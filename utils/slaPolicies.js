// SLA objectives (v5.1, conception/v5.md §3.5): a time to first response (TTO) and a time to
// resolution (TTR), counted in business hours on the ticket's calendar (its team's, else the
// space's; none = around the clock). The resolution clock pauses while the ticket waits (a status
// of kind « waiting ») and stops when it is resolved or closed.
// An objective applies by criteria (priorities, types, subjects — a category covers its
// sub-categories —, channels); the most precise one wins, then the first in the list.
// The deadlines are stored on the ticket (tto_due_at, ttr_due_at) and computed again when what
// they depend on changes — so « overdue » is a plain SQL condition.
// The deadlines per stage (sla_*_hours, per status, per subject) are a separate, older mechanism,
// unchanged.
const { parseJsonField } = require('./jsonField');
const cal = require('./calendars');

const MAX_POLICIES = 30;
const MAX_MINUTES = 365 * 24 * 60;
const PRIORITIES = ['low', 'normal', 'urgent'];
const TYPES = ['incident', 'request'];
const CHANNELS = ['discord', 'email', 'web'];
const channelOf = ownerId => (/^mail:/.test(ownerId) ? 'email' : /^web:/.test(ownerId) ? 'web' : 'discord');
const SEP = ' › ';

const shape = r => ({
  id: r.id, name: r.name, position: r.position, active: !!Number(r.active), businessHours: !!Number(r.business_hours),
  ttoMinutes: r.tto_minutes, ttrMinutes: r.ttr_minutes, conditions: { priorities: [], types: [], subjects: [], channels: [], organizations: [], ...(parseJsonField(r.conditions, {}) || {}) },
});
async function listPolicies(db, { escalations = false } = {}) {
  const list = (await db('SELECT * FROM sla_policies ORDER BY position, id').catch(() => [])).map(shape);
  if (escalations) for (const p of list) p.escalations = await require('./slaEscalation').levelsOf(db, { policyId: p.id });
  return list;
}

function clean(input = {}) {
  const name = typeof input.name === 'string' ? input.name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60) : '';
  if (!name) return { error: 'Nom de l\'objectif requis (60 caractères au plus)' };
  const mins = v => (v === null || v === undefined || v === '' ? null : Number(v));
  const tto = mins(input.ttoMinutes), ttr = mins(input.ttrMinutes);
  for (const [v, n] of [[tto, 'Prise en charge'], [ttr, 'Résolution']]) if (v !== null && !(Number.isInteger(v) && v > 0 && v <= MAX_MINUTES)) return { error: `${n} : une durée en minutes, d'une minute à un an` };
  if (tto === null && ttr === null) return { error: 'Donne au moins un délai : prise en charge ou résolution' };
  const list = (v, allowed, max = 60) => [...new Set((Array.isArray(v) ? v : []).map(String))].filter(x => !allowed || allowed.includes(x)).slice(0, max);
  const c = input.conditions || {};
  const conditions = { priorities: list(c.priorities, PRIORITIES), types: list(c.types, TYPES), subjects: list(c.subjects, null).map(x => x.slice(0, 100)), channels: list(c.channels, CHANNELS),
    organizations: [...new Set((Array.isArray(c.organizations) ? c.organizations : []).map(Number).filter(Number.isInteger))].slice(0, 100) };
  return { value: { name, ttoMinutes: tto, ttrMinutes: ttr, conditions, businessHours: input.businessHours !== false, active: input.active !== false } };
}

async function savePolicy(db, id, input) {
  const r = clean(input);
  if (r.error) return r;
  const v = r.value;
  const E = require('./slaEscalation');
  const esc = await E.cleanLevels(db, input.escalations, ['tto', 'ttr']);
  if (esc.error) return esc;
  const vals = [v.name, v.ttoMinutes, v.ttrMinutes, JSON.stringify(v.conditions), v.businessHours ? 1 : 0, v.active ? 1 : 0];
  if (id) {
    const res = await db('UPDATE sla_policies SET name = ?, tto_minutes = ?, ttr_minutes = ?, conditions = ?, business_hours = ?, active = ? WHERE id = ?', [...vals, id]);
    if (!res.affectedRows) return { error: 'Objectif introuvable', status: 404 };
  } else {
    const [n] = await db('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS pos FROM sla_policies');
    if (Number(n.n) >= MAX_POLICIES) return { error: `${MAX_POLICIES} objectifs au plus` };
    id = (await db('INSERT INTO sla_policies (name, tto_minutes, ttr_minutes, conditions, business_hours, active, position) VALUES (?, ?, ?, ?, ?, ?, ?)', [...vals, Number(n.pos) + 1])).insertId;
  }
  await E.saveLevels(db, { policyId: id }, esc.value);
  return { ok: true, id };
}
async function deletePolicy(db, id) {
  const r = await db('DELETE FROM sla_policies WHERE id = ?', [id]);
  if (!r.affectedRows) return { error: 'Objectif introuvable', status: 404 };
  await require('./slaEscalation').dropLevels(db, { policyId: id });
  return { ok: true };
}
async function reorderPolicies(db, ids) {
  let pos = 1;
  for (const id of (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger).slice(0, MAX_POLICIES)) await db('UPDATE sla_policies SET position = ? WHERE id = ?', [pos++, id]);
}

// Does an objective take this ticket? An empty criterion takes everything
function matches(p, t) {
  const c = p.conditions;
  if (c.priorities.length && !c.priorities.includes(t.priority)) return false;
  if (c.types.length && !c.types.includes(t.ticket_type || 'request')) return false;
  if (c.channels.length && !c.channels.includes(channelOf(t.owner_id))) return false;
  // An organisation's objective covers its sub-organisations (t.org_parent_id, read by refreshSla)
  if (c.organizations.length && !c.organizations.some(id => id === Number(t.organization_id) || id === Number(t.org_parent_id))) return false;
  if (c.subjects.length) {
    const s = String(t.subject || '');
    if (!c.subjects.some(x => s === x || s.startsWith(`${x}${SEP}`))) return false;
  }
  return true;
}
const precision = p => Object.values(p.conditions).filter(v => v.length).length;
function pickPolicy(policies, t) {
  return policies.filter(p => p.active && matches(p, t)).sort((a, b) => precision(b) - precision(a) || a.position - b.position || a.id - b.id)[0] || null;
}

const toDate = ms => (ms == null ? null : new Date(ms));
// The deadlines of one ticket, from its creation and what it has spent waiting
async function refreshSla(db, ticketId, { policies = null } = {}) {
  const [t] = await db('SELECT t.*, o.parent_id AS org_parent_id FROM tickets t LEFT JOIN organizations o ON o.id = t.organization_id WHERE t.id = ?', [ticketId]);
  if (!t) return null;
  const p = pickPolicy(policies || await listPolicies(db), t);
  if (!p) {
    if (t.sla_policy_id || t.tto_due_at || t.ttr_due_at) await db('UPDATE tickets SET sla_policy_id = NULL, tto_due_at = NULL, ttr_due_at = NULL WHERE id = ?', [t.id]);
    return null;
  }
  const c = p.businessHours ? await cal.calendarForTicket(db, t) : null;
  const k = c ? cal.asCal(c) : null;
  const start = new Date(t.created_at).getTime();
  const add = (from, minutes) => (k ? cal.addBusinessMinutes(k, from, minutes) : from + minutes * 60000);
  const tto = p.ttoMinutes ? toDate(add(start, p.ttoMinutes)) : null;
  const ttr = p.ttrMinutes ? toDate(add(start, p.ttrMinutes + Number(t.sla_paused_minutes || 0))) : null;
  await db('UPDATE tickets SET sla_policy_id = ?, tto_due_at = ?, ttr_due_at = ? WHERE id = ?', [p.id, tto, ttr, t.id]);
  return { policyId: p.id, ttoDueAt: tto, ttrDueAt: ttr };
}
const refreshQuietly = (db, ticketId) => refreshSla(db, ticketId).catch(err => console.error('sla: calcul', ticketId, err.message));

// Stage changes: entering a « waiting » status pauses the resolution clock, leaving it resumes it
// (the business time spent waiting moves the resolution deadline)
async function onStageChange(db, ticketId, kind) {
  const [t] = await db('SELECT * FROM tickets WHERE id = ?', [ticketId]);
  if (!t || t.status !== 'open') return;
  if (kind === 'waiting') {
    if (!t.sla_paused_at) await db('UPDATE tickets SET sla_paused_at = NOW() WHERE id = ?', [t.id]);
    return;
  }
  if (!t.sla_paused_at) return;
  await require('./slaEscalation').onResume(db, t).catch(err => console.error('ola: reprise', t.id, err.message));
  const [p] = t.sla_policy_id ? await db('SELECT business_hours FROM sla_policies WHERE id = ?', [t.sla_policy_id]) : [];
  const c = p && Number(p.business_hours) ? await cal.calendarForTicket(db, t) : null;
  const from = new Date(t.sla_paused_at).getTime(), now = Date.now();
  const paused = c ? cal.businessMinutes(cal.asCal(c), from, now) : Math.round((now - from) / 60000);
  await db('UPDATE tickets SET sla_paused_at = NULL, sla_paused_minutes = sla_paused_minutes + ? WHERE id = ?', [paused, t.id]);
  await refreshQuietly(db, t.id);
}

// After a change of the objectives: every open ticket gets its deadlines again
async function refreshOpenTickets(db) {
  const policies = await listPolicies(db);
  const ids = (await db("SELECT id FROM tickets WHERE status = 'open' ORDER BY id DESC LIMIT 5000")).map(r => r.id);
  const { refreshOla } = require('./slaEscalation');
  for (const id of ids) { await refreshSla(db, id, { policies }).catch(() => null); await refreshOla(db, id).catch(() => null); }
  return ids.length;
}

// State of the two objectives, for the ticket view and the list
const WARNING_RATIO = 0.25; // « warning » in the last quarter of the time
function objectiveState(dueAt, metAt, startMs, now) {
  if (!dueAt) return null;
  const due = new Date(dueAt).getTime();
  if (metAt) return { dueAt: new Date(due).toISOString(), state: new Date(metAt).getTime() <= due ? 'met' : 'missed' };
  if (now >= due) return { dueAt: new Date(due).toISOString(), state: 'breached', minutesLate: Math.round((now - due) / 60000) };
  const total = due - startMs;
  return { dueAt: new Date(due).toISOString(), state: total > 0 && (due - now) / total <= WARNING_RATIO ? 'warning' : 'ok', minutesLeft: Math.round((due - now) / 60000) };
}
function objectives(t, now = Date.now()) {
  if (!t?.sla_policy_id && !t?.ola_due_at) return null;
  const start = new Date(t.created_at).getTime();
  const done = t.resolved_at || t.closed_at;
  const pause = o => (o && t.sla_paused_at && !done ? { ...o, state: 'paused' } : o);
  // OLA (utils/slaEscalation.js): the team's own time, from when the ticket came to it
  const ola = t.ola_due_at ? objectiveState(t.ola_due_at, done, new Date(t.team_since || t.created_at).getTime(), now) : null;
  return {
    policyId: t.sla_policy_id || null,
    tto: t.sla_policy_id ? objectiveState(t.tto_due_at, t.first_response_at, start, now) : null,
    ttr: t.sla_policy_id ? pause(objectiveState(t.ttr_due_at, done, start, now)) : null,
    ola: ola ? { ...pause(ola), teamId: t.team_id } : null,
  };
}
// SQL: a ticket that has missed one of its objectives and is still open (« Hors délai » view)
const OBJECTIVE_BREACHED_SQL = `(status = 'open' AND ((first_response_at IS NULL AND tto_due_at IS NOT NULL AND tto_due_at < NOW())
  OR (resolved_at IS NULL AND sla_paused_at IS NULL AND ttr_due_at IS NOT NULL AND ttr_due_at < NOW())
  OR (resolved_at IS NULL AND sla_paused_at IS NULL AND ola_due_at IS NOT NULL AND ola_due_at < NOW())))`;

module.exports = { PRIORITIES, TYPES, CHANNELS, listPolicies, savePolicy, deletePolicy, reorderPolicies, pickPolicy, matches, refreshSla, refreshQuietly, onStageChange, refreshOpenTickets, objectives, OBJECTIVE_BREACHED_SQL, channelOf };

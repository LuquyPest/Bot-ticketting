// Service catalogue (v5.3, conception/v5.md §3.12): what the requester can ask for, by category,
// each service with its icon and description (« Demander un accès », « Signaler une panne »…).
// A service opens its form — fields (text, long text, number, list, checkbox, date) with display
// conditions (« if Hardware = Laptop, ask for the model »), required fields and defaults — and
// sets what the ticket becomes (template): ticket category, type, team, priority.
// The opening forms of before (intake_forms) were copied as services by migration 65.
const { parseJsonField } = require('./jsonField');

const TYPES = ['text', 'textarea', 'number', 'select', 'checkbox', 'date'];
const MAX_SERVICES = 100, MAX_FIELDS = 20;
const KEY_RE = /^[a-z][a-z0-9_]{0,29}$/;

const shape = r => ({
  id: r.id, name: r.name, description: r.description || '', icon: r.icon || '', category: r.category || '', position: r.position, active: !!Number(r.active),
  fields: parseJsonField(r.fields, []) || [],
  template: { subject: r.subject || null, type: r.ticket_type || null, teamId: r.team_id || null, priority: r.priority || null },
  organizationIds: (parseJsonField(r.organization_ids, []) || []).map(Number).filter(Boolean), // v8: [] = everyone
});
async function listServices(db, { activeOnly = false } = {}) {
  return (await db(`SELECT * FROM catalog_services ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY category, position, name`).catch(() => [])).map(shape);
}
const serviceOf = async (db, id, opts) => (await listServices(db, opts)).find(s => s.id === Number(id)) || null;

function cleanFields(input) {
  if (!Array.isArray(input) || input.length > MAX_FIELDS) return { error: `${MAX_FIELDS} champs au plus` };
  const out = [];
  for (const [i, f] of input.entries()) {
    const label = typeof f?.label === 'string' ? f.label.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
    if (!label) return { error: `Champ ${i + 1} : libellé requis` };
    const type = TYPES.includes(f.type) ? f.type : 'text';
    const key = KEY_RE.test(f.key || '') ? f.key : `f${i + 1}`;
    if (out.some(x => x.key === key)) return { error: `Deux champs ont la clé « ${key} »` };
    const choices = type === 'select' ? [...new Set((Array.isArray(f.choices) ? f.choices : String(f.choices || '').split('\n')).map(c => String(c).trim().slice(0, 100)).filter(Boolean))].slice(0, 25) : [];
    if (type === 'select' && choices.length < 2) return { error: `« ${label} » : au moins deux choix` };
    let showIf = null;
    if (f.showIf && f.showIf.key) {
      const target = out.find(x => x.key === f.showIf.key);
      if (!target) return { error: `« ${label} » : la condition doit porter sur un champ placé avant` };
      showIf = { key: target.key, equals: String(f.showIf.equals ?? '').slice(0, 100) };
      if (target.type === 'select' && !target.choices.includes(showIf.equals)) return { error: `« ${label} » : « ${showIf.equals} » n'est pas un choix de « ${target.label} »` };
    }
    const def = f.default === undefined || f.default === null ? '' : String(f.default).slice(0, 200);
    out.push({ key, label, type, choices, required: !!f.required, default: def, showIf });
  }
  return { value: out };
}

async function clean(db, input = {}) {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  if (!name) return { error: 'Nom du service requis (80 caractères au plus)' };
  const fields = cleanFields(input.fields || []);
  if (fields.error) return fields;
  const t = input.template || {};
  let subject = null;
  if (t.subject) {
    const [cfg] = await db('SELECT ticket_subjects FROM guild_config WHERE id = 1');
    const known = parseJsonField(cfg?.ticket_subjects, []).map(x => (typeof x === 'string' ? x : x?.label || x?.name)).filter(Boolean);
    if (!known.includes(t.subject)) return { error: 'Sujet inconnu (Paramètres → Tickets → Sujets)' };
    subject = t.subject;
  }
  const teamId = t.teamId ? Number(t.teamId) : null;
  if (teamId && !(await db('SELECT 1 FROM teams WHERE id = ?', [teamId])).length) return { error: 'Équipe introuvable' };
  const organizationIds = [...new Set((Array.isArray(input.organizationIds) ? input.organizationIds : []).map(Number).filter(n => n > 0))].slice(0, 200);
  if (organizationIds.length && Number((await db('SELECT COUNT(*) AS n FROM organizations WHERE id IN (?)', [organizationIds]))[0].n) < organizationIds.length) return { error: 'Organisation introuvable' };
  return { value: {
    name, description: typeof input.description === 'string' ? input.description.trim().slice(0, 300) : '',
    icon: typeof input.icon === 'string' ? [...input.icon.trim()].slice(0, 4).join('') : '', category: typeof input.category === 'string' ? input.category.replace(/\s+/g, ' ').trim().slice(0, 60) : '',
    active: input.active !== false, fields: fields.value, organizationIds,
    subject, type: ['incident', 'request'].includes(t.type) ? t.type : null, teamId, priority: ['low', 'normal', 'urgent'].includes(t.priority) ? t.priority : null,
  } };
}
async function saveService(db, id, input) {
  const r = await clean(db, input);
  if (r.error) return r;
  const v = r.value;
  const vals = [v.name, v.description || null, v.icon || null, v.category || null, v.active ? 1 : 0, JSON.stringify(v.fields), v.subject, v.type, v.teamId, v.priority, v.organizationIds.length ? JSON.stringify(v.organizationIds) : null];
  if (id) {
    const res = await db('UPDATE catalog_services SET name = ?, description = ?, icon = ?, category = ?, active = ?, fields = ?, subject = ?, ticket_type = ?, team_id = ?, priority = ?, organization_ids = ? WHERE id = ?', [...vals, id]);
    if (!res.affectedRows) return { error: 'Service introuvable', status: 404 };
    return { ok: true, id };
  }
  const [n] = await db('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS pos FROM catalog_services');
  if (Number(n.n) >= MAX_SERVICES) return { error: `${MAX_SERVICES} services au plus` };
  const ins = await db('INSERT INTO catalog_services (name, description, icon, category, active, fields, subject, ticket_type, team_id, priority, organization_ids, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [...vals, Number(n.pos) + 1]);
  return { ok: true, id: ins.insertId };
}
async function deleteService(db, id) {
  const r = await db('DELETE FROM catalog_services WHERE id = ?', [id]);
  return r.affectedRows ? { ok: true } : { error: 'Service introuvable', status: 404 };
}

// Is a field shown, given the answers? A field hidden by its condition is never required nor kept
function shown(field, answers, fields) {
  if (!field.showIf) return true;
  const target = fields.find(f => f.key === field.showIf.key);
  if (target && !shown(target, answers, fields)) return false;
  const v = answers[field.showIf.key];
  return String(target?.type === 'checkbox' ? (v === true || v === 'true' ? 'oui' : 'non') : v ?? '') === field.showIf.equals;
}
// The answers checked against the form: { value: [{ label, text }] } or { error: { key, label, reason } }
function checkAnswers(service, raw = {}) {
  const answers = raw && typeof raw === 'object' ? raw : {};
  const out = [];
  for (const f of service.fields) {
    if (!shown(f, answers, service.fields)) continue;
    let v = answers[f.key];
    if (f.type === 'checkbox') {
      const on = v === true || v === 'true';
      if (f.required && !on) return { error: { label: f.label, reason: 'required' } };
      out.push({ key: f.key, label: f.label, text: on ? 'oui' : 'non' });
      continue;
    }
    v = String(v ?? '').trim().slice(0, f.type === 'textarea' ? 2000 : 300);
    if (!v) { if (f.required) return { error: { label: f.label, reason: 'required' } }; continue; }
    if (f.type === 'number' && !/^-?\d+([.,]\d+)?$/.test(v)) return { error: { label: f.label, reason: 'number' } };
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: { label: f.label, reason: 'date' } };
    if (f.type === 'select' && !f.choices.includes(v)) return { error: { label: f.label, reason: 'choice' } };
    out.push({ key: f.key, label: f.label, text: v });
  }
  return { value: out };
}
const summaryOf = (service, rows) => [`🧾 **${service.name}**`, ...rows.map(r => `**${r.label}** : ${r.text}`)].join('\n');

// After the opening: the template of the service (type, team, priority) — the subject was given at the opening
async function applyTemplate({ db, client, guildId, ticketId, service }) {
  const tm = require('./ticketManager').createManager(db, client, guildId);
  const actor = { id: 'system', tag: `Catalogue · ${service.name}`, username: `Catalogue · ${service.name}`, source: 'system' };
  const t = service.template;
  if (t.type) {
    await db('UPDATE tickets SET ticket_type = ? WHERE id = ?', [t.type, ticketId]);
    await require('./slaPolicies').refreshQuietly(db, ticketId);
  }
  if (t.priority) await tm.setPriority(ticketId, t.priority, actor);
  if (t.teamId) {
    const [row] = await db('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    if (row) await require('./teams').routeTicket({ db, tm, ticket: row, teamId: t.teamId, actor });
  }
  await db('UPDATE tickets SET catalog_service_id = ? WHERE id = ?', [service.id, ticketId]);
}

// v8: the services a requester sees — those for everyone, and those of their organisations
// (a parent organisation's services count for its sub-organisations)
async function memberOrgs(db, ids) {
  const rows = await db('SELECT c.organization_id, o.parent_id FROM contact_identities ci JOIN contacts c ON c.id = ci.contact_id LEFT JOIN organizations o ON o.id = c.organization_id WHERE ci.value IN (?) AND c.organization_id IS NOT NULL', [ids.length ? ids : ['-']]).catch(() => []);
  return [...new Set(rows.flatMap(r => [r.organization_id, r.parent_id]).filter(Boolean).map(Number))];
}
const visibleTo = (service, orgs) => !service.organizationIds.length || service.organizationIds.some(id => orgs.includes(id));

module.exports = { memberOrgs, visibleTo, TYPES, listServices, serviceOf, cleanFields, saveService, deleteService, shown, checkAnswers, summaryOf, applyTemplate };

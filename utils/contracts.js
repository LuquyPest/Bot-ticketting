// Contracts of the organisations (v7, conception/v7.md §3.3): a block of hours, a number of tickets,
// or unlimited support, from a start date to an optional end date, with an optional SLA objective
// that its organisation's tickets get (utils/slaPolicies.js). Consumption is computed: the time
// spent on the organisation's tickets (sub-organisations included) during the contract, or the
// tickets opened during it. The founders and the account manager are told once at the threshold
// and once before the end; a contract that renews itself is followed by the next one.
const { recordEvent, SYSTEM } = require('./audit');

const KINDS = ['hours', 'tickets', 'unlimited'];
const MAX_PER_ORG = 50;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ymd = d => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : (d ? String(d).slice(0, 10) : null));
const today = () => ymd(new Date());

const shape = (c, used) => {
  const quota = c.kind === 'unlimited' ? null : Number(c.quota || 0);
  const start = ymd(c.starts_on), end = ymd(c.ends_on);
  const now = today();
  const state = start > now ? 'upcoming' : end && end < now ? 'ended' : 'active';
  return {
    id: c.id, organizationId: c.organization_id, name: c.name, kind: c.kind, quota, startsOn: start, endsOn: end,
    slaPolicyId: c.sla_policy_id || null, alertPercent: Number(c.alert_percent ?? 80), alertDays: Number(c.alert_days ?? 30), autoRenew: !!Number(c.auto_renew),
    renewalOf: c.renewal_of || null, notes: c.notes || '', state,
    used, remaining: quota === null ? null : Math.max(0, quota - used), percent: quota ? Math.round((100 * used) / quota) : null,
  };
};

// The organisation and its sub-organisations
async function orgFamily(db, orgId) {
  const rows = await db('SELECT id FROM organizations WHERE id = ? OR parent_id = ?', [orgId, orgId]).catch(() => []);
  return rows.map(r => r.id);
}
// Hours (in minutes) or tickets used by a contract
async function usage(db, c) {
  if (c.kind === 'unlimited' && !c.forceCount) return 0;
  const orgs = await orgFamily(db, c.organization_id);
  if (!orgs.length) return 0;
  const from = ymd(c.starts_on), to = ymd(c.ends_on) || '9999-12-31';
  if (c.kind === 'tickets') {
    const [r] = await db('SELECT COUNT(*) AS n FROM tickets WHERE organization_id IN (?) AND merged_into IS NULL AND DATE(created_at) BETWEEN ? AND ?', [orgs, from, to]);
    return Number(r.n);
  }
  const [r] = await db(`SELECT COALESCE(SUM(COALESCE(tt.seconds, 0)), 0) AS s FROM ticket_time tt JOIN tickets t ON t.id = tt.ticket_id
    WHERE t.organization_id IN (?) AND DATE(tt.started_at) BETWEEN ? AND ?`, [orgs, from, to]);
  return Math.round(Number(r.s) / 60);
}

async function listContracts(db, orgId) {
  const rows = await db('SELECT * FROM contracts WHERE organization_id = ? ORDER BY starts_on DESC, id DESC', [orgId]).catch(() => []);
  return Promise.all(rows.map(async c => shape(c, await usage(db, c))));
}
// The contract in force for an organisation (or its parent): the latest started, or null
async function activeFor(db, orgId) {
  if (!orgId) return null;
  const [o] = await db('SELECT id, parent_id FROM organizations WHERE id = ?', [orgId]).catch(() => []);
  if (!o) return null;
  const now = today();
  for (const id of [o.id, o.parent_id].filter(Boolean)) {
    const [c] = await db('SELECT * FROM contracts WHERE organization_id = ? AND starts_on <= ? AND (ends_on IS NULL OR ends_on >= ?) ORDER BY starts_on DESC, id DESC LIMIT 1', [id, now, now]).catch(() => []);
    if (c) return shape(c, await usage(db, c));
  }
  return null;
}

async function clean(db, input = {}) {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
  if (!name) return { error: 'Nom du contrat requis' };
  if (!KINDS.includes(input.kind)) return { error: 'Type : forfait d\'heures, nombre de tickets ou illimité' };
  let quota = null;
  if (input.kind !== 'unlimited') {
    quota = Number(input.quota);
    if (!Number.isInteger(quota) || quota <= 0 || quota > 10000000) return { error: input.kind === 'hours' ? 'Forfait : un nombre de minutes positif' : 'Nombre de tickets positif' };
  }
  if (!DATE_RE.test(String(input.startsOn || ''))) return { error: 'Date de début requise (AAAA-MM-JJ)' };
  const endsOn = input.endsOn ? String(input.endsOn) : null;
  if (endsOn && (!DATE_RE.test(endsOn) || endsOn < input.startsOn)) return { error: 'La fin doit suivre le début' };
  const slaPolicyId = input.slaPolicyId ? Number(input.slaPolicyId) : null;
  if (slaPolicyId && !(await db('SELECT 1 FROM sla_policies WHERE id = ?', [slaPolicyId])).length) return { error: 'Objectif SLA introuvable' };
  const alertPercent = input.alertPercent === undefined ? 80 : Number(input.alertPercent);
  if (!Number.isInteger(alertPercent) || alertPercent < 0 || alertPercent > 100) return { error: 'Seuil d\'alerte : de 0 à 100 % (0 : jamais)' };
  const alertDays = input.alertDays === undefined ? 30 : Number(input.alertDays);
  if (!Number.isInteger(alertDays) || alertDays < 0 || alertDays > 365) return { error: 'Alerte avant la fin : de 0 à 365 jours (0 : jamais)' };
  const autoRenew = !!input.autoRenew;
  if (autoRenew && !endsOn) return { error: 'Un contrat qui se renouvelle a une date de fin' };
  return { value: { name, kind: input.kind, quota, startsOn: input.startsOn, endsOn, slaPolicyId, alertPercent, alertDays, autoRenew, notes: typeof input.notes === 'string' ? input.notes.slice(0, 2000) : '' } };
}

async function saveContract(db, orgId, id, input, actor) {
  if (!(await db('SELECT 1 FROM organizations WHERE id = ?', [orgId])).length) return { error: 'Organisation introuvable', status: 404 };
  const r = await clean(db, input);
  if (r.error) return r;
  const v = r.value;
  if (id) {
    const res = await db(`UPDATE contracts SET name = ?, kind = ?, quota = ?, starts_on = ?, ends_on = ?, sla_policy_id = ?, alert_percent = ?, alert_days = ?, auto_renew = ?, notes = ?,
      quota_alerted_at = NULL, end_alerted_at = NULL WHERE id = ? AND organization_id = ?`,
    [v.name, v.kind, v.quota, v.startsOn, v.endsOn, v.slaPolicyId, v.alertPercent, v.alertDays, v.autoRenew ? 1 : 0, v.notes || null, id, orgId]);
    if (!res.affectedRows) return { error: 'Contrat introuvable', status: 404 };
  } else {
    const [{ n }] = await db('SELECT COUNT(*) AS n FROM contracts WHERE organization_id = ?', [orgId]);
    if (Number(n) >= MAX_PER_ORG) return { error: `${MAX_PER_ORG} contrats au plus par organisation` };
    id = (await db('INSERT INTO contracts (organization_id, name, kind, quota, starts_on, ends_on, sla_policy_id, alert_percent, alert_days, auto_renew, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [orgId, v.name, v.kind, v.quota, v.startsOn, v.endsOn, v.slaPolicyId, v.alertPercent, v.alertDays, v.autoRenew ? 1 : 0, v.notes || null])).insertId;
  }
  await recordEvent(db, { actor, action: 'contract_save', targetType: 'organization', targetId: orgId, details: { id, name: v.name } });
  await refreshOrgSla(db, orgId);
  return { ok: true, id };
}
async function deleteContract(db, orgId, id, actor) {
  const r = await db('DELETE FROM contracts WHERE id = ? AND organization_id = ?', [id, orgId]);
  if (!r.affectedRows) return { error: 'Contrat introuvable', status: 404 };
  await recordEvent(db, { actor, action: 'contract_delete', targetType: 'organization', targetId: orgId, details: { id } });
  await refreshOrgSla(db, orgId);
  return { ok: true };
}
// The SLA of the open tickets of the organisation follows its contract
async function refreshOrgSla(db, orgId) {
  const ids = await orgFamily(db, orgId);
  if (!ids.length) return;
  for (const t of await db("SELECT id FROM tickets WHERE organization_id IN (?) AND status = 'open'", [ids]).catch(() => [])) await require('./slaPolicies').refreshQuietly(db, t.id);
}
// The SLA objective a ticket gets from its organisation's contract, or null
async function policyForTicket(db, t) {
  if (!t.organization_id) return null;
  const c = await activeFor(db, t.organization_id);
  return c?.slaPolicyId || null;
}

// ── Daily job: thresholds, ends and renewals ──
async function tell(db, guildId, c, title, body) {
  const [o] = await db('SELECT name, manager_id FROM organizations WHERE id = ?', [c.organization_id]).catch(() => []);
  const founders = (await db("SELECT user_id FROM dashboard_users WHERE role = 'fondateur'").catch(() => [])).map(r => r.user_id);
  const who = [...new Set([...founders, o?.manager_id].filter(Boolean).map(String))];
  for (const uid of who) require('./sse').sendToUser(guildId, uid, 'followed', { ticketId: null, kind: 'contract', title: `${title} · ${o?.name || ''}`.slice(0, 120), body: body.slice(0, 160) });
}
async function checkContracts(db, guildId) {
  const now = today();
  let alerts = 0, renewed = 0;
  for (const c of await db('SELECT * FROM contracts WHERE starts_on <= ?', [now]).catch(() => [])) {
    const s = shape(c, await usage(db, c));
    if (s.state === 'active' && s.quota && s.alertPercent && s.percent >= s.alertPercent && !c.quota_alerted_at) {
      await db('UPDATE contracts SET quota_alerted_at = NOW() WHERE id = ?', [c.id]);
      await recordEvent(db, { actor: SYSTEM, action: 'contract_alert', targetType: 'organization', targetId: c.organization_id, details: { id: c.id, percent: s.percent } });
      await tell(db, guildId, c, `Contrat « ${c.name} » consommé à ${s.percent} %`, s.kind === 'hours' ? `${Math.round(s.used / 6) / 10} h sur ${Math.round(s.quota / 6) / 10} h` : `${s.used} tickets sur ${s.quota}`);
      alerts++;
    }
    if (s.state === 'active' && s.endsOn && s.alertDays && !c.end_alerted_at && !s.autoRenew) {
      const days = Math.round((new Date(`${s.endsOn}T00:00:00`) - new Date(`${now}T00:00:00`)) / 864e5);
      if (days <= s.alertDays) {
        await db('UPDATE contracts SET end_alerted_at = NOW() WHERE id = ?', [c.id]);
        await recordEvent(db, { actor: SYSTEM, action: 'contract_alert', targetType: 'organization', targetId: c.organization_id, details: { id: c.id, days } });
        await tell(db, guildId, c, `Contrat « ${c.name} » : fin le ${s.endsOn}`, `Dans ${days} jour(s)`);
        alerts++;
      }
    }
    // Ended and renewing itself: the next contract, same length, from the day after (once)
    if (s.state === 'ended' && s.autoRenew && !(await db('SELECT 1 FROM contracts WHERE renewal_of = ?', [c.id])).length) {
      const start = new Date(`${s.endsOn}T00:00:00`); start.setDate(start.getDate() + 1);
      const len = Math.round((new Date(`${s.endsOn}T00:00:00`) - new Date(`${s.startsOn}T00:00:00`)) / 864e5);
      const end = new Date(start); end.setDate(end.getDate() + len);
      const id = (await db('INSERT INTO contracts (organization_id, name, kind, quota, starts_on, ends_on, sla_policy_id, alert_percent, alert_days, auto_renew, notes, renewal_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
        [c.organization_id, c.name, c.kind, c.quota, ymd(start), ymd(end), c.sla_policy_id, c.alert_percent, c.alert_days, c.notes, c.id])).insertId;
      await recordEvent(db, { actor: SYSTEM, action: 'contract_renew', targetType: 'organization', targetId: c.organization_id, details: { from: c.id, id } });
      renewed++;
    }
  }
  return { alerts, renewed };
}
async function runContractCheck() {
  const { getActiveGuilds } = require('./guildScan');
  const { getTenantDb } = require('./tenantDb');
  for (const { guild_id } of await getActiveGuilds()) {
    await checkContracts(getTenantDb(guild_id), guild_id).catch(err => console.error('contrats:', guild_id, err.message));
  }
}

module.exports = { KINDS, listContracts, activeFor, saveContract, deleteContract, policyForTicket, checkContracts, runContractCheck, usage };

// Licences and warranties of the inventory (v8, conception/v8.md §3.6).
// - Any element can carry an end of warranty and an end of vendor support; an element with a
//   number of seats is a licence: it has an expiry date and a cost, and is assigned to people
//   (contacts, staff) or to elements (computers). Seats used / free; over the seats is flagged.
// - A daily job warns (dashboard notification to the founders and the space's e-mail of each of
//   them when they have one) 30 days, then 7 days before a warranty, a support or a licence ends —
//   once per date and threshold.
const { recordEvent } = require('./audit');

const KINDS = ['contact', 'staff', 'asset'];
const THRESHOLDS = [30, 7];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ymd = d => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d ? String(d).slice(0, 10) : null);
const today = () => ymd(new Date());
const daysUntil = d => Math.round((new Date(`${ymd(d)}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 864e5);
const SYSTEM = { id: 'system', tag: 'Parc', username: 'Parc', source: 'system' };

// The lifecycle fields given with an element → columns, or { error }
function clean(input = {}) {
  const v = {};
  for (const [k, col] of [['warrantyEndsOn', 'warranty_ends_on'], ['supportEndsOn', 'support_ends_on'], ['licenceExpiresOn', 'licence_expires_on']]) {
    if (input[k] === undefined) continue;
    if (input[k] && !DATE_RE.test(String(input[k]))) return { error: 'Date au format AAAA-MM-JJ' };
    v[col] = input[k] || null;
  }
  if (input.seats !== undefined) {
    const n = input.seats === null || input.seats === '' ? null : Number(input.seats);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 1000000)) return { error: 'Nombre de sièges : un entier positif' };
    v.seats = n;
  }
  if (input.cost !== undefined) {
    const c = input.cost === null || input.cost === '' ? null : Number(input.cost);
    if (c !== null && (!Number.isFinite(c) || c < 0 || c > 1e9)) return { error: 'Coût invalide' };
    v.cost = c;
  }
  return { value: v };
}

// What the asset view shows: dates, days left, seats
async function lifecycleOf(db, asset) {
  const out = { warrantyEndsOn: ymd(asset.warranty_ends_on), supportEndsOn: ymd(asset.support_ends_on), licenceExpiresOn: ymd(asset.licence_expires_on),
    seats: asset.seats == null ? null : Number(asset.seats), cost: asset.cost == null ? null : Number(asset.cost), assignments: [], used: 0 };
  if (out.seats != null) {
    out.assignments = await assignmentsOf(db, asset.id);
    out.used = out.assignments.length;
  }
  out.over = out.seats != null && out.used > out.seats;
  return out;
}

async function assignmentsOf(db, licenceId) {
  const rows = await db(`SELECT a.*, c.display_name AS contact_name, u.username AS staff_name, x.name AS asset_name FROM asset_assignments a
    LEFT JOIN contacts c ON a.kind = 'contact' AND c.id = a.ref LEFT JOIN dashboard_users u ON a.kind = 'staff' AND u.user_id = a.ref LEFT JOIN assets x ON a.kind = 'asset' AND x.id = a.ref
    WHERE a.licence_id = ? ORDER BY a.id`, [licenceId]).catch(() => []);
  return rows.map(r => ({ id: r.id, kind: r.kind, ref: r.ref, label: r.contact_name || r.staff_name || r.asset_name || r.ref, assignedAt: r.assigned_at }));
}
async function assign(db, licenceId, { kind, ref }, actor) {
  const [l] = await db('SELECT id, name, seats FROM assets WHERE id = ?', [licenceId]);
  if (!l) return { error: 'Élément introuvable', status: 404 };
  if (l.seats == null) return { error: 'Cet élément n\'est pas une licence (pas de nombre de sièges)' };
  if (!KINDS.includes(kind)) return { error: 'Attribuer à : contact, staff ou asset' };
  const r = String(ref || '').trim();
  const exists = kind === 'contact' ? await db('SELECT 1 FROM contacts WHERE id = ?', [Number(r) || 0])
    : kind === 'staff' ? await db("SELECT 1 FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [r])
      : await db('SELECT 1 FROM assets WHERE id = ? AND id <> ?', [Number(r) || 0, licenceId]);
  if (!exists.length) return { error: 'Introuvable' };
  const ins = await db('INSERT IGNORE INTO asset_assignments (licence_id, kind, ref) VALUES (?, ?, ?)', [licenceId, kind, r]);
  if (!ins.affectedRows) return { error: 'Déjà attribuée' };
  await db('INSERT INTO asset_history (asset_id, actor_tag, changes) VALUES (?, ?, ?)', [licenceId, String(actor?.tag || actor?.username || '').slice(0, 100), JSON.stringify({ assigned: `${kind}:${r}` })]).catch(() => null);
  const used = Number((await db('SELECT COUNT(*) AS n FROM asset_assignments WHERE licence_id = ?', [licenceId]))[0].n);
  return { ok: true, over: used > Number(l.seats), used };
}
async function unassign(db, licenceId, assignmentId) {
  const r = await db('DELETE FROM asset_assignments WHERE id = ? AND licence_id = ?', [assignmentId, licenceId]);
  return r.affectedRows ? { ok: true } : { error: 'Attribution introuvable', status: 404 };
}

// Elements whose warranty, support or licence ends within `days` (the « expire bientôt » filter)
async function expiringSoon(db, days = 30) {
  const until = ymd(new Date(Date.now() + days * 864e5));
  const rows = await db(`SELECT id, name, warranty_ends_on, support_ends_on, licence_expires_on FROM assets WHERE status <> 'retired' AND (
      (warranty_ends_on IS NOT NULL AND warranty_ends_on <= ?) OR (support_ends_on IS NOT NULL AND support_ends_on <= ?) OR (licence_expires_on IS NOT NULL AND licence_expires_on <= ?))
    ORDER BY LEAST(COALESCE(warranty_ends_on, '9999-12-31'), COALESCE(support_ends_on, '9999-12-31'), COALESCE(licence_expires_on, '9999-12-31')) LIMIT 500`, [until, until, until]).catch(() => []);
  return rows.map(r => {
    const ends = [['warranty', r.warranty_ends_on], ['support', r.support_ends_on], ['licence', r.licence_expires_on]].filter(([, d]) => d && ymd(d) <= until).map(([kind, d]) => ({ kind, on: ymd(d), days: daysUntil(d) }));
    return { id: r.id, name: r.name, ends };
  });
}

const LABEL = { warranty: 'Fin de garantie', support: 'Fin du support éditeur', licence: 'Échéance de licence' };
// The daily check of a space → number of alerts sent
async function checkExpiries(db, guildId) {
  let sent = 0;
  const founders = (await db("SELECT user_id FROM dashboard_users WHERE role = 'fondateur'").catch(() => [])).map(r => String(r.user_id));
  for (const a of await expiringSoon(db, Math.max(...THRESHOLDS))) {
    for (const e of a.ends) {
      if (e.days < 0) continue; // already over: shown in the inventory, not warned again
      const threshold = THRESHOLDS.filter(t => e.days <= t).sort((x, y) => x - y)[0];
      if (!threshold) continue;
      const r = await db('INSERT IGNORE INTO asset_expiry_alerts (asset_id, kind, ends_on, threshold) VALUES (?, ?, ?, ?)', [a.id, e.kind, e.on, threshold]);
      if (!r.affectedRows) continue;
      const title = `${LABEL[e.kind]} : ${a.name}`.slice(0, 120);
      const body = `Le ${e.on}, dans ${e.days} jour(s)`;
      for (const uid of founders) require('./sse').sendToUser(guildId, uid, 'followed', { ticketId: null, kind: 'asset', title, body });
      await recordEvent(db, { actor: SYSTEM, action: 'asset_expiry_alert', targetType: 'asset', targetId: a.id, details: { kind: e.kind, on: e.on, days: e.days } });
      await mailFounders(guildId, founders, title, body).catch(() => null);
      sent++;
    }
  }
  return sent;
}
async function mailFounders(guildId, userIds, title, body) {
  const im = require('./instanceMail');
  if (!userIds.length || !(await im.mailSettings().catch(() => ({}))).enabled) return;
  const { globalQuery } = require('./globalDb');
  const rows = await globalQuery('SELECT email FROM accounts WHERE id IN (?) AND email_verified = 1 AND email IS NOT NULL', [userIds]).catch(() => []);
  const [space] = await globalQuery('SELECT guild_name FROM guilds WHERE guild_id = ?', [guildId]).catch(() => []);
  const base = String(require('./config').config.webServerBaseUrl || '').replace(/\/$/, '');
  for (const { email } of rows) await im.sendInstanceMail({ to: email, template: 'assetExpiry', lang: require('./i18n').lang(), vars: { space: space?.guild_name || 'Support', title, body, link: `${base}/parc` } }).catch(() => null);
}
async function runExpiryCheck() {
  const { getTenantDb } = require('./tenantDb');
  for (const { guild_id } of await require('./guildScan').getActiveGuilds()) {
    const db = getTenantDb(guild_id);
    if (!(await require('./assets').enabled(db).catch(() => false))) continue;
    await checkExpiries(db, guild_id).catch(err => console.error('parc échéances:', guild_id, err.message));
  }
}

module.exports = { KINDS, THRESHOLDS, clean, lifecycleOf, assignmentsOf, assign, unassign, expiringSoon, checkExpiries, runExpiryCheck };

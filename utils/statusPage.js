// Public status page of a space (v7, conception/v7.md §3.6), off until the space turns it on:
// components (« Site web », « Messagerie »…) with their state, the incidents the staff published
// (Incidents, « publier sur la page de statut »), the history and the availability over 90 days,
// and an e-mail subscription (confirmed by a link) told when a published incident opens or ends.
// Only what was published is shown: never a ticket, a requester or an internal note.
const crypto = require('crypto');
const { recordEvent } = require('./audit');

const STATES = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'];
const RANK = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, major_outage: 4 };
const MAX_COMPONENTS = 30, DAYS = 90;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

async function settings(db) {
  const [c] = await db('SELECT status_page_enabled, status_page_title FROM guild_config WHERE id = 1').catch(() => []);
  return { enabled: Number(c?.status_page_enabled) === 1, title: c?.status_page_title || '' };
}
async function saveSettings(db, input = {}) {
  const title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  await db('UPDATE guild_config SET status_page_enabled = ?, status_page_title = ? WHERE id = 1', [input.enabled ? 1 : 0, title || null]);
  return { ok: true };
}

// ── Components ──
async function listComponents(db) {
  return (await db('SELECT * FROM status_components ORDER BY position, id').catch(() => []))
    .map(c => ({ id: c.id, name: c.name, description: c.description || '', status: c.status, updatedAt: c.updated_at }));
}
async function saveComponent(db, id, input = {}) {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  if (!name) return { error: 'Nom du composant requis' };
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 300) : '';
  if (id) {
    const r = await db('UPDATE status_components SET name = ?, description = ? WHERE id = ?', [name, description || null, id]);
    return r.affectedRows ? { ok: true, id } : { error: 'Composant introuvable', status: 404 };
  }
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM status_components');
  if (Number(n) >= MAX_COMPONENTS) return { error: `${MAX_COMPONENTS} composants au plus` };
  const ins = await db('INSERT INTO status_components (name, description, position) VALUES (?, ?, ?)', [name, description || null, Number(n)]);
  await db("INSERT INTO status_component_events (component_id, status) VALUES (?, 'operational')", [ins.insertId]);
  return { ok: true, id: ins.insertId };
}
async function deleteComponent(db, id) {
  const r = await db('DELETE FROM status_components WHERE id = ?', [id]);
  return r.affectedRows ? { ok: true } : { error: 'Composant introuvable', status: 404 };
}
async function setComponentStatus(db, id, status, actor) {
  if (!STATES.includes(status)) return { error: `État : ${STATES.join(', ')}` };
  const [c] = await db('SELECT name, status FROM status_components WHERE id = ?', [id]);
  if (!c) return { error: 'Composant introuvable', status: 404 };
  if (c.status === status) return { ok: true };
  await db('UPDATE status_components SET status = ? WHERE id = ?', [status, id]);
  await db('INSERT INTO status_component_events (component_id, status) VALUES (?, ?)', [id, status]);
  await recordEvent(db, { actor, action: 'status_component', details: { component: c.name, status } });
  return { ok: true };
}

// Availability per day over 90 days: the share of each day the component was not down
// (« degraded » and « maintenance » count as available, partial and major outages do not)
async function availability(db, componentId, now = Date.now()) {
  const from = now - DAYS * 864e5;
  const events = await db('SELECT status, at FROM status_component_events WHERE component_id = ? ORDER BY at, id', [componentId]);
  const before = [...events].reverse().find(e => new Date(e.at).getTime() <= from);
  const timeline = [{ status: before?.status || 'operational', at: from }, ...events.filter(e => new Date(e.at).getTime() > from).map(e => ({ status: e.status, at: new Date(e.at).getTime() }))];
  const down = s => s === 'partial_outage' || s === 'major_outage';
  const days = [];
  let total = 0, downTotal = 0;
  for (let d = 0; d < DAYS; d++) {
    const start = from + d * 864e5, end = Math.min(start + 864e5, now);
    let dn = 0;
    for (let i = 0; i < timeline.length; i++) {
      const a = Math.max(timeline[i].at, start), b = Math.min(i + 1 < timeline.length ? timeline[i + 1].at : now, end);
      if (b > a && down(timeline[i].status)) dn += b - a;
    }
    const len = Math.max(1, end - start);
    total += len; downTotal += dn;
    days.push({ day: new Date(start).toISOString().slice(0, 10), pct: Math.round((1 - dn / len) * 10000) / 100, down: dn > 0 });
  }
  return { days, pct: Math.round((1 - downTotal / Math.max(1, total)) * 10000) / 100 };
}

// What the public sees
async function publicView(db) {
  const s = await settings(db);
  if (!s.enabled) return null;
  const components = await listComponents(db);
  const withUptime = await Promise.all(components.map(async c => ({ ...c, availability: await availability(db, c.id) })));
  const worst = components.reduce((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), 'operational');
  const rows = await db(`SELECT id, title, message, resolved_message, created_at, resolved_at FROM incidents WHERE public = 1
    AND (resolved_at IS NULL OR resolved_at >= NOW() - INTERVAL ${DAYS} DAY) ORDER BY resolved_at IS NULL DESC, created_at DESC LIMIT 50`).catch(() => []);
  const incidents = rows.map(i => ({ id: i.id, title: i.title, message: i.message, resolvedMessage: i.resolved_message || '', createdAt: i.created_at, resolvedAt: i.resolved_at }));
  return { title: s.title, status: incidents.some(i => !i.resolvedAt) && worst === 'operational' ? 'degraded' : worst, components: withUptime, incidents };
}

// ── Subscriptions ──
async function subscribe(db, guildId, email, lang = 'fr') {
  const address = String(email || '').trim().toLowerCase().slice(0, 254);
  const { EMAIL_RE } = require('./emailTickets');
  if (!EMAIL_RE.test(address)) return { error: 'Adresse e-mail invalide' };
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM status_subscribers');
  if (Number(n) >= 10000) return { error: 'Trop d\'abonnés' };
  const token = crypto.randomBytes(24).toString('base64url');
  const [cur] = await db('SELECT confirmed_at FROM status_subscribers WHERE email = ?', [address]);
  if (cur?.confirmed_at) return { ok: true }; // already subscribed: say nothing more
  await db(`INSERT INTO status_subscribers (email, token_hash, unsub_token, lang) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), lang = VALUES(lang), created_at = NOW()`, [address, sha(token), crypto.randomBytes(24).toString('base64url'), lang === 'en' ? 'en' : 'fr']);
  const link = `${base()}/statut/${guildId}/confirmer?t=${token}`;
  await require('./instanceMail').sendInstanceMail({ to: address, template: 'statusConfirm', lang, vars: { space: await spaceName(db, guildId), link } }).catch(err => console.error('statut: confirmation', err.message));
  return { ok: true };
}
async function confirm(db, token) {
  const r = await db('UPDATE status_subscribers SET confirmed_at = COALESCE(confirmed_at, NOW()) WHERE token_hash = ? AND created_at >= NOW() - INTERVAL 7 DAY', [sha(token)]);
  return !!r.affectedRows;
}
async function unsubscribe(db, token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) return false;
  const r = await db('DELETE FROM status_subscribers WHERE unsub_token = ?', [String(token)]);
  return !!r.affectedRows;
}
const base = () => String(require('./config').config.webServerBaseUrl || '').replace(/\/$/, '');
async function spaceName(db, guildId) {
  const s = await settings(db);
  if (s.title) return s.title;
  const [g] = await require('./globalDb').globalQuery('SELECT guild_name FROM guilds WHERE guild_id = ?', [guildId]).catch(() => []);
  return g?.guild_name || 'Datick';
}
// A published incident opened or ended: each confirmed subscriber gets an e-mail (with a link to leave)
async function notify(db, guildId, incident, kind) {
  if (!(await settings(db)).enabled) return 0;
  const subs = await db('SELECT email, unsub_token, lang FROM status_subscribers WHERE confirmed_at IS NOT NULL LIMIT 10000').catch(() => []);
  const space = await spaceName(db, guildId);
  let sent = 0;
  for (const s of subs) {
    const token = s.unsub_token;
    const body = kind === 'resolved' ? (incident.resolved_message || incident.message) : incident.message;
    await require('./instanceMail').sendInstanceMail({ to: s.email, template: kind === 'resolved' ? 'statusResolved' : 'statusIncident', lang: s.lang,
      vars: { space, title: incident.title, body, link: `${base()}/statut/${guildId}`, unsubscribe: `${base()}/statut/${guildId}/desabonner?t=${token}` } })
      .then(() => { sent++; }).catch(err => console.error('statut: envoi', err.message));
  }
  return sent;
}
async function subscriberCount(db) {
  const [r] = await db('SELECT COUNT(*) AS n, COALESCE(SUM(confirmed_at IS NOT NULL), 0) AS ok FROM status_subscribers').catch(() => [{ n: 0, ok: 0 }]);
  return { total: Number(r.n), confirmed: Number(r.ok) };
}

module.exports = { STATES, settings, saveSettings, listComponents, saveComponent, deleteComponent, setComponentStatus, availability, publicView, subscribe, confirm, unsubscribe, notify, subscriberCount };

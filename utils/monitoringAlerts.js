// Monitoring alerts coming in (v7, conception/v7.md §3.10): Alertmanager, Grafana, Uptime Kuma,
// Zabbix and a generic JSON format. Each source has its own secret address. An alert that fires
// opens a ticket (subject, team and priority of the source), or adds a note to the open ticket of
// the same alert; its end resolves it (closes it). The ticket comes from « Supervision · <source> »,
// like a recurring ticket: nobody is messaged, it follows the rules, the SLA and the notifications.
const crypto = require('crypto');
const { recordEvent } = require('./audit');

const KINDS = ['alertmanager', 'grafana', 'uptimekuma', 'zabbix', 'generic'];
const KIND_LABELS = { alertmanager: 'Prometheus Alertmanager', grafana: 'Grafana', uptimekuma: 'Uptime Kuma', zabbix: 'Zabbix', generic: 'Générique (JSON)' };
const PRIORITIES = ['low', 'normal', 'urgent'];
const MAX_SOURCES = 20, MAX_ALERTS_PER_CALL = 50;
const ownerOf = (guildId, id) => `web:${crypto.createHash('sha256').update(`monitoring:${guildId}:${id}`).digest('hex').slice(0, 24)}`;
const base = () => String(require('./config').config.webServerBaseUrl || '').replace(/\/$/, '');

const shape = (s, guildId) => ({ id: s.id, name: s.name, kind: s.kind, subject: s.subject || '', teamId: s.team_id || null, priority: s.priority, autoClose: !!Number(s.auto_close), active: !!Number(s.active),
  url: `${base()}/api/monitoring/${guildId}/${s.id}/${s.secret}`, lastAt: s.last_at || null });
async function listSources(db, guildId) { return (await db('SELECT * FROM monitoring_sources ORDER BY name').catch(() => [])).map(s => shape(s, guildId)); }
async function saveSource(db, id, input = {}) {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  if (!name) return { error: 'Nom de la source requis' };
  if (!KINDS.includes(input.kind)) return { error: `Outil : ${KINDS.join(', ')}` };
  const priority = PRIORITIES.includes(input.priority) ? input.priority : 'urgent';
  const teamId = input.teamId ? Number(input.teamId) : null;
  if (teamId && !(await db('SELECT 1 FROM teams WHERE id = ?', [teamId])).length) return { error: 'Équipe introuvable' };
  const subject = typeof input.subject === 'string' ? input.subject.trim().slice(0, 100) : '';
  const vals = [name, input.kind, subject || null, teamId, priority, input.autoClose === false ? 0 : 1, input.active === false ? 0 : 1];
  if (id) {
    const r = await db('UPDATE monitoring_sources SET name = ?, kind = ?, subject = ?, team_id = ?, priority = ?, auto_close = ?, active = ? WHERE id = ?', [...vals, id]);
    if (input.newSecret && r.affectedRows) await db('UPDATE monitoring_sources SET secret = ? WHERE id = ?', [crypto.randomBytes(20).toString('hex'), id]);
    return r.affectedRows ? { ok: true, id } : { error: 'Source introuvable', status: 404 };
  }
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM monitoring_sources');
  if (Number(n) >= MAX_SOURCES) return { error: `${MAX_SOURCES} sources au plus` };
  return { ok: true, id: (await db('INSERT INTO monitoring_sources (name, kind, subject, team_id, priority, auto_close, active, secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [...vals, crypto.randomBytes(20).toString('hex')])).insertId };
}
async function deleteSource(db, id) {
  const r = await db('DELETE FROM monitoring_sources WHERE id = ?', [id]);
  return r.affectedRows ? { ok: true } : { error: 'Source introuvable', status: 404 };
}

// The payload of a tool → [{ key, firing, title, text, severity }]
const txt = (v, max = 2000) => String(v ?? '').slice(0, max);
function parse(kind, p) {
  if (!p || typeof p !== 'object') return [];
  if (kind === 'alertmanager' || kind === 'grafana') {
    return (Array.isArray(p.alerts) ? p.alerts : []).slice(0, MAX_ALERTS_PER_CALL).map(a => {
      const labels = a.labels || {}, ann = a.annotations || {};
      const key = a.fingerprint || crypto.createHash('sha256').update(JSON.stringify(Object.entries(labels).sort())).digest('hex').slice(0, 32);
      const where = [labels.instance, labels.job, labels.service].filter(Boolean).join(' · ');
      return { key: txt(key, 80), firing: a.status !== 'resolved', title: txt(ann.summary || labels.alertname || 'Alerte', 200), severity: txt(labels.severity, 20),
        text: [ann.description || ann.message || '', where && `Cible : ${where}`, labels.alertname && `Alerte : ${labels.alertname}`, a.generatorURL && `Source : ${a.generatorURL}`].filter(Boolean).join('\n') };
    });
  }
  if (kind === 'uptimekuma') {
    const m = p.monitor || {}, h = p.heartbeat || {};
    if (!m.id && !m.name) return [];
    return [{ key: txt(`kuma:${m.id || m.name}`, 80), firing: Number(h.status) === 0, title: txt(`${m.name || 'Moniteur'} ${Number(h.status) === 0 ? 'ne répond plus' : 'répond de nouveau'}`, 200), severity: '',
      text: [p.msg || h.msg || '', m.url && `Adresse : ${m.url}`].filter(Boolean).join('\n') }];
  }
  if (kind === 'zabbix') {
    const status = String(p.status || p.event_status || '').toUpperCase();
    const key = p.event_id || p.eventid || p.trigger_id || p.triggerid;
    if (!key) return [];
    return [{ key: txt(`zbx:${key}`, 80), firing: !['RESOLVED', 'OK', '0'].includes(status), title: txt(p.subject || p.name || p.trigger_name || 'Problème Zabbix', 200), severity: txt(p.severity, 20),
      text: [p.message || '', p.host && `Hôte : ${p.host}`].filter(Boolean).join('\n') }];
  }
  // generic: { key, status: firing | resolved, title, message, severity } or a list of them
  return (Array.isArray(p) ? p : Array.isArray(p.alerts) ? p.alerts : [p]).slice(0, MAX_ALERTS_PER_CALL).filter(a => a?.key && a?.title)
    .map(a => ({ key: txt(a.key, 80), firing: !['resolved', 'ok', 'up'].includes(String(a.status || 'firing').toLowerCase()), title: txt(a.title, 200), text: txt(a.message || a.text || ''), severity: txt(a.severity, 20) }));
}

const note = (db, ticketId, tag, text) => db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, 'system', ?, ?, 'system')", [ticketId, tag.slice(0, 100), text.slice(0, 4000)]);

async function openTicket({ db, client, guildId, src, alert }) {
  const tag = `Supervision · ${src.name}`.slice(0, 100);
  const user = { id: ownerOf(guildId, src.id), tag, username: tag, send: async () => null };
  const tm = require('./ticketManager').createManager(db, client, guildId);
  const content = `🚨 ${alert.title}${alert.severity ? ` (${alert.severity})` : ''}\n\n${alert.text}`.trim();
  const res = await tm.createTicket(user, content.slice(0, 4000), [], (src.subject || alert.title).slice(0, 100), { forceNew: true });
  if (!res?.ticket) return null;
  const actor = { id: 'system', tag, username: tag, source: 'system' };
  if (src.priority) await tm.setPriority(res.ticket.id, src.priority, actor);
  if (src.team_id) {
    const [row] = await db('SELECT * FROM tickets WHERE id = ?', [res.ticket.id]);
    if (row) await require('./teams').routeTicket({ db, tm, ticket: row, teamId: src.team_id, actor });
  }
  await recordEvent(db, { actor, action: 'monitoring_alert', ticketId: res.ticket.id, details: { source: src.name, alert: alert.title } });
  return res.ticket.id;
}

// One call of a tool → { opened, updated, resolved }
async function receive({ db, client, guildId, sourceId, secret, payload }) {
  const [src] = await db('SELECT * FROM monitoring_sources WHERE id = ?', [sourceId]);
  const a = Buffer.from(String(secret || '')), b = Buffer.from(String(src?.secret || ''));
  if (!src || !Number(src.active) || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { error: 'Inconnu', status: 404 };
  await db('UPDATE monitoring_sources SET last_at = NOW() WHERE id = ?', [src.id]);
  return processAlerts({ db, client, guildId, src, alerts: parse(src.kind, payload) });
}
async function processAlerts({ db, client, guildId, src, alerts }) {
  const out = { opened: 0, updated: 0, resolved: 0, ticketIds: [] };
  const tag = `Supervision · ${src.name}`;
  for (const alert of alerts) {
    const [st] = await db("SELECT a.*, t.status AS ticket_status FROM monitoring_alerts a LEFT JOIN tickets t ON t.id = a.ticket_id WHERE a.source_id = ? AND a.alert_key = ?", [src.id, alert.key]);
    const open = st && st.ticket_status === 'open';
    if (alert.firing) {
      if (open) {
        // Still firing: a note at most every hour
        if (Date.now() - new Date(st.last_note_at || 0).getTime() > 3600e3) { await note(db, st.ticket_id, tag, `🔁 Toujours en alerte : ${alert.title}`); await db('UPDATE monitoring_alerts SET last_note_at = NOW() WHERE id = ?', [st.id]); out.updated++; }
        await db("UPDATE monitoring_alerts SET state = 'firing', last_at = NOW() WHERE id = ?", [st.id]);
        continue;
      }
      const ticketId = await openTicket({ db, client, guildId, src, alert });
      if (!ticketId) continue;
      out.ticketIds.push(ticketId);
      await db(`INSERT INTO monitoring_alerts (source_id, alert_key, ticket_id, state, last_note_at) VALUES (?, ?, ?, 'firing', NOW())
        ON DUPLICATE KEY UPDATE ticket_id = VALUES(ticket_id), state = 'firing', last_at = NOW(), last_note_at = NOW()`, [src.id, alert.key, ticketId]);
      out.opened++;
    } else if (open) {
      await note(db, st.ticket_id, tag, `✅ Alerte terminée : ${alert.title}`);
      await db("UPDATE monitoring_alerts SET state = 'resolved', last_at = NOW() WHERE id = ?", [st.id]);
      if (Number(src.auto_close)) {
        const [ticket] = await db('SELECT * FROM tickets WHERE id = ?', [st.ticket_id]);
        await require('./resolution').closeResolved({ db, client, guildId, ticket, by: { id: 'system', tag, username: tag, source: 'system', reason: 'Alerte terminée' } }).catch(err => console.error('supervision: fermeture', err.message));
      }
      out.resolved++;
    }
  }
  return out;
}

// « Tester » (v8): a test alert that fires, then ends — the whole path, ticket included
async function testSource({ db, client, guildId, id }) {
  const [src] = await db('SELECT * FROM monitoring_sources WHERE id = ?', [id]);
  if (!src) return { error: 'Source introuvable', status: 404 };
  const key = `test:${Date.now()}`;
  const alert = { key, title: 'Alerte de test', text: 'Envoyée par le bouton « Tester » du dashboard.', severity: 'test' };
  const fired = await processAlerts({ db, client, guildId, src, alerts: [{ ...alert, firing: true }] });
  const ended = await processAlerts({ db, client, guildId, src, alerts: [{ ...alert, firing: false }] });
  await db('DELETE FROM monitoring_alerts WHERE source_id = ? AND alert_key = ?', [src.id, key]).catch(() => null);
  if (!fired.opened) return { error: 'Le ticket de test n\'a pas pu être ouvert' };
  return { ok: true, ticketId: fired.ticketIds[0], closed: !!Number(src.auto_close) && ended.resolved > 0 };
}

module.exports = { KINDS, KIND_LABELS, listSources, saveSource, deleteSource, parse, receive, testSource };

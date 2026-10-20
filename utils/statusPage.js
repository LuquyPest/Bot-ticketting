// Public status page: live state of the bot (Discord connection), the dashboard and the database,
// current incidents and maintenances, 90-day history and availability. Nothing internal is
// exposed (no server, no error message). Outages detected by utils/discordWatch.js are recorded
// and resolved automatically; the super-admin declares the others.
const { globalQuery } = require('./globalDb');

const DAYS = 90;

async function openAutoOutage(title) {
  const [open] = await globalQuery("SELECT id FROM status_events WHERE auto = 1 AND resolved_at IS NULL AND component = 'bot'");
  if (open) return open.id;
  const { insertId } = await globalQuery("INSERT INTO status_events (kind, component, severity, title, auto) VALUES ('incident', 'bot', 'major', ?, 1)", [title]);
  return insertId;
}

async function resolveAutoOutages() {
  await globalQuery("UPDATE status_events SET resolved_at = NOW() WHERE auto = 1 AND resolved_at IS NULL");
}

const iso = d => (d ? new Date(d).toISOString() : null);

async function publicStatus(client) {
  let dbOk = true;
  try { await globalQuery('SELECT 1'); } catch { dbOk = false; }
  const botUp = !!client?.isReady?.() && client.ws?.status === 0;
  const events = dbOk ? await globalQuery(
    `SELECT id, kind, component, severity, title, message, started_at, resolved_at FROM status_events
     WHERE started_at >= NOW() - INTERVAL ? DAY OR resolved_at IS NULL ORDER BY started_at DESC LIMIT 200`, [DAYS]) : [];
  const open = events.filter(e => !e.resolved_at);
  const affects = (e, c) => e.component === c || e.component === 'all';
  const state = c => {
    const live = c === 'bot' ? botUp : true;
    const ev = open.filter(e => affects(e, c));
    if (!live || ev.some(e => e.kind === 'incident' && e.severity === 'major')) return 'down';
    if (ev.some(e => e.kind === 'maintenance')) return 'maintenance';
    if (ev.length) return 'degraded';
    return 'operational';
  };

  // Availability of the bot over 90 days: share of time without a major bot incident
  const now = Date.now(), from = now - DAYS * 86400000;
  let downMs = 0;
  const days = Array.from({ length: DAYS }, (_, i) => ({ date: new Date(from + (i + 1) * 86400000).toISOString().slice(0, 10), level: 'operational' }));
  const rank = { operational: 0, maintenance: 1, degraded: 2, down: 3 };
  for (const e of events) {
    const start = Math.max(new Date(e.started_at).getTime(), from);
    const end = e.resolved_at ? new Date(e.resolved_at).getTime() : now;
    if (affects(e, 'bot') && e.kind === 'incident' && e.severity === 'major') downMs += Math.max(0, end - start);
    const level = e.kind === 'maintenance' ? 'maintenance' : e.severity === 'major' ? 'down' : 'degraded';
    for (const d of days) {
      const ds = new Date(`${d.date}T00:00:00Z`).getTime(), de = ds + 86400000;
      if (start < de && end > ds && rank[level] > rank[d.level]) d.level = level;
    }
  }
  const components = { bot: state('bot'), dashboard: state('dashboard'), database: dbOk ? 'operational' : 'down' };
  const overall = Object.values(components).sort((a, b) => rank[b] - rank[a])[0];
  return {
    overall, components,
    uptime: Math.round(10000 * (1 - downMs / (now - from))) / 100,
    current: open.map(e => ({ ...e, started_at: iso(e.started_at), resolved_at: null })),
    history: events.filter(e => e.resolved_at).map(e => ({ ...e, started_at: iso(e.started_at), resolved_at: iso(e.resolved_at) })),
    days,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = { publicStatus, openAutoOutage, resolveAutoOutages, DAYS };

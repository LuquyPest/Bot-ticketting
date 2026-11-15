// Prometheus endpoint (GET /metrics), off by default: the owner turns it on in Instance → Santé,
// which creates a token shown once (only its SHA-256 is stored). Prometheus, Grafana Agent or
// Uptime Kuma then read it with « Authorization: Bearer <token> ». Only numbers: no ticket
// subject, no member name; servers are labelled with their ID and name.
const crypto = require('crypto');
const { getSetting, setSetting } = require('./instanceSettings');
const { globalQuery } = require('./globalDb');
const { getTenantDb } = require('./tenantDb');

const KEY = 'metrics';
const CACHE_MS = 15 * 1000;
const sha = s => crypto.createHash('sha256').update(String(s)).digest();

let settingsCache = null; // { at, value }
async function metricsSettings() {
  if (settingsCache && Date.now() - settingsCache.at < 30 * 1000) return settingsCache.value;
  const value = await getSetting(KEY, { enabled: false, tokenHash: null, createdAt: null });
  settingsCache = { at: Date.now(), value };
  return value;
}

// Turns the endpoint on (new token returned once) or off (token forgotten)
async function setMetrics(enabled) {
  settingsCache = null;
  if (!enabled) { await setSetting(KEY, { enabled: false, tokenHash: null, createdAt: null }); return { enabled: false }; }
  const token = `tbm_${crypto.randomBytes(24).toString('base64url')}`;
  await setSetting(KEY, { enabled: true, tokenHash: sha(token).toString('hex'), createdAt: Date.now() });
  return { enabled: true, token };
}

async function authorized(req) {
  const s = await metricsSettings();
  if (!s.enabled || !s.tokenHash) return { enabled: false };
  const m = /^Bearer\s+(\S+)$/i.exec(req.get('Authorization') || '');
  const ok = !!m && crypto.timingSafeEqual(sha(m[1]), Buffer.from(s.tokenHash, 'hex'));
  return { enabled: true, ok };
}

// Prometheus text format
const esc = v => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
function render(families) {
  const out = [];
  for (const [name, type, help, samples] of families) {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of samples) {
      if (value === null || value === undefined || Number.isNaN(Number(value))) continue;
      const l = Object.entries(labels || {}).map(([k, v]) => `${k}="${esc(v)}"`).join(',');
      out.push(`${name}${l ? `{${l}}` : ''} ${Number(value)}`);
    }
  }
  return `${out.join('\n')}\n`;
}

async function timed(fn) {
  const t = Date.now();
  try { await fn(); return { up: 1, s: (Date.now() - t) / 1000 }; } catch { return { up: 0, s: (Date.now() - t) / 1000 }; }
}

async function collect(client) {
  const { getRedis } = require('./redis');
  const [db, redis] = await Promise.all([timed(() => globalQuery('SELECT 1')), timed(() => getRedis().ping())]);
  const families = [];
  const version = require('../package.json').version;
  families.push(['ticketbot_info', 'gauge', 'Version of the bot', [[{ version: `v${version}` }, 1]]]);
  families.push(['ticketbot_discord_connected', 'gauge', '1 when the bot is connected to Discord', [[{}, client?.ws?.status === 0 ? 1 : 0]]]);
  families.push(['ticketbot_discord_ping_seconds', 'gauge', 'Discord gateway latency', [[{}, client?.ws?.ping >= 0 ? client.ws.ping / 1000 : null]]]);
  families.push(['ticketbot_database_up', 'gauge', '1 when MariaDB answers', [[{}, db.up]]]);
  families.push(['ticketbot_database_latency_seconds', 'gauge', 'Time of a trivial MariaDB query', [[{}, db.s]]]);
  families.push(['ticketbot_redis_up', 'gauge', '1 when Redis answers', [[{}, redis.up]]]);
  families.push(['ticketbot_redis_latency_seconds', 'gauge', 'Time of a Redis PING', [[{}, redis.s]]]);

  // Tickets, per active server
  const guilds = await globalQuery("SELECT guild_id, guild_name FROM guilds WHERE status = 'active'").catch(() => []);
  const open = [], unassigned = [], waiting = [], opened24 = [], closed24 = [], firstResponse = [];
  for (const g of guilds) {
    const labels = { guild_id: g.guild_id, guild: g.guild_name || g.guild_id };
    const [row] = await getTenantDb(g.guild_id)(
      `SELECT
         SUM(status = 'open') AS open,
         SUM(status = 'open' AND NOT EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id)) AS unassigned,
         SUM(status = 'open' AND stage = 'waiting') AS waiting,
         SUM(created_at >= NOW() - INTERVAL 1 DAY) AS opened24,
         SUM(status = 'closed' AND closed_at >= NOW() - INTERVAL 1 DAY) AS closed24
       FROM tickets t WHERE status = 'open' OR created_at >= NOW() - INTERVAL 1 DAY OR closed_at >= NOW() - INTERVAL 1 DAY`
    ).catch(() => [null]);
    if (!row) continue;
    open.push([labels, Number(row.open || 0)]);
    unassigned.push([labels, Number(row.unassigned || 0)]);
    waiting.push([labels, Number(row.waiting || 0)]);
    opened24.push([labels, Number(row.opened24 || 0)]);
    closed24.push([labels, Number(row.closed24 || 0)]);
    // Oldest open ticket without any staff answer yet: the queue that is waiting right now
    const [old] = await getTenantDb(g.guild_id)(
      `SELECT TIMESTAMPDIFF(SECOND, MIN(t.created_at), NOW()) AS s FROM tickets t
       WHERE t.status = 'open' AND NOT EXISTS (SELECT 1 FROM ticket_notes n WHERE n.ticket_id = t.id AND n.source = 'reply')`
    ).catch(() => [null]);
    firstResponse.push([labels, old?.s === null || old?.s === undefined ? 0 : Number(old.s)]);
  }
  families.push(['ticketbot_tickets_open', 'gauge', 'Open tickets', open]);
  families.push(['ticketbot_tickets_unassigned', 'gauge', 'Open tickets nobody is assigned to', unassigned]);
  families.push(['ticketbot_tickets_waiting', 'gauge', 'Open tickets in the « Waiting » stage', waiting]);
  families.push(['ticketbot_tickets_opened_24h', 'gauge', 'Tickets opened over the last 24 hours', opened24]);
  families.push(['ticketbot_tickets_closed_24h', 'gauge', 'Tickets closed over the last 24 hours', closed24]);
  families.push(['ticketbot_oldest_unanswered_ticket_seconds', 'gauge', 'Age of the oldest open ticket without a staff answer (0: none)', firstResponse]);

  // Scheduled jobs (BullMQ)
  try {
    const { counts } = await require('./jobQueue').jobsStatus();
    families.push(['ticketbot_jobs', 'gauge', 'Scheduled jobs by state', Object.entries(counts || {}).map(([state, n]) => [{ state }, n])]);
  } catch { /* Redis down: already visible in ticketbot_redis_up */ }

  // Backups (status files of the backup, verify and offsite services)
  const b = require('./backupStatus').backupStatus();
  if (b.configured) {
    const last = (s, ok) => (s && s.ok === ok && s.at ? s.at / 1000 : null);
    families.push(['ticketbot_backup_last_success_timestamp_seconds', 'gauge', 'Time of the last successful backup', [[{ kind: 'backup' }, last(b.backup, true)], [{ kind: 'verify' }, last(b.verify, true)], [{ kind: 'offsite' }, last(b.offsite, true)]]]);
    families.push(['ticketbot_backup_problems', 'gauge', 'Backup problems shown in Instance → Santé', [[{}, b.problems.length]]]);
  }

  // Version
  try {
    const u = await require('./updates').updateState();
    families.push(['ticketbot_update_available', 'gauge', '1 when a newer version is published', [[{ latest: u.latest || '' }, u.available ? 1 : 0]]]);
  } catch { /* no check yet */ }

  const mem = process.memoryUsage();
  families.push(['process_resident_memory_bytes', 'gauge', 'Resident memory of the bot process', [[{}, mem.rss]]]);
  families.push(['nodejs_heap_used_bytes', 'gauge', 'Heap used by Node.js', [[{}, mem.heapUsed]]]);
  families.push(['process_uptime_seconds', 'gauge', 'Time since the bot process started', [[{}, Math.round(process.uptime())]]]);
  return render(families);
}

let cache = null; // { at, text }
async function metricsText(client) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.text;
  const text = await collect(client);
  cache = { at: Date.now(), text };
  return text;
}

// Express handler for GET /metrics
async function metricsHandler(req, res) {
  const auth = await authorized(req).catch(() => ({ enabled: false }));
  if (!auth.enabled) return res.status(404).type('text/plain').send('Not found\n');
  if (!auth.ok) return res.status(401).set('WWW-Authenticate', 'Bearer').type('text/plain').send('Unauthorized\n');
  try {
    res.set('Cache-Control', 'no-store').type('text/plain; version=0.0.4; charset=utf-8').send(await metricsText(req.app.locals.client));
  } catch (err) {
    console.error('metrics:', err.message);
    res.status(500).type('text/plain').send('Error\n');
  }
}

const clearMetricsCache = () => { cache = null; settingsCache = null; };

module.exports = { metricsSettings, setMetrics, metricsHandler, render, clearMetricsCache, KEY };

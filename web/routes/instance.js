// Instance section of the dashboard (/api/instance), reserved to the owner of the instance
// (utils/instance.js): servers of the instance, founders, health, errors, journal, blocked IPs,
// error alert and demonstration server. GET /info is public (name shown on the sign-in page).
const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb, getDbName } = require('../../utils/tenantDb');
const { logAudit } = require('../../utils/gradePermissions');
const requireOwner = require('../middleware/owner');
const { instanceAuditMiddleware } = require('../../utils/instanceAudit');
const { getSetting, setSetting } = require('../../utils/instanceSettings');
const { instanceName, instanceAvatar } = require('../../utils/instance');
const { config } = require('../../utils/config');

// GET /api/instance/info — public: what the sign-in page and the member space show
router.get('/info', async (req, res) => {
  const client = req.app.locals.client;
  const { demoEnabled } = require('../../utils/demo');
  res.json({
    name: instanceName(client),
    avatar: instanceAvatar(client),
    demo: await demoEnabled(),
    privacyUrl: config.privacyUrl || null,
    contactEmail: config.contactEmail || (/@/.test(config.vapid?.contact || '') ? config.vapid.contact.replace(/^mailto:/, '') : null),
  });
});

router.use(requireOwner);
// Every successful change made from the section is journaled (instance_audit_log)
router.use(instanceAuditMiddleware);

// ─── GUILDS ──────────────────────────────────────────────────────────────────

// GET /api/instance/guilds
router.get('/guilds', async (req, res) => {
  try {
    res.json(await globalQuery('SELECT * FROM guilds ORDER BY created_at DESC'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/instance/guilds/:guildId
router.get('/guilds/:guildId', async (req, res) => {
  try {
    const [guild] = await globalQuery('SELECT * FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });

    let stats = null;
    if (guild.status === 'active') {
      try {
        const db = getTenantDb(guild.guild_id);
        const [[tickets], [openTickets], [users]] = await Promise.all([
          db('SELECT COUNT(*) as c FROM tickets'),
          db('SELECT COUNT(*) as c FROM tickets WHERE status = "open"'),
          db('SELECT COUNT(*) as c FROM dashboard_users WHERE role != "nouveau"')
        ]);
        stats = { tickets: tickets.c, openTickets: openTickets.c, staffMembers: users.c };
      } catch { /* DB not ready */ }
    }

    res.json({ ...guild, stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/instance/guilds/:guildId/suspend
router.patch('/guilds/:guildId/suspend', async (req, res) => {
  try {
    const [guild] = await globalQuery('SELECT guild_id FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
    await globalQuery('UPDATE guilds SET status = "suspended", suspension_reason = "admin" WHERE guild_id = ?', [guild.guild_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/instance/guilds/:guildId/reactivate
router.patch('/guilds/:guildId/reactivate', async (req, res) => {
  try {
    const [guild] = await globalQuery('SELECT guild_id, status FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
    await globalQuery('UPDATE guilds SET status = "active", suspension_reason = NULL WHERE guild_id = ?', [guild.guild_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/instance/guilds/:guildId
router.delete('/guilds/:guildId', async (req, res) => {
  try {
    const [guild] = await globalQuery('SELECT * FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });

    // The bot leaves the Discord server first — otherwise it stays there and the server is
    // registered again at the next restart (events/ready.js)
    const discordGuild = await req.app.locals.client?.guilds.fetch(guild.guild_id).catch(() => null);
    let leftDiscord = false;
    if (discordGuild) {
      leftDiscord = await discordGuild.leave().then(() => true).catch(err => {
        console.error('guild leave error:', err.message);
        return false;
      });
    }

    const dbName = getDbName(guild.guild_id);
    const cfg = require('../../utils/config').config.database;
    const conn = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password });
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    } finally {
      await conn.end();
    }

    await globalQuery('DELETE FROM guilds WHERE guild_id = ?', [guild.guild_id]);
    res.json({ ok: true, leftDiscord, wasInDiscord: !!discordGuild });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/instance/guilds/:guildId/maintenance — toggle maintenance mode
router.patch('/guilds/:guildId/maintenance', async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: '`enabled` boolean requis' });
  try {
    const [guild] = await globalQuery('SELECT guild_id FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
    await globalQuery('UPDATE guilds SET maintenance_mode = ? WHERE guild_id = ?', [enabled ? 1 : 0, guild.guild_id]);
    res.json({ ok: true, maintenance_mode: enabled ? 1 : 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── FOUNDERS (per-tenant) ──────────────────────────────────────────────────

const SNOWFLAKE_RE = /^\d{17,20}$/;

// GET /api/instance/guilds/:guildId/founders — fondateurs du dashboard de ce serveur
router.get('/guilds/:guildId/founders', async (req, res) => {
  try {
    const [guild] = await globalQuery('SELECT guild_id, status, owner_discord_id, inviter_discord_id FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });

    const rows = await getTenantDb(guild.guild_id)(
      `SELECT user_id, username, avatar, first_login, last_login FROM dashboard_users
       WHERE role = 'fondateur' ORDER BY first_login ASC`
    );
    res.json(rows.map(r => ({
      ...r,
      isOwner:   r.user_id === guild.owner_discord_id,
      isInviter: r.user_id === guild.inviter_discord_id,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/instance/guilds/:guildId/founders — { discordId } : nomme un fondateur
router.post('/guilds/:guildId/founders', async (req, res) => {
  const discordId = typeof req.body.discordId === 'string' ? req.body.discordId.trim() : '';
  if (!SNOWFLAKE_RE.test(discordId)) return res.status(400).json({ error: 'ID Discord invalide (17 à 20 chiffres)' });

  try {
    const [guild] = await globalQuery('SELECT guild_id, guild_name, status FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });

    const client = req.app.locals.client;
    const user = await client?.users.fetch(discordId).catch(() => null);
    if (!user) return res.status(404).json({ error: 'Utilisateur Discord introuvable' });
    if (user.bot) return res.status(400).json({ error: 'Impossible de nommer un bot fondateur' });

    const discordGuild = await client.guilds.fetch(guild.guild_id).catch(() => null);
    const isMember = !!(discordGuild && await discordGuild.members.fetch(discordId).catch(() => null));

    const db = getTenantDb(guild.guild_id);
    await db(
      `INSERT INTO dashboard_users (user_id, username, avatar, role) VALUES (?, ?, ?, 'fondateur')
       ON DUPLICATE KEY UPDATE role = 'fondateur', username = VALUES(username), avatar = VALUES(avatar)`,
      [user.id, user.username, user.avatar || null]
    );
    await logAudit(req.owner.id, req.owner.username, 'founder_add', 'user', user.id, { username: user.username }, db);

    const baseUrl = require('../../utils/config').config.webServerBaseUrl || '';
    await user.send(
      `👑 Tu as été nommé **fondateur** du dashboard de **${guild.guild_name}**.` +
      (baseUrl ? `\nConnecte-toi avec Discord sur ${baseUrl} et sélectionne le serveur.` : '')
    ).catch(() => null);

    res.json({ ok: true, user_id: user.id, username: user.username, isMember });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/instance/guilds/:guildId/founders/:userId — retire le rôle fondateur
router.delete('/guilds/:guildId/founders/:userId', async (req, res) => {
  const userId = String(req.params.userId);
  if (!SNOWFLAKE_RE.test(userId)) return res.status(400).json({ error: 'ID Discord invalide' });
  try {
    const [guild] = await globalQuery('SELECT guild_id, status FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });

    const db = getTenantDb(guild.guild_id);
    const [row] = await db("SELECT username FROM dashboard_users WHERE user_id = ? AND role = 'fondateur'", [userId]);
    if (!row) return res.status(404).json({ error: 'Cette personne n\'est pas fondateur de ce serveur' });
    const [{ n }] = await db("SELECT COUNT(*) AS n FROM dashboard_users WHERE role = 'fondateur'");
    if (n <= 1) return res.status(400).json({ error: 'Impossible de retirer le dernier fondateur — ajoute d\'abord un autre fondateur' });

    // Back to "nouveau"; if they hold a Discord staff role, the role sync gives them a support account again
    await db('UPDATE dashboard_users SET role = "nouveau", discord_has_role = 0 WHERE user_id = ?', [userId]);
    await logAudit(req.owner.id, req.owner.username, 'founder_remove', 'user', userId, { username: row.username }, db);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── BLOCAGES (adresses IP limitées par les limites de requêtes) ─────────────

const { listBlocked, unblock } = require('../rateLimiters');

// GET /api/instance/blocked — IP blocked by the request limits
router.get('/blocked', async (req, res) => {
  try {
    res.json({ ips: await listBlocked() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/instance/blocked/ips/unblock — { limiter, key }
router.post('/blocked/ips/unblock', async (req, res) => {
  const { limiter, key } = req.body;
  if (typeof limiter !== 'string' || typeof key !== 'string' || key.length > 100) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  try {
    if (!(await unblock(limiter, key))) return res.status(404).json({ error: 'Blocage introuvable ou déjà expiré' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── GLOBAL STATS ────────────────────────────────────────────────────────────

// GET /api/instance/stats — overview of every server of the instance
router.get('/stats', async (req, res) => {
  try {
    const guilds = await globalQuery(
      `SELECT guild_id, guild_name, guild_icon, status, maintenance_mode, member_count
       FROM guilds ORDER BY guild_name`
    );

    const DAYS = 30;
    const daily = new Map();
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      daily.set(d, { day: d, opened: 0, closed: 0 });
    }
    const totals = { tickets: 0, openTickets: 0, opened30d: 0, closed30d: 0, staff: 0 };
    const perGuild = [];

    for (const g of guilds) {
      const row = { ...g, maintenance_mode: !!g.maintenance_mode, tickets: null, openTickets: null, opened30d: null, staff: null, avgRating: null };
      try {
        const db = getTenantDb(g.guild_id);
        const [[counts], opened, closed, [rating]] = await Promise.all([
          db(`SELECT COUNT(*) AS total, SUM(status = 'open') AS open,
                     SUM(created_at >= DATE_SUB(NOW(), INTERVAL ${DAYS} DAY)) AS opened30d,
                     (SELECT COUNT(*) FROM dashboard_users WHERE role IN ('support', 'fondateur')) AS staff
              FROM tickets`),
          db(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS n FROM tickets
              WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ${DAYS - 1} DAY) GROUP BY d`),
          db(`SELECT DATE_FORMAT(closed_at, '%Y-%m-%d') AS d, COUNT(*) AS n FROM tickets
              WHERE closed_at >= DATE_SUB(CURDATE(), INTERVAL ${DAYS - 1} DAY) GROUP BY d`),
          db('SELECT AVG(rating) AS avg FROM ticket_ratings'),
        ]);
        Object.assign(row, {
          tickets: Number(counts.total) || 0, openTickets: Number(counts.open) || 0,
          opened30d: Number(counts.opened30d) || 0, staff: Number(counts.staff) || 0,
          avgRating: rating?.avg != null ? Math.round(rating.avg * 10) / 10 : null,
        });
        for (const r of opened) if (daily.has(r.d)) daily.get(r.d).opened += Number(r.n);
        for (const r of closed) if (daily.has(r.d)) { daily.get(r.d).closed += Number(r.n); totals.closed30d += Number(r.n); }
        totals.tickets += row.tickets; totals.openTickets += row.openTickets;
        totals.opened30d += row.opened30d; totals.staff += row.staff;
      } catch { /* tenant DB not ready */ }
      perGuild.push(row);
    }

    const count = st => guilds.filter(g => g.status === st).length;
    const [errors24h] = await globalQuery('SELECT COUNT(*) AS c FROM error_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)');

    res.json({
      guilds: { total: guilds.length, active: count('active'), suspended: count('suspended') },
      errors24h: errors24h.c,
      totals,
      daily: [...daily.values()],
      perGuild,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Filters shared by the error list and its deletion: guild, context, text, period (hours).
function errorFilters(q) {
  const where = [];
  const params = [];
  if (typeof q.guild_id === 'string' && q.guild_id) {
    if (q.guild_id === 'none') where.push('e.guild_id IS NULL');
    else { where.push('e.guild_id = ?'); params.push(q.guild_id); }
  }
  if (typeof q.context === 'string' && q.context) { where.push('e.context = ?'); params.push(q.context.slice(0, 100)); }
  if (typeof q.q === 'string' && q.q.trim()) {
    where.push('(e.message LIKE ? OR e.context LIKE ?)');
    const like = `%${q.q.trim().slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`;
    params.push(like, like);
  }
  const hours = parseInt(q.hours);
  if (hours > 0) { where.push('e.created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)'); params.push(Math.min(hours, 24 * 365)); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// GET /api/instance/error-logs — centralized error journal (bot, dashboard, jobs)
router.get('/error-logs', async (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const f = errorFilters(req.query);
  try {
    const [rows, [{ total }], contexts, hourly] = await Promise.all([
      globalQuery(
        `SELECT e.id, e.guild_id, g.guild_name, e.context, e.message, e.stack, e.created_at
         FROM error_logs e LEFT JOIN guilds g ON g.guild_id = e.guild_id ${f.sql}
         ORDER BY e.id DESC LIMIT ? OFFSET ?`, [...f.params, limit, offset]),
      globalQuery(`SELECT COUNT(*) AS total FROM error_logs e ${f.sql}`, f.params),
      // Most frequent sources over the last 7 days (filter shortcuts)
      globalQuery(`SELECT context, COUNT(*) AS n, MAX(created_at) AS last FROM error_logs
                   WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY context ORDER BY n DESC LIMIT 12`),
      // Hours ago (0 = last hour): independent of the database and browser time zones
      globalQuery(`SELECT TIMESTAMPDIFF(HOUR, created_at, NOW()) AS ago, COUNT(*) AS n FROM error_logs
                   WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) GROUP BY ago`),
    ]);
    res.json({ rows, total: Number(total), contexts, hourly });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/instance/error-logs/:id — dismiss one entry
router.delete('/error-logs/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID invalide' });
  await globalQuery('DELETE FROM error_logs WHERE id = ?', [id]);
  res.json({ ok: true });
});

// DELETE /api/instance/error-logs — clear every entry matching the current filters
router.delete('/error-logs', async (req, res) => {
  const f = errorFilters(req.query);
  const r = await globalQuery(`DELETE e FROM error_logs e ${f.sql}`, f.params);
  res.json({ ok: true, deleted: r.affectedRows || 0 });
});

// ── Demonstration server ──
router.get('/demo', async (req, res) => {
  res.json({ enabled: await require('../../utils/demo').demoEnabled() });
});
router.put('/demo', async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled doit être un booléen' });
  await setSetting('demo', { enabled: req.body.enabled });
  res.json({ enabled: req.body.enabled });
});
router.post('/demo/reset', async (req, res) => {
  res.json(await require('../../utils/demo').seedDemo());
});

// ─── BACKUPS ─────────────────────────────────────────────────────────────────

// GET /api/instance/backup-key — key of the encrypted backups (BACKUP_KEY); every display is logged
router.get('/backup-key', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const key = config.backupKey || null;
  if (key) {
    globalQuery('INSERT INTO instance_audit_log (actor_id, actor_name, action, ip) VALUES (?, ?, ?, ?)',
      [req.owner.id, req.owner.username, 'backup_key_view', (req.ip || '').slice(0, 64)]).catch(() => null);
  }
  res.json({ configured: !!key, key });
});

// ─── HEALTH ──────────────────────────────────────────────────────────────────

const timed = async fn => { const t = Date.now(); try { await fn(); return { ok: true, ms: Date.now() - t }; } catch (err) { return { ok: false, ms: Date.now() - t, error: err.message }; } };

// GET /api/instance/health — Discord, database, Redis, scheduled jobs, process, schema versions
router.get('/health', async (req, res) => {
  const client = req.app.locals.client;
  const { getRedis } = require('../../utils/redis');
  const [database, redis] = await Promise.all([timed(() => globalQuery('SELECT 1')), timed(() => getRedis().ping())]);
  let jobs = null;
  try { jobs = await require('../../utils/jobQueue').jobsStatus(); } catch (err) { jobs = { error: err.message }; }
  const { schemaVersion, LATEST_VERSION } = require('../../utils/tenantMigrations');
  const guilds = await globalQuery("SELECT guild_id, guild_name FROM guilds WHERE status IN ('active', 'suspended')");
  const schemas = [];
  for (const g of guilds) schemas.push({ guildId: g.guild_id, name: g.guild_name, version: await schemaVersion(getTenantDb(g.guild_id)).catch(() => null) });
  const mem = process.memoryUsage();
  const WS_STATUS = ['prêt', 'connexion', 'reconnexion', 'inactif', 'presque prêt', 'déconnecté', 'en attente des serveurs', 'identification', 'reprise'];
  res.json({
    now: Date.now(),
    discord: client ? { ok: client.ws?.status === 0, status: WS_STATUS[client.ws?.status] ?? String(client.ws?.status), pingMs: client.ws?.ping ?? null, guilds: client.guilds?.cache?.size ?? 0, user: client.user?.tag || null } : { ok: false, status: 'client absent' },
    database, redis, jobs,
    process: { uptimeS: Math.round(process.uptime()), node: process.version, rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576), pid: process.pid },
    schemas: { latest: LATEST_VERSION, guilds: schemas },
  });
});

// ─── INSTANCE JOURNAL ──────────────────────────────────────────────────────────────

// GET /api/instance/audit?actor=&action=&guild_id=&page= — journal of the instance section
router.get('/audit', async (req, res) => {
  const where = [], params = [];
  const q = k => (typeof req.query[k] === 'string' && req.query[k] ? req.query[k].slice(0, 100) : null);
  if (q('actor')) { where.push('a.actor_name = ?'); params.push(q('actor')); }
  if (q('action')) { where.push('a.action = ?'); params.push(q('action')); }
  if (q('guild_id')) { where.push('a.guild_id = ?'); params.push(q('guild_id')); }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const [rows, [{ total }], actors] = await Promise.all([
    globalQuery(`SELECT a.*, g.guild_name FROM instance_audit_log a LEFT JOIN guilds g ON g.guild_id = a.guild_id ${sql} ORDER BY a.id DESC LIMIT 50 OFFSET ?`, [...params, (page - 1) * 50]),
    globalQuery(`SELECT COUNT(*) AS total FROM instance_audit_log a ${sql}`, params),
    globalQuery('SELECT DISTINCT actor_name FROM instance_audit_log ORDER BY actor_name'),
  ]);
  res.json({ rows, total: Number(total), page, pages: Math.max(1, Math.ceil(total / 50)), actors: actors.map(a => a.actor_name) });
});

// ─── ERROR ALERT ─────────────────────────────────────────────────────────────

function cleanErrorAlert(body) {
  const { enabled, threshold, windowMinutes, discordUserIds, webhookUrl, discordDownMinutes = 5 } = body || {};
  if (typeof enabled !== 'boolean') return { error: 'enabled doit être un booléen' };
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 10000) return { error: 'Seuil invalide (1 à 10 000)' };
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440) return { error: 'Fenêtre invalide (1 à 1 440 minutes)' };
  if (!Array.isArray(discordUserIds) || discordUserIds.length > 10 || !discordUserIds.every(id => /^\d{17,20}$/.test(id)))
    return { error: 'IDs Discord invalides (10 au plus)' };
  if (webhookUrl !== null && (typeof webhookUrl !== 'string' || webhookUrl.length > 500 || !/^https:\/\/.{3,}/.test(webhookUrl)))
    return { error: 'URL de webhook invalide (https uniquement)' };
  if (!Number.isInteger(discordDownMinutes) || discordDownMinutes < 0 || discordDownMinutes > 1440) return { error: 'Délai de déconnexion invalide (0 à 1 440 minutes)' };
  return { value: { enabled, threshold, windowMinutes, discordUserIds: [...new Set(discordUserIds)], webhookUrl, discordDownMinutes } };
}

// GET /api/instance/settings/error-alert
router.get('/settings/error-alert', async (req, res) => {
  const { DEFAULTS, KEY } = require('../../utils/errorAlert');
  res.json(await getSetting(KEY, DEFAULTS));
});

// PUT /api/instance/settings/error-alert
router.put('/settings/error-alert', async (req, res) => {
  const { value, error } = cleanErrorAlert(req.body);
  if (error) return res.status(400).json({ error });
  await setSetting(require('../../utils/errorAlert').KEY, value);
  res.json(value);
});

// POST /api/instance/settings/error-alert/test — sends a test alert with the saved settings
router.post('/settings/error-alert/test', async (req, res) => {
  const alert = require('../../utils/errorAlert');
  const settings = await getSetting(alert.KEY, alert.DEFAULTS);
  if (!(await alert.recipients(req.app.locals.client, settings)).length && !settings.webhookUrl) return res.status(400).json({ error: 'Aucun destinataire configuré' });
  const results = await alert.sendAlert(req.app.locals.client, settings, await alert.errorSummary(settings.windowMinutes), true);
  res.json({ ok: true, dm: results.dm, webhook: results.webhook });
});

module.exports = router;

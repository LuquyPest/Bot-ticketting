const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { verifyTotp, newTotpSecret, totpUri } = require('../../utils/totp');
const { seal, open, isSealed } = require('../../utils/secretBox');
const QRCode = require('qrcode');
const mysql = require('mysql2/promise');
const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb, getDbName } = require('../../utils/tenantDb');
const { ensureTenantSchema } = require('../../utils/tenantSchema');
const { logAudit } = require('../../utils/gradePermissions');
const requireSuperAdmin = require('../middleware/superadmin');
const { saAuditMiddleware } = require('../../utils/saAudit');

// Every successful change made from the panel is journaled (sa_audit_log)
router.use(saAuditMiddleware);
const { parseJsonField } = require('../../utils/jsonField');

function logSaAuth(req, username, status) {
  const ip = req.ip || 'unknown';
  const ua = (req.headers['user-agent'] || '').slice(0, 500);
  globalQuery(
    'INSERT INTO sa_auth_logs (username, ip, user_agent, status) VALUES (?, ?, ?, ?)',
    [username, ip, ua, status]
  ).catch(() => null);
}

const isGuildIdList = v => Array.isArray(v) && v.length <= 500 && v.every(id => typeof id === 'string' && /^\d{17,20}$/.test(id));

// ─── AUTH ────────────────────────────────────────────────────────────────────

// Per-account lockout (on top of the per-IP rate limit): resists distributed brute force.
const LOCK_AFTER_FAILURES = 5;
const LOCK_MINUTES = 15;
const tableOf = type => (type === 'superadmin' ? 'superadmins' : 'managers');

async function recordFailure(type, id) {
  await globalQuery(
    `UPDATE ${tableOf(type)}
     SET failed_attempts = failed_attempts + 1,
         locked_until = IF(failed_attempts >= ?, NOW() + INTERVAL ? MINUTE, locked_until)
     WHERE id = ?`,
    [LOCK_AFTER_FAILURES, LOCK_MINUTES, id]
  ).catch(() => null);
}

// Final step of a successful login: fresh session ID, counters reset.
function completeLogin(req, res, pending) {
  globalQuery(`UPDATE ${tableOf(pending.type)} SET failed_attempts = 0, locked_until = NULL WHERE id = ?`, [pending.id]).catch(() => null);
  logSaAuth(req, pending.username, 'success');
  const saUser = { id: pending.id, username: pending.username, type: pending.type, lastSeen: Date.now() };
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Erreur serveur' });
    req.session.superAdmin = saUser;
    res.json({ ok: true, username: pending.username, type: pending.type });
  });
}

// POST /api/sa/auth/login
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Identifiants requis' });
  }

  try {
    let account = null;
    let accountType = null;

    const [sa] = await globalQuery('SELECT * FROM superadmins WHERE username = ?', [username.trim()]);
    if (sa) { account = sa; accountType = 'superadmin'; }

    if (!account) {
      const [mgr] = await globalQuery('SELECT * FROM managers WHERE username = ?', [username.trim()]);
      if (mgr) { account = mgr; accountType = 'manager'; }
    }

    // Always run bcrypt.compare even when account is not found to normalize response time
    // and prevent username enumeration via timing side-channel.
    const DUMMY_HASH = '$2b$12$invalidhashpaddingtomatchcostXXXXXXXXXXXXXXXXXXXXXXXXX';
    const valid = await bcrypt.compare(password, account ? account.password_hash : DUMMY_HASH);

    // Same message as the IP limiter, so a lock does not confirm that the account exists
    if (account?.locked_until && new Date(account.locked_until) > new Date()) {
      logSaAuth(req, username.trim(), 'failed');
      return res.status(429).json({ error: 'Trop de tentatives, réessaye dans 15 minutes' });
    }
    if (!account || !valid) {
      if (account) await recordFailure(accountType, account.id);
      logSaAuth(req, username.trim(), 'failed');
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    req.session.saPendingLogin = { id: account.id, username: account.username, type: accountType };

    if (!account.totp_secret || !account.totp_enabled) {
      // First login OR setup started but never confirmed — always generate a fresh secret.
      // Never return an existing DB secret in an API response.
      const secret = newTotpSecret();
      req.session.saPendingLogin.tempSecret = secret;
      const otpUri = totpUri(account.username, 'TicketBot SA', secret);
      const qrDataUrl = await QRCode.toDataURL(otpUri);
      return res.json({ needs_totp_setup: true, qrDataUrl, secret });
    }

    // Normal login — ask for TOTP code
    return res.json({ needs_totp_verify: true });
  } catch (err) {
    console.error('sa login error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/sa/auth/totp-setup — confirm TOTP after scanning QR
router.post('/auth/totp-setup', async (req, res) => {
  const pending = req.session.saPendingLogin;
  if (!pending) return res.status(401).json({ error: 'Session expirée, reconnectez-vous' });

  const { code } = req.body;
  if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Code TOTP requis' });

  const secret = pending.tempSecret;
  if (!secret) return res.status(400).json({ error: 'Aucun secret en attente de confirmation' });

  const step = verifyTotp(code, secret);
  if (!step) return res.status(400).json({ error: 'Code invalide' });

  try {
    await globalQuery(
      `UPDATE ${tableOf(pending.type)} SET totp_secret = ?, totp_enabled = 1, totp_last_step = ? WHERE id = ?`,
      [seal(secret), step, pending.id]
    );
    completeLogin(req, res, pending);
  } catch (err) {
    console.error('sa totp-setup error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const SA_TOTP_MAX_ATTEMPTS = 5;

// POST /api/sa/auth/totp-verify — second factor on normal login
router.post('/auth/totp-verify', async (req, res) => {
  const pending = req.session.saPendingLogin;
  if (!pending) return res.status(401).json({ error: 'Session expirée, reconnectez-vous' });

  if ((pending.totpAttempts || 0) >= SA_TOTP_MAX_ATTEMPTS) {
    delete req.session.saPendingLogin;
    return res.status(429).json({ error: 'Trop de tentatives — reconnecte-toi' });
  }

  const { code } = req.body;
  if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Code TOTP requis' });

  try {
    const [account] = await globalQuery(
      `SELECT totp_secret, totp_last_step, locked_until FROM ${tableOf(pending.type)} WHERE id = ?`,
      [pending.id]
    );
    if (!account?.totp_secret) return res.status(401).json({ error: 'Compte invalide' });
    if (account.locked_until && new Date(account.locked_until) > new Date()) {
      delete req.session.saPendingLogin;
      return res.status(429).json({ error: 'Trop de tentatives, réessaye dans 15 minutes' });
    }

    const step = verifyTotp(code, account.totp_secret, account.totp_last_step);
    if (!step) {
      req.session.saPendingLogin.totpAttempts = (pending.totpAttempts || 0) + 1;
      await recordFailure(pending.type, pending.id);
      const remaining = SA_TOTP_MAX_ATTEMPTS - req.session.saPendingLogin.totpAttempts;
      logSaAuth(req, pending.username, 'totp_failed');
      return res.status(400).json({
        error: `Code invalide — ${remaining} tentative${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}`
      });
    }

    // Records the used step (replay protection) and migrates a legacy plaintext secret
    await globalQuery(
      `UPDATE ${tableOf(pending.type)} SET totp_last_step = ?, totp_secret = ? WHERE id = ?`,
      [step, isSealed(account.totp_secret) ? account.totp_secret : seal(open(account.totp_secret)), pending.id]
    );
    completeLogin(req, res, pending);
  } catch (err) {
    console.error('sa totp-verify error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/sa/auth/me
router.get('/auth/me', requireSuperAdmin, (req, res) => {
  const { id, username, type } = req.saUser;
  res.json({ id, username, type });
});

// POST /api/sa/auth/logout — drops the SA identity and rotates the session ID (dashboard login kept)
router.post('/auth/logout', (req, res) => {
  const { user, discordAccessToken, currentGuildId } = req.session;
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Erreur serveur' });
    Object.assign(req.session, { user, discordAccessToken, currentGuildId });
    res.json({ ok: true });
  });
});

// ─── GUILDS ──────────────────────────────────────────────────────────────────

// Managers can only see and act on their assigned guilds.
// Always re-fetches from DB — assignedGuilds is not stored in the session.
async function canAccessGuild(req, guildId) {
  if (req.saUser.type === 'superadmin') return true;
  const [mgr] = await globalQuery('SELECT assigned_guilds FROM managers WHERE id = ?', [req.saUser.id]);
  const assigned = parseJsonField(mgr?.assigned_guilds);
  return assigned.includes(guildId);
}

// GET /api/sa/guilds
router.get('/guilds', requireSuperAdmin, async (req, res) => {
  try {
    if (req.saUser.type === 'superadmin') {
      const guilds = await globalQuery('SELECT * FROM guilds ORDER BY created_at DESC');
      return res.json(guilds);
    }
    // Manager — only assigned guilds
    const [mgr] = await globalQuery('SELECT assigned_guilds FROM managers WHERE id = ?', [req.saUser.id]);
    const ids = parseJsonField(mgr?.assigned_guilds);
    if (!ids.length) return res.json([]);
    const guilds = await globalQuery('SELECT * FROM guilds WHERE guild_id IN (?) ORDER BY created_at DESC', [ids]);
    res.json(guilds);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/sa/guilds/:guildId
router.get('/guilds/:guildId', requireSuperAdmin, async (req, res) => {
  try {
    const [guild] = await globalQuery('SELECT * FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
    if (!await canAccessGuild(req, guild.guild_id)) return res.status(403).json({ error: 'Accès refusé' });

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

// POST /api/sa/guilds/:guildId/approve
router.post('/guilds/:guildId/approve', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  try {
    const [guild] = await globalQuery('SELECT * FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
    if (guild.status === 'active') return res.status(400).json({ error: 'Déjà actif' });

    await ensureTenantSchema(guild.guild_id);

    // Fondateur = invitant (fallback sur le owner si non capturé)
    const founderId  = guild.inviter_discord_id  || guild.owner_discord_id;
    const founderTag = guild.inviter_discord_tag || guild.owner_discord_tag;

    const db = getTenantDb(guild.guild_id);
    await db(
      `INSERT INTO dashboard_users (user_id, username, role) VALUES (?, ?, 'fondateur')
       ON DUPLICATE KEY UPDATE role = 'fondateur'`,
      [founderId, founderTag]
    );

    await globalQuery(
      'UPDATE guilds SET status = "active", approved_by = ?, approved_at = NOW(), activation_token = NULL WHERE guild_id = ?',
      [req.saUser.id, guild.guild_id]
    );

    // DM au fondateur
    try {
      const client = req.app.locals.client;
      const baseUrl = require('../../utils/config').config.webServerBaseUrl || '';
      const founderUser = await client.users.fetch(founderId);
      await founderUser.send([
        `✅ Ton serveur **${guild.guild_name}** a été activé !`,
        '',
        `Tu peux maintenant accéder au dashboard : **${baseUrl}**`,
        'Connecte-toi avec Discord et sélectionne ton serveur.'
      ].join('\n')).catch(() => null);
    } catch {}

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/sa/guilds/:guildId/suspend
router.patch('/guilds/:guildId/suspend', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
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

// PATCH /api/sa/guilds/:guildId/reactivate
router.patch('/guilds/:guildId/reactivate', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
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

// DELETE /api/sa/guilds/:guildId
router.delete('/guilds/:guildId', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  try {
    const [guild] = await globalQuery('SELECT * FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });

    // The bot leaves the Discord server first — otherwise it stays there and the server is
    // re-registered as "pending" at the next restart (events/ready.js)
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

// PATCH /api/sa/guilds/:guildId/maintenance — toggle maintenance mode
router.patch('/guilds/:guildId/maintenance', requireSuperAdmin, async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: '`enabled` boolean requis' });
  try {
    const [guild] = await globalQuery('SELECT guild_id FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
    if (!await canAccessGuild(req, guild.guild_id)) return res.status(403).json({ error: 'Accès refusé' });
    await globalQuery('UPDATE guilds SET maintenance_mode = ? WHERE guild_id = ?', [enabled ? 1 : 0, guild.guild_id]);
    res.json({ ok: true, maintenance_mode: enabled ? 1 : 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── FOUNDERS (per-tenant) ──────────────────────────────────────────────────

const SNOWFLAKE_RE = /^\d{17,20}$/;

// GET /api/sa/guilds/:guildId/founders — fondateurs du dashboard de ce serveur
router.get('/guilds/:guildId/founders', requireSuperAdmin, async (req, res) => {
  try {
    const [guild] = await globalQuery('SELECT guild_id, status, owner_discord_id, inviter_discord_id FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
    if (!await canAccessGuild(req, guild.guild_id)) return res.status(403).json({ error: 'Accès refusé' });
    if (guild.status === 'pending') return res.json([]); // no tenant DB before approval

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

// POST /api/sa/guilds/:guildId/founders — { discordId } : nomme un fondateur (superadmin uniquement)
router.post('/guilds/:guildId/founders', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  const discordId = typeof req.body.discordId === 'string' ? req.body.discordId.trim() : '';
  if (!SNOWFLAKE_RE.test(discordId)) return res.status(400).json({ error: 'ID Discord invalide (17 à 20 chiffres)' });

  try {
    const [guild] = await globalQuery('SELECT guild_id, guild_name, status FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
    if (guild.status === 'pending') return res.status(400).json({ error: 'Approuve d\'abord le serveur' });

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
    await logAudit(`sa:${req.saUser.id}`, `SA ${req.saUser.username}`, 'founder_add', 'user', user.id, { username: user.username }, db);

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

// DELETE /api/sa/guilds/:guildId/founders/:userId — retire le rôle fondateur (superadmin uniquement)
router.delete('/guilds/:guildId/founders/:userId', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  const userId = String(req.params.userId);
  if (!SNOWFLAKE_RE.test(userId)) return res.status(400).json({ error: 'ID Discord invalide' });
  try {
    const [guild] = await globalQuery('SELECT guild_id, status FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
    if (guild.status === 'pending') return res.status(400).json({ error: 'Serveur non approuvé' });

    const db = getTenantDb(guild.guild_id);
    const [row] = await db("SELECT username FROM dashboard_users WHERE user_id = ? AND role = 'fondateur'", [userId]);
    if (!row) return res.status(404).json({ error: 'Cette personne n\'est pas fondateur de ce serveur' });
    const [{ n }] = await db("SELECT COUNT(*) AS n FROM dashboard_users WHERE role = 'fondateur'");
    if (n <= 1) return res.status(400).json({ error: 'Impossible de retirer le dernier fondateur — ajoute d\'abord un autre fondateur' });

    // Back to "nouveau"; if they hold a Discord staff role, the role sync gives them a support account again
    await db('UPDATE dashboard_users SET role = "nouveau", discord_has_role = 0 WHERE user_id = ?', [userId]);
    await logAudit(`sa:${req.saUser.id}`, `SA ${req.saUser.username}`, 'founder_remove', 'user', userId, { username: row.username }, db);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── BLOCAGES (comptes SA/manager verrouillés, IP limitées) ─────────────────

const { listBlocked, unblock } = require('../rateLimiters');

// GET /api/sa/blocked — comptes verrouillés après trop d'échecs + IP bloquées par les limites de requêtes
router.get('/blocked', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  try {
    const [sas, mgrs] = await Promise.all([
      globalQuery('SELECT id, username, failed_attempts, locked_until FROM superadmins WHERE locked_until > NOW()'),
      globalQuery('SELECT id, username, failed_attempts, locked_until FROM managers WHERE locked_until > NOW()'),
    ]);
    res.json({
      accounts: [
        ...sas.map(a => ({ ...a, type: 'superadmin' })),
        ...mgrs.map(a => ({ ...a, type: 'manager' })),
      ],
      ips: await listBlocked(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/sa/blocked/accounts/:type/:id/unlock
router.post('/blocked/accounts/:type/:id/unlock', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  const table = { superadmin: 'superadmins', manager: 'managers' }[req.params.type];
  if (!table) return res.status(400).json({ error: 'Type de compte invalide' });
  try {
    const r = await globalQuery(`UPDATE ${table} SET failed_attempts = 0, locked_until = NULL WHERE id = ?`, [parseInt(req.params.id)]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Compte introuvable' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/sa/blocked/ips/unblock — { limiter, key }
router.post('/blocked/ips/unblock', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
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

// ─── MANAGERS ────────────────────────────────────────────────────────────────

// GET /api/sa/managers
router.get('/managers', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  try {
    const managers = await globalQuery(
      'SELECT id, username, assigned_guilds, created_by, created_at FROM managers ORDER BY id ASC'
    );
    res.json(managers.map(m => ({
      ...m,
      assigned_guilds: parseJsonField(m.assigned_guilds)
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/sa/managers
router.post('/managers', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  try {
    const { username, password, assigned_guilds = [] } = req.body;
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ error: 'Username requis' });
    }
    if (!password || typeof password !== 'string' || password.length < 12) {
      return res.status(400).json({ error: 'Mot de passe requis (min 12 caractères)' });
    }
    if (!isGuildIdList(assigned_guilds)) {
      return res.status(400).json({ error: 'assigned_guilds doit être un tableau d\'IDs de serveurs' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await globalQuery(
      'INSERT INTO managers (username, password_hash, assigned_guilds, created_by) VALUES (?, ?, ?, ?)',
      [username.trim(), hash, JSON.stringify(assigned_guilds), req.saUser.id]
    );
    res.json({ id: result.insertId, username: username.trim(), assigned_guilds });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Username déjà utilisé' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/sa/managers/:id
router.patch('/managers/:id', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  try {
    const managerId = parseInt(req.params.id);
    const { password, assigned_guilds } = req.body;

    const updates = [];
    const params = [];

    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < 12) {
        return res.status(400).json({ error: 'Mot de passe trop court (min 12 caractères)' });
      }
      updates.push('password_hash = ?');
      params.push(await bcrypt.hash(password, 12));
      // Reset TOTP so the manager must set up again after password change
      updates.push('totp_secret = NULL', 'totp_enabled = 0', 'totp_last_step = 0', 'failed_attempts = 0', 'locked_until = NULL');
    }

    if (assigned_guilds !== undefined) {
      if (!isGuildIdList(assigned_guilds)) return res.status(400).json({ error: 'assigned_guilds invalide' });
      updates.push('assigned_guilds = ?');
      params.push(JSON.stringify(assigned_guilds));
    }

    if (!updates.length) return res.json({ ok: true });
    params.push(managerId);
    await globalQuery(`UPDATE managers SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/sa/managers/:id/reset-totp
router.post('/managers/:id/reset-totp', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  try {
    await globalQuery('UPDATE managers SET totp_secret = NULL, totp_enabled = 0, totp_last_step = 0 WHERE id = ?', [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/sa/managers/:id
router.delete('/managers/:id', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  try {
    await globalQuery('DELETE FROM managers WHERE id = ?', [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── GLOBAL STATS ────────────────────────────────────────────────────────────

// GET /api/sa/stats — overview of every guild the caller can see (managers: assigned guilds only)
router.get('/stats', requireSuperAdmin, async (req, res) => {
  try {
    let guilds = await globalQuery(
      `SELECT g.guild_id, g.guild_name, g.guild_icon, g.status, g.maintenance_mode, g.member_count,
              g.max_tickets, g.max_agents, g.transcript_retention_days, g.plan_id, p.name AS plan_name
       FROM guilds g LEFT JOIN plans p ON p.id = g.plan_id ORDER BY g.guild_name`
    );
    if (req.saUser.type !== 'superadmin') {
      const [mgr] = await globalQuery('SELECT assigned_guilds FROM managers WHERE id = ?', [req.saUser.id]);
      const ids = new Set(parseJsonField(mgr?.assigned_guilds));
      guilds = guilds.filter(g => ids.has(g.guild_id));
    }

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
      if (g.status !== 'pending') {
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
      }
      perGuild.push(row);
    }

    const count = st => guilds.filter(g => g.status === st).length;
    const [[managers], [errors24h]] = await Promise.all([
      globalQuery('SELECT COUNT(*) AS c FROM managers'),
      req.saUser.type === 'superadmin'
        ? globalQuery('SELECT COUNT(*) AS c FROM error_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)')
        : Promise.resolve([{ c: null }]),
    ]);

    res.json({
      guilds: { total: guilds.length, active: count('active'), pending: count('pending'), suspended: count('suspended') },
      managers: managers.c,
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

// PATCH /api/sa/guilds/:guildId/limits — set per-guild resource limits
router.patch('/guilds/:guildId/limits', requireSuperAdmin, async (req, res) => {
  const { max_tickets, max_agents, transcript_retention_days } = req.body;
  const isInt = v => v === undefined || (Number.isInteger(v) && v >= 0);
  if (!isInt(max_tickets) || !isInt(max_agents) || !isInt(transcript_retention_days)) {
    return res.status(400).json({ error: 'Valeurs entières positives requises (0 = illimité)' });
  }
  try {
    const [guild] = await globalQuery('SELECT guild_id FROM guilds WHERE guild_id = ?', [req.params.guildId]);
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
    if (!await canAccessGuild(req, guild.guild_id)) return res.status(403).json({ error: 'Accès refusé' });
    const updates = [];
    const values  = [];
    if (max_tickets !== undefined)              { updates.push('max_tickets = ?');                values.push(max_tickets); }
    if (max_agents !== undefined)               { updates.push('max_agents = ?');                 values.push(max_agents); }
    if (transcript_retention_days !== undefined){ updates.push('transcript_retention_days = ?'); values.push(transcript_retention_days); }
    if (!updates.length) return res.status(400).json({ error: 'Aucune valeur fournie' });
    updates.push('plan_id = NULL'); // edited by hand: no longer follows a plan
    values.push(guild.guild_id);
    await globalQuery(`UPDATE guilds SET ${updates.join(', ')} WHERE guild_id = ?`, values);
    res.json({ ok: true });
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

// GET /api/sa/error-logs — centralized error journal (bot, dashboard, jobs)
router.get('/error-logs', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
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

// DELETE /api/sa/error-logs/:id — dismiss one entry
router.delete('/error-logs/:id', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID invalide' });
  await globalQuery('DELETE FROM error_logs WHERE id = ?', [id]);
  res.json({ ok: true });
});

// DELETE /api/sa/error-logs — clear every entry matching the current filters
router.delete('/error-logs', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  const f = errorFilters(req.query);
  const r = await globalQuery(`DELETE e FROM error_logs e ${f.sql}`, f.params);
  res.json({ ok: true, deleted: r.affectedRows || 0 });
});

// ─── ANNOUNCEMENTS ───────────────────────────────────────────────────────────

const superadminOnly = (req, res, next) => (req.saUser.type === 'superadmin' ? next() : res.status(403).json({ error: 'Réservé au super-admin' }));

// ── Public status page: incidents and maintenances declared by the super-admin ──
function cleanStatusEvent(b, partial = false) {
  const out = {};
  if (!partial || b.title !== undefined) {
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title || title.length > 120) return { error: 'Titre requis (120 caractères max)' };
    out.title = title;
  }
  if (b.message !== undefined) {
    if (b.message !== null && (typeof b.message !== 'string' || b.message.length > 2000)) return { error: 'Message trop long (2000 max)' };
    out.message = b.message?.trim() || null;
  }
  if (b.kind !== undefined) { if (!['incident', 'maintenance'].includes(b.kind)) return { error: 'Type invalide' }; out.kind = b.kind; }
  if (b.component !== undefined) { if (!['bot', 'dashboard', 'all'].includes(b.component)) return { error: 'Composant invalide' }; out.component = b.component; }
  if (b.severity !== undefined) { if (!['minor', 'major'].includes(b.severity)) return { error: 'Gravité invalide' }; out.severity = b.severity; }
  return { value: out };
}

router.get('/status-events', requireSuperAdmin, superadminOnly, async (req, res) => {
  res.json(await globalQuery('SELECT * FROM status_events ORDER BY resolved_at IS NULL DESC, started_at DESC LIMIT 100'));
});

router.post('/status-events', requireSuperAdmin, superadminOnly, async (req, res) => {
  const { value, error } = cleanStatusEvent(req.body || {});
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(value);
  const { insertId } = await globalQuery(`INSERT INTO status_events (${keys.join(', ')}, created_by) VALUES (${keys.map(() => '?').join(', ')}, ?)`, [...keys.map(k => value[k]), req.saUser.username]);
  res.json({ id: insertId });
});

router.patch('/status-events/:id', requireSuperAdmin, superadminOnly, async (req, res) => {
  const { value, error } = cleanStatusEvent(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  const sets = Object.keys(value).map(k => `${k} = ?`);
  const params = Object.values(value);
  if (req.body?.resolved === true) sets.push('resolved_at = COALESCE(resolved_at, NOW())');
  if (req.body?.resolved === false) sets.push('resolved_at = NULL');
  if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
  const r = await globalQuery(`UPDATE status_events SET ${sets.join(', ')} WHERE id = ?`, [...params, parseInt(req.params.id) || 0]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Événement introuvable' });
  res.json({ ok: true });
});

router.delete('/status-events/:id', requireSuperAdmin, superadminOnly, async (req, res) => {
  const r = await globalQuery('DELETE FROM status_events WHERE id = ?', [parseInt(req.params.id) || 0]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Événement introuvable' });
  res.json({ ok: true });
});

router.get('/announcements', requireSuperAdmin, superadminOnly, async (req, res) => {
  res.json(await globalQuery('SELECT * FROM announcements ORDER BY id DESC LIMIT 50'));
});

router.post('/announcements', requireSuperAdmin, superadminOnly, async (req, res) => {
  const { title, body, level, showBanner, sendDm, endsAt } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 120) return res.status(400).json({ error: 'Titre requis (120 caractères max)' });
  if (typeof body !== 'string' || !body.trim() || body.length > 4000) return res.status(400).json({ error: 'Message requis (4000 caractères max)' });
  if (!showBanner && !sendDm) return res.status(400).json({ error: 'Choisis au moins un canal : bandeau ou MP' });
  const ends = endsAt ? new Date(endsAt) : null;
  if (ends && (isNaN(ends) || ends < Date.now())) return res.status(400).json({ error: 'Date de fin invalide' });
  const r = await globalQuery(
    'INSERT INTO announcements (title, body, level, show_banner, send_dm, ends_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [title.trim(), body.trim(), level === 'warning' ? 'warning' : 'info', showBanner ? 1 : 0, sendDm ? 1 : 0, ends, req.saUser.username]
  );
  const [a] = await globalQuery('SELECT * FROM announcements WHERE id = ?', [r.insertId]);
  // DMs go out in the background (many founders); the count is stored when done
  if (sendDm) require('../../utils/announcements').sendAnnouncementDms(req.app.locals.client, a).catch(() => null);
  res.json({ ...a, recipients: sendDm ? (await require('../../utils/announcements').founderIds()).length : 0 });
});

// DELETE /api/sa/announcements/:id — removes the banner (sent DMs stay)
router.delete('/announcements/:id', requireSuperAdmin, superadminOnly, async (req, res) => {
  const r = await globalQuery('DELETE FROM announcements WHERE id = ?', [parseInt(req.params.id)]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Annonce introuvable' });
  res.json({ ok: true });
});

// ─── HEALTH ──────────────────────────────────────────────────────────────────

const timed = async fn => { const t = Date.now(); try { await fn(); return { ok: true, ms: Date.now() - t }; } catch (err) { return { ok: false, ms: Date.now() - t, error: err.message }; } };

// GET /api/sa/health — Discord, database, Redis, scheduled jobs, process, schema versions
router.get('/health', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
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

// ─── PLANS ───────────────────────────────────────────────────────────────────
// A plan is a set of limits; assigning it copies the limits into the guild (the existing
// enforcement keeps working), and editing it updates every guild on that plan.

const LIMIT_KEYS = ['max_tickets', 'max_agents', 'transcript_retention_days'];

function cleanPlan(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 60) return { error: 'Nom invalide (60 caractères max)' };
    out.name = body.name.trim();
  }
  if (body.description !== undefined) {
    if (body.description !== null && (typeof body.description !== 'string' || body.description.length > 255)) return { error: 'Description invalide' };
    out.description = body.description?.trim() || null;
  }
  for (const k of LIMIT_KEYS) {
    if (body[k] === undefined) { if (!partial) out[k] = 0; continue; }
    if (!Number.isInteger(body[k]) || body[k] < 0 || body[k] > 100000) return { error: `${k} : entier positif attendu` };
    out[k] = body[k];
  }
  return { value: out };
}


router.get('/plans', requireSuperAdmin, async (req, res) => {
  const plans = await globalQuery(`SELECT p.*, (SELECT COUNT(*) FROM guilds g WHERE g.plan_id = p.id) AS guild_count FROM plans p ORDER BY p.name`);
  res.json(plans.map(p => ({ ...p, guild_count: Number(p.guild_count) })));
});

router.post('/plans', requireSuperAdmin, superadminOnly, async (req, res) => {
  const { value, error } = cleanPlan(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const r = await globalQuery('INSERT INTO plans (name, description, max_tickets, max_agents, transcript_retention_days) VALUES (?, ?, ?, ?, ?)',
      [value.name, value.description ?? null, value.max_tickets, value.max_agents, value.transcript_retention_days]);
    res.json({ id: r.insertId, ...value, guild_count: 0 });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Une formule porte déjà ce nom' });
    throw err;
  }
});

router.patch('/plans/:id', requireSuperAdmin, superadminOnly, async (req, res) => {
  const [plan] = await globalQuery('SELECT * FROM plans WHERE id = ?', [parseInt(req.params.id)]);
  if (!plan) return res.status(404).json({ error: 'Formule introuvable' });
  const { value, error } = cleanPlan(req.body, true);
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(value);
  if (keys.length) await globalQuery(`UPDATE plans SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => value[k]), plan.id]);
  const limits = LIMIT_KEYS.filter(k => value[k] !== undefined);
  let propagated = 0;
  if (limits.length) {
    propagated = (await globalQuery(`UPDATE guilds SET ${limits.map(k => `${k} = ?`).join(', ')} WHERE plan_id = ?`, [...limits.map(k => value[k]), plan.id])).affectedRows;
  }
  res.json({ ...plan, ...value, propagated });
});

router.delete('/plans/:id', requireSuperAdmin, superadminOnly, async (req, res) => {
  const id = parseInt(req.params.id);
  // Guilds keep their current limits and become "custom"
  await globalQuery('UPDATE guilds SET plan_id = NULL WHERE plan_id = ?', [id]);
  const r = await globalQuery('DELETE FROM plans WHERE id = ?', [id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Formule introuvable' });
  res.json({ ok: true });
});

// PUT /api/sa/guilds/:guildId/plan { planId } — null: keep the limits, as custom
router.put('/guilds/:guildId/plan', requireSuperAdmin, async (req, res) => {
  const [guild] = await globalQuery('SELECT guild_id FROM guilds WHERE guild_id = ?', [req.params.guildId]);
  if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
  if (!await canAccessGuild(req, guild.guild_id)) return res.status(403).json({ error: 'Accès refusé' });
  if (req.body.planId === null) {
    await globalQuery('UPDATE guilds SET plan_id = NULL WHERE guild_id = ?', [guild.guild_id]);
    return res.json({ ok: true, plan: null });
  }
  const [plan] = await globalQuery('SELECT * FROM plans WHERE id = ?', [parseInt(req.body.planId)]);
  if (!plan) return res.status(400).json({ error: 'Formule introuvable' });
  await globalQuery('UPDATE guilds SET plan_id = ?, max_tickets = ?, max_agents = ?, transcript_retention_days = ? WHERE guild_id = ?',
    [plan.id, plan.max_tickets, plan.max_agents, plan.transcript_retention_days, guild.guild_id]);
  res.json({ ok: true, plan });
});

// ─── SA JOURNAL ──────────────────────────────────────────────────────────────

// GET /api/sa/audit?actor=&action=&guild_id=&page= — journal of the panel (superadmin only)
router.get('/audit', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  const where = [], params = [];
  const q = k => (typeof req.query[k] === 'string' && req.query[k] ? req.query[k].slice(0, 100) : null);
  if (q('actor')) { where.push('a.actor_name = ?'); params.push(q('actor')); }
  if (q('action')) { where.push('a.action = ?'); params.push(q('action')); }
  if (q('guild_id')) { where.push('a.guild_id = ?'); params.push(q('guild_id')); }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const [rows, [{ total }], actors] = await Promise.all([
    globalQuery(`SELECT a.*, g.guild_name FROM sa_audit_log a LEFT JOIN guilds g ON g.guild_id = a.guild_id ${sql} ORDER BY a.id DESC LIMIT 50 OFFSET ?`, [...params, (page - 1) * 50]),
    globalQuery(`SELECT COUNT(*) AS total FROM sa_audit_log a ${sql}`, params),
    globalQuery('SELECT DISTINCT actor_name FROM sa_audit_log ORDER BY actor_name'),
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

// GET /api/sa/settings/error-alert
router.get('/settings/error-alert', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  const { getSetting } = require('../../utils/saSettings');
  const { DEFAULTS, KEY } = require('../../utils/errorAlert');
  res.json(await getSetting(KEY, DEFAULTS));
});

// PUT /api/sa/settings/error-alert
router.put('/settings/error-alert', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  const { value, error } = cleanErrorAlert(req.body);
  if (error) return res.status(400).json({ error });
  const { setSetting } = require('../../utils/saSettings');
  await setSetting(require('../../utils/errorAlert').KEY, value);
  res.json(value);
});

// POST /api/sa/settings/error-alert/test — sends a test alert with the saved settings
router.post('/settings/error-alert/test', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  const { getSetting } = require('../../utils/saSettings');
  const alert = require('../../utils/errorAlert');
  const settings = await getSetting(alert.KEY, alert.DEFAULTS);
  if (!settings.discordUserIds.length && !settings.webhookUrl) return res.status(400).json({ error: 'Aucun destinataire configuré' });
  const results = await alert.sendAlert(req.app.locals.client, settings, await alert.errorSummary(settings.windowMinutes), true);
  res.json({ ok: true, dm: results.dm, webhook: results.webhook });
});

module.exports = router;

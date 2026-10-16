const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { authenticator } = require('otplib');
const { verifyTotp } = require('../../utils/totp');
const { seal, open, isSealed } = require('../../utils/secretBox');
const QRCode = require('qrcode');
const mysql = require('mysql2/promise');
const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb, getDbName } = require('../../utils/tenantDb');
const { ensureTenantSchema } = require('../../utils/tenantSchema');
const { logAudit } = require('../../utils/gradePermissions');
const requireSuperAdmin = require('../middleware/superadmin');
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
      const secret = authenticator.generateSecret();
      req.session.saPendingLogin.tempSecret = secret;
      const otpUri = authenticator.keyuri(account.username, 'TicketBot SA', secret);
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
      ips: listBlocked(),
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

// GET /api/sa/stats
router.get('/stats', requireSuperAdmin, async (req, res) => {
  try {
    const [[total], [active], [pending], [suspended], [managerCount]] = await Promise.all([
      globalQuery('SELECT COUNT(*) as c FROM guilds'),
      globalQuery('SELECT COUNT(*) as c FROM guilds WHERE status = "active"'),
      globalQuery('SELECT COUNT(*) as c FROM guilds WHERE status = "pending"'),
      globalQuery('SELECT COUNT(*) as c FROM guilds WHERE status = "suspended"'),
      globalQuery('SELECT COUNT(*) as c FROM managers'),
    ]);

    res.json({
      guilds: { total: total.c, active: active.c, pending: pending.c, suspended: suspended.c },
      managers: managerCount.c
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
    values.push(guild.guild_id);
    await globalQuery(`UPDATE guilds SET ${updates.join(', ')} WHERE guild_id = ?`, values);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/sa/error-logs — centralized error log from all guilds
router.get('/error-logs', requireSuperAdmin, async (req, res) => {
  if (req.saUser.type !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  const guild_id = typeof req.query.guild_id === 'string' ? req.query.guild_id : null;
  const limit  = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  try {
    const where  = guild_id ? 'WHERE guild_id = ?' : '';
    const params = guild_id ? [guild_id, limit, offset] : [limit, offset];
    const [rows, [{ total }]] = await Promise.all([
      globalQuery(`SELECT id, guild_id, context, message, stack, created_at FROM error_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, params),
      globalQuery(`SELECT COUNT(*) as total FROM error_logs ${where}`, guild_id ? [guild_id] : []),
    ]);
    res.json({ rows, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

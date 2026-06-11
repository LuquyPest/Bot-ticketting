const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const mysql = require('mysql2/promise');
const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb, getDbName } = require('../../utils/tenantDb');
const { ensureTenantSchema } = require('../../utils/tenantSchema');
const requireSuperAdmin = require('../middleware/superadmin');

// ─── AUTH ────────────────────────────────────────────────────────────────────

// POST /api/sa/auth/login
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Identifiants requis' });

  try {
    let account = null;
    let accountType = null;

    const [sa] = await globalQuery('SELECT * FROM superadmins WHERE username = ?', [username.trim()]);
    if (sa) { account = sa; accountType = 'superadmin'; }

    if (!account) {
      const [mgr] = await globalQuery('SELECT * FROM managers WHERE username = ?', [username.trim()]);
      if (mgr) { account = mgr; accountType = 'manager'; }
    }

    if (!account) return res.status(401).json({ error: 'Identifiants invalides' });

    const valid = await bcrypt.compare(password, account.password_hash);
    if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });

    req.session.saPendingLogin = { id: account.id, username: account.username, type: accountType };

    if (!account.totp_secret) {
      // First login — generate TOTP secret and show QR
      const secret = authenticator.generateSecret();
      req.session.saPendingLogin.tempSecret = secret;
      const otpUri = authenticator.keyuri(account.username, 'TicketBot SA', secret);
      const qrDataUrl = await QRCode.toDataURL(otpUri);
      return res.json({ needs_totp_setup: true, qrDataUrl, secret });
    }

    if (!account.totp_enabled) {
      // Setup started but TOTP not confirmed yet — re-show QR
      const otpUri = authenticator.keyuri(account.username, 'TicketBot SA', account.totp_secret);
      const qrDataUrl = await QRCode.toDataURL(otpUri);
      return res.json({ needs_totp_setup: true, qrDataUrl, secret: account.totp_secret });
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

  if (!authenticator.verify({ token: code.replace(/\s/g, ''), secret })) {
    return res.status(400).json({ error: 'Code invalide' });
  }

  try {
    const table = pending.type === 'superadmin' ? 'superadmins' : 'managers';
    await globalQuery(`UPDATE ${table} SET totp_secret = ?, totp_enabled = 1 WHERE id = ?`, [secret, pending.id]);

    delete req.session.saPendingLogin;
    req.session.superAdmin = { id: pending.id, username: pending.username, type: pending.type };
    res.json({ ok: true, username: pending.username, type: pending.type });
  } catch (err) {
    console.error('sa totp-setup error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/sa/auth/totp-verify — second factor on normal login
router.post('/auth/totp-verify', async (req, res) => {
  const pending = req.session.saPendingLogin;
  if (!pending) return res.status(401).json({ error: 'Session expirée, reconnectez-vous' });

  const { code } = req.body;
  if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Code TOTP requis' });

  try {
    const table = pending.type === 'superadmin' ? 'superadmins' : 'managers';
    const [account] = await globalQuery(`SELECT totp_secret FROM ${table} WHERE id = ?`, [pending.id]);
    if (!account?.totp_secret) return res.status(401).json({ error: 'Compte invalide' });

    if (!authenticator.verify({ token: code.replace(/\s/g, ''), secret: account.totp_secret })) {
      return res.status(400).json({ error: 'Code invalide' });
    }

    delete req.session.saPendingLogin;
    req.session.superAdmin = { id: pending.id, username: pending.username, type: pending.type };
    res.json({ ok: true, username: pending.username, type: pending.type });
  } catch (err) {
    console.error('sa totp-verify error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/sa/auth/me
router.get('/auth/me', requireSuperAdmin, (req, res) => {
  res.json(req.saUser);
});

// POST /api/sa/auth/logout
router.post('/auth/logout', (req, res) => {
  delete req.session.superAdmin;
  delete req.session.saPendingLogin;
  res.json({ ok: true });
});

// ─── GUILDS ──────────────────────────────────────────────────────────────────

// Managers can only see and act on their assigned guilds
function canAccessGuild(req, guildId) {
  if (req.saUser.type === 'superadmin') return true;
  const assigned = req.saUser.assignedGuilds || [];
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
    const ids = mgr?.assigned_guilds ? JSON.parse(mgr.assigned_guilds) : [];
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
    if (!canAccessGuild(req, guild.guild_id)) return res.status(403).json({ error: 'Accès refusé' });

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

    // Register guild owner as fondateur in the per-guild DB
    const db = getTenantDb(guild.guild_id);
    await db(
      `INSERT INTO dashboard_users (user_id, username, role) VALUES (?, ?, 'fondateur')
       ON DUPLICATE KEY UPDATE role = 'fondateur'`,
      [guild.owner_discord_id, guild.owner_discord_tag]
    );

    await globalQuery(
      'UPDATE guilds SET status = "active", approved_by = ?, approved_at = NOW(), activation_token = NULL WHERE guild_id = ?',
      [req.saUser.id, guild.guild_id]
    );

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
    await globalQuery('UPDATE guilds SET status = "suspended" WHERE guild_id = ?', [guild.guild_id]);
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
    await globalQuery('UPDATE guilds SET status = "active" WHERE guild_id = ?', [guild.guild_id]);
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

    const dbName = getDbName(guild.guild_id);
    const cfg = require('../../config.json').database;
    const conn = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password });
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    } finally {
      await conn.end();
    }

    await globalQuery('DELETE FROM guilds WHERE guild_id = ?', [guild.guild_id]);
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
      assigned_guilds: typeof m.assigned_guilds === 'string' ? JSON.parse(m.assigned_guilds) : m.assigned_guilds
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
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Mot de passe requis (min 8 caractères)' });
    }
    if (!Array.isArray(assigned_guilds)) {
      return res.status(400).json({ error: 'assigned_guilds doit être un tableau' });
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
      if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Mot de passe trop court (min 8 caractères)' });
      }
      updates.push('password_hash = ?');
      params.push(await bcrypt.hash(password, 12));
      // Reset TOTP so the manager must set up again after password change
      updates.push('totp_secret = NULL', 'totp_enabled = 0');
    }

    if (assigned_guilds !== undefined) {
      if (!Array.isArray(assigned_guilds)) return res.status(400).json({ error: 'assigned_guilds invalide' });
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
    await globalQuery('UPDATE managers SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?', [parseInt(req.params.id)]);
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

module.exports = router;

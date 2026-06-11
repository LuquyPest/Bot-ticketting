const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const crypto  = require('crypto');
const { authenticator } = require('otplib');
const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb }  = require('../../utils/tenantDb');

function logLogin(req, userId, username, status) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const ua = (req.headers['user-agent'] || '').slice(0, 500);
  globalQuery(
    'INSERT INTO login_logs (user_id, username, ip, user_agent, status) VALUES (?, ?, ?, ?, ?)',
    [userId, username, ip, ua, status]
  ).catch(() => null);
}

let _cfg = null;
let _cfgMtime = 0;
const fs = require('fs');
const _cfgPath = require.resolve('../../config.json');

function cfg() {
  try {
    const mtime = fs.statSync(_cfgPath).mtimeMs;
    if (!_cfg || mtime !== _cfgMtime) {
      delete require.cache[_cfgPath];
      _cfg = require(_cfgPath);
      _cfgMtime = mtime;
    }
  } catch {
    if (!_cfg) throw new Error('config.json introuvable');
  }
  return _cfg;
}

// GET /api/auth/me
router.get('/me', async (req, res) => {
  // Pending TOTP verification (after OAuth, before 2FA confirmed)
  if (!req.session.user && req.session.pendingTotp) {
    const p = req.session.pendingTotp;
    return res.json({ id: p.userId, username: p.username, avatar: p.avatar, needsTotp: true });
  }

  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  const user = req.session.user;

  const guildId = req.session.currentGuildId || null;

  if (!guildId) {
    return res.json({ ...user, guildId: null, permissions: [] });
  }

  try {
    const db = getTenantDb(guildId);
    const base = { ...user, guildId };
    if (user.role === 'fondateur') {
      return res.json({ ...base, permissions: require('../../utils/gradePermissions').PERMISSIONS });
    }
    const perms = await require('../../utils/gradePermissions').getUserPermissions(user.id, db);
    res.json({ ...base, permissions: [...perms] });
  } catch {
    res.json({ ...user, guildId, permissions: [] });
  }
});

// GET /api/auth/guilds — list guilds this user has access to
router.get('/guilds', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const guilds = await globalQuery(
      'SELECT guild_id, guild_name, guild_icon, status FROM guilds WHERE status = "active"'
    );

    const accessible = [];
    for (const guild of guilds) {
      try {
        const db = getTenantDb(guild.guild_id);
        const [row] = await db(
          'SELECT role FROM dashboard_users WHERE user_id = ?',
          [req.session.user.id]
        );
        if (row && row.role !== 'nouveau') {
          accessible.push({ ...guild, role: row.role });
        }
      } catch {
        // Guild DB might not exist yet — skip
      }
    }
    res.json(accessible);
  } catch (err) {
    console.error('auth/guilds error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/select-guild
router.post('/select-guild', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  const { guildId } = req.body;
  if (!guildId) return res.status(400).json({ error: 'guildId requis' });

  try {
    const [guild] = await globalQuery(
      'SELECT * FROM guilds WHERE guild_id = ? AND status = "active"',
      [guildId]
    );
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });

    const db = getTenantDb(guildId);
    const [dbUser] = await db(
      'SELECT role FROM dashboard_users WHERE user_id = ?',
      [req.session.user.id]
    );
    if (!dbUser) return res.status(403).json({ error: 'Accès refusé sur ce serveur' });

    req.session.currentGuildId = guildId;
    req.session.user.role = dbUser.role;
    res.json({ ok: true, guildId, role: dbUser.role });
  } catch (err) {
    console.error('select-guild error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/auth/discord — redirect to Discord OAuth
router.get('/discord', (req, res) => {
  const config = cfg();
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.dashboard.discordCallbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

// GET /api/auth/discord/callback
router.get('/discord/callback', async (req, res) => {
  const config = cfg();
  const { code, state } = req.query;
  if (!code) return res.redirect('/login?error=no_code');
  if (!state || state !== req.session.oauthState) return res.redirect('/login?error=invalid_state');
  delete req.session.oauthState;

  try {
    const { data: token } = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id:     config.clientId,
        client_secret: config.dashboard.discordClientSecret,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  config.dashboard.discordCallbackUrl
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { data: discordUser } = await axios.get(
      'https://discord.com/api/users/@me',
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );

    // Find active guilds where this user is registered
    const activeGuilds = await globalQuery(
      'SELECT guild_id, guild_name, guild_icon FROM guilds WHERE status = "active"'
    );

    const userGuilds = [];
    for (const guild of activeGuilds) {
      try {
        const db = getTenantDb(guild.guild_id);
        const [existing] = await db(
          'SELECT user_id, role FROM dashboard_users WHERE user_id = ?',
          [discordUser.id]
        );

        if (existing) {
          await db(
            'UPDATE dashboard_users SET username = ?, avatar = ?, last_login = NOW() WHERE user_id = ?',
            [discordUser.username, discordUser.avatar || null, discordUser.id]
          );
          if (existing.role !== 'nouveau') {
            userGuilds.push({ guild_id: guild.guild_id, guild_name: guild.guild_name, guild_icon: guild.guild_icon, role: existing.role });
          }
        }
      } catch {
        // DB not ready yet — skip
      }
    }

    // Check if user has 2FA enabled
    const [totpRow] = await globalQuery(
      'SELECT totp_enabled FROM user_totp WHERE user_id = ? AND totp_enabled = 1',
      [discordUser.id]
    );

    if (totpRow) {
      // 2FA required — store pending state, don't establish full session yet
      logLogin(req, discordUser.id, discordUser.username, '2fa_required');
      req.session.regenerate(err => {
        if (err) return res.redirect('/login?error=oauth_failed');
        req.session.pendingTotp = {
          userId:     discordUser.id,
          username:   discordUser.username,
          avatar:     discordUser.avatar || null,
          userGuilds,
        };
        res.redirect('/totp-verify');
      });
      return;
    }

    // No 2FA — establish session normally
    logLogin(req, discordUser.id, discordUser.username, 'success');
    req.session.regenerate(err => {
      if (err) return res.redirect('/login?error=oauth_failed');
      req.session.user = {
        id:       discordUser.id,
        username: discordUser.username,
        avatar:   discordUser.avatar || null,
        role:     null,
      };

      if (userGuilds.length === 1) {
        req.session.currentGuildId = userGuilds[0].guild_id;
        req.session.user.role = userGuilds[0].role;
        return res.redirect('/');
      }

      res.redirect(userGuilds.length === 0 ? '/pending' : '/select-guild');
    });
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    res.redirect('/login?error=oauth_failed');
  }
});

const TOTP_MAX_ATTEMPTS = 5;

// POST /api/auth/totp-verify-login — complete login after 2FA verification
router.post('/totp-verify-login', async (req, res) => {
  const pending = req.session.pendingTotp;
  if (!pending) return res.status(400).json({ error: 'Aucune session en attente de vérification' });

  // Lockout after too many failed attempts — invalidate session, force re-auth
  if ((pending.totpAttempts || 0) >= TOTP_MAX_ATTEMPTS) {
    delete req.session.pendingTotp;
    logLogin(req, pending.userId, pending.username, 'blocked');
    return res.status(429).json({ error: 'Trop de tentatives — reconnecte-toi depuis Discord' });
  }

  const code = (req.body.code || '').replace(/\s/g, '');
  if (!code) return res.status(400).json({ error: 'Code requis' });

  try {
    const [row] = await globalQuery(
      'SELECT totp_secret FROM user_totp WHERE user_id = ? AND totp_enabled = 1',
      [pending.userId]
    );
    if (!row) return res.status(400).json({ error: 'Configuration 2FA introuvable' });

    if (!authenticator.verify({ token: code, secret: row.totp_secret })) {
      req.session.pendingTotp.totpAttempts = (pending.totpAttempts || 0) + 1;
      const remaining = TOTP_MAX_ATTEMPTS - req.session.pendingTotp.totpAttempts;
      return res.status(400).json({
        error: `Code invalide — ${remaining} tentative${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}`
      });
    }

    const { userGuilds } = pending;
    delete req.session.pendingTotp;

    logLogin(req, pending.userId, pending.username, 'success');
    req.session.user = {
      id:       pending.userId,
      username: pending.username,
      avatar:   pending.avatar,
      role:     null,
    };

    if (userGuilds.length === 1) {
      req.session.currentGuildId = userGuilds[0].guild_id;
      req.session.user.role = userGuilds[0].role;
    }

    const redirect = userGuilds.length === 0 ? '/pending'
                   : userGuilds.length === 1 ? '/'
                   : '/select-guild';

    res.json({ ok: true, redirect });
  } catch (err) {
    console.error('totp-verify-login error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;

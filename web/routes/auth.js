const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const crypto  = require('crypto');
const { authenticator } = require('otplib');
const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb }  = require('../../utils/tenantDb');

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

function logLogin(req, userId, username, status) {
  const ip = getClientIp(req);
  const ua = (req.headers['user-agent'] || '').slice(0, 500);
  globalQuery(
    'INSERT INTO login_logs (user_id, username, ip, user_agent, status) VALUES (?, ?, ?, ?, ?)',
    [userId, username, ip, ua, status]
  ).catch(() => null);
}

function trackSession(req, userId) {
  const ip = getClientIp(req);
  const ua = (req.headers['user-agent'] || '').slice(0, 500);
  const sid = req.session.id;
  globalQuery(
    `INSERT INTO user_sessions (user_id, session_id, ip, user_agent)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE last_seen_at = NOW()`,
    [userId, sid, ip, ua]
  ).catch(() => null);
}

async function checkNewIpAlert(req, userId) {
  const ip = getClientIp(req);
  try {
    const rows = await globalQuery(
      'SELECT ip FROM login_logs WHERE user_id = ? AND status = "success" ORDER BY id DESC LIMIT 10',
      [userId]
    );
    const known = new Set(rows.map(r => r.ip));
    if (known.size === 0 || known.has(ip)) return; // first login or known IP

    const config = cfg();
    if (!config.token) return;
    const date = new Date().toLocaleString('fr-FR');
    const dmChannel = await axios.post(
      'https://discord.com/api/users/@me/channels',
      { recipient_id: userId },
      { headers: { Authorization: `Bot ${config.token}` } }
    ).catch(() => null);
    if (!dmChannel?.data?.id) return;
    await axios.post(
      `https://discord.com/api/channels/${dmChannel.data.id}/messages`,
      { content: `⚠️ **Nouvelle connexion au dashboard** depuis une IP inconnue \`${ip}\` le ${date}.\nSi ce n'est pas toi, révoque tes sessions depuis ton profil.` },
      { headers: { Authorization: `Bot ${config.token}` } }
    ).catch(() => null);
  } catch {}
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
  if (!req.session.user && req.session.pendingTotp) {
    const p = req.session.pendingTotp;
    return res.json({ id: p.userId, username: p.username, avatar: p.avatar, needsTotp: true });
  }

  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  const user = req.session.user;
  const guildId = req.session.currentGuildId || null;

  if (!guildId) return res.json({ ...user, guildId: null, permissions: [] });

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

// GET /api/auth/guilds
// Fetches the user's Discord guilds (via stored access token), filters by MANAGE_GUILD,
// and enriches each entry with the bot's status from our DB.
router.get('/guilds', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });

  const accessToken = req.session.discordAccessToken;
  if (!accessToken) return res.status(401).json({ error: 'Session expirée — reconnecte-toi' });

  try {
    const { data: discordGuilds } = await axios.get(
      'https://discord.com/api/users/@me/guilds',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const MANAGE_GUILD = BigInt(0x20);
    const manageable = discordGuilds.filter(g =>
      g.owner || ((BigInt(g.permissions) & MANAGE_GUILD) !== 0n)
    );

    if (!manageable.length) return res.json([]);

    const ids = manageable.map(g => g.id);
    const dbGuilds = await globalQuery(
      `SELECT guild_id, status FROM guilds WHERE guild_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    const dbMap = new Map(dbGuilds.map(g => [g.guild_id, g.status]));

    const result = manageable.map(g => ({
      id:      g.id,
      name:    g.name,
      icon:    g.icon,
      iconUrl: g.icon
        ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${g.icon.startsWith('a_') ? 'gif' : 'webp'}?size=128`
        : null,
      status: dbMap.get(g.id) ?? 'not_added',
    }));

    res.json(result);
  } catch (err) {
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'Session Discord expirée — reconnecte-toi' });
    }
    console.error('auth/guilds error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/auth/invite-url?guildId=xxx
// Returns the bot invite URL with the target guild pre-selected.
router.get('/invite-url', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  const config = cfg();
  const { guildId } = req.query;
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('scope', 'bot applications.commands');
  url.searchParams.set('permissions', '117776'); // VIEW + SEND + MANAGE_CHANNELS + HISTORY + EMBED + ATTACH
  if (guildId) {
    url.searchParams.set('guild_id', guildId);
    url.searchParams.set('disable_guild_select', 'true');
  }
  res.json({ url: url.toString() });
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
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable ou inactif' });

    const db = getTenantDb(guildId);
    let [dbUser] = await db(
      'SELECT role FROM dashboard_users WHERE user_id = ?',
      [req.session.user.id]
    );

    // Auto-register the guild owner as fondateur on their first access
    if (!dbUser && guild.owner_discord_id === req.session.user.id) {
      await db(
        `INSERT INTO dashboard_users (user_id, username, avatar, role)
         VALUES (?, ?, ?, 'fondateur')
         ON DUPLICATE KEY UPDATE role = 'fondateur'`,
        [req.session.user.id, req.session.user.username, req.session.user.avatar]
      );
      dbUser = { role: 'fondateur' };
    }

    if (!dbUser) return res.status(403).json({ error: 'Accès refusé — contacte le fondateur du serveur' });

    const userData     = { ...req.session.user, role: dbUser.role };
    const accessToken  = req.session.discordAccessToken;

    // Regenerate session ID after privilege change (prevents session fixation)
    req.session.regenerate(regenErr => {
      if (regenErr) return res.status(500).json({ error: 'Erreur serveur' });
      req.session.user               = userData;
      req.session.discordAccessToken = accessToken;
      req.session.currentGuildId     = guildId;
      res.json({ ok: true, guildId, role: dbUser.role });
    });
    return;
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
  url.searchParams.set('scope', 'identify guilds');
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

    const [totpRow] = await globalQuery(
      'SELECT totp_enabled FROM user_totp WHERE user_id = ? AND totp_enabled = 1',
      [discordUser.id]
    );

    if (totpRow) {
      logLogin(req, discordUser.id, discordUser.username, '2fa_required');
      req.session.regenerate(err => {
        if (err) return res.redirect('/login?error=oauth_failed');
        req.session.pendingTotp = {
          userId:             discordUser.id,
          username:           discordUser.username,
          avatar:             discordUser.avatar || null,
          discordAccessToken: token.access_token,
        };
        res.redirect('/totp-verify');
      });
      return;
    }

    logLogin(req, discordUser.id, discordUser.username, 'success');
    checkNewIpAlert(req, discordUser.id).catch(() => null);
    req.session.regenerate(err => {
      if (err) return res.redirect('/login?error=oauth_failed');
      req.session.user = {
        id:       discordUser.id,
        username: discordUser.username,
        avatar:   discordUser.avatar || null,
        role:     null,
      };
      req.session.discordAccessToken = token.access_token;
      req.session.save(() => trackSession(req, discordUser.id));
      res.redirect('/select-guild');
    });
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    res.redirect('/login?error=oauth_failed');
  }
});

const TOTP_MAX_ATTEMPTS = 5;

// POST /api/auth/totp-verify-login
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

    logLogin(req, pending.userId, pending.username, 'success');
    checkNewIpAlert(req, pending.userId).catch(() => null);
    req.session.user = {
      id:       pending.userId,
      username: pending.username,
      avatar:   pending.avatar,
      role:     null,
    };
    req.session.discordAccessToken = pending.discordAccessToken;
    delete req.session.pendingTotp;
    req.session.save(() => trackSession(req, pending.userId));

    res.json({ ok: true, redirect: '/select-guild' });
  } catch (err) {
    console.error('totp-verify-login error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const sid    = req.session.id;
  const userId = req.session.user?.id;
  req.session.destroy(() => {
    if (userId) {
      globalQuery('DELETE FROM user_sessions WHERE session_id = ?', [sid]).catch(() => null);
    }
    res.json({ ok: true });
  });
});

module.exports = router;

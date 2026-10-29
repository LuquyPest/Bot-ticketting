const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const crypto  = require('crypto');
const { verifyTotp, consumeRecoveryCode } = require('../../utils/totp');
const { seal, open, isSealed } = require('../../utils/secretBox');

const RECOVERY_RE = /^[0-9a-f]{5}-?[0-9a-f]{5}$/i;
const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb }  = require('../../utils/tenantDb');
const { syncDiscordStaff, discordStaffLevel } = require('../../utils/staffSync');
const { recordEvent } = require('../../utils/audit');

function getClientIp(req) {
  return req.ip || 'unknown'; // resolved through `trust proxy` — never trust raw X-Forwarded-For
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

// Sign-in from a device the account never used: DM through the bot (utils/deviceAlert.js).
// Called before the sign-in is written to login_logs, otherwise the device is already "known".
async function checkNewDeviceAlert(req, userId) {
  try {
    const config = cfg();
    if (!config.token) return;
    const send = async (recipient, payload) => {
      const dm = await axios.post('https://discord.com/api/users/@me/channels', { recipient_id: recipient },
        { headers: { Authorization: `Bot ${config.token}` } }).catch(() => null);
      if (dm?.data?.id) {
        await axios.post(`https://discord.com/api/channels/${dm.data.id}/messages`, payload,
          { headers: { Authorization: `Bot ${config.token}` } }).catch(() => null);
      }
    };
    await require('../../utils/deviceAlert').alertNewDevice({
      userId, userAgent: req.headers['user-agent'], ip: getClientIp(req), baseUrl: config.webServerBaseUrl, send,
    });
  } catch {}
}

let _cfg = null;
let _cfgMtime = 0;
const fs = require('fs');
const _cfgPath = require('../../utils/config').CONFIG_PATH;

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
    const base = { ...user, guildId, idleTimeoutMinutes: await require('../../utils/idleTimeout').idleMinutes(db, guildId) };
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
  if (req.session.user.demo) {
    const { DEMO_GUILD_ID, DEMO_NAME } = require('../../utils/demo');
    return res.json([{ id: DEMO_GUILD_ID, name: DEMO_NAME, icon: null, iconUrl: null, status: 'active' }]);
  }

  const accessToken = req.session.discordAccessToken;
  if (!accessToken) return res.status(401).json({ error: 'Session expirée — reconnecte-toi' });

  try {
    const { data: discordGuilds } = await axios.get(
      'https://discord.com/api/users/@me/guilds',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const MANAGE_GUILD = BigInt(0x20);
    const canManage = g => g.owner || ((BigInt(g.permissions) & MANAGE_GUILD) !== 0n);
    if (!discordGuilds.length) return res.json([]);

    const ids = discordGuilds.map(g => g.id);
    const dbGuilds = await globalQuery(
      `SELECT guild_id, status FROM guilds WHERE guild_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    const dbMap = new Map(dbGuilds.map(g => [g.guild_id, g.status]));

    // Managers see every server (to invite the bot); others see the active servers where they
    // already have a dashboard account or hold a Discord staff role
    const visible = [];
    for (const g of discordGuilds) {
      if (canManage(g)) { visible.push(g); continue; }
      if (dbMap.get(g.id) !== 'active') continue;
      try {
        const db = getTenantDb(g.id);
        const [row] = await db('SELECT role FROM dashboard_users WHERE user_id = ?', [req.session.user.id]);
        if (row || await discordStaffLevel(req.app.locals.client, db, g.id, req.session.user.id)) visible.push(g);
      } catch { /* tenant DB unavailable */ }
    }

    const result = visible.map(g => ({
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
  // VIEW + SEND + MANAGE_CHANNELS + HISTORY + EMBED + ATTACH + VIEW_AUDIT_LOG (who invited the bot → founder)
  // + MENTION_EVERYONE (lets "urgent" ping support roles that are not mentionable; mentions are
  // otherwise disabled by the client's default allowedMentions, so @everyone can never be triggered)
  url.searchParams.set('permissions', '268684432');
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
  if (typeof guildId !== 'string' || !/^\d{17,20}$/.test(guildId)) return res.status(400).json({ error: 'guildId requis' });

  try {
    const [guild] = await globalQuery(
      'SELECT * FROM guilds WHERE guild_id = ? AND status = "active"',
      [guildId]
    );
    if (!guild) return res.status(404).json({ error: 'Serveur introuvable ou inactif' });

    const db = getTenantDb(guildId);
    // Discord support / chief support roles (Paramètres) grant or revoke dashboard access
    await syncDiscordStaff(req.app.locals.client, db, guildId, req.session.user)
      .catch(err => console.error('syncDiscordStaff error:', err.message));
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

    await recordEvent(db, {
      actor: { ...req.session.user, tag: req.session.user.username, source: 'dashboard' },
      action: 'dashboard_login', details: { role: dbUser.role, ip: getClientIp(req) },
    });
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
  delete req.session.oauthPurpose; // dashboard sign-in, even after an unfinished member sign-in
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
  // Sign-in started from the member space (/espace) rather than the dashboard
  const forMember = req.session.oauthPurpose === 'member';
  const fail = reason => res.redirect(`${forMember ? '/espace' : '/login'}?error=${reason}`);
  if (!code) return fail('no_code');
  if (!state || state !== req.session.oauthState) return fail('invalid_state');
  delete req.session.oauthState;
  delete req.session.oauthPurpose;

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

    // Member space: identity only, no dashboard rights. The rest of the session (an open
    // dashboard session in the same browser) is kept across the ID regeneration.
    if (forMember) {
      const keep = Object.fromEntries(Object.entries(req.session).filter(([k]) => k !== 'cookie'));
      req.session.regenerate(err => {
        if (err) return fail('oauth_failed');
        Object.assign(req.session, keep);
        req.session.member = { id: discordUser.id, username: discordUser.global_name || discordUser.username, avatar: discordUser.avatar || null };
        res.redirect('/espace');
      });
      return;
    }

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

    // Check before logging, otherwise the current IP is already "known"
    checkNewDeviceAlert(req, discordUser.id).catch(() => null)
      .finally(() => logLogin(req, discordUser.id, discordUser.username, 'success'));
    req.session.regenerate(err => {
      if (err) return res.redirect('/login?error=oauth_failed');
      req.session.user = {
        id:       discordUser.id,
        username: discordUser.username,
        avatar:   discordUser.avatar || null,
        role:     null,
      };
      req.session.discordAccessToken = token.access_token;
      req.session.lastActivityAt = Date.now();
      req.session.save(() => trackSession(req, discordUser.id));
      res.redirect('/select-guild');
    });
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    fail('oauth_failed');
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

  const code = (typeof req.body.code === 'string' ? req.body.code : '').trim();
  if (!code) return res.status(400).json({ error: 'Code requis' });

  try {
    const [row] = await globalQuery(
      'SELECT totp_secret, totp_last_step, recovery_codes FROM user_totp WHERE user_id = ? AND totp_enabled = 1',
      [pending.userId]
    );
    if (!row) return res.status(400).json({ error: 'Configuration 2FA introuvable' });

    // Either a 6-digit TOTP (never accepted twice) or a one-time recovery code
    let ok = false;
    if (RECOVERY_RE.test(code)) {
      const remaining = consumeRecoveryCode(code, row.recovery_codes);
      if (remaining) {
        await globalQuery('UPDATE user_totp SET recovery_codes = ? WHERE user_id = ?', [JSON.stringify(remaining), pending.userId]);
        ok = true;
      }
    } else {
      const step = verifyTotp(code, row.totp_secret, row.totp_last_step);
      if (step) {
        // Also migrates legacy plaintext secrets to encrypted storage
        await globalQuery(
          'UPDATE user_totp SET totp_last_step = ?, totp_secret = ? WHERE user_id = ?',
          [step, isSealed(row.totp_secret) ? row.totp_secret : seal(open(row.totp_secret)), pending.userId]
        );
        ok = true;
      }
    }

    if (!ok) {
      req.session.pendingTotp.totpAttempts = (pending.totpAttempts || 0) + 1;
      const remaining = TOTP_MAX_ATTEMPTS - req.session.pendingTotp.totpAttempts;
      return res.status(400).json({
        error: `Code invalide — ${remaining} tentative${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}`
      });
    }

    checkNewDeviceAlert(req, pending.userId).catch(() => null)
      .finally(() => logLogin(req, pending.userId, pending.username, 'success'));
    // New session ID once fully authenticated
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Erreur serveur' });
      req.session.user = {
        id:       pending.userId,
        username: pending.username,
        avatar:   pending.avatar,
        role:     null,
      };
      req.session.discordAccessToken = pending.discordAccessToken;
      req.session.lastActivityAt = Date.now();
      req.session.save(() => trackSession(req, pending.userId));
      res.json({ ok: true, redirect: '/select-guild' });
    });
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

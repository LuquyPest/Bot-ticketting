const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const { query } = require('../../utils/db');

function cfg() {
  delete require.cache[require.resolve('../../config.json')];
  return require('../../config.json');
}

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  res.json(req.session.user);
});

router.get('/discord', (req, res) => {
  const config = cfg();
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.dashboard.discordCallbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds.members.read');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

router.get('/discord/callback', async (req, res) => {
  const config = cfg();
  const { code, state } = req.query;
  if (!code) return res.redirect('/login?error=no_code');

  if (!state || state !== req.session.oauthState) {
    return res.redirect('/login?error=invalid_state');
  }
  delete req.session.oauthState;

  try {
    const { data: token } = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.dashboard.discordClientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.dashboard.discordCallbackUrl
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const headers = { Authorization: `Bearer ${token.access_token}` };
    const [{ data: discordUser }, memberRes] = await Promise.all([
      axios.get('https://discord.com/api/users/@me', { headers }),
      axios.get(`https://discord.com/api/users/@me/guilds/${config.guildId}/member`, { headers }).catch(() => null)
    ]);

    if (!memberRes) return res.redirect('/login?error=not_in_guild');

    const isFounder = discordUser.id === config.webFounderId;
    let role;

    if (isFounder) {
      role = 'fondateur';
      await query(
        `INSERT INTO dashboard_users (user_id, username, avatar, role)
         VALUES (?, ?, ?, 'fondateur')
         ON DUPLICATE KEY UPDATE username = VALUES(username), avatar = VALUES(avatar), role = 'fondateur', last_login = NOW()`,
        [discordUser.id, discordUser.username, discordUser.avatar || null]
      );
    } else {
      const discordRoles = memberRes.data.roles || [];
      const hasSupport = discordRoles.includes(config.supportRoleId) || discordRoles.includes(config.chiefSupportRoleId) ? 1 : 0;

      const [existing] = await query('SELECT role FROM dashboard_users WHERE user_id = ?', [discordUser.id]);
      if (existing) {
        role = existing.role;
        await query(
          'UPDATE dashboard_users SET username = ?, avatar = ?, discord_has_support = ?, last_login = NOW() WHERE user_id = ?',
          [discordUser.username, discordUser.avatar || null, hasSupport, discordUser.id]
        );
      } else {
        role = 'nouveau';
        await query(
          'INSERT INTO dashboard_users (user_id, username, avatar, role, discord_has_support) VALUES (?, ?, ?, \'nouveau\', ?)',
          [discordUser.id, discordUser.username, discordUser.avatar || null, hasSupport]
        );
      }
    }

    req.session.regenerate((err) => {
      if (err) return res.redirect('/login?error=oauth_failed');
      req.session.user = {
        id: discordUser.id,
        username: discordUser.username,
        avatar: discordUser.avatar || null,
        role
      };
      res.redirect(role === 'nouveau' ? '/pending' : '/');
    });
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    res.redirect('/login?error=oauth_failed');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;

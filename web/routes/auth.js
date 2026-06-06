const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const axios = require('axios');

function cfg() {
  delete require.cache[require.resolve('../../config.json')];
  return require('../../config.json');
}

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  res.json(req.session.user);
});

router.post('/login', async (req, res) => {
  const config = cfg();
  const dash = config.dashboard || {};

  if (!dash.authMethods?.includes('password')) {
    return res.status(400).json({ error: 'Authentification par mot de passe désactivée' });
  }

  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe requis' });

  const stored = dash.password;
  if (!stored) return res.status(500).json({ error: 'Aucun mot de passe configuré' });

  const valid = (stored.startsWith('$2b$') || stored.startsWith('$2a$'))
    ? await bcrypt.compare(password, stored)
    : password === stored;

  if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect' });

  req.session.user = { id: 'local', username: 'Admin', avatar: null, method: 'password' };
  res.json({ ok: true, user: req.session.user });
});

router.get('/discord', (req, res) => {
  const config = cfg();
  const dash = config.dashboard || {};

  if (!dash.authMethods?.includes('discord')) {
    return res.status(400).json({ error: 'Authentification Discord désactivée' });
  }

  const clientId = dash.discordClientId || config.clientId;
  const redirectUri = dash.discordCallbackUrl;
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds.members.read');

  res.redirect(url.toString());
});

router.get('/discord/callback', async (req, res) => {
  const config = cfg();
  const dash = config.dashboard || {};
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const clientId = dash.discordClientId || config.clientId;
    const { data: token } = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: dash.discordClientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: dash.discordCallbackUrl
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const headers = { Authorization: `Bearer ${token.access_token}` };
    const [{ data: user }, memberRes] = await Promise.all([
      axios.get('https://discord.com/api/users/@me', { headers }),
      axios.get(`https://discord.com/api/users/@me/guilds/${config.guildId}/member`, { headers }).catch(() => null)
    ]);

    if (!memberRes) return res.redirect('/?error=not_in_guild');

    const allowedRoleId = dash.allowedRoleId || config.chiefSupportRoleId;
    if (!memberRes.data.roles?.includes(allowedRoleId)) {
      return res.redirect('/?error=no_permission');
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      method: 'discord'
    };

    res.redirect('/');
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    res.redirect('/?error=oauth_failed');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;

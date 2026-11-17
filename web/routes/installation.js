// First installation without Discord (utils/installation.js):
//   GET  /api/installation          → { needed, discordLogin }
//   POST /api/installation/owner    { token, email, displayName, password } → owner created, signed in
const express = require('express');
const router = express.Router();
const inst = require('../../utils/installation');
const { trackSession, logLogin } = require('./auth').helpers;

router.get('/', async (req, res, next) => {
  try { res.json({ needed: await inst.setupNeeded(req.app.locals.client) }); } catch (err) { next(err); }
});

router.post('/owner', async (req, res) => {
  try {
    const r = await inst.createOwner(req.app.locals.client, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    const a = r.account;
    logLogin(req, a.id, a.display_name, 'success');
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Erreur serveur' });
      req.session.user = { id: a.id, username: a.display_name, avatar: null, role: null };
      req.session.authMethod = 'password';
      req.session.lastActivityAt = Date.now();
      req.session.save(() => trackSession(req, a.id));
      res.json({ ok: true, redirect: '/instance' });
    });
  } catch (err) {
    console.error('installation error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

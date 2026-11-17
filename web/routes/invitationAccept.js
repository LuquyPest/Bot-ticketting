// Page /invitation (utils/invitations.js), open without being signed in:
//   GET  /api/auth/invitation?token=…                          → what the invitation is
//   POST /api/auth/invitation/accept { token, displayName, password }  → joins the team
// Signed in, the account joins; otherwise an account is created with the invited address (a
// person who already has an account with it signs in first). Rate-limited with the sign-in routes.
const express = require('express');
const router = express.Router();
const inv = require('../../utils/invitations');
const { trackSession, logLogin } = require('./auth').helpers;

const sessionUser = req => (req.session?.user?.id ? req.session.user : null);

router.get('/invitation', async (req, res, next) => {
  try {
    const r = await inv.describe(String(req.query.token || ''), sessionUser(req));
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json(r);
  } catch (err) { next(err); }
});

router.post('/invitation/accept', async (req, res, next) => {
  try {
    const { token, displayName, password } = req.body || {};
    const r = await inv.accept(String(token || ''), sessionUser(req), { displayName, password });
    if (r.error) return res.status(r.status).json({ error: r.error, needsLogin: r.needsLogin || undefined });
    if (!r.created) return res.json({ ok: true, guildId: r.guildId, redirect: '/select-guild' });
    const a = r.account;
    logLogin(req, a.id, a.display_name, 'success');
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Erreur serveur' });
      req.session.user = { id: a.id, username: a.display_name, avatar: null, role: null };
      req.session.authMethod = 'password';
      req.session.lastActivityAt = Date.now();
      req.session.save(() => trackSession(req, a.id));
      res.json({ ok: true, guildId: r.guildId, created: true, redirect: '/select-guild' });
    });
  } catch (err) { next(err); }
});

module.exports = router;

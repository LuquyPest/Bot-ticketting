// Sign-in with an e-mail address and a password (v4 PR 5, conception/v4.md §3.3 and §5).
// An account gets a password from Profil → Connexion, once its address is confirmed by a link.
//   POST /api/auth/password-login           { email, password }
//   POST /api/auth/password-reset           { email }            → always the same answer
//   POST /api/auth/password-reset/confirm   { token, password }
//   GET  /api/auth/verify-email?token=…                           → link of the e-mail check
// No account enumeration: same answer and same work whether the address exists or not; the
// 2FA of the account applies; 10 failures in 15 minutes lock the password sign-in of an account.
const express = require('express');
const router = express.Router();
const accounts = require('../../utils/accounts');
const { hashPassword, verifyPassword, passwordProblem } = require('../../utils/passwords');
const { createToken, consumeToken } = require('../../utils/authTokens');
const { globalQuery } = require('../../utils/globalDb');
const { getRedis } = require('../../utils/redis');
const { config } = require('../../utils/config');
const { logLogin, trackSession, checkNewDeviceAlert } = require('./auth').helpers;

const RESET_TTL_S = 30 * 60;
const FAIL_MAX = 10;
const FAIL_WINDOW_S = 15 * 60;
const GENERIC = 'Adresse e-mail ou mot de passe incorrect';
const langOf = req => (/^fr\b/i.test(req.get('Accept-Language') || 'fr') ? 'fr' : 'en');
const base = () => (config.webServerBaseUrl || '').replace(/\/$/, '');

router.post('/password-login', async (req, res) => {
  const email = accounts.normEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password || password.length > 200) return res.status(400).json({ error: GENERIC });
  try {
    const account = await accounts.findByVerifiedEmail(email);
    const failKey = `pwfail:${account?.id || email}`;
    const fails = Number(await getRedis().get(failKey).catch(() => 0)) || 0;
    // Always one derivation, also for an unknown address
    const ok = await verifyPassword(password, account?.password_hash || null);
    if (fails >= FAIL_MAX) {
      logLogin(req, account?.id || 'inconnu', email, 'blocked');
      return res.status(429).json({ error: 'Trop de tentatives : réessaie dans un quart d\'heure, ou réinitialise ton mot de passe' });
    }
    if (!account || !ok) {
      await getRedis().multi().incr(failKey).expire(failKey, FAIL_WINDOW_S).exec().catch(() => null);
      if (account) logLogin(req, account.id, email, 'blocked');
      return res.status(401).json({ error: GENERIC });
    }
    if (account.disabled) { logLogin(req, account.id, email, 'disabled'); return res.status(403).json({ error: 'Ce compte est désactivé. Contacte le propriétaire de l\'instance.' }); }
    await getRedis().del(failKey).catch(() => null);
    await accounts.touchLogin(account.id);

    const user = { id: account.id, username: account.display_name, avatar: account.avatar || null };
    const [totpRow] = await globalQuery('SELECT totp_enabled FROM user_totp WHERE user_id = ? AND totp_enabled = 1', [account.id]);
    if (totpRow) {
      logLogin(req, account.id, user.username, '2fa_required');
      return req.session.regenerate(err => {
        if (err) return res.status(500).json({ error: 'Erreur serveur' });
        req.session.pendingTotp = { userId: user.id, username: user.username, avatar: user.avatar, discordAccessToken: null, method: 'password' };
        res.json({ ok: true, totp: true });
      });
    }
    checkNewDeviceAlert(req, account.id).catch(() => null).finally(() => logLogin(req, account.id, user.username, 'success'));
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Erreur serveur' });
      req.session.user = { ...user, role: null };
      req.session.authMethod = 'password';
      req.session.lastActivityAt = Date.now();
      req.session.save(() => trackSession(req, account.id));
      res.json({ ok: true, redirect: '/select-guild' });
    });
  } catch (err) {
    console.error('password-login error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Same answer for any address; the e-mail leaves only for an account with that verified address
router.post('/password-reset', async (req, res) => {
  const email = accounts.normEmail(req.body?.email);
  const answer = { ok: true, message: 'Si un compte utilise cette adresse, un e-mail vient de partir avec un lien valable 30 minutes.' };
  if (!email || email.length > 254) return res.json(answer);
  try {
    const account = await accounts.findByVerifiedEmail(email);
    if (account && !account.disabled) {
      const token = await createToken('pwreset', { accountId: account.id, email }, RESET_TTL_S);
      await require('../../utils/instanceMail').sendInstanceMail({
        to: email, template: 'passwordReset', lang: langOf(req),
        vars: { link: `${base()}/reset-password?token=${encodeURIComponent(token)}`, minutes: RESET_TTL_S / 60 },
      }).catch(err => console.error('password-reset mail:', err.message));
    }
  } catch (err) { console.error('password-reset error:', err.message); }
  res.json(answer);
});

router.post('/password-reset/confirm', async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  try {
    const data = await consumeToken('pwreset', req.body?.token);
    if (!data) return res.status(400).json({ error: 'Lien expiré ou déjà utilisé : demande un nouvel e-mail' });
    const problem = passwordProblem(password, { email: data.email });
    if (problem) {
      // The link stays usable for a second try
      await getRedis().set(`tok:pwreset:${require('crypto').createHash('sha256').update(String(req.body.token)).digest('hex')}`, JSON.stringify(data), 'EX', RESET_TTL_S).catch(() => null);
      return res.status(400).json({ error: problem });
    }
    const account = await accounts.getAccount(data.accountId);
    if (!account || account.disabled || accounts.normEmail(account.email) !== data.email) return res.status(400).json({ error: 'Lien expiré ou déjà utilisé : demande un nouvel e-mail' });
    await accounts.setPasswordHash(account.id, await hashPassword(password));
    await getRedis().del(`pwfail:${account.id}`).catch(() => null);
    // Every open session of the account is closed: whoever knew the old password is out
    await require('../../utils/sessionsRevoke').revokeAllSessions(account.id).catch(() => null);
    logLogin(req, account.id, account.display_name, 'success');
    res.json({ ok: true });
  } catch (err) {
    console.error('password-reset confirm error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Link of the e-mail sent from Profil → Connexion
router.get('/verify-email', async (req, res) => {
  const data = await consumeToken('verifyemail', String(req.query.token || '')).catch(() => null);
  if (!data) return res.redirect('/profile?email=expired');
  const r = await accounts.setVerifiedEmail(data.accountId, data.email).catch(() => ({ error: true }));
  res.redirect(`/profile?email=${r.error ? 'taken' : 'verified'}`);
});

module.exports = router;

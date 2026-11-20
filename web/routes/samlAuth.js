// SAML 2.0 sign-in (utils/saml.js, v7):
//   GET  /api/auth/saml/login     → to the identity provider (an AuthnRequest, its ID kept 10 min)
//   POST /api/auth/saml/acs       ← the provider's signed response (HTTP-POST binding, form)
//   GET  /api/auth/saml/metadata  → metadata of Datick as service provider
// Mounted before the CSRF guard: the provider posts a plain form; the response is proven by its
// signature, its audience, its destination and the request it answers. The 2FA of the account applies.
const express = require('express');
const router = express.Router();
const saml = require('../../utils/saml');
const accounts = require('../../utils/accounts');
const { globalQuery } = require('../../utils/globalDb');
const { allowBurst } = require('../../utils/rateLimit');

const PROVIDER = 'saml';
const helpers = () => require('./auth').helpers;

router.get('/saml/login', async (req, res) => {
  try {
    const url = await saml.loginUrl();
    if (!url) return res.redirect('/login?error=saml_off');
    res.redirect(url);
  } catch (err) { console.error('saml login:', err.message); res.redirect('/login?error=saml_invalid'); }
});
router.get('/saml/metadata', async (req, res) => {
  try { res.type('application/samlmetadata+xml').send(await saml.metadata()); } catch (err) { console.error('saml metadata:', err.message); res.status(500).end(); }
});
router.post('/saml/acs', express.urlencoded({ extended: false, limit: '512kb' }), async (req, res) => {
  const fail = reason => res.redirect(`/login?error=${reason}`);
  const { logLogin, trackSession, checkNewDeviceAlert } = helpers();
  try {
    if (!(await allowBurst(`samlacs:${req.ip}`, 30, 10 * 60 * 1000))) return fail('saml_invalid');
    const who = await saml.check(req.body || {});
    let account = await accounts.accountByIdentity(PROVIDER, who.subject);
    if (!account && who.email) {
      // The provider is the organisation's own (set by the owner): its address attaches the identity
      const byMail = await accounts.findByVerifiedEmail(who.email);
      if (byMail) {
        const [already] = await globalQuery('SELECT subject FROM account_identities WHERE provider = ? AND account_id = ?', [PROVIDER, byMail.id]);
        if (!already) { await accounts.linkIdentity(PROVIDER, who.subject, byMail.id); account = await accounts.getAccount(byMail.id); }
      }
    }
    if (!account) { logLogin(req, 'inconnu', PROVIDER, 'blocked'); return fail('saml_no_account'); }
    if (account.disabled) { logLogin(req, account.id, account.display_name, 'disabled'); return fail('account_disabled'); }
    await accounts.linkIdentity(PROVIDER, who.subject, account.id); // last use
    await accounts.touchLogin(account.id);
    const user = { id: account.id, username: account.display_name, avatar: account.avatar || null };
    const [totpRow] = await globalQuery('SELECT totp_enabled FROM user_totp WHERE user_id = ? AND totp_enabled = 1', [account.id]);
    if (totpRow) {
      logLogin(req, account.id, user.username, '2fa_required');
      return req.session.regenerate(err => {
        if (err) return fail('saml_invalid');
        req.session.pendingTotp = { userId: user.id, username: user.username, avatar: user.avatar, discordAccessToken: null, method: 'saml' };
        res.redirect('/totp-verify');
      });
    }
    checkNewDeviceAlert(req, account.id).catch(() => null).finally(() => logLogin(req, account.id, user.username, 'success'));
    req.session.regenerate(err => {
      if (err) return fail('saml_invalid');
      req.session.user = { ...user, role: null };
      req.session.authMethod = 'saml';
      req.session.lastActivityAt = Date.now();
      req.session.save(() => trackSession(req, account.id));
      res.redirect('/select-guild');
    });
  } catch (err) {
    console.error('saml acs:', err.message);
    fail(err.reason || 'saml_invalid');
  }
});

module.exports = router;

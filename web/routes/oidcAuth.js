// Sign-in with Google, Microsoft or an OpenID Connect provider (v4 PR 12, utils/loginProviders.js).
//   GET /api/auth/oidc/:provider            → to the provider (sign-in page)
//   GET /api/auth/oidc/:provider?link=1     → to the provider, to link it to the signed-in account
//   GET /api/auth/oidc/:provider/callback   → back from the provider
// The return finds the account by its identity, or else by the address the provider says is
// verified; nobody gets an account by signing in this way (invitations create them).
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const accounts = require('../../utils/accounts');
const providers = require('../../utils/loginProviders');
const { globalQuery } = require('../../utils/globalDb');
const { logLogin, trackSession, checkNewDeviceAlert } = require('./auth').helpers;

const sameText = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

router.get('/oidc/:provider', async (req, res) => {
  const key = req.params.provider;
  const link = req.query.link === '1';
  const back = reason => res.redirect(link ? `/profile?link=${reason}` : `/login?error=${reason}`);
  if (!providers.OIDC_KEYS.includes(key)) return back('provider_off');
  if (link && (!req.session.user || req.session.user.demo)) return res.redirect('/login');
  try {
    const start = await providers.authorizeUrl(key);
    if (!start) return back('provider_off');
    req.session.oidc = { ...start.pending, purpose: link ? 'link' : 'login', accountId: link ? req.session.user.id : null };
    req.session.save(() => res.redirect(start.url));
  } catch (err) {
    console.error(`oidc ${key} start:`, err.message);
    back('oauth_failed');
  }
});

router.get('/oidc/:provider/callback', async (req, res) => {
  const key = req.params.provider;
  const pending = req.session.oidc;
  delete req.session.oidc;
  const link = pending?.purpose === 'link';
  const fail = reason => res.redirect(link ? `/profile?link=${reason}` : `/login?error=${reason}`);
  if (!pending || !sameText(String(req.query.state || ''), pending.state || '')) return fail('invalid_state');
  if (req.query.error || !req.query.code) return fail('oauth_failed');
  const provider = `oidc:${key}`;
  try {
    const who = await providers.finish(key, pending, String(req.query.code).slice(0, 2000));

    if (link) {
      if (!req.session.user || req.session.user.id !== pending.accountId) return res.redirect('/login');
      const owner = await accounts.accountByIdentity(provider, who.subject);
      if (owner && owner.id !== pending.accountId) return fail('oidc_taken');
      // One identity of each provider per account
      await accounts.unlinkIdentity(provider, pending.accountId);
      await accounts.linkIdentity(provider, who.subject, pending.accountId);
      return res.redirect('/profile?link=ok');
    }

    let account = await accounts.accountByIdentity(provider, who.subject);
    if (!account && who.emailVerified) {
      const byMail = await accounts.findByVerifiedEmail(who.email);
      if (byMail) {
        const [already] = await globalQuery('SELECT subject FROM account_identities WHERE provider = ? AND account_id = ?', [provider, byMail.id]);
        // Another identity of the same provider is already linked: not replaced silently
        if (!already) { await accounts.linkIdentity(provider, who.subject, byMail.id); account = await accounts.getAccount(byMail.id); }
      }
    }
    if (!account) {
      logLogin(req, 'inconnu', provider, 'blocked'); // no address of an unknown person in the journal
      return fail(who.email && !who.emailVerified ? 'oidc_unverified' : 'oidc_no_account');
    }
    if (account.disabled) { logLogin(req, account.id, account.display_name, 'disabled'); return fail('account_disabled'); }
    await accounts.linkIdentity(provider, who.subject, account.id); // last use
    await accounts.touchLogin(account.id);

    const user = { id: account.id, username: account.display_name, avatar: account.avatar || null };
    const [totpRow] = await globalQuery('SELECT totp_enabled FROM user_totp WHERE user_id = ? AND totp_enabled = 1', [account.id]);
    if (totpRow) {
      logLogin(req, account.id, user.username, '2fa_required');
      return req.session.regenerate(err => {
        if (err) return fail('oauth_failed');
        req.session.pendingTotp = { userId: user.id, username: user.username, avatar: user.avatar, discordAccessToken: null, method: 'oidc' };
        res.redirect('/totp-verify');
      });
    }
    checkNewDeviceAlert(req, account.id).catch(() => null).finally(() => logLogin(req, account.id, user.username, 'success'));
    req.session.regenerate(err => {
      if (err) return fail('oauth_failed');
      req.session.user = { ...user, role: null };
      req.session.authMethod = 'oidc';
      req.session.lastActivityAt = Date.now();
      req.session.save(() => trackSession(req, account.id));
      res.redirect('/select-guild');
    });
  } catch (err) {
    console.error(`oidc ${key} callback:`, err.message);
    fail(err.reason || 'oauth_failed');
  }
});

module.exports = router;

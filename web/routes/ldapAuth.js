// Sign-in with the LDAP / Active Directory directory of the instance (v5.7, utils/ldapDirectory.js).
//   POST /api/auth/ldap-login   { login, password }
// The directory identity is found by its stable identifier, or else attached to the account whose
// verified address is the one in the directory; nobody gets an account by signing in this way.
// Same answer for an unknown login and a wrong password; 10 failures in 15 minutes lock the login;
// the 2FA of the account applies.
const express = require('express');
const router = express.Router();
const accounts = require('../../utils/accounts');
const directory = require('../../utils/ldapDirectory');
const { globalQuery } = require('../../utils/globalDb');
const { getRedis } = require('../../utils/redis');
const { logLogin, trackSession, checkNewDeviceAlert } = require('./auth').helpers;

const PROVIDER = 'ldap';
const FAIL_MAX = 10;
const FAIL_WINDOW_S = 15 * 60;
const GENERIC = 'Identifiant ou mot de passe incorrect';

router.post('/ldap-login', async (req, res) => {
  const login = typeof req.body?.login === 'string' ? req.body.login.trim().slice(0, 200) : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!login || !password || password.length > 200) return res.status(400).json({ error: GENERIC });
  try {
    if (!(await directory.active())) return res.status(404).json({ error: 'Connexion par l\'annuaire désactivée' });
    const failKey = `ldapfail:${login.toLowerCase()}`;
    const fails = Number(await getRedis().get(failKey).catch(() => 0)) || 0;
    if (fails >= FAIL_MAX) {
      logLogin(req, 'inconnu', PROVIDER, 'blocked');
      return res.status(429).json({ error: 'Trop de tentatives : réessaie dans un quart d\'heure' });
    }
    const who = await directory.authenticate(login, password);
    if (who.error === 'unavailable') return res.status(503).json({ error: 'Annuaire injoignable : réessaie plus tard, ou connecte-toi autrement' });
    if (who.error) {
      await getRedis().multi().incr(failKey).expire(failKey, FAIL_WINDOW_S).exec().catch(() => null);
      logLogin(req, 'inconnu', PROVIDER, 'blocked');
      return res.status(401).json({ error: who.error === 'group' ? 'Ton compte de l\'annuaire n\'est pas dans le groupe autorisé' : GENERIC });
    }
    await getRedis().del(failKey).catch(() => null);

    let account = await accounts.accountByIdentity(PROVIDER, who.subject);
    if (!account && who.email) {
      const byMail = await accounts.findByVerifiedEmail(who.email);
      if (byMail) {
        const [already] = await globalQuery('SELECT subject FROM account_identities WHERE provider = ? AND account_id = ?', [PROVIDER, byMail.id]);
        // Another directory identity is already linked to this account: not replaced silently
        if (!already) { await accounts.linkIdentity(PROVIDER, who.subject, byMail.id); account = await accounts.getAccount(byMail.id); }
      }
    }
    // v6: an account for a member of the allowed group, if the owner turned it on
    if (!account) {
      account = await directory.provision(who).catch(err => { console.error('ldap provision:', err.message); return null; });
      if (account) await accounts.linkIdentity(PROVIDER, who.subject, account.id);
    }
    if (!account) {
      logLogin(req, 'inconnu', PROVIDER, 'blocked');
      return res.status(403).json({ error: 'Aucun compte n\'utilise l\'adresse de ton compte de l\'annuaire. Demande une invitation, ou connecte-toi autrement puis confirme cette adresse dans Profil → Connexion.' });
    }
    if (account.disabled) { logLogin(req, account.id, account.display_name, 'disabled'); return res.status(403).json({ error: 'Ce compte est désactivé. Contacte le propriétaire de l\'instance.' }); }
    await accounts.linkIdentity(PROVIDER, who.subject, account.id); // last use
    await accounts.touchLogin(account.id);

    const user = { id: account.id, username: account.display_name, avatar: account.avatar || null };
    const [totpRow] = await globalQuery('SELECT totp_enabled FROM user_totp WHERE user_id = ? AND totp_enabled = 1', [account.id]);
    if (totpRow) {
      logLogin(req, account.id, user.username, '2fa_required');
      return req.session.regenerate(err => {
        if (err) return res.status(500).json({ error: 'Erreur serveur' });
        req.session.pendingTotp = { userId: user.id, username: user.username, avatar: user.avatar, discordAccessToken: null, method: PROVIDER };
        res.json({ ok: true, totp: true });
      });
    }
    checkNewDeviceAlert(req, account.id).catch(() => null).finally(() => logLogin(req, account.id, user.username, 'success'));
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Erreur serveur' });
      req.session.user = { ...user, role: null };
      req.session.authMethod = PROVIDER;
      req.session.lastActivityAt = Date.now();
      req.session.save(() => trackSession(req, account.id));
      res.json({ ok: true, redirect: '/select-guild' });
    });
  } catch (err) {
    console.error('ldap-login error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

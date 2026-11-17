// Sign-in providers of the instance (v4 PR 12, conception/v4.md §3.3 and §5), chosen by the owner
// in Instance → Connexion: Discord (the sign-in through the instance's Discord application, distinct
// from the Discord integration), Google and Microsoft (OpenID Connect presets) and one generic
// OpenID Connect provider (Keycloak, Authentik, Okta…). E-mail and password is always available.
//
// OpenID Connect: authorization code with state, nonce and PKCE (S256). The ID token comes straight
// from the provider's token endpoint over TLS, authenticated by the client secret, so its signature
// is not checked again (OpenID Connect Core §3.1.3.7); issuer, audience, expiry and nonce are.
// An identity is attached to an existing account by its address only when the provider says the
// address is verified; otherwise it is linked from Profil → Connexion by a signed-in person.
const crypto = require('crypto');
const axios = require('axios');
const { getSetting, setSetting } = require('./instanceSettings');
const { seal, open } = require('./secretBox');

const KEY = 'login_providers';
const OIDC_KEYS = ['google', 'microsoft', 'oidc'];
const DEFAULTS = {
  discord: { enabled: true }, // an instance coming from v3 keeps the Discord sign-in
  google: { enabled: false, clientId: '', clientSecret: '' },
  microsoft: { enabled: false, clientId: '', clientSecret: '', tenant: 'common' },
  oidc: { enabled: false, name: '', issuer: '', clientId: '', clientSecret: '' },
};
const LABELS = { discord: 'Discord', google: 'Google', microsoft: 'Microsoft' };
const TENANT_RE = /^[A-Za-z0-9.-]{1,100}$/;
const HTTP = { timeout: 10000, maxContentLength: 1024 * 1024, maxRedirects: 0 };

const { config } = require('./config');
const base = () => (config.webServerBaseUrl || '').replace(/\/$/, '');
const discordApp = () => !!(config.clientId && config.dashboard?.discordClientSecret);

async function load() {
  const s = await getSetting(KEY, {});
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = { ...DEFAULTS[k], ...(s[k] && typeof s[k] === 'object' ? s[k] : {}) };
  return out;
}

const issuerOf = (key, p) => (key === 'google' ? 'https://accounts.google.com'
  : key === 'microsoft' ? `https://login.microsoftonline.com/${p.tenant || 'common'}/v2.0`
  : String(p.issuer || '').replace(/\/$/, ''));
const configured = (key, p) => (key === 'discord' ? discordApp() : !!(p.clientId && p.clientSecret && issuerOf(key, p)));
const labelOf = (key, p) => (key === 'oidc' ? (p.name || 'OpenID Connect') : LABELS[key]);

// The providers a person can sign in with now (enabled and configured), for the sign-in page
async function activeProviders() {
  const s = await load();
  return Object.keys(DEFAULTS).filter(k => s[k].enabled && configured(k, s[k])).map(k => ({ id: k, label: labelOf(k, s[k]) }));
}
async function isActive(key) { return (await activeProviders()).some(p => p.id === key); }
const discordLoginActive = () => isActive('discord');

// Instance → Connexion: the settings without the secrets
async function publicSettings() {
  const s = await load();
  const out = { callbackBase: `${base()}/api/auth/oidc`, discordApp: discordApp() };
  for (const k of Object.keys(DEFAULTS)) {
    const { clientSecret, ...rest } = s[k];
    out[k] = { ...rest, ...(k === 'discord' ? {} : { secretSet: !!clientSecret, callbackUrl: `${base()}/api/auth/oidc/${k}/callback` }), configured: configured(k, s[k]) };
  }
  return out;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// New settings from the form; a secret left empty keeps the one stored. { error } or { settings }.
async function prepare(input) {
  const cur = await load();
  const next = {};
  for (const k of Object.keys(DEFAULTS)) {
    const i = input?.[k] && typeof input[k] === 'object' ? input[k] : {};
    const p = { ...cur[k], enabled: i.enabled === undefined ? cur[k].enabled : !!i.enabled };
    if (k !== 'discord') {
      if (i.clientId !== undefined) p.clientId = str(i.clientId, 255);
      if (typeof i.clientSecret === 'string' && i.clientSecret.trim()) p.clientSecret = seal(i.clientSecret.trim().slice(0, 500));
      if (k === 'microsoft' && i.tenant !== undefined) {
        p.tenant = str(i.tenant, 100) || 'common';
        if (!TENANT_RE.test(p.tenant)) return { error: 'Locataire Microsoft invalide (common, organizations ou l\'identifiant de l\'annuaire)' };
      }
      if (k === 'oidc') {
        if (i.name !== undefined) p.name = str(i.name, 40);
        if (i.issuer !== undefined) {
          p.issuer = str(i.issuer, 300).replace(/\/$/, '');
          if (p.issuer && !/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(p.issuer)) return { error: 'L\'adresse du fournisseur doit commencer par https://' };
        }
      }
      if (p.enabled && !configured(k, p)) return { error: `${labelOf(k, p)} : identifiant et secret de l'application${k === 'oidc' ? ', adresse du fournisseur' : ''} requis pour l'activer` };
    }
    next[k] = p;
  }
  return { settings: next };
}

const save = settings => setSetting(KEY, settings);

// Providers usable with these settings: what the owner would keep after a change
function usableWith(settings) {
  return new Set(Object.keys(DEFAULTS).filter(k => settings[k].enabled && configured(k, settings[k])));
}
// Ways an account can sign in with this set of providers: its password (on a verified address)
// and its identities of a usable provider
async function methodsLeft(accountId, usable) {
  const accounts = require('./accounts');
  const account = await accounts.getAccount(accountId);
  const { globalQuery } = require('./globalDb');
  const identities = await globalQuery('SELECT provider FROM account_identities WHERE account_id = ?', [String(accountId)]);
  const left = [];
  if (account?.has_password && account.email_verified) left.push('password');
  for (const i of identities) {
    const key = i.provider === 'discord' ? 'discord' : i.provider.replace(/^oidc:/, '');
    if (usable.has(key)) left.push(i.provider);
  }
  // An account born from Discord (ID = Discord ID) signs in with Discord even without its identity
  // row (sessions opened before the accounts existed)
  if (usable.has('discord') && /^\d{17,20}$/.test(String(accountId)) && !identities.some(i => i.provider === 'discord')) left.push('discord');
  return left;
}

// ── OpenID Connect ──
const discoveryCache = new Map(); // issuer → { doc, at }
async function discovery(issuer) {
  const hit = discoveryCache.get(issuer);
  if (hit && Date.now() - hit.at < 3600 * 1000) return hit.doc;
  const { data } = await axios.get(`${issuer}/.well-known/openid-configuration`, HTTP);
  if (!data || typeof data !== 'object' || !/^https:\/\//.test(data.authorization_endpoint || '') || !/^https:\/\//.test(data.token_endpoint || '')) throw new Error('discovery');
  discoveryCache.set(issuer, { doc: data, at: Date.now() });
  return data;
}

async function providerConfig(key) {
  if (!OIDC_KEYS.includes(key)) return null;
  const s = await load();
  const p = s[key];
  if (!p.enabled || !configured(key, p)) return null;
  return { key, label: labelOf(key, p), clientId: p.clientId, clientSecret: open(p.clientSecret), issuer: issuerOf(key, p) };
}

const b64url = buf => buf.toString('base64url');

// Start: the URL to send the browser to, and what the session keeps for the return
async function authorizeUrl(key) {
  const p = await providerConfig(key);
  if (!p) return null;
  const doc = await discovery(p.issuer);
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('redirect_uri', `${base()}/api/auth/oidc/${key}/callback`);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest()));
  url.searchParams.set('code_challenge_method', 'S256');
  if (key === 'google') url.searchParams.set('prompt', 'select_account');
  return { url: url.toString(), pending: { provider: key, state, nonce, verifier, at: Date.now() } };
}

function decodeJwt(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw new Error('id_token');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

const verifiedFlag = v => v === true || v === 'true';

// Return: checks the state (by the caller), exchanges the code, checks the ID token.
// Resolves to { subject, email, emailVerified, name } or throws.
async function finish(key, pending, code) {
  const p = await providerConfig(key);
  if (!p) throw Object.assign(new Error('off'), { reason: 'provider_off' });
  if (!pending || pending.provider !== key || Date.now() - pending.at > 10 * 60 * 1000) throw Object.assign(new Error('state'), { reason: 'invalid_state' });
  const doc = await discovery(p.issuer);
  const { data: token } = await axios.post(doc.token_endpoint, new URLSearchParams({
    grant_type: 'authorization_code', code: String(code), redirect_uri: `${base()}/api/auth/oidc/${key}/callback`,
    client_id: p.clientId, client_secret: p.clientSecret, code_verifier: pending.verifier,
  }), { ...HTTP, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } });
  const claims = decodeJwt(token?.id_token);
  const now = Math.floor(Date.now() / 1000);
  // Microsoft "common"/"organizations": the issuer names the person's directory
  const expectedIss = String(doc.issuer || p.issuer).replace('{tenantid}', String(claims.tid || ''));
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const bad = claims.iss !== expectedIss ? 'iss'
    : !aud.includes(p.clientId) || (aud.length > 1 && claims.azp !== p.clientId) ? 'aud'
    : !(Number(claims.exp) > now - 60) ? 'exp'
    : claims.nonce !== pending.nonce ? 'nonce'
    : !claims.sub || String(claims.sub).length > 255 ? 'sub' : null;
  if (bad) throw Object.assign(new Error(`id_token ${bad}`), { reason: 'oidc_invalid' });
  let info = claims;
  // Some providers keep the address for the userinfo endpoint
  if (!claims.email && doc.userinfo_endpoint && token.access_token) {
    const { data } = await axios.get(doc.userinfo_endpoint, { ...HTTP, headers: { Authorization: `Bearer ${token.access_token}` } }).catch(() => ({ data: null }));
    if (data && String(data.sub) === String(claims.sub)) info = { ...claims, ...data, sub: claims.sub };
  }
  const email = typeof info.email === 'string' ? info.email.trim().toLowerCase().slice(0, 254) : '';
  // Microsoft does not vouch for the address, except for a domain the directory owns (xms_edov)
  const emailVerified = !!email && (key === 'microsoft' ? verifiedFlag(info.xms_edov) : verifiedFlag(info.email_verified));
  const name = String(info.name || info.preferred_username || email || p.label).slice(0, 100);
  return { subject: String(claims.sub), email, emailVerified, name };
}

const resetCache = () => discoveryCache.clear();

module.exports = {
  OIDC_KEYS, LABELS, load, activeProviders, isActive, discordLoginActive, publicSettings, prepare, save,
  usableWith, methodsLeft, authorizeUrl, finish, labelOf, resetCache,
};

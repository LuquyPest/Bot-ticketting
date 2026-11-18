// Support mailboxes connected by OAuth2 (v5.0, conception/v5.md §3.14): Gmail / Google Workspace
// and Microsoft 365 / Outlook, without an app password. The owner of the instance declares the
// application once (Instance → Connexion → Boîtes e-mail); each space then connects its mailbox
// with « Se connecter avec Google / Microsoft » (Paramètres → Intégrations → Tickets par e-mail).
// IMAP and SMTP authenticate with XOAUTH2; the refresh token is sealed (utils/secretBox.js), the
// access token is renewed a few minutes before it expires.
const crypto = require('crypto');
const axios = require('axios');
const { getSetting, setSetting } = require('./instanceSettings');
const { seal, open } = require('./secretBox');
const { config } = require('./config');

const KEY = 'mail_oauth';
const TENANT_RE = /^[A-Za-z0-9.-]{1,100}$/;
const HTTP = { timeout: 15000, maxContentLength: 1024 * 1024, maxRedirects: 0 };
const MARGIN_MS = 3 * 60 * 1000;
const base = () => (config.webServerBaseUrl || '').replace(/\/$/, '');

// Fixed endpoints and servers: nothing here comes from a form, so no request can be sent elsewhere
const PROVIDERS = {
  google: {
    label: 'Google',
    authorize: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    token: () => 'https://oauth2.googleapis.com/token',
    revoke: 'https://oauth2.googleapis.com/revoke',
    scope: 'openid email https://mail.google.com/',
    extra: { access_type: 'offline', prompt: 'consent' }, // consent: Google sends a refresh token every time
    imap: { host: 'imap.gmail.com', port: 993 },
    smtp: { host: 'smtp.gmail.com', port: 465 },
  },
  microsoft: {
    label: 'Microsoft',
    authorize: t => `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`,
    token: t => `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`,
    revoke: null,
    scope: 'openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send',
    extra: { prompt: 'select_account' },
    imap: { host: 'outlook.office365.com', port: 993 },
    smtp: { host: 'smtp.office365.com', port: 587 },
  },
};
const KEYS = Object.keys(PROVIDERS);
const isOAuth = mode => KEYS.includes(mode);
const callbackUrl = key => `${base()}/api/email/oauth/${key}/callback`;

// ── The application, declared by the owner of the instance ──
async function load() {
  const s = await getSetting(KEY, {});
  return {
    google: { clientId: '', clientSecret: '', ...(s.google || {}) },
    microsoft: { clientId: '', clientSecret: '', tenant: 'common', ...(s.microsoft || {}) },
  };
}
const configured = p => !!(p.clientId && p.clientSecret);

async function publicSettings() {
  const s = await load();
  const out = {};
  for (const k of KEYS) {
    const { clientSecret, ...rest } = s[k];
    out[k] = { ...rest, secretSet: !!clientSecret, configured: configured(s[k]), callbackUrl: callbackUrl(k) };
  }
  return out;
}

// { google: { clientId, clientSecret }, microsoft: { clientId, clientSecret, tenant } } — an empty
// secret keeps the saved one, an empty identifier forgets the application
async function saveSettings(input) {
  const cur = await load();
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const next = {};
  for (const k of KEYS) {
    const i = input?.[k] && typeof input[k] === 'object' ? input[k] : {};
    const p = { ...cur[k] };
    if (i.clientId !== undefined) p.clientId = str(i.clientId, 255);
    if (typeof i.clientSecret === 'string' && i.clientSecret.trim()) p.clientSecret = seal(i.clientSecret.trim().slice(0, 500));
    if (!p.clientId) p.clientSecret = '';
    if (k === 'microsoft' && i.tenant !== undefined) {
      p.tenant = str(i.tenant, 100) || 'common';
      if (!TENANT_RE.test(p.tenant)) return { error: 'Annuaire Microsoft invalide (common, organizations ou l\'identifiant de l\'annuaire)' };
    }
    next[k] = p;
  }
  await setSetting(KEY, next);
  return { settings: await publicSettings() };
}

async function providerConfig(key) {
  if (!isOAuth(key)) return null;
  const p = (await load())[key];
  if (!configured(p)) return null;
  return { ...PROVIDERS[key], key, clientId: p.clientId, clientSecret: open(p.clientSecret), tenant: p.tenant || 'common' };
}
async function available() {
  const s = await load();
  return Object.fromEntries(KEYS.map(k => [k, configured(s[k])]));
}

// ── Connecting a mailbox ──
const b64url = buf => buf.toString('base64url');
async function authorizeUrl(key) {
  const p = await providerConfig(key);
  if (!p) return null;
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const url = new URL(p.authorize(p.tenant));
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', p.scope);
  url.searchParams.set('redirect_uri', callbackUrl(key));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest()));
  url.searchParams.set('code_challenge_method', 'S256');
  for (const [k, v] of Object.entries(p.extra)) url.searchParams.set(k, v);
  return { url: url.toString(), pending: { provider: key, state, verifier, at: Date.now() } };
}

async function tokenRequest(p, params) {
  const { data } = await axios.post(p.token(p.tenant), new URLSearchParams({ client_id: p.clientId, client_secret: p.clientSecret, ...params }),
    { ...HTTP, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } });
  if (!data?.access_token) throw Object.assign(new Error('token'), { reason: 'oauth_failed' });
  return data;
}

function claimsOf(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken || '').split('.')[1] || '', 'base64url').toString('utf8')); } catch { return {}; }
}

// Back from the provider: { account, refresh, access, expiresAt }. The ID token comes straight from
// the token endpoint over TLS, authenticated by the client secret (no signature to check again).
async function finish(key, pending, code) {
  const p = await providerConfig(key);
  if (!p) throw Object.assign(new Error('off'), { reason: 'provider_off' });
  if (!pending || pending.provider !== key || Date.now() - pending.at > 10 * 60 * 1000) throw Object.assign(new Error('state'), { reason: 'invalid_state' });
  const t = await tokenRequest(p, { grant_type: 'authorization_code', code: String(code), redirect_uri: callbackUrl(key), code_verifier: pending.verifier });
  if (!t.refresh_token) throw Object.assign(new Error('no refresh token'), { reason: 'no_refresh' });
  const c = claimsOf(t.id_token);
  const account = String(c.email || c.preferred_username || c.upn || '').trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) throw Object.assign(new Error('no address'), { reason: 'no_address' });
  return { account, refresh: t.refresh_token, access: t.access_token, expiresAt: new Date(Date.now() + (Number(t.expires_in) || 3600) * 1000) };
}

// Stores the connection of the space's mailbox: the servers become the provider's, the address
// the connected account's (an alias can still be shown as « Adresse du support »)
async function saveConnection(db, key, conn) {
  const P = PROVIDERS[key];
  await db(`INSERT INTO email_settings (id, auth_mode, oauth_account, oauth_refresh, oauth_access, oauth_expires_at, imap_host, imap_port, imap_user, smtp_host, smtp_port, smtp_user, address, last_error)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON DUPLICATE KEY UPDATE auth_mode = VALUES(auth_mode), oauth_account = VALUES(oauth_account), oauth_refresh = VALUES(oauth_refresh), oauth_access = VALUES(oauth_access),
              oauth_expires_at = VALUES(oauth_expires_at), imap_host = VALUES(imap_host), imap_port = VALUES(imap_port), imap_user = VALUES(imap_user),
              smtp_host = VALUES(smtp_host), smtp_port = VALUES(smtp_port), smtp_user = VALUES(smtp_user), address = COALESCE(NULLIF(address, ''), VALUES(address)), last_error = NULL`,
    [key, conn.account, seal(conn.refresh), seal(conn.access), conn.expiresAt, P.imap.host, P.imap.port, conn.account, P.smtp.host, P.smtp.port, conn.account, conn.account]);
}

// Forgets the connection (and revokes it at Google); the mailbox stops being read
async function disconnect(db) {
  const [row] = await db('SELECT auth_mode, oauth_refresh FROM email_settings WHERE id = 1').catch(() => []);
  if (row?.auth_mode === 'google' && row.oauth_refresh) {
    let token = null;
    try { token = open(row.oauth_refresh); } catch { /* key changed */ }
    if (token) await axios.post(PROVIDERS.google.revoke, new URLSearchParams({ token }), { ...HTTP, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => null);
  }
  await db("UPDATE email_settings SET auth_mode = 'password', oauth_account = NULL, oauth_refresh = NULL, oauth_access = NULL, oauth_expires_at = NULL, enabled = 0 WHERE id = 1");
}

// A valid access token for the space's mailbox (s: emailSettings(db, { withSecrets: true }), whose
// non-enumerable _db is the space's database). Renewed and saved when it is about to expire.
const refreshing = new Map();
async function accessToken(s) {
  if (!isOAuth(s.auth_mode)) return null;
  if (s.oauth_access && s.oauth_expires_at && new Date(s.oauth_expires_at).getTime() - Date.now() > MARGIN_MS) return s.oauth_access;
  const db = s._db;
  const key = db || 'x'; // one renewal at a time per space
  if (refreshing.has(key)) return refreshing.get(key);
  const run = (async () => {
    const p = await providerConfig(s.auth_mode);
    if (!p) throw Object.assign(new Error(`${PROVIDERS[s.auth_mode].label} : l'application n'est plus déclarée sur l'instance (Instance → Connexion)`), { expose: true });
    if (!s.oauth_refresh) throw Object.assign(new Error('Boîte non connectée : reconnecte-la'), { expose: true });
    let t;
    try { t = await tokenRequest(p, { grant_type: 'refresh_token', refresh_token: s.oauth_refresh, scope: p.scope }); }
    catch (err) {
      const code = err.response?.data?.error;
      const msg = code === 'invalid_grant'
        ? `${PROVIDERS[s.auth_mode].label} : la connexion de la boîte a expiré ou a été retirée, reconnecte-la`
        : `${PROVIDERS[s.auth_mode].label} : renouvellement de l'accès impossible (${code || err.message})`;
      if (db) await db('UPDATE email_settings SET last_error = ? WHERE id = 1', [msg.slice(0, 300)]).catch(() => null);
      throw Object.assign(new Error(msg), { expose: true });
    }
    const expiresAt = new Date(Date.now() + (Number(t.expires_in) || 3600) * 1000);
    if (db) {
      // Microsoft may hand out a new refresh token: the old one stops working soon after
      await db('UPDATE email_settings SET oauth_access = ?, oauth_expires_at = ?, oauth_refresh = COALESCE(?, oauth_refresh) WHERE id = 1',
        [seal(t.access_token), expiresAt, t.refresh_token ? seal(t.refresh_token) : null]);
    }
    s.oauth_access = t.access_token; s.oauth_expires_at = expiresAt;
    if (t.refresh_token) s.oauth_refresh = t.refresh_token;
    return t.access_token;
  })();
  refreshing.set(key, run);
  try { return await run; } finally { refreshing.delete(key); }
}

module.exports = { PROVIDERS, KEYS, isOAuth, callbackUrl, publicSettings, saveSettings, available, authorizeUrl, finish, saveConnection, disconnect, accessToken, load };

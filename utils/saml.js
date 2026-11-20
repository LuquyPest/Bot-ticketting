// SAML 2.0 sign-in of the instance (v7, conception/v7.md §3.9): Entra ID, Okta, ADFS, Keycloak…,
// set by the owner in Instance → Connexion. Datick is the service provider (SP):
//   metadata  /api/auth/saml/metadata   (entity ID = its own URL)
//   ACS       /api/auth/saml/acs        (HTTP-POST binding)
// Required: a signed response AND a signed assertion (IdP certificate given by the owner), the
// audience and the destination, the request it answers (InResponseTo, kept 10 minutes in Redis and
// consumed once), no assertion seen twice, 3 minutes of clock skew at most. Optionally only the
// members of one group (attribute « groups » or the one given). The identity is found by its NameID,
// or attached to the account with the same verified address; nobody gets an account by signing in.
const { getSetting, setSetting } = require('./instanceSettings');
const { config } = require('./config');

const KEY = 'saml_sp';
const DEFAULTS = { enabled: false, name: '', entryPoint: '', idpIssuer: '', idpCert: '', emailAttribute: 'email', nameAttribute: 'displayName', groupAttribute: 'groups', group: '' };
const base = () => String(config.webServerBaseUrl || '').replace(/\/$/, '');
const spIssuer = () => `${base()}/api/auth/saml/metadata`;
const acsUrl = () => `${base()}/api/auth/saml/acs`;

const PEM_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;
const certBody = pem => String(pem || '').replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');

async function load() { return { ...DEFAULTS, ...(await getSetting(KEY, DEFAULTS)) }; }
async function active() { const s = await load(); return !!(s.enabled && s.entryPoint && s.idpCert); }
async function publicSettings() {
  const s = await load();
  return { ...s, idpCert: s.idpCert ? `${s.idpCert.slice(0, 40)}…` : '', idpCertSet: !!s.idpCert, spEntityId: spIssuer(), acsUrl: acsUrl(), metadataUrl: spIssuer() };
}
function prepare(input = {}, cur = DEFAULTS) {
  const str = (k, max = 300) => (typeof input[k] === 'string' ? input[k].trim().slice(0, max) : cur[k] || '');
  const v = {
    enabled: !!input.enabled, name: str('name', 40), entryPoint: str('entryPoint', 500), idpIssuer: str('idpIssuer', 300),
    emailAttribute: str('emailAttribute', 200) || 'email', nameAttribute: str('nameAttribute', 200) || 'displayName', groupAttribute: str('groupAttribute', 200) || 'groups', group: str('group', 300),
    idpCert: cur.idpCert || '',
  };
  if (typeof input.idpCert === 'string' && input.idpCert.trim()) {
    const m = PEM_RE.exec(input.idpCert.trim()) || (/^[A-Za-z0-9+/=\s]{200,}$/.test(input.idpCert.trim()) ? [input.idpCert.trim()] : null);
    if (!m) return { error: 'Certificat du fournisseur : le PEM (-----BEGIN CERTIFICATE-----…)' };
    v.idpCert = certBody(m[0]);
  }
  if (v.enabled) {
    try { const u = new URL(v.entryPoint); if (u.protocol !== 'https:') throw new Error(); } catch { return { error: 'Adresse de connexion du fournisseur (SSO) : https://…' }; }
    if (!v.idpCert) return { error: 'Certificat de signature du fournisseur requis' };
    if (!base().startsWith('https://')) return { error: 'L\'instance doit être servie en https pour SAML' };
  }
  return { value: v };
}
async function save(v) { await setSetting(KEY, v); return { ok: true }; }

// Redis cache: requests waiting for their answer, assertions already seen
function cacheProvider() {
  const redis = () => require('./redis').getRedis();
  return {
    async saveAsync(key, value) { await redis().set(`saml:req:${key}`, value, 'PX', 10 * 60 * 1000); return { value, createdAt: Date.now() }; },
    async getAsync(key) { return redis().get(`saml:req:${key}`); },
    async removeAsync(key) { if (!key) return null; const v = await redis().get(`saml:req:${key}`); await redis().del(`saml:req:${key}`); return v; },
    async consumeAsync(key) { return redis().getdel(`saml:req:${key}`); },
    async saveIfAbsentAsync(key, value, expiresAtMs) {
      const ttl = Math.max(1000, expiresAtMs - Date.now());
      return (await redis().set(`saml:seen:${key}`, value, 'PX', ttl, 'NX')) === 'OK';
    },
  };
}
function spFor(s) {
  const { SAML, ValidateInResponseTo } = require('@node-saml/node-saml');
  return new SAML({
    entryPoint: s.entryPoint, issuer: spIssuer(), callbackUrl: acsUrl(), audience: spIssuer(), idpCert: s.idpCert, idpIssuer: s.idpIssuer || undefined,
    wantAssertionsSigned: true, wantAuthnResponseSigned: true, acceptedClockSkewMs: 3 * 60 * 1000, maxAssertionAgeMs: 10 * 60 * 1000,
    validateInResponseTo: ValidateInResponseTo.always, requestIdExpirationPeriodMs: 10 * 60 * 1000, rejectReplayedAssertions: true, cacheProvider: cacheProvider(),
    identifierFormat: null, disableRequestedAuthnContext: true, signatureAlgorithm: 'sha256', digestAlgorithm: 'sha256',
  });
}

async function loginUrl(relayState = '') {
  const s = await load();
  if (!(await active())) return null;
  return spFor(s).getAuthorizeUrlAsync(relayState, undefined, {});
}
async function metadata() {
  const s = await load();
  return spFor({ ...s, idpCert: s.idpCert || 'MA==', entryPoint: s.entryPoint || `${base()}/` }).generateServiceProviderMetadata(null, null);
}

const attr = (profile, name) => {
  const v = profile?.[name] ?? profile?.attributes?.[name];
  return Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)];
};
// The SAMLResponse posted by the IdP → { subject, email, name, groups } or throws { reason }
async function check(body, { test = false } = {}) {
  const s = await load();
  if (!(await active())) throw Object.assign(new Error('SAML off'), { reason: 'saml_off' });
  let r;
  try { r = await spFor(s).validatePostResponseAsync({ SAMLResponse: String(body?.SAMLResponse || '').slice(0, 300000), RelayState: String(body?.RelayState || '').slice(0, 200) }); }
  catch (err) { throw Object.assign(new Error(`SAML : ${err.message}`), { reason: 'saml_invalid' }); }
  const p = r?.profile;
  if (!p?.nameID) throw Object.assign(new Error('SAML : pas de NameID'), { reason: 'saml_invalid' });
  const email = (attr(p, s.emailAttribute)[0] || p.email || p.mail || (/@/.test(p.nameID) ? p.nameID : '')).trim().toLowerCase();
  const name = (attr(p, s.nameAttribute)[0] || p.displayName || email || p.nameID).slice(0, 100);
  const groups = attr(p, s.groupAttribute);
  if (test) return { subject: String(p.nameID).slice(0, 255), email, name, groups, groupOk: !s.group || groups.includes(s.group), group: s.group || null };
  if (s.group && !groups.includes(s.group)) throw Object.assign(new Error('SAML : hors du groupe autorisé'), { reason: 'saml_group' });
  return { subject: String(p.nameID).slice(0, 255), email, name, groups };
}

// « Tester » (v8): what can be checked without signing in — the certificate, the provider's address
async function diagnose() {
  const s = await load();
  const checks = [];
  checks.push({ label: 'Instance servie en https', ok: base().startsWith('https://'), detail: base() || 'adresse publique non réglée' });
  if (s.idpCert) {
    try {
      const pem = `-----BEGIN CERTIFICATE-----\n${s.idpCert.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`;
      const c = new (require('crypto').X509Certificate)(pem);
      const days = Math.floor((Date.parse(c.validTo) - Date.now()) / 86400000);
      checks.push({ label: 'Certificat du fournisseur', ok: days > 0, detail: `${c.subject.replace(/\n/g, ', ')} — ${days > 0 ? `valable encore ${days} jour(s)` : 'expiré'} (${c.validTo})`, warn: days > 0 && days < 30 });
    } catch (err) { checks.push({ label: 'Certificat du fournisseur', ok: false, detail: `illisible : ${err.message}` }); }
  } else checks.push({ label: 'Certificat du fournisseur', ok: false, detail: 'non fourni' });
  if (s.entryPoint) {
    try {
      const r = await fetch(s.entryPoint, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) });
      checks.push({ label: 'Adresse de connexion du fournisseur', ok: r.status < 500, detail: `répond ${r.status}` });
    } catch (err) { checks.push({ label: 'Adresse de connexion du fournisseur', ok: false, detail: `injoignable : ${err.cause?.code || err.message}` }); }
  } else checks.push({ label: 'Adresse de connexion du fournisseur', ok: false, detail: 'non fournie' });
  return { checks, ok: checks.every(c => c.ok) };
}
// A sign-in that only shows what the provider sends back (no session): its RelayState is a
// one-time nonce, kept 10 minutes
async function testLoginUrl() {
  if (!(await active())) return null;
  const nonce = require('crypto').randomBytes(16).toString('hex');
  await require('./redis').getRedis().set(`saml:test:${nonce}`, '1', 'EX', 600);
  return loginUrl(`test:${nonce}`);
}
async function consumeTest(relayState) {
  const m = /^test:([a-f0-9]{32})$/.exec(String(relayState || ''));
  return !!m && !!(await require('./redis').getRedis().getdel(`saml:test:${m[1]}`));
}

module.exports = { diagnose, testLoginUrl, consumeTest, KEY, DEFAULTS, load, active, publicSettings, prepare, save, loginUrl, metadata, check, spIssuer, acsUrl };

// LDAP / Active Directory directory of the instance (v5.7, conception/v5.md §3.18), set by the owner
// in Instance → Connexion:
//   - sign-in of the staff with the directory account (POST /api/auth/ldap-login): the person is found
//     with the service account, then their own password is checked by a bind as them. As with the
//     other providers nobody gets an account this way: the directory identity is attached to the
//     account holding the same verified address (invitations create accounts);
//   - import of the contacts and organisations of the directory into a space (utils/helpdeskImport.js).
// Only LDAPS (ldaps://) or StartTLS: a password never travels in clear. The server certificate is
// checked (system CAs, or the CA given here); not checking it is an explicit choice.
const { Client } = require('ldapts');
const { getSetting, setSetting } = require('./instanceSettings');
const { seal, open } = require('./secretBox');

const KEY = 'ldap_directory';
const DEFAULTS = {
  enabled: false, label: '', url: '', startTls: false, tlsVerify: true, ca: '',
  bindDn: '', bindPassword: '', baseDn: '',
  loginAttr: 'uid', userFilter: '(objectClass=person)', mailAttr: 'mail', nameAttr: 'displayName,cn',
  group: '', contactsBase: '', contactsFilter: '(&(objectClass=person)(mail=*))', orgAttr: 'company,o',
};
const URL_RE = /^ldaps?:\/\/[A-Za-z0-9.-]{1,253}(:\d{1,5})?\/?$/;
const ATTR_RE = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const TIMEOUT = 10000;
const MAX_CONTACTS = 5000;

async function load() {
  const s = await getSetting(KEY, {});
  return { ...DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
}
const configured = s => !!(s.url && s.baseDn && s.bindDn && s.bindPassword);
const labelOf = s => s.label || 'Annuaire';

// For the sign-in page: the label when the directory sign-in is on
async function active() {
  const s = await load();
  return s.enabled && configured(s) ? { label: labelOf(s) } : null;
}

async function publicSettings() {
  const { bindPassword, ...rest } = await load();
  return { ...rest, passwordSet: !!bindPassword, configured: configured({ ...rest, bindPassword }) };
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const attrList = v => String(v || '').split(',').map(a => a.trim()).filter(Boolean);
// A filter given by the owner: balanced parentheses, nothing else checked (it is theirs)
const filterOk = f => {
  if (!f) return true;
  if (!/^\(.*\)$/s.test(f) || f.length > 500) return false;
  let depth = 0;
  for (const ch of f.replace(/\\./g, '')) { if (ch === '(') depth++; else if (ch === ')' && --depth < 0) return false; }
  return depth === 0;
};

// New settings from the form; the password left empty keeps the one stored. { error } or { settings }.
async function prepare(input) {
  const i = input && typeof input === 'object' ? input : {};
  const s = await load();
  if (i.enabled !== undefined) s.enabled = !!i.enabled;
  if (i.startTls !== undefined) s.startTls = !!i.startTls;
  if (i.tlsVerify !== undefined) s.tlsVerify = !!i.tlsVerify;
  for (const [k, max] of [['label', 40], ['url', 300], ['bindDn', 500], ['baseDn', 500], ['group', 500], ['contactsBase', 500], ['userFilter', 500], ['contactsFilter', 500], ['loginAttr', 64], ['mailAttr', 64], ['nameAttr', 130], ['orgAttr', 130], ['ca', 20000]]) {
    const v = str(i[k], max);
    if (v !== undefined) s[k] = v;
  }
  if (typeof i.bindPassword === 'string' && i.bindPassword) s.bindPassword = seal(i.bindPassword.slice(0, 500));
  if (s.url && !URL_RE.test(s.url)) return { error: 'Adresse de l\'annuaire invalide (ldaps://serveur:636, ou ldap://serveur:389 avec StartTLS)' };
  if (/^ldap:\/\//i.test(s.url) && !s.startTls) return { error: 'Sans LDAPS, active StartTLS : un mot de passe ne doit pas passer en clair' };
  if (/^ldaps:\/\//i.test(s.url) && s.startTls) return { error: 'StartTLS ne s\'utilise qu\'avec ldap:// (ldaps:// est déjà chiffré)' };
  if (!ATTR_RE.test(s.loginAttr) || !ATTR_RE.test(s.mailAttr) || ![s.nameAttr, s.orgAttr].every(v => !v || attrList(v).every(a => ATTR_RE.test(a)))) return { error: 'Nom d\'attribut invalide' };
  if (!filterOk(s.userFilter) || !filterOk(s.contactsFilter)) return { error: 'Filtre LDAP invalide (entre parenthèses, équilibrées)' };
  if (s.ca && !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(s.ca)) return { error: 'Certificat de l\'autorité au format PEM attendu' };
  if (s.enabled && !configured(s)) return { error: 'Adresse, base, compte de service et son mot de passe requis pour l\'activer' };
  return { settings: s };
}
const save = settings => setSetting(KEY, settings);

// RFC 4515: a value placed in a filter
const escapeFilter = v => String(v).replace(/[\\*()\0]/g, c => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);

function tls(s) {
  const host = (s.url.match(/^ldaps?:\/\/([^:/]+)/i) || [])[1];
  return { rejectUnauthorized: s.tlsVerify !== false, ...(s.ca ? { ca: s.ca } : {}), servername: /^[\d.]+$/.test(host) ? undefined : host, minVersion: 'TLSv1.2' };
}
// A connected client (TLS in place), bound with the service account unless told otherwise
async function connect(s, bind = true) {
  const ldaps = /^ldaps:/i.test(s.url);
  const client = new Client({ url: s.url.replace(/\/$/, ''), timeout: TIMEOUT, connectTimeout: TIMEOUT, ...(ldaps ? { tlsOptions: tls(s) } : {}) });
  try {
    if (!ldaps) await client.startTLS(tls(s));
    if (bind) await client.bind(s.bindDn, open(s.bindPassword) || '');
    return client;
  } catch (err) {
    await client.unbind().catch(() => null);
    throw err;
  }
}

const first = (entry, attrs) => {
  for (const a of attrList(attrs)) {
    const key = Object.keys(entry).find(k => k.toLowerCase() === a.toLowerCase());
    const v = key ? entry[key] : undefined;
    const one = Array.isArray(v) ? v[0] : v;
    if (one !== undefined && one !== null && String(one).trim()) return Buffer.isBuffer(one) ? one : String(one).trim();
  }
  return '';
};
// The stable identifier of an entry: entryUUID (OpenLDAP), objectGUID (Active Directory), else its DN
function subjectOf(entry) {
  const uuid = first(entry, 'entryUUID');
  if (uuid) return `uuid:${String(uuid).toLowerCase()}`;
  const guid = first(entry, 'objectGUID');
  if (guid) return `guid:${Buffer.isBuffer(guid) ? guid.toString('hex') : Buffer.from(String(guid), 'binary').toString('hex')}`;
  return `dn:${String(entry.dn).toLowerCase()}`;
}
const personAttrs = s => ['entryUUID', 'objectGUID', s.mailAttr, ...attrList(s.nameAttr), ...attrList(s.orgAttr)];
const explicitBuffer = ['objectGUID'];

async function inGroup(client, s, dn, login) {
  if (!s.group) return true;
  const f = `(|(member=${escapeFilter(dn)})(uniqueMember=${escapeFilter(dn)})(memberUid=${escapeFilter(login)}))`;
  const r = await client.search(s.group, { scope: 'base', filter: f, attributes: ['dn'], sizeLimit: 1, timeLimit: 10 });
  return r.searchEntries.length > 0;
}

// Checks a directory login. { subject, email, name } or { error: 'invalid' | 'group' | 'unavailable' }.
// Same answer for an unknown login and a wrong password.
async function authenticate(login, password) {
  const s = await load();
  if (!s.enabled || !configured(s)) return { error: 'unavailable' };
  const user = String(login || '').trim();
  // An empty password would be an anonymous bind, which many servers accept
  if (!user || user.length > 200 || typeof password !== 'string' || !password || password.length > 200) return { error: 'invalid' };
  let client;
  try {
    client = await connect(s);
    const filter = `(&(${s.loginAttr}=${escapeFilter(user)})${s.userFilter || ''})`;
    const r = await client.search(s.baseDn, { scope: 'sub', filter, attributes: personAttrs(s), explicitBufferAttributes: explicitBuffer, sizeLimit: 2, timeLimit: 10 });
    if (r.searchEntries.length !== 1) return { error: 'invalid' };
    const entry = r.searchEntries[0];
    const userClient = await connect(s, false);
    try { await userClient.bind(entry.dn, password); }
    catch { return { error: 'invalid' }; }
    finally { await userClient.unbind().catch(() => null); }
    if (!(await inGroup(client, s, entry.dn, user))) return { error: 'group' };
    return { subject: subjectOf(entry), email: String(first(entry, s.mailAttr)).toLowerCase(), name: String(first(entry, s.nameAttr) || user).slice(0, 100) };
  } catch (err) {
    if (err?.code === 49 || /InvalidCredentials/.test(err?.name || '')) return { error: 'invalid' };
    console.error('ldap sign-in:', err.code || err.message);
    return { error: 'unavailable' };
  } finally {
    if (client) await client.unbind().catch(() => null);
  }
}

// The people of the directory as rows for utils/helpdeskImport.js (kind « contacts »)
async function contactRows(settings) {
  const s = settings || await load();
  if (!configured(s)) return { error: 'Annuaire non configuré (Instance → Connexion)' };
  let client;
  try {
    client = await connect(s);
    const r = await client.search(s.contactsBase || s.baseDn, {
      scope: 'sub', filter: s.contactsFilter || DEFAULTS.contactsFilter, attributes: personAttrs(s), explicitBufferAttributes: explicitBuffer,
      sizeLimit: MAX_CONTACTS, timeLimit: 30, paged: { pageSize: 500 },
    });
    return { rows: r.searchEntries.slice(0, MAX_CONTACTS).map(e => ({ id: subjectOf(e).slice(0, 64), email: String(first(e, s.mailAttr)), name: String(first(e, s.nameAttr)), organization: String(first(e, s.orgAttr)) })) };
  } catch (err) {
    console.error('ldap contacts:', err.code || err.message);
    return { error: `Annuaire injoignable ou refusé (${err.code === 49 ? 'compte de service refusé' : String(err.code || err.message).slice(0, 80)})` };
  } finally {
    if (client) await client.unbind().catch(() => null);
  }
}

// Instance → Connexion → Tester: the service account, the number of people the filters find, and
// before they are saved
async function test(settings) {
  let client;
  try {
    client = await connect(settings);
    const r = await client.search(settings.baseDn, { scope: 'sub', filter: `(&(${settings.loginAttr}=*)${settings.userFilter || ''})`, attributes: ['dn'], sizeLimit: 1000, timeLimit: 10 })
      .catch(err => (err?.code === 4 ? { searchEntries: new Array(1000) } : Promise.reject(err)));
    return { ok: true, people: r.searchEntries.length };
  } catch (err) {
    return { ok: false, error: err.code === 49 ? 'Compte de service refusé' : String(err.code || err.message).slice(0, 120) };
  } finally {
    if (client) await client.unbind().catch(() => null);
  }
}

module.exports = { KEY, DEFAULTS, load, active, publicSettings, prepare, save, authenticate, contactRows, test, escapeFilter };

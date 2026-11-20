// CRM of a space (v7, conception/v7.md §3.3): HubSpot or Salesforce, read only.
// - On the ticket view, the requester's CRM card: name, company, owner, value, link (cached 10 min).
// - Synchronisation of the companies and contacts into the organisations and contacts of the space
//   (through utils/helpdeskImport.js, « update what is already imported »), by hand or every day.
// The token is given by an administrator of the space, sealed (utils/secretBox.js), never sent back.
// Outgoing calls only go to the provider: api.hubapi.com, or the Salesforce instance of the space
// (an https *.salesforce.com address). HUBSPOT_API_URL / SALESFORCE_ALLOW_ANY_HOST exist for tests.
const { seal, open } = require('./secretBox');

const PROVIDERS = ['hubspot', 'salesforce'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SF_HOST_RE = /^https:\/\/[a-z0-9][a-z0-9.-]*\.(my\.)?salesforce\.com$/i;
const CACHE_S = 600;
const MAX_SYNC = 5000;

const hubspotBase = () => (process.env.HUBSPOT_API_URL || 'https://api.hubapi.com').replace(/\/$/, '');
const sfHostOk = url => SF_HOST_RE.test(url) || (process.env.SALESFORCE_ALLOW_ANY_HOST === '1' && /^https?:\/\/[^/\s]+$/.test(url));

// ── Settings ──
async function rawSettings(db) {
  const [c] = await db('SELECT crm_provider, crm_config FROM guild_config WHERE id = 1').catch(() => []);
  let cfg = {};
  try { cfg = c?.crm_config ? JSON.parse(open(c.crm_config)) : {}; } catch { cfg = {}; }
  return { provider: PROVIDERS.includes(c?.crm_provider) ? c.crm_provider : null, ...cfg };
}
// What the dashboard sees: never the token nor the secret
async function settings(db) {
  const s = await rawSettings(db);
  return { provider: s.provider, instanceUrl: s.instanceUrl || '', clientId: s.clientId || '', hasToken: !!s.token, hasSecret: !!s.clientSecret, portalId: s.portalId || '',
    dailySync: !!s.dailySync, lastSync: s.lastSync || null };
}
async function saveSettings(db, input = {}) {
  const cur = await rawSettings(db);
  if (input.provider === null || input.provider === '') {
    await db('UPDATE guild_config SET crm_provider = NULL, crm_config = NULL WHERE id = 1');
    return { ok: true };
  }
  if (!PROVIDERS.includes(input.provider)) return { error: 'CRM : hubspot ou salesforce' };
  const next = { dailySync: !!input.dailySync, lastSync: cur.provider === input.provider ? cur.lastSync || null : null };
  const keep = k => (typeof input[k] === 'string' && input[k].trim() ? input[k].trim() : cur.provider === input.provider ? cur[k] : undefined);
  next.token = keep('token');
  if (input.provider === 'hubspot') {
    if (!next.token) return { error: 'Jeton d\'application privée HubSpot requis' };
    next.portalId = /^\d{1,15}$/.test(String(input.portalId || '')) ? String(input.portalId) : '';
  } else {
    const url = String(input.instanceUrl || cur.instanceUrl || '').trim().replace(/\/$/, '');
    if (!sfHostOk(url)) return { error: 'Adresse de l\'instance Salesforce : https://<société>.my.salesforce.com' };
    next.instanceUrl = url;
    next.clientId = typeof input.clientId === 'string' ? input.clientId.trim().slice(0, 300) : cur.clientId || '';
    next.clientSecret = keep('clientSecret');
    if (!next.token && !(next.clientId && next.clientSecret)) return { error: 'Jeton d\'accès, ou identifiant et secret d\'une application connectée (client credentials)' };
  }
  await db('UPDATE guild_config SET crm_provider = ?, crm_config = ? WHERE id = 1', [input.provider, seal(JSON.stringify(next))]);
  return { ok: true };
}
async function remember(db, patch) {
  const cur = await rawSettings(db);
  const { provider, ...rest } = cur;
  if (!provider) return;
  await db('UPDATE guild_config SET crm_config = ? WHERE id = 1', [seal(JSON.stringify({ ...rest, ...patch }))]);
}

// ── HTTP ──
async function call(url, { method = 'GET', headers = {}, body = null } = {}) {
  const res = await fetch(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...headers },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined, redirect: 'error', signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw Object.assign(new Error(`CRM : réponse ${res.status}${data?.message ? ` (${String(data.message).slice(0, 120)})` : Array.isArray(data) && data[0]?.message ? ` (${String(data[0].message).slice(0, 120)})` : ''}`), { status: res.status });
  return data;
}

// Salesforce: the token given, or one from the client credentials flow
async function sfToken(s) {
  if (s.token) return s.token;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: s.clientId, client_secret: s.clientSecret }).toString();
  const r = await call(`${s.instanceUrl}/services/oauth2/token`, { method: 'POST', body });
  if (!r?.access_token) throw new Error('CRM : pas de jeton Salesforce');
  return r.access_token;
}
const soql = async (s, token, q) => call(`${s.instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } });
const soqlString = v => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// ── Card of a requester ──
async function lookupUncached(s, email) {
  if (s.provider === 'hubspot') {
    const h = { Authorization: `Bearer ${s.token}` };
    const found = await call(`${hubspotBase()}/crm/v3/objects/contacts/search`, { method: 'POST', headers: h, body: {
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }], limit: 1,
      properties: ['firstname', 'lastname', 'email', 'phone', 'jobtitle', 'lifecyclestage', 'hubspot_owner_id'] } });
    const c = found?.results?.[0];
    if (!c) return null;
    const p = c.properties || {};
    let company = null, owner = null;
    const assoc = await call(`${hubspotBase()}/crm/v4/objects/contacts/${encodeURIComponent(c.id)}/associations/companies`, { headers: h }).catch(() => null);
    const compId = assoc?.results?.[0]?.toObjectId;
    if (compId) {
      const co = await call(`${hubspotBase()}/crm/v3/objects/companies/${encodeURIComponent(compId)}?properties=name,domain,annualrevenue,industry`, { headers: h }).catch(() => null);
      if (co) company = { name: co.properties?.name || null, domain: co.properties?.domain || null, revenue: co.properties?.annualrevenue ? Number(co.properties.annualrevenue) : null, industry: co.properties?.industry || null };
    }
    if (p.hubspot_owner_id) {
      const o = await call(`${hubspotBase()}/crm/v3/owners/${encodeURIComponent(p.hubspot_owner_id)}`, { headers: h }).catch(() => null);
      if (o) owner = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || null;
    }
    return { provider: 'hubspot', name: [p.firstname, p.lastname].filter(Boolean).join(' ') || null, email: p.email || email, phone: p.phone || null, title: p.jobtitle || null,
      stage: p.lifecyclestage || null, company, owner, url: s.portalId ? `https://app.hubspot.com/contacts/${s.portalId}/contact/${encodeURIComponent(c.id)}` : null };
  }
  const token = await sfToken(s);
  const r = await soql(s, token, `SELECT Id, Name, Email, Phone, Title, Owner.Name, Account.Name, Account.Website, Account.AnnualRevenue, Account.Industry FROM Contact WHERE Email = ${soqlString(email)} LIMIT 1`);
  const c = r?.records?.[0];
  if (!c) return null;
  return { provider: 'salesforce', name: c.Name || null, email: c.Email || email, phone: c.Phone || null, title: c.Title || null, stage: null,
    company: c.Account ? { name: c.Account.Name || null, domain: c.Account.Website || null, revenue: c.Account.AnnualRevenue ?? null, industry: c.Account.Industry || null } : null,
    owner: c.Owner?.Name || null, url: /^[a-zA-Z0-9]{15,18}$/.test(String(c.Id)) ? `${s.instanceUrl}/${c.Id}` : null };
}
// The card of an e-mail address: { card } (card null when unknown) or { error }
async function lookup(db, guildId, email) {
  const s = await rawSettings(db);
  if (!s.provider) return { card: null, off: true };
  const address = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(address)) return { card: null };
  const redis = require('./redis').getRedis();
  const key = `crm:${guildId}:${require('crypto').createHash('sha256').update(address).digest('hex').slice(0, 32)}`;
  const cached = await redis.get(key).catch(() => null);
  if (cached) return { card: JSON.parse(cached) };
  try {
    const card = await lookupUncached(s, address);
    await redis.set(key, JSON.stringify(card), 'EX', CACHE_S).catch(() => null);
    return { card };
  } catch (err) { return { card: null, error: err.message }; }
}
// The address of a ticket's requester, when known: e-mail tickets, web tickets, a contact card
async function requesterEmail(db, ticket) {
  const [c] = await db(`SELECT c.email FROM contact_identities ci JOIN contacts c ON c.id = ci.contact_id WHERE ci.value = ? AND c.email IS NOT NULL`, [ticket.owner_id]).catch(() => []);
  if (c?.email) return c.email;
  const [l] = await db('SELECT label FROM contact_identities WHERE value = ? AND kind IN (\'email\', \'web\')', [ticket.owner_id]).catch(() => []);
  return l?.label && EMAIL_RE.test(l.label) ? l.label : null;
}

// ── Synchronisation ──
async function fetchAll(s) {
  const orgs = [], contacts = [];
  if (s.provider === 'hubspot') {
    const h = { Authorization: `Bearer ${s.token}` };
    let after = null;
    do {
      const r = await call(`${hubspotBase()}/crm/v3/objects/companies?limit=100&properties=name,domain${after ? `&after=${encodeURIComponent(after)}` : ''}`, { headers: h });
      for (const c of r?.results || []) if (c.properties?.name) orgs.push({ organizationid: `hs:${c.id}`, organization: c.properties.name, domains: c.properties.domain || '' });
      after = r?.paging?.next?.after || null;
    } while (after && orgs.length < MAX_SYNC);
    const names = new Map(orgs.map(o => [o.organizationid, o.organization]));
    after = null;
    do {
      const r = await call(`${hubspotBase()}/crm/v3/objects/contacts?limit=100&properties=email,firstname,lastname&associations=companies${after ? `&after=${encodeURIComponent(after)}` : ''}`, { headers: h });
      for (const c of r?.results || []) {
        const p = c.properties || {};
        if (!EMAIL_RE.test(String(p.email || ''))) continue;
        const comp = c.associations?.companies?.results?.[0]?.id;
        contacts.push({ contactid: `hs:${c.id}`, email: p.email, personname: [p.firstname, p.lastname].filter(Boolean).join(' '), organization: comp ? names.get(`hs:${comp}`) || '' : '' });
      }
      after = r?.paging?.next?.after || null;
    } while (after && contacts.length < MAX_SYNC);
    return { orgs, contacts };
  }
  const token = await sfToken(s);
  const all = async q => {
    const out = [];
    let r = await soql(s, token, q);
    out.push(...(r?.records || []));
    while (r?.nextRecordsUrl && out.length < MAX_SYNC && /^\/services\/data\//.test(r.nextRecordsUrl)) {
      r = await call(`${s.instanceUrl}${r.nextRecordsUrl}`, { headers: { Authorization: `Bearer ${token}` } });
      out.push(...(r?.records || []));
    }
    return out;
  };
  for (const a of await all('SELECT Id, Name, Website FROM Account')) {
    if (!a.Name) continue;
    const domain = String(a.Website || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];
    orgs.push({ organizationid: `sf:${a.Id}`, organization: a.Name, domains: domain });
  }
  for (const c of await all('SELECT Id, Name, Email, Account.Name FROM Contact WHERE Email != null')) {
    if (EMAIL_RE.test(String(c.Email || ''))) contacts.push({ contactid: `sf:${c.Id}`, email: c.Email, personname: c.Name || '', organization: c.Account?.Name || '' });
  }
  return { orgs, contacts };
}
// Pulls the companies, then the contacts → { organizations: {created, updated}, contacts: {…} } or { error }
async function syncNow(db) {
  const s = await rawSettings(db);
  if (!s.provider) return { error: 'Aucun CRM branché' };
  let got;
  try { got = await fetchAll(s); } catch (err) { return { error: err.message }; }
  const H = require('./helpdeskImport');
  const o = await H.importRows(db, { source: s.provider, kind: 'organizations', rows: got.orgs, update: true });
  const c = await H.importRows(db, { source: s.provider, kind: 'contacts', rows: got.contacts, update: true });
  const result = { organizations: { created: o.created, updated: o.updated, errors: o.errors?.length || 0 }, contacts: { created: c.created, updated: c.updated, errors: c.errors?.length || 0 } };
  await remember(db, { lastSync: { at: new Date().toISOString(), ...result } });
  await require('./audit').recordEvent(db, { actor: { id: 'system', tag: 'CRM' }, action: 'helpdesk_import', details: { source: s.provider, ...result } }).catch(() => null);
  return result;
}
async function runCrmSync() {
  const { getActiveGuilds } = require('./guildScan');
  const { getTenantDb } = require('./tenantDb');
  for (const { guild_id } of await getActiveGuilds()) {
    const db = getTenantDb(guild_id);
    const s = await rawSettings(db).catch(() => ({}));
    if (s.provider && s.dailySync) await syncNow(db).catch(err => console.error('crm:', guild_id, err.message));
  }
}

// « Tester » (v8): a real call with the saved keys → { ok, detail } or { error }, said plainly
async function test(db) {
  const s = await rawSettings(db);
  if (!s.provider) return { error: 'Aucun CRM n\'est branché' };
  try {
    if (s.provider === 'hubspot') {
      const r = await call(`${hubspotBase()}/crm/v3/objects/contacts?limit=1&properties=email`, { headers: { Authorization: `Bearer ${s.token}` } });
      return { ok: true, detail: `HubSpot répond : ${r?.results?.length ? 'les contacts sont lisibles' : 'aucun contact pour l\'instant'}.` };
    }
    const token = await sfToken(s);
    const r = await soql(s, token, 'SELECT COUNT() FROM Contact');
    return { ok: true, detail: `Salesforce répond : ${Number(r?.totalSize || 0)} contact(s) lisibles.` };
  } catch (err) { return { error: explain(err) }; }
}
// An HTTP failure in words the administrator can act on
function explain(err) {
  if (err.status === 401) return `${err.message} — jeton refusé : il est faux, expiré ou révoqué`;
  if (err.status === 403) return `${err.message} — jeton valide mais sans le droit de lire les contacts`;
  if (err.status === 404) return `${err.message} — adresse ou projet introuvable`;
  if (err.name === 'TimeoutError') return 'Le service ne répond pas (10 s)';
  return err.message;
}

module.exports = { test, explain, PROVIDERS, settings, saveSettings, lookup, requesterEmail, syncNow, runCrmSync, sfHostOk };

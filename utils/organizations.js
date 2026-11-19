// Organisations (v5.3, conception/v5.md §3.7): they group contacts — a client company, an internal
// department, a site. A contact joins one by the domain of its e-mail address (automatic), by
// hand (then the domain no longer moves it), or by import. An organisation has its own calendar
// (it comes before the team's and the space's, utils/calendars.js), an SLA (criterion
// « organisation » of the objectives, utils/slaPolicies.js), a team and an account manager, fields
// (contract, phone…), notes, and sub-organisations (one level).
// A ticket keeps the organisation of its requester when it is opened (tickets.organization_id):
// it is what the SLA, the rules, the list and the reports read. Moving a contact moves its open tickets.
const { parseJsonField } = require('./jsonField');

const MAX_ORGS = 2000, MAX_DOMAINS = 20, MAX_FIELDS = 20;
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,63}$/;
// Domains everyone shares: never a reason to group people
const PUBLIC_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr', 'msn.com', 'yahoo.com', 'yahoo.fr', 'icloud.com', 'me.com', 'aol.com', 'gmx.com', 'gmx.fr', 'gmx.de', 'web.de', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'proton.me', 'protonmail.com', 'yandex.com', 'mail.com', 'zoho.com']);

async function listOrgs(db) {
  const orgs = await db(`SELECT o.*, (SELECT COUNT(*) FROM contacts c WHERE c.organization_id = o.id) AS contacts,
      (SELECT COUNT(*) FROM tickets t WHERE t.organization_id = o.id AND t.status = 'open') AS open_tickets
    FROM organizations o ORDER BY o.name`).catch(() => []);
  const domains = await db('SELECT domain, organization_id FROM organization_domains ORDER BY domain').catch(() => []);
  return orgs.map(o => ({
    id: o.id, name: o.name, parentId: o.parent_id || null, teamId: o.team_id || null, managerId: o.manager_id || null, calendarId: o.calendar_id || null,
    fields: parseJsonField(o.fields, {}) || {}, notes: o.notes || '', contacts: Number(o.contacts), openTickets: Number(o.open_tickets),
    domains: domains.filter(d => d.organization_id === o.id).map(d => d.domain),
  }));
}
const orgOf = async (db, id) => (await listOrgs(db)).find(o => o.id === Number(id)) || null;

async function clean(db, id, input = {}) {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
  if (!name) return { error: 'Nom de l\'organisation requis (100 caractères au plus)' };
  const parentId = input.parentId ? Number(input.parentId) : null;
  if (parentId) {
    if (parentId === Number(id)) return { error: 'Une organisation ne peut pas être sa propre parente' };
    const [p] = await db('SELECT id, parent_id FROM organizations WHERE id = ?', [parentId]);
    if (!p) return { error: 'Organisation parente introuvable' };
    if (p.parent_id) return { error: 'Un seul niveau de sous-organisations' };
    if (id && (await db('SELECT 1 FROM organizations WHERE parent_id = ?', [id])).length) return { error: 'Cette organisation a des sous-organisations : elle ne peut pas en devenir une' };
  }
  const domains = [...new Set((Array.isArray(input.domains) ? input.domains : String(input.domains || '').split(/[\s,;]+/)).map(d => String(d).trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
  if (domains.length > MAX_DOMAINS) return { error: `${MAX_DOMAINS} domaines au plus` };
  const bad = domains.find(d => !DOMAIN_RE.test(d));
  if (bad) return { error: `Domaine invalide : ${bad}` };
  const pub = domains.find(d => PUBLIC_DOMAINS.has(d));
  if (pub) return { error: `${pub} est une messagerie publique : rattache ces personnes à la main` };
  const taken = domains.length ? await db('SELECT domain FROM organization_domains WHERE domain IN (?) AND organization_id <> ?', [domains, Number(id) || 0]) : [];
  if (taken.length) return { error: `Le domaine ${taken[0].domain} est déjà celui d'une autre organisation` };
  const teamId = input.teamId ? Number(input.teamId) : null;
  if (teamId && !(await db('SELECT 1 FROM teams WHERE id = ?', [teamId])).length) return { error: 'Équipe introuvable' };
  const managerId = input.managerId ? String(input.managerId) : null;
  if (managerId && !(await db("SELECT 1 FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [managerId])).length) return { error: 'Le responsable doit faire partie du staff' };
  const calendarId = input.calendarId ? Number(input.calendarId) : null;
  if (calendarId && !(await require('./calendars').calendarOf(db, calendarId))) return { error: 'Calendrier introuvable' };
  const fields = {};
  for (const [k, v] of Object.entries(input.fields && typeof input.fields === 'object' ? input.fields : {}).slice(0, MAX_FIELDS + 1)) {
    if (Object.keys(fields).length >= MAX_FIELDS) return { error: `${MAX_FIELDS} champs au plus` };
    const key = String(k).replace(/\s+/g, ' ').trim().slice(0, 40), val = String(v ?? '').trim().slice(0, 300);
    if (key && val) fields[key] = val;
  }
  return { value: { name, parentId, domains, teamId, managerId, calendarId, fields, notes: typeof input.notes === 'string' ? input.notes.slice(0, 5000) : '' } };
}

async function saveOrg(db, id, input) {
  if (!id) {
    const [n] = await db('SELECT COUNT(*) AS n FROM organizations');
    if (Number(n.n) >= MAX_ORGS) return { error: `${MAX_ORGS} organisations au plus` };
  } else if (!(await db('SELECT 1 FROM organizations WHERE id = ?', [id])).length) return { error: 'Organisation introuvable', status: 404 };
  const r = await clean(db, id, input);
  if (r.error) return r;
  const v = r.value;
  const vals = [v.name, v.parentId, v.teamId, v.managerId, v.calendarId, JSON.stringify(v.fields), v.notes || null];
  if (id) await db('UPDATE organizations SET name = ?, parent_id = ?, team_id = ?, manager_id = ?, calendar_id = ?, fields = ?, notes = ? WHERE id = ?', [...vals, id]);
  else id = (await db('INSERT INTO organizations (name, parent_id, team_id, manager_id, calendar_id, fields, notes) VALUES (?, ?, ?, ?, ?, ?, ?)', vals)).insertId;
  await db('DELETE FROM organization_domains WHERE organization_id = ?', [id]);
  for (const d of v.domains) await db('INSERT INTO organization_domains (domain, organization_id) VALUES (?, ?)', [d, id]);
  // Contacts of these domains (unless placed by hand), and of the domains it no longer has
  await db('UPDATE contacts SET organization_id = NULL WHERE organization_id = ? AND org_manual = 0', [id]);
  await attachByDomain(db);
  await refreshOpenTickets(db, { organizationId: id });
  return { ok: true, id };
}
async function deleteOrg(db, id) {
  if (!(await db('SELECT 1 FROM organizations WHERE id = ?', [id])).length) return { error: 'Organisation introuvable', status: 404 };
  await db('UPDATE organizations SET parent_id = NULL WHERE parent_id = ?', [id]);
  await db('UPDATE contacts SET organization_id = NULL, org_manual = 0 WHERE organization_id = ?', [id]);
  await db('DELETE FROM organization_domains WHERE organization_id = ?', [id]);
  await db('DELETE FROM organizations WHERE id = ?', [id]);
  await refreshOpenTickets(db, { organizationId: id });
  return { ok: true };
}

// Contacts whose e-mail domain belongs to an organisation (never those placed by hand)
async function attachByDomain(db) {
  await db(`UPDATE contacts c JOIN organization_domains d ON d.domain = LOWER(SUBSTRING_INDEX(c.email, '@', -1))
    SET c.organization_id = d.organization_id WHERE c.org_manual = 0 AND c.email LIKE '%@%' AND (c.organization_id IS NULL OR c.organization_id <> d.organization_id)`).catch(() => null);
}
// A contact placed by hand (organizationId null = no organisation, still by hand); auto = back to the domain
async function setContactOrg(db, contactId, organizationId, { auto = false } = {}) {
  if (!auto && organizationId && !(await db('SELECT 1 FROM organizations WHERE id = ?', [organizationId])).length) return { error: 'Organisation introuvable' };
  if (auto) {
    await db('UPDATE contacts SET organization_id = NULL, org_manual = 0 WHERE id = ?', [contactId]);
    await attachByDomain(db);
  } else await db('UPDATE contacts SET organization_id = ?, org_manual = 1 WHERE id = ?', [organizationId || null, contactId]);
  await refreshOpenTickets(db, { contactId });
  return { ok: true };
}

// The open tickets follow their requester's organisation (and their SLA deadlines)
async function refreshOpenTickets(db, { contactId = null, organizationId = null } = {}) {
  const where = contactId ? 'ci.contact_id = ?' : '(c.organization_id = ? OR t.organization_id = ?)';
  const params = contactId ? [contactId] : [organizationId, organizationId];
  const rows = await db(`SELECT t.id FROM tickets t JOIN contact_identities ci ON ci.value = t.owner_id JOIN contacts c ON c.id = ci.contact_id
    WHERE t.status = 'open' AND ${where} LIMIT 5000`, params).catch(() => []);
  for (const { id } of rows) await assignTicket(db, id, { sync: false });
  return rows.length;
}

// At the opening (utils/ticketManager.js): the requester's contact, then its organisation
async function assignTicket(db, ticketId, { sync = true } = {}) {
  if (sync) {
    await require('./contacts').sync(db);
    await attachByDomain(db);
  }
  const [before] = await db('SELECT organization_id FROM tickets WHERE id = ?', [ticketId]);
  await db(`UPDATE tickets t LEFT JOIN contact_identities ci ON ci.value = t.owner_id LEFT JOIN contacts c ON c.id = ci.contact_id
    SET t.organization_id = c.organization_id WHERE t.id = ?`, [ticketId]);
  const [after] = await db('SELECT organization_id FROM tickets WHERE id = ?', [ticketId]);
  if ((before?.organization_id || null) !== (after?.organization_id || null)) await require('./slaPolicies').refreshQuietly(db, ticketId);
  return after?.organization_id || null;
}

// « name;domains » lines (domains separated by commas or spaces), the first line may be a header
async function importCsv(db, text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 1001);
  let created = 0, updated = 0;
  const errors = [];
  for (const [i, line] of lines.entries()) {
    const [name, domains = ''] = line.split(/[;\t]/).map(x => x.trim());
    if (i === 0 && /^(nom|name)$/i.test(name)) continue;
    const [row] = await db('SELECT id FROM organizations WHERE name = ?', [name]);
    const cur = row ? await orgOf(db, row.id) : null;
    const r = await saveOrg(db, row?.id || null, { ...(cur || {}), name, domains: [...new Set([...(cur?.domains || []), ...domains.split(/[\s,]+/).filter(Boolean)])] });
    if (r.error) errors.push(`Ligne ${i + 1} : ${r.error}`);
    else if (row) updated++; else created++;
  }
  return { created, updated, errors: errors.slice(0, 20) };
}

module.exports = { PUBLIC_DOMAINS, listOrgs, orgOf, saveOrg, deleteOrg, attachByDomain, setContactOrg, assignTicket, refreshOpenTickets, importCsv };

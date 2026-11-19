// Imports from other helpdesk tools (v5.7, conception/v5.md §3.18): the exports of Zendesk,
// Freshdesk, GLPI, osTicket and Zammad (CSV or JSON), or any CSV / JSON with the same columns.
// Tickets (with their conversation when the export has it), contacts, organisations, articles.
// The columns are found by their usual names in each tool (aliases); statuses and priorities are
// translated. An import can be replayed: what was already taken (import_refs, by source and
// external ID) is skipped, never duplicated. A dry run counts without writing.
const { parseJsonField } = require('./jsonField');

const SOURCES = ['zendesk', 'freshdesk', 'glpi', 'osticket', 'zammad', 'generic'];
const KINDS = ['tickets', 'contacts', 'organizations', 'articles'];
const MAX_ROWS = 20000;

// ── Reading: CSV (« , » or « ; », quotes, multi-line cells) or JSON (array, {tickets: […]}, NDJSON) ──
function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : (firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cell += c;
    if (rows.length > MAX_ROWS + 1) break;
  }
  row.push(cell); if (row.some(x => x !== '')) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}
function parseJson(text) {
  const s = String(text).trim();
  if (!s) return [];
  if (s[0] !== '[' && s[0] !== '{') return [];
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v;
    for (const k of ['tickets', 'users', 'contacts', 'organizations', 'articles', 'data', 'results', 'items']) if (Array.isArray(v[k])) return v[k];
    return [v];
  } catch {
    // NDJSON (Zendesk incremental exports): one object per line
    return s.split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
}
function parse(format, text) {
  const rows = format === 'json' ? parseJson(text) : parseCsv(text);
  return rows.slice(0, MAX_ROWS);
}

// ── Columns: the usual names in each tool, case and accents ignored ──
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '');
const ALIASES = {
  id: ['id', 'ticketid', 'ticketnumber', 'number', 'numero', 'ref', 'reference', 'externalid', 'iddisplayed'],
  subject: ['subject', 'title', 'titre', 'sujet', 'objet', 'summary', 'name', 'nom'],
  description: ['description', 'descriptiontext', 'content', 'contenu', 'body', 'message', 'details', 'issue', 'texte'],
  status: ['status', 'statut', 'state', 'etat', 'stateid', 'statusname'],
  priority: ['priority', 'priorite', 'urgency', 'urgence', 'priorityname', 'priorityid'],
  email: ['requesteremail', 'requester', 'email', 'mail', 'demandeur', 'requestermail', 'customeremail', 'contactemail', 'from', 'emailaddress', 'customer', 'useremail', 'demandeuremail', 'emaildemandeur', 'emaildudemandeur', 'requesteremailaddress', 'contactmail', 'courriel'],
  name: ['requestername', 'contactname', 'customername', 'nomdudemandeur', 'fullname', 'displayname', 'username', 'firstname'],
  organization: ['organization', 'organisation', 'organizationname', 'company', 'societe', 'entreprise', 'entity', 'entite', 'companyname'],
  domains: ['domains', 'domaines', 'domainnames', 'domain'],
  created: ['createdat', 'created', 'creation', 'datecreation', 'opendate', 'dateouverture', 'datedouverture', 'datedeouverture', 'createdtime', 'date'],
  closed: ['closedat', 'solvedat', 'resolvedat', 'closedate', 'solvedate', 'datefermeture', 'dateresolution', 'datederesolution', 'datedefermeture', 'closedtime'],
  category: ['category', 'categorie', 'type', 'group', 'groupe', 'itilcategory', 'section', 'folder'],
  answer: ['answer', 'reponse', 'body', 'content', 'contenu', 'solution', 'descriptiontext', 'description', 'text'],
  question: ['question', 'title', 'titre', 'subject', 'sujet', 'name'],
  comments: ['comments', 'conversations', 'messages', 'articles', 'thread', 'followups', 'suivis'],
};
function pick(row, key) {
  const want = ALIASES[key];
  const flat = {};
  const walk = (o, pre = '') => { for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, `${pre}${k}`); else flat[norm(`${pre}${k}`)] = v; } };
  walk(row);
  for (const a of want) if (flat[a] !== undefined && flat[a] !== null && flat[a] !== '') return flat[a];
  return null;
}
const text = (v, max) => (v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/\r\n/g, '\n').trim().slice(0, max));

// Statuses and priorities of each tool → Datick
const CLOSED_WORDS = new Set(['closed', 'solved', 'resolved', 'ferme', 'clos', 'resolu', 'done', 'archived']);
function isClosed(source, v) {
  const s = norm(v);
  if (source === 'glpi') return s === '5' || s === '6' || CLOSED_WORDS.has(s); // GLPI: 5 solved, 6 closed
  if (source === 'freshdesk') return s === '4' || s === '5' || CLOSED_WORDS.has(s); // Freshdesk: 4 resolved, 5 closed
  return CLOSED_WORDS.has(s);
}
function priorityOf(v) {
  const s = norm(v);
  if (['urgent', 'urgente', 'high', 'haute', 'veryhigh', 'treshaute', 'major', 'majeure', 'critical', 'critique', '4', '5', '6'].includes(s)) return 'urgent';
  if (['low', 'basse', 'faible', 'verylow', 'tresbasse', '1'].includes(s)) return 'low';
  return 'normal';
}
const dateOf = v => {
  if (!v) return null;
  const n = Number(v);
  const d = Number.isFinite(n) && String(v).length >= 10 && !/[-/]/.test(String(v)) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) || d.getFullYear() < 1990 ? null : d;
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Writing ──
async function seen(db, source, kind, extId) {
  if (!extId) return null;
  const [r] = await db('SELECT local_id FROM import_refs WHERE source = ? AND kind = ? AND external_id = ?', [source, kind, String(extId).slice(0, 64)]);
  return r ? r.local_id : null;
}
const remember = (db, source, kind, extId, localId) => (extId ? db('INSERT IGNORE INTO import_refs (source, kind, external_id, local_id) VALUES (?, ?, ?, ?)', [source, kind, String(extId).slice(0, 64), localId]) : null);

async function orgId(db, name, cache) {
  const n = text(name, 100);
  if (!n) return null;
  if (cache.has(n)) return cache.get(n);
  let [o] = await db('SELECT id FROM organizations WHERE name = ?', [n]);
  if (!o) o = { id: (await db('INSERT INTO organizations (name) VALUES (?)', [n])).insertId };
  cache.set(n, o.id);
  return o.id;
}
// The requester known by their e-mail address: the identity e-mail tickets use (utils/emailTickets.js)
async function requester(db, email, name) {
  const address = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(address)) return null;
  const owner = require('./emailTickets').ownerIdFor(address);
  await db('INSERT INTO email_contacts (owner_id, address, name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = COALESCE(name, VALUES(name))', [owner, address, text(name, 100) || null]);
  return { owner, address, tag: text(name, 100) || address };
}

async function importRows(db, { source, kind, rows, dryRun = false }) {
  if (!SOURCES.includes(source)) return { error: 'Outil inconnu' };
  if (!KINDS.includes(kind)) return { error: 'Type d\'import inconnu' };
  const out = { rows: rows.length, created: 0, skipped: 0, errors: [] };
  const orgs = new Map();
  const { newVirtualChannelId } = require('./virtualChannel');
  for (const [i, row] of rows.entries()) {
    try {
      const extId = text(pick(row, 'id'), 64) || null;
      if (await seen(db, source, kind, extId)) { out.skipped++; continue; }
      if (kind === 'organizations') {
        const name = text(pick(row, 'organization') || pick(row, 'subject'), 100);
        if (!name) { out.errors.push(`Ligne ${i + 1} : nom manquant`); continue; }
        if (dryRun) { out.created++; continue; }
        const id = await orgId(db, name, orgs);
        const domains = text(pick(row, 'domains'), 500).split(/[\s,;]+/).map(d => d.toLowerCase().replace(/^@/, '')).filter(d => /^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(d)).slice(0, 20);
        for (const d of domains) await db('INSERT IGNORE INTO organization_domains (domain, organization_id) VALUES (?, ?)', [d, id]);
        await remember(db, source, kind, extId, id); out.created++;
      } else if (kind === 'contacts') {
        const email = pick(row, 'email');
        if (!EMAIL_RE.test(String(email || '').trim())) { out.errors.push(`Ligne ${i + 1} : adresse e-mail manquante ou invalide`); continue; }
        if (dryRun) { out.created++; continue; }
        const who = await requester(db, email, pick(row, 'name'));
        const [ci] = await db('SELECT contact_id FROM contact_identities WHERE value = ?', [who.owner]);
        let cid = ci?.contact_id;
        if (!cid) {
          cid = (await db('INSERT INTO contacts (display_name, email, seed) VALUES (?, ?, ?)', [who.tag, who.address, who.owner])).insertId;
          await db("INSERT IGNORE INTO contact_identities (value, contact_id, kind, label) VALUES (?, ?, 'email', ?)", [who.owner, cid, who.address]);
        }
        const org = pick(row, 'organization');
        if (org) await db('UPDATE contacts SET organization_id = ?, org_manual = 1 WHERE id = ?', [await orgId(db, org, orgs), cid]);
        await remember(db, source, kind, extId, cid); out.created++;
      } else if (kind === 'articles') {
        const question = text(pick(row, 'question'), 200), answer = text(pick(row, 'answer'), 5000);
        if (!question || !answer) { out.errors.push(`Ligne ${i + 1} : titre ou contenu manquant`); continue; }
        if (dryRun) { out.created++; continue; }
        // Imported as drafts: the staff checks them before anyone reads them
        const id = (await db("INSERT INTO faq_entries (question, answer, keywords, category, visibility, status, created_by_tag) VALUES (?, ?, '', ?, 'members', 'draft', ?)",
          [question, answer.replace(/<[^>]+>/g, ''), text(pick(row, 'category'), 80), `Import ${source}`])).insertId;
        await remember(db, source, kind, extId, id); out.created++;
      } else {
        const subject = text(pick(row, 'subject'), 100) || '(sans sujet)';
        if (!EMAIL_RE.test(String(pick(row, 'email') || '').trim().toLowerCase())) { out.errors.push(`Ligne ${i + 1} : adresse du demandeur manquante ou invalide`); continue; }
        if (dryRun) { out.created++; continue; }
        const who = await requester(db, pick(row, 'email'), pick(row, 'name'));
        const closed = isClosed(source, pick(row, 'status'));
        const created = dateOf(pick(row, 'created')) || new Date();
        const closedAt = closed ? (dateOf(pick(row, 'closed')) || created) : null;
        const org = pick(row, 'organization');
        const id = (await db(`INSERT INTO tickets (channel_id, owner_id, owner_tag, subject, status, priority, created_at, closed_at, closed_by_tag, last_message_at, stage_changed_at, organization_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [newVirtualChannelId(), who.owner, who.tag, subject, closed ? 'closed' : 'open', priorityOf(pick(row, 'priority')), created, closedAt,
          closed ? `Import ${source}` : null, created, created, org ? await orgId(db, org, orgs) : null])).insertId;
        const desc = text(pick(row, 'description'), 20000).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
        if (desc) await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source, created_at) VALUES (?, ?, ?, ?, 'user', ?)", [id, who.owner, who.tag, desc.slice(0, 20000), created]);
        // The conversation, when the export carries it (JSON): each message with its author
        const comments = pick(row, 'comments');
        const list = Array.isArray(comments) ? comments : typeof comments === 'string' ? parseJsonField(comments, []) : [];
        for (const c of (Array.isArray(list) ? list : []).slice(0, 500)) {
          const body = text(c?.body || c?.plain_body || c?.content || c?.text || c?.description, 20000).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
          if (!body) continue;
          const internal = c?.public === false || c?.private === true || c?.internal === true || c?.is_private === true;
          const fromStaff = internal || c?.incoming === false || ['agent', 'staff', 'admin'].includes(String(c?.author_role || c?.sender || '').toLowerCase());
          const author = text(c?.author_name || c?.from || c?.author?.name || c?.user?.name, 100) || (fromStaff ? `Import ${source}` : who.tag);
          await db('INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [id, fromStaff ? 'import' : who.owner, author, body, internal ? 'system' : fromStaff ? 'reply' : 'user', dateOf(c?.created_at || c?.date) || created]);
        }
        await remember(db, source, kind, extId, id); out.created++;
      }
    } catch (err) { out.errors.push(`Ligne ${i + 1} : ${err.message}`); }
    if (out.errors.length > 50) { out.errors.push('Trop d\'erreurs : import arrêté'); break; }
  }
  if (!dryRun && kind === 'contacts') await require('./organizations').attachByDomain(db).catch(() => null);
  out.errors = out.errors.slice(0, 50);
  return out;
}

module.exports = { SOURCES, KINDS, parse, parseCsv, parseJson, pick, isClosed, priorityOf, importRows };

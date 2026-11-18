// Public API v2 (v4.1): same keys as v1 (tb_<space>_<64 hex>, Authorization: Bearer), with the
// space of the key, contacts, attachments and cursor pagination. v1 stays as it is.
// Lists answer { data: [...], next_cursor }: pass next_cursor back as ?cursor= for the next page,
// null at the end. Confidential tickets never leave through a key; contacts need read_contacts.
const express = require('express');
const router = express.Router();
const v1 = require('./apiV1');
const { globalQuery } = require('../../utils/globalDb');
const { NOT_CONFIDENTIAL } = v1;

const ENDPOINTS = [];
const requirePerm = perm => (req, res, next) =>
  !perm || req.apiKey.permissions.has(perm) ? next() : res.status(403).json({ error: `Permission requise : ${perm}` });
function endpoint(doc, handler) {
  ENDPOINTS.push(doc);
  router[doc.method](doc.path.replace(/\{(\w+)\}/g, ':$1'), requirePerm(doc.perm), async (req, res) => {
    try { await handler(req, res); } catch (err) { console.error('api v2:', err.message); if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' }); }
  });
}

// ── Cursor pagination: an opaque token holding the last ID of the page ──
const encodeCursor = id => Buffer.from(JSON.stringify({ id })).toString('base64url');
function decodeCursor(value) {
  if (value === undefined || value === '') return { id: null };
  try {
    const { id } = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    return Number.isInteger(id) && id > 0 ? { id } : { error: true };
  } catch { return { error: true }; }
}
function pageParams(req, res) {
  const limit = req.query.limit === undefined ? 50 : parseInt(req.query.limit);
  if (!(limit >= 1 && limit <= 100)) { res.status(400).json({ error: 'limit : entre 1 et 100' }); return null; }
  const cursor = decodeCursor(req.query.cursor);
  if (cursor.error) { res.status(400).json({ error: 'Curseur invalide' }); return null; }
  return { limit, after: cursor.id };
}
// rows fetched with limit + 1: the extra one tells whether a next page exists
const page = (rows, limit) => ({ data: rows.slice(0, limit), next_cursor: rows.length > limit ? encodeCursor(rows[limit - 1].id) : null });
const PAGE_QUERY = [
  { name: 'limit', type: 'integer', description: 'Éléments par page, de 1 à 100 (50 par défaut)' },
  { name: 'cursor', description: 'La valeur `next_cursor` de la page précédente' },
];

const kindOf = id => (/^mail:/.test(id) ? 'email' : /^web:/.test(id) ? 'web' : 'discord');
const TICKET_COLS = `t.id, t.status, t.stage, t.subject, t.priority, t.owner_id, t.owner_tag, t.claimed_by, t.created_at, t.closed_at, t.closed_by_tag, t.last_message_at,
  (SELECT ci.contact_id FROM contact_identities ci WHERE ci.value = t.owner_id) AS contact_id`;
async function shapeTickets(db, rows) {
  if (!rows.length) return [];
  const tags = await db('SELECT a.ticket_id, g.name FROM ticket_tag_assignments a JOIN ticket_tags g ON g.id = a.tag_id WHERE a.ticket_id IN (?)', [rows.map(r => r.id)]);
  return rows.map(({ owner_id, owner_tag, ...t }) => ({
    ...t, owner: { id: owner_id, tag: owner_tag, kind: kindOf(owner_id) },
    tags: tags.filter(x => x.ticket_id === t.id).map(x => x.name),
  }));
}
const TICKET_EXAMPLE = {
  id: 42, status: 'open', stage: 'in_progress', subject: 'Paiement', priority: 'normal', claimed_by: '234567890123456789',
  created_at: '2026-10-18T09:12:00.000Z', closed_at: null, closed_by_tag: null, last_message_at: '2026-10-18T10:02:00.000Z', contact_id: 7,
  owner: { id: 'mail:3f0c9a1b2c3d4e5f60718293', tag: 'client@example.com', kind: 'email' }, tags: ['Remboursement'],
};

// Public, no key needed: the description of this API
router.get('/openapi.json', (req, res) => res.json(buildOpenApi(require('../../utils/instance').instanceName(req.app.locals.client))));

router.use(v1.apiKeyAuth);

endpoint({
  method: 'get', path: '/space', perm: null, summary: 'L\'espace de la clé',
  description: 'L\'espace auquel la clé donne accès : identifiant, nom, serveur Discord relié ou non, et les permissions de la clé. Aucune permission requise.',
  example: { id: '123456789012345678', name: 'Support', discord: true, created_at: '2026-01-04T10:00:00.000Z', permissions: ['read_tickets', 'read_contacts'] },
}, async (req, res) => {
  const [g] = await globalQuery('SELECT guild_id, guild_name, created_at FROM guilds WHERE guild_id = ?', [req.guildId]).catch(() => []);
  res.json({
    id: req.guildId, name: g?.guild_name || req.guildId, discord: await require('../../utils/spaces').hasDiscord(req.guildId),
    created_at: g?.created_at || null, permissions: [...req.apiKey.permissions],
  });
});

endpoint({
  method: 'get', path: '/tickets', perm: 'read_tickets', summary: 'Lister les tickets',
  description: 'Tickets de l\'espace, du plus récent au plus ancien, page par page (curseur). Chaque ticket porte son demandeur (`owner.kind` : `discord`, `email` ou `web`), sa fiche contact et ses tags. Les tickets confidentiels ne sont jamais accessibles par l\'API.',
  query: [{ name: 'status', enum: ['open', 'closed'], description: 'Filtrer par statut' }, { name: 'contact_id', type: 'integer', description: 'Tickets d\'une fiche contact' }, ...PAGE_QUERY],
  example: { data: [TICKET_EXAMPLE], next_cursor: 'eyJpZCI6NDJ9' },
  errors: [400],
}, async (req, res) => {
  const p = pageParams(req, res);
  if (!p) return;
  const { status } = req.query;
  if (status && status !== 'open' && status !== 'closed') return res.status(400).json({ error: 'Statut invalide' });
  const contactId = req.query.contact_id !== undefined ? parseInt(req.query.contact_id) : null;
  if (req.query.contact_id !== undefined && !(contactId > 0)) return res.status(400).json({ error: 'contact_id invalide' });
  const where = [NOT_CONFIDENTIAL.replace(/visibility_grade_id/g, 't.visibility_grade_id')], params = [];
  if (status) { where.push('t.status = ?'); params.push(status); }
  if (contactId) { where.push('t.owner_id IN (SELECT value FROM contact_identities WHERE contact_id = ?)'); params.push(contactId); }
  if (p.after) { where.push('t.id < ?'); params.push(p.after); }
  const rows = await req.guildDb(`SELECT ${TICKET_COLS} FROM tickets t WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT ?`, [...params, p.limit + 1]);
  const out = page(rows, p.limit);
  res.json({ ...out, data: await shapeTickets(req.guildDb, out.data) });
});

async function ticketOf(req, res) {
  const id = parseInt(req.params.id);
  const [t] = id > 0 ? await req.guildDb(`SELECT ${TICKET_COLS} FROM tickets t WHERE t.id = ? AND ${NOT_CONFIDENTIAL.replace(/visibility_grade_id/g, 't.visibility_grade_id')}`, [id]) : [];
  if (!t) { res.status(404).json({ error: 'Ticket introuvable' }); return null; }
  return t;
}

endpoint({
  method: 'get', path: '/tickets/{id}', perm: 'read_tickets', summary: 'Détail d\'un ticket, ses messages et ses pièces jointes',
  description: 'Le ticket, ses messages dans l\'ordre (`source` : `user` demandeur, `reply` réponse du staff, `web` note interne, `discord` message du salon, `scheduled`, `system`) et la liste de ses pièces jointes.',
  params: [{ name: 'id', type: 'integer', description: 'Numéro du ticket' }],
  example: { ...TICKET_EXAMPLE, messages: [{ id: 901, author_id: 'mail:3f0c9a1b2c3d4e5f60718293', author_tag: 'client@example.com', content: 'Mon paiement est refusé', source: 'user', created_at: '2026-10-18T09:12:00.000Z' }], attachments: [{ id: 3, filename: 'facture.pdf', content_type: 'application/pdf', size: 48213, message_id: 901, created_at: '2026-10-18T09:12:00.000Z' }] },
  errors: [404],
}, async (req, res) => {
  const t = await ticketOf(req, res);
  if (!t) return;
  const [ticket] = await shapeTickets(req.guildDb, [t]);
  const messages = await req.guildDb('SELECT id, author_id, author_tag, content, source, created_at FROM ticket_notes WHERE ticket_id = ? ORDER BY created_at ASC, id ASC', [t.id]);
  res.json({ ...ticket, messages, attachments: await attachmentsOf(req.guildDb, t.id) });
});

async function attachmentsOf(db, ticketId) {
  return (await db('SELECT id, filename, content_type, size, note_id, created_at FROM email_attachments WHERE ticket_id = ? ORDER BY id', [ticketId]).catch(() => []))
    .map(({ note_id, ...a }) => ({ ...a, message_id: note_id }));
}

endpoint({
  method: 'get', path: '/tickets/{id}/attachments/{fileId}', perm: 'read_tickets', summary: 'Télécharger une pièce jointe',
  description: 'Le fichier, toujours envoyé en téléchargement (`application/octet-stream`), jamais interprété par le navigateur.',
  params: [{ name: 'id', type: 'integer', description: 'Numéro du ticket' }, { name: 'fileId', type: 'integer', description: 'Identifiant de la pièce jointe' }],
  example: '(contenu du fichier)',
  errors: [404],
}, async (req, res) => {
  const t = await ticketOf(req, res);
  if (!t) return;
  const found = await require('../../utils/emailAttachments').fileFor(req.guildDb, req.guildId, t.id, parseInt(req.params.fileId) || 0);
  if (!found) return res.status(404).json({ error: 'Fichier introuvable' });
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(found.row.filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  res.sendFile(found.file);
});

endpoint({
  method: 'post', path: '/tickets/{id}/close', perm: 'close_tickets', summary: 'Fermer un ticket',
  description: 'Comme en v1 : ferme le ticket comme depuis le dashboard (transcript, message de fermeture et demande de note au demandeur), au nom de la clé.',
  params: [{ name: 'id', type: 'integer', description: 'Numéro du ticket' }],
  example: { ok: true },
  errors: [400, 404],
}, async (req, res) => {
  await v1.closeHandler(req, res); // same code as v1: one place for the closing rules
});

// ── Contacts ──
async function shapeContacts(db, rows) {
  if (!rows.length) return [];
  const ids = await db('SELECT contact_id, value, kind, label FROM contact_identities WHERE contact_id IN (?) ORDER BY created_at', [rows.map(r => r.id)]);
  return rows.map(c => ({ ...c, identities: ids.filter(i => i.contact_id === c.id).map(({ contact_id, ...i }) => i) }));
}
const CONTACT_EXAMPLE = { id: 7, display_name: 'Camille', email: 'client@example.com', created_at: '2026-10-02T08:00:00.000Z', identities: [{ value: 'mail:3f0c9a1b2c3d4e5f60718293', kind: 'email', label: 'client@example.com' }, { value: '123456789012345678', kind: 'discord', label: 'camille' }] };

endpoint({
  method: 'get', path: '/contacts', perm: 'read_contacts', summary: 'Lister les contacts',
  description: 'Les fiches contacts de l\'espace (une par personne, avec ses identités Discord, e-mail et web), de la plus récente à la plus ancienne. Les notes internes du staff ne sont pas exposées.',
  query: [{ name: 'q', description: 'Recherche dans le nom et l\'adresse e-mail' }, ...PAGE_QUERY],
  example: { data: [CONTACT_EXAMPLE], next_cursor: null },
  errors: [400],
}, async (req, res) => {
  const p = pageParams(req, res);
  if (!p) return;
  await require('../../utils/contacts').sync(req.guildDb, { key: `api:${req.guildId}` }); // its own throttle: never delays the dashboard's
  const where = [], params = [];
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q) { where.push('(display_name LIKE ? OR email LIKE ?)'); const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`; params.push(like, like); }
  if (p.after) { where.push('id < ?'); params.push(p.after); }
  const rows = await req.guildDb(`SELECT id, display_name, email, created_at FROM contacts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`, [...params, p.limit + 1]);
  const out = page(rows, p.limit);
  res.json({ ...out, data: await shapeContacts(req.guildDb, out.data) });
});

endpoint({
  method: 'get', path: '/contacts/{id}', perm: 'read_contacts', summary: 'Une fiche contact',
  description: 'La fiche, ses identités et le nombre de ses tickets (hors confidentiels). Ses tickets : `GET /tickets?contact_id=…` (permission `read_tickets`).',
  params: [{ name: 'id', type: 'integer', description: 'Identifiant du contact' }],
  example: { ...CONTACT_EXAMPLE, tickets: { open: 1, total: 3 } },
  errors: [404],
}, async (req, res) => {
  const [c] = await req.guildDb('SELECT id, display_name, email, created_at FROM contacts WHERE id = ?', [parseInt(req.params.id) || 0]);
  if (!c) return res.status(404).json({ error: 'Contact introuvable' });
  const [contact] = await shapeContacts(req.guildDb, [c]);
  const [n] = await req.guildDb(`SELECT COUNT(*) AS total, SUM(status = 'open') AS open FROM tickets WHERE owner_id IN (SELECT value FROM contact_identities WHERE contact_id = ?) AND ${NOT_CONFIDENTIAL}`, [c.id]);
  res.json({ ...contact, tickets: { open: Number(n.open || 0), total: Number(n.total || 0) } });
});

endpoint({
  method: 'get', path: '/stats', perm: 'read_stats', summary: 'Statistiques globales',
  description: 'Comme en v1 : nombre de tickets (total, ouverts, fermés) et note moyenne.',
  example: { tickets: { total: 340, open: 12, closed: 328 }, ratings: { count: 120, average: 4.42 } },
}, async (req, res) => {
  await v1.statsHandler(req, res);
});

function buildOpenApi(name = 'Datick') {
  return v1.makeOpenApi({
    endpoints: ENDPOINTS, version: 2, title: `${name} — API publique v2`,
    description: 'Les mêmes clés que la v1 (page « Clés API »), dans l\'en-tête `Authorization: Bearer <clé>`. Les listes répondent `{ "data": [...], "next_cursor": "…" }` : repasse `next_cursor` en `?cursor=` pour la page suivante (`null` à la fin). La v1 reste disponible sans changement.',
  });
}

module.exports = router;
module.exports.ENDPOINTS = ENDPOINTS;
module.exports.buildOpenApi = buildOpenApi;

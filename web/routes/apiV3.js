// Public API v3 (v5.0, conception/v5.md §3.18): everything of v2 (read), plus writing — open a
// ticket for someone, answer, add an internal note, change status, priority, team, assignees, tags,
// fields and copies. Same keys (tb_<space>_<64 hex>), three new permissions: create_tickets,
// reply_tickets, update_tickets. Confidential tickets are never reachable through a key.
// An API key acts under its own name (« API · <key> »), source « api » in the log; it never counts as
// a staff member in the statistics.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const v1 = require('./apiV1');
const v2 = require('./apiV2');
const { recordEvent } = require('../../utils/audit');
const { allowBurst } = require('../../utils/rateLimit');
const { broadcast } = require('../../utils/sse');
const { NOT_CONFIDENTIAL } = v1;

const ENDPOINTS = [];
const requirePerm = perm => (req, res, next) => (!perm || req.apiKey.permissions.has(perm) ? next() : res.status(403).json({ error: `Permission requise : ${perm}` }));
// Writes: 120 per minute and per key
const writeLimit = async (req, res, next) => ((await allowBurst(`apiw:${req.guildId}:${req.apiKey.id}`, 120, 60 * 1000)) ? next() : res.status(429).json({ error: 'Trop de requêtes pour cette clé' }));
function endpoint(doc, ...handlers) {
  ENDPOINTS.push(doc);
  const handler = handlers.pop();
  router[doc.method](doc.path.replace(/\{(\w+)\}/g, ':$1'), requirePerm(doc.perm), writeLimit, ...handlers, async (req, res) => {
    try { await handler(req, res); } catch (err) { console.error('api v3:', err.message); if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' }); }
  });
}

const actorOf = req => ({ id: `api:${req.apiKey.id}`, tag: `API · ${req.apiKey.name}`, username: `API · ${req.apiKey.name}`, source: 'api' });
const tmOf = req => require('../../utils/ticketManager').createManager(req.guildDb, req.app.locals.client, req.guildId);
async function openTicketOf(req, res, { open = true } = {}) {
  const id = parseInt(req.params.id);
  const [t] = id > 0 ? await req.guildDb(`SELECT * FROM tickets WHERE id = ? AND ${NOT_CONFIDENTIAL}`, [id]) : [];
  if (!t) { res.status(404).json({ error: 'Ticket introuvable' }); return null; }
  if (open && t.status !== 'open') { res.status(400).json({ error: 'Ticket fermé' }); return null; }
  return t;
}
async function ticketView(req, id) {
  const [t] = await req.guildDb(`SELECT ${v2.TICKET_COLS}, t.team_id FROM tickets t WHERE t.id = ?`, [id]);
  const [shaped] = await v2.shapeTickets(req.guildDb, [t]);
  const assignees = (await req.guildDb('SELECT user_id FROM ticket_assignees WHERE ticket_id = ? ORDER BY assigned_at', [id]).catch(() => [])).map(a => a.user_id);
  const cc = (await require('../../utils/ticketCc').listCc(req.guildDb, id)).map(c => c.address);
  const fields = Object.fromEntries((await req.guildDb('SELECT field_id, value FROM ticket_field_values WHERE ticket_id = ?', [id]).catch(() => [])).map(f => [f.field_id, f.value]));
  return { ...shaped, team_id: t.team_id || null, assignees, cc, fields };
}
const TICKET_OUT = {
  id: 87, status: 'open', stage: 'open', subject: 'Commande 1287 non reçue', priority: 'normal', claimed_by: null, created_at: '2026-11-18T09:12:00.000Z', closed_at: null,
  closed_by_tag: null, last_message_at: '2026-11-18T09:12:00.000Z', contact_id: 12, owner: { id: 'mail:3f0c9a1b2c3d4e5f60718293', tag: 'client@example.com', kind: 'email' },
  tags: ['Livraison'], team_id: 2, assignees: ['234567890123456789'], cc: ['adjoint@example.com'], fields: { 3: '1287' },
};

// ── Open a ticket ──
const PRIORITIES = ['low', 'normal', 'urgent'];
endpoint({
  method: 'post', path: '/tickets', perm: 'create_tickets', summary: 'Ouvrir un ticket',
  description: 'Ouvre un ticket au nom d\'une personne, identifiée par son adresse e-mail : comme si elle avait écrit au support (règles, équipe, attribution automatique, accusé de réception par e-mail si `notify` n\'est pas `false`). Facultatif : priorité, tags (par nom), copies, champs personnalisés (par identifiant). L\'en-tête `Idempotency-Key` évite un doublon si la requête est rejouée (24 h).',
  body: { requester: { email: 'client@example.com', name: 'Camille' }, subject: 'Commande 1287 non reçue', message: 'Bonjour, ma commande n\'est pas arrivée.', priority: 'normal', tags: ['Livraison'], cc: ['adjoint@example.com'], fields: { 3: '1287' }, notify: true },
  example: TICKET_OUT, errors: [400],
}, async (req, res) => {
  const b = req.body || {};
  const email = require('../../utils/emailTickets');
  const address = String(b.requester?.email || '').trim().toLowerCase();
  if (!email.EMAIL_RE.test(address) || address.length > 254) return res.status(400).json({ error: 'requester.email : adresse e-mail invalide' });
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!message || message.length > 4000) return res.status(400).json({ error: 'message : requis, 4000 caractères au plus' });
  const subject = typeof b.subject === 'string' ? b.subject.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100) : '';
  if (b.priority !== undefined && !PRIORITIES.includes(b.priority)) return res.status(400).json({ error: `priority : ${PRIORITIES.join(', ')}` });
  const name = typeof b.requester?.name === 'string' ? b.requester.name.replace(/[\r\n\t"<>]+/g, ' ').trim().slice(0, 100) : null;
  const check = await checkChanges(req, { tags_add: b.tags, fields: b.fields, cc_add: b.cc });
  if (check.error) return res.status(400).json({ error: check.error });
  const emailRe = require('../../utils/emailTickets').EMAIL_RE;
  if (check.value.cc_add.some(c => !emailRe.test(String(c).trim().toLowerCase()))) return res.status(400).json({ error: 'cc : adresse e-mail invalide' });
  if (check.value.cc_add.length > 10) return res.status(400).json({ error: 'cc : 10 copies au plus' });

  // A replayed request (network retry) gives back the ticket it opened
  const idem = typeof req.get('Idempotency-Key') === 'string' && req.get('Idempotency-Key').slice(0, 200);
  const redis = require('../../utils/redis').getRedis();
  const idemKey = idem && `idem:${req.guildId}:${req.apiKey.id}:${crypto.createHash('sha256').update(idem).digest('hex')}`;
  if (idemKey) {
    const prev = await redis.get(idemKey).catch(() => null);
    if (prev) { res.setHeader('Idempotent-Replayed', 'true'); return res.json(await ticketView(req, Number(prev))); }
  }
  const ownerId = email.ownerIdFor(address);
  if (await require('../../utils/guildScan').isBlacklistedIn(req.guildDb, ownerId)) return res.status(403).json({ error: 'Cette personne est sur la liste noire de l\'espace' });
  await email.upsertContact(req.guildDb, address, name);
  const user = email.userFor(ownerId, address, name, req.guildId);
  const tm = tmOf(req);
  const r = await tm.createTicket(user, message, [], subject || null, { forceNew: true });
  if (!r?.ticket) return res.status(409).json({ error: 'Ticket impossible à ouvrir' });
  const id = r.ticket.id;
  if (idemKey) await redis.set(idemKey, String(id), 'EX', 24 * 3600).catch(() => null);
  await recordEvent(req.guildDb, { actor: actorOf(req), action: 'ticket_open_api', ticketId: id, details: { requester: address } });
  const [fresh] = await req.guildDb('SELECT * FROM tickets WHERE id = ?', [id]);
  await applyChanges(req, fresh, { priority: b.priority, ...check.value });
  if (b.notify !== false) await tm.sendWelcomeDm(user, true, subject || null, id).catch(() => null);
  res.json(await ticketView(req, id));
});

// ── Answer and note ──
const replyUpload = (req, res, next) => (req.is('multipart/form-data')
  ? require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 5 } }).single('file')(req, res, e => (e ? res.status(413).json({ error: 'Fichier trop volumineux (8 Mo au plus)' }) : next()))
  : next());
endpoint({
  method: 'post', path: '/tickets/{id}/reply', perm: 'reply_tickets', summary: 'Répondre au demandeur',
  description: 'Envoie une réponse au demandeur par son canal (MP Discord, e-mail avec ses copies, espace web), comme depuis le dashboard, au nom de la clé (`anonymous: true` : « Support »). Un fichier peut être joint en `multipart/form-data` (champ `file`, 8 Mo au plus, avec `message`).',
  params: [{ name: 'id', type: 'integer', description: 'Numéro du ticket' }],
  body: { message: 'Votre colis est reparti ce matin.', anonymous: false },
  example: { ok: true, note_id: 4211 }, errors: [400, 404],
}, replyUpload, async (req, res) => {
  const t = await openTicketOf(req, res);
  if (!t) return;
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if ((!message && !req.file) || message.length > 4000) return res.status(400).json({ error: 'message : requis (ou un fichier), 4000 caractères au plus' });
  const anonymous = req.body?.anonymous === true || req.body?.anonymous === 'true';
  const upload = req.file ? { buffer: req.file.buffer, name: String(req.file.originalname || 'fichier').slice(0, 100) } : null;
  // The dashboard's own reply: Discord channel, every linked person, history, first response, log
  const fakeReq = { app: req.app, guildId: req.guildId, guildDb: req.guildDb };
  await require('./tickets').sendStaffReply(fakeReq, t, { content: message, anonymous, upload, actor: actorOf(req) });
  const [note] = await req.guildDb("SELECT MAX(id) AS id FROM ticket_notes WHERE ticket_id = ? AND source = 'reply'", [t.id]);
  res.json({ ok: true, note_id: note?.id || null });
});

endpoint({
  method: 'post', path: '/tickets/{id}/notes', perm: 'reply_tickets', summary: 'Ajouter une note interne',
  description: 'Une note visible du staff seulement, jamais envoyée au demandeur.',
  params: [{ name: 'id', type: 'integer', description: 'Numéro du ticket' }],
  body: { message: 'Le transporteur confirme une livraison demain.' },
  example: { ok: true, note_id: 4212 }, errors: [400, 404],
}, async (req, res) => {
  const t = await openTicketOf(req, res, { open: false });
  if (!t) return;
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > 2000) return res.status(400).json({ error: 'message : requis, 2000 caractères au plus' });
  const a = actorOf(req);
  const { insertId } = await req.guildDb("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, 'web')", [t.id, a.id, a.tag, message]);
  await recordEvent(req.guildDb, { actor: a, action: 'ticket_note', ticketId: t.id, details: { excerpt: message.slice(0, 120) } });
  broadcast('note', { ticketId: t.id, note: { id: insertId, ticket_id: t.id, author_id: a.id, author_tag: a.tag, content: message, source: 'web', created_at: new Date() } }, req.guildId);
  res.json({ ok: true, note_id: insertId });
});

// ── Changes ──
// Checked before anything is written: { value } or { error }
async function checkChanges(req, b) {
  const db = req.guildDb;
  const out = {};
  if (b.priority !== undefined) {
    if (!PRIORITIES.includes(b.priority)) return { error: `priority : ${PRIORITIES.join(', ')}` };
    out.priority = b.priority;
  }
  if (b.stage !== undefined) {
    if (!(await require('../../utils/stages').stageOf(db, String(b.stage)))) return { error: 'stage : statut inconnu (open, waiting, in_progress ou s_<id> d\'un statut de l\'espace)' };
    out.stage = String(b.stage);
  }
  if (b.team_id !== undefined) {
    if (b.team_id !== null && !(await require('../../utils/teams').teamOf(db, Number(b.team_id)))) return { error: 'team_id : équipe introuvable' };
    out.team_id = b.team_id === null ? null : Number(b.team_id);
  }
  const list = (v, name, max = 20) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > max) throw Object.assign(new Error(`${name} : liste de ${max} éléments au plus`), { status: 400 });
    return v.map(String);
  };
  try {
    out.assignees_add = list(b.assignees_add, 'assignees_add', 10);
    out.assignees_remove = list(b.assignees_remove, 'assignees_remove', 10);
    out.tags_add = list(b.tags_add, 'tags_add');
    out.tags_remove = list(b.tags_remove, 'tags_remove');
    out.cc_add = list(b.cc_add, 'cc_add', 10);
    out.cc_remove = list(b.cc_remove, 'cc_remove', 10);
  } catch (e) { return { error: e.message }; }
  if (out.assignees_add.length) {
    const staff = await db("SELECT user_id, username FROM dashboard_users WHERE user_id IN (?) AND role IN ('support', 'fondateur')", [out.assignees_add]);
    if (staff.length !== new Set(out.assignees_add).size) return { error: 'assignees_add : seul le staff de l\'espace peut être attribué' };
    out.staff = staff;
  }
  const tags = new Map((await db('SELECT id, name FROM ticket_tags')).map(x => [x.name.toLowerCase(), x.id]));
  for (const n of [...out.tags_add, ...out.tags_remove]) if (!tags.has(n.toLowerCase())) return { error: `Tag inconnu : ${n}` };
  out.tagIds = { add: out.tags_add.map(n => tags.get(n.toLowerCase())), remove: out.tags_remove.map(n => tags.get(n.toLowerCase())) };
  if (b.fields !== undefined) {
    if (!b.fields || typeof b.fields !== 'object' || Array.isArray(b.fields)) return { error: 'fields : objet { identifiant: valeur }' };
    const known = new Map((await db('SELECT id, type FROM ticket_fields')).map(f => [String(f.id), f]));
    for (const [id, v] of Object.entries(b.fields)) {
      const f = known.get(String(id));
      if (!f) return { error: `fields : champ ${id} inconnu` };
      if (v !== null && v !== '' && (typeof v !== 'string' || v.length > 200)) return { error: `fields.${id} : texte de 200 caractères au plus` };
      if (v && f.type === 'number' && !Number.isFinite(Number(String(v).replace(',', '.')))) return { error: `fields.${id} : un nombre est attendu` };
    }
    out.fields = b.fields;
  }
  return { value: out };
}

// The copies depend on the ticket (its requester, its channel, how many it has): checked against it
async function checkCc(req, t, list = []) {
  const [n] = await req.guildDb('SELECT COUNT(*) AS n FROM ticket_cc WHERE ticket_id = ?', [t.id]);
  if (Number(n.n) + list.length > 10) return 'cc_add : 10 copies au plus par ticket';
  for (const address of list) {
    const r = await require('../../utils/ticketCc').addCc(req.guildDb, t, { address }, 'api', { dryRun: true });
    if (r.error) return `cc_add (${address}) : ${r.error}`;
  }
  return null;
}

async function applyChanges(req, t, c) {
  const db = req.guildDb, a = actorOf(req), tm = tmOf(req);
  // The status first: it is the one change that can still fail (no Discord category for it…),
  // and then nothing else has been written
  if (c.stage && c.stage !== t.stage) {
    const r = await tm.moveToStage(t.id, c.stage, a);
    if (!r.ok) throw Object.assign(new Error(r.error || 'Changement de statut impossible'), { status: 400 });
  }
  if (c.priority && c.priority !== t.priority) await tm.setPriority(t.id, c.priority, a);
  if (c.team_id !== undefined) {
    if (c.team_id === null) {
      await db('UPDATE tickets SET team_id = NULL WHERE id = ?', [t.id]);
      await recordEvent(db, { actor: a, action: 'ticket_team', ticketId: t.id, details: { team: null } });
    } else {
      await require('../../utils/teams').routeTicket({ db, tm, ticket: t, teamId: c.team_id, actor: a });
    }
  }
  for (const s of c.staff || []) await tm.addAssignee(t.id, { id: s.user_id, username: s.username }, a);
  for (const uid of c.assignees_remove || []) await tm.removeAssignee(t.id, uid, a);
  for (const tagId of c.tagIds?.add || []) {
    if ((await db('INSERT IGNORE INTO ticket_tag_assignments (ticket_id, tag_id) VALUES (?, ?)', [t.id, tagId])).affectedRows) {
      await recordEvent(db, { actor: a, action: 'ticket_tag_add', ticketId: t.id, targetType: 'tag', targetId: tagId });
      await require('../../utils/channelVisibility').syncAfterTagChange(db, req.app.locals.client, req.guildId, t.id, tagId).catch(() => null);
    }
  }
  for (const tagId of c.tagIds?.remove || []) {
    if ((await db('DELETE FROM ticket_tag_assignments WHERE ticket_id = ? AND tag_id = ?', [t.id, tagId])).affectedRows) {
      await recordEvent(db, { actor: a, action: 'ticket_tag_remove', ticketId: t.id, targetType: 'tag', targetId: tagId });
      await require('../../utils/channelVisibility').syncAfterTagChange(db, req.app.locals.client, req.guildId, t.id, tagId).catch(() => null);
    }
  }
  if (c.fields) {
    const { saveFieldValues } = require('../../utils/ticketFields');
    for (const [id, v] of Object.entries(c.fields)) if (v === '' || v === null) await db('DELETE FROM ticket_field_values WHERE ticket_id = ? AND field_id = ?', [t.id, Number(id)]);
    await saveFieldValues(db, t.id, Object.fromEntries(Object.entries(c.fields).filter(([, v]) => v)));
    await recordEvent(db, { actor: a, action: 'ticket_fields_update', ticketId: t.id, details: { fields: Object.keys(c.fields) } });
  }
  const cc = require('../../utils/ticketCc');
  for (const address of c.cc_add || []) {
    const r = await cc.addCc(db, t, { address }, a.tag);
    if (r.error) throw Object.assign(new Error(`cc_add (${address}) : ${r.error}`), { status: 400 });
    if (r.added) await recordEvent(db, { actor: a, action: 'ticket_cc_add', ticketId: t.id, details: { address: r.address } });
  }
  for (const address of c.cc_remove || []) {
    const [row] = await db('SELECT id FROM ticket_cc WHERE ticket_id = ? AND address = ?', [t.id, String(address).trim().toLowerCase()]);
    if (row) { await cc.removeCc(db, t.id, row.id); await recordEvent(db, { actor: a, action: 'ticket_cc_remove', ticketId: t.id, details: { address } }); }
  }
  broadcast('ticket', { id: t.id }, req.guildId);
}

endpoint({
  method: 'patch', path: '/tickets/{id}', perm: 'update_tickets', summary: 'Modifier un ticket',
  description: 'Change ce qui est donné, le reste ne bouge pas : `priority` (low, normal, urgent), `stage` (open, waiting, in_progress ou le `s_<id>` d\'un statut de l\'espace), `team_id` (`null` : sans équipe ; une équipe qui attribue donne le ticket à l\'un de ses membres), `assignees_add` / `assignees_remove` (identifiants du staff), `tags_add` / `tags_remove` (noms), `fields` (`{ identifiant: valeur }`, `null` efface), `cc_add` / `cc_remove` (adresses, tickets par e-mail). Tout est vérifié avant d\'écrire : une erreur ne change rien. Chaque changement est au journal, au nom de la clé.',
  params: [{ name: 'id', type: 'integer', description: 'Numéro du ticket' }],
  body: { priority: 'urgent', stage: 'in_progress', team_id: 2, assignees_add: ['234567890123456789'], tags_add: ['VIP'], fields: { 3: '1287' }, cc_add: ['direction@example.com'] },
  example: TICKET_OUT, errors: [400, 404],
}, async (req, res) => {
  const t = await openTicketOf(req, res);
  if (!t) return;
  const check = await checkChanges(req, req.body || {});
  if (check.error) return res.status(400).json({ error: check.error });
  const ccErr = await checkCc(req, t, check.value.cc_add);
  if (ccErr) return res.status(400).json({ error: ccErr });
  try { await applyChanges(req, t, check.value); } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); throw err; }
  res.json(await ticketView(req, t.id));
});

function buildOpenApi(name = 'Datick') {
  return v1.makeOpenApi({
    endpoints: [...v2.ENDPOINTS, ...ENDPOINTS], version: 3, title: `${name} — API publique v3`,
    description: 'Tout ce que fait la v2, plus l\'écriture : ouvrir un ticket, répondre, noter, modifier. Les mêmes clés (page « Clés API »), dans l\'en-tête `Authorization: Bearer <clé>` ; les écritures demandent les permissions `create_tickets`, `reply_tickets` ou `update_tickets`, et sont limitées à 120 par minute et par clé. Une clé agit à son nom (« API · <nom de la clé> »), visible dans le journal. Les tickets confidentiels ne sont jamais accessibles. Les v2 et v1 restent disponibles sans changement.',
  });
}

const app = express.Router();
app.get('/openapi.json', (req, res) => res.json(buildOpenApi(require('../../utils/instance').instanceName(req.app.locals.client))));
app.use(v2);      // the key is checked there (and req.apiKey set); its reads answer here too
app.use(router);  // the writes

module.exports = app;
module.exports.ENDPOINTS = ENDPOINTS;
module.exports.buildOpenApi = buildOpenApi;

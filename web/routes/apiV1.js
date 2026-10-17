// Public API authenticated by per-guild API keys (created in the dashboard, "Clés API").
// Key format: tb_<guildId>_<64 hex>. Send it as `Authorization: Bearer <key>`.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb } = require('../../utils/tenantDb');
const { createManager } = require('../../utils/ticketManager');
const { broadcast } = require('../../utils/sse');
const { recordEvent } = require('../../utils/audit');

const KEY_RE = /^tb_(\d{17,20})_[a-f0-9]{64}$/;

async function apiKeyAuth(req, res, next) {
  const key = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const match = KEY_RE.exec(key);
  if (!match) return res.status(401).json({ error: 'Clé API manquante ou invalide' });

  try {
    const guildId = match[1];
    const [guild] = await globalQuery(
      'SELECT guild_id FROM guilds WHERE guild_id = ? AND status = "active" AND maintenance_mode = 0',
      [guildId]
    );
    if (!guild) return res.status(401).json({ error: 'Clé API invalide' });

    const db = getTenantDb(guildId);
    const [cfg] = await db('SELECT api_keys_enabled FROM guild_config LIMIT 1');
    if (!cfg?.api_keys_enabled) return res.status(403).json({ error: 'API désactivée pour ce serveur' });

    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const [row] = await db(
      'SELECT id, name, permissions, created_by FROM api_keys WHERE key_hash = ? AND active = 1 AND (expires_at IS NULL OR expires_at > NOW())',
      [keyHash]
    );
    if (!row) return res.status(401).json({ error: 'Clé API invalide, révoquée ou expirée' });

    db('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [row.id]).catch(() => null);
    let perms = [];
    try { perms = Array.isArray(row.permissions) ? row.permissions : JSON.parse(row.permissions || '[]'); } catch {}

    req.guildId = guildId;
    req.guildDb = db;
    req.apiKey  = { ...row, permissions: new Set(perms) };
    next();
  } catch (err) {
    console.error('apiKeyAuth error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

const requirePerm = perm => (req, res, next) =>
  req.apiKey.permissions.has(perm) ? next() : res.status(403).json({ error: `Permission requise : ${perm}` });

// Every endpoint is declared with its documentation: the OpenAPI description (GET /api/v1/openapi.json)
// and the dashboard's « Documentation API » page are generated from this list.
const ENDPOINTS = [];
function endpoint(doc, handler) {
  ENDPOINTS.push(doc);
  router[doc.method](doc.path.replace(/\{(\w+)\}/g, ':$1'), requirePerm(doc.perm), handler);
}

const TICKET_EXAMPLE = {
  id: 42, owner_id: '123456789012345678', owner_tag: 'membre', claimed_by: '234567890123456789', status: 'open',
  subject: 'Paiement', priority: 'normal', created_at: '2026-10-18T09:12:00.000Z', closed_at: null, closed_by_tag: null,
};

// Public, no key needed: the description of this API
router.get('/openapi.json', (req, res) => res.json(buildOpenApi()));

router.use(apiKeyAuth);

endpoint({
  method: 'get', path: '/tickets', perm: 'read_tickets', summary: 'Lister les tickets',
  description: 'Tickets du serveur de la clé, du plus récent au plus ancien, 50 par page.',
  query: [
    { name: 'status', enum: ['open', 'closed'], description: 'Filtrer par statut' },
    { name: 'page', type: 'integer', description: 'Page (à partir de 1)' },
  ],
  example: { tickets: [TICKET_EXAMPLE], total: 1, page: 1, pages: 1 },
}, async (req, res) => {
  const { status } = req.query;
  if (status && status !== 'open' && status !== 'closed') return res.status(400).json({ error: 'Statut invalide' });
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  try {
    const where = status ? 'WHERE status = ?' : '';
    const params = status ? [status] : [];
    const [tickets, [{ total }]] = await Promise.all([
      req.guildDb(
        `SELECT id, owner_id, owner_tag, claimed_by, status, subject, priority, created_at, closed_at, closed_by_tag
         FROM tickets ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
      ),
      req.guildDb(`SELECT COUNT(*) AS total FROM tickets ${where}`, params),
    ]);
    res.json({ tickets, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

endpoint({
  method: 'get', path: '/tickets/{id}', perm: 'read_tickets', summary: 'Détail d\'un ticket et ses messages',
  description: 'Le ticket et tous ses messages dans l\'ordre : `user` (membre), `reply` (réponse du staff), `web` (note interne), `discord` (message dans le salon), `scheduled`, `system`.',
  params: [{ name: 'id', type: 'integer', description: 'Numéro du ticket' }],
  example: { ...TICKET_EXAMPLE, messages: [{ author_id: '123456789012345678', author_tag: 'membre', content: 'Mon paiement est refusé', source: 'user', created_at: '2026-10-18T09:12:00.000Z' }] },
  errors: [404],
}, async (req, res) => {
  try {
    const [ticket] = await req.guildDb(
      `SELECT id, owner_id, owner_tag, claimed_by, status, subject, priority, created_at, closed_at, closed_by_tag
       FROM tickets WHERE id = ?`,
      [parseInt(req.params.id)]
    );
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    const messages = await req.guildDb(
      'SELECT author_id, author_tag, content, source, created_at FROM ticket_notes WHERE ticket_id = ? ORDER BY created_at ASC',
      [ticket.id]
    );
    res.json({ ...ticket, messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

endpoint({
  method: 'post', path: '/tickets/{id}/close', perm: 'close_tickets', summary: 'Fermer un ticket',
  description: 'Ferme le ticket comme depuis le dashboard (transcript, MP de fermeture et demande de note au membre). La fermeture est tracée au nom de la clé et n\'entre pas dans les statistiques du staff.',
  params: [{ name: 'id', type: 'integer', description: 'Numéro du ticket' }],
  example: { ok: true },
  errors: [400, 404],
}, async (req, res) => {
  try {
    const [ticket] = await req.guildDb('SELECT id, channel_id, status FROM tickets WHERE id = ?', [parseInt(req.params.id)]);
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket déjà fermé' });

    // api: true keeps the closure out of staff stats (see closeTicketWithTranscript)
    const closedBy = { id: req.apiKey.created_by, tag: `API · ${req.apiKey.name}`, username: `API · ${req.apiKey.name}`, api: true };
    const client = req.app.locals.client;
    const channel = client && ticket.channel_id ? await client.channels.fetch(ticket.channel_id).catch(() => null) : null;
    if (channel) {
      await createManager(req.guildDb, client, req.guildId).closeTicketWithTranscript(channel, closedBy);
    } else {
      await req.guildDb(
        'UPDATE tickets SET status = "closed", closed_at = NOW(), closed_by_tag = ? WHERE id = ?',
        [closedBy.tag, ticket.id]
      );
      await recordEvent(req.guildDb, { actor: closedBy, action: 'ticket_close', ticketId: ticket.id, details: { via: 'api' } });
    }
    broadcast('ticket', { id: ticket.id, status: 'closed' }, req.guildId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

endpoint({
  method: 'get', path: '/stats', perm: 'read_stats', summary: 'Statistiques globales',
  description: 'Nombre de tickets (total, ouverts, fermés) et note moyenne donnée par les membres.',
  example: { tickets: { total: 340, open: 12, closed: 328 }, ratings: { count: 120, average: 4.42 } },
}, async (req, res) => {
  try {
    const [[counts], [rating]] = await Promise.all([
      req.guildDb(
        `SELECT COUNT(*) AS total, SUM(status = 'open') AS open, SUM(status = 'closed') AS closed FROM tickets`
      ),
      req.guildDb('SELECT AVG(rating) AS avg_rating, COUNT(*) AS ratings FROM ticket_ratings'),
    ]);
    res.json({
      tickets: { total: Number(counts.total), open: Number(counts.open || 0), closed: Number(counts.closed || 0) },
      ratings: { count: Number(rating.ratings), average: rating.avg_rating != null ? Number(Number(rating.avg_rating).toFixed(2)) : null },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const ERROR_TEXT = { 400: 'Requête invalide', 401: 'Clé manquante, invalide, révoquée ou expirée', 403: 'Permission manquante ou API désactivée', 404: 'Introuvable', 429: 'Trop de requêtes' };

function buildOpenApi() {
  const { config } = require('../../utils/config');
  let server = '/api/v1';
  try { server = new URL('/api/v1', config.dashboard?.discordCallbackUrl || config.webServerBaseUrl).toString(); } catch { /* relative */ }
  const paths = {};
  for (const e of ENDPOINTS) {
    const parameters = [
      ...(e.params || []).map(p => ({ name: p.name, in: 'path', required: true, description: p.description, schema: { type: p.type || 'string' } })),
      ...(e.query || []).map(q => ({ name: q.name, in: 'query', required: false, description: q.description, schema: q.enum ? { type: 'string', enum: q.enum } : { type: q.type || 'string' } })),
    ];
    const responses = { 200: { description: 'Succès', content: { 'application/json': { example: e.example } } } };
    for (const code of [401, 403, ...(e.errors || []), 429]) responses[code] = { description: ERROR_TEXT[code], content: { 'application/json': { example: { error: ERROR_TEXT[code] } } } };
    (paths[e.path] ||= {})[e.method] = {
      summary: e.summary, description: `${e.description}\n\nPermission de la clé : \`${e.perm}\`.`,
      'x-permission': e.perm, parameters, responses, security: [{ bearer: [] }],
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Ticket Bot — API publique', version: '1',
      description: 'Accès aux tickets d\'un serveur avec une clé API créée dans le dashboard (page « Clés API »). La clé désigne le serveur et porte ses permissions. Envoie-la dans l\'en-tête `Authorization: Bearer <clé>`. Limite : celle de l\'API du dashboard, par adresse IP.',
    },
    servers: [{ url: server }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Clé au format tb_<id du serveur>_<64 caractères hexadécimaux>' } } },
    paths,
  };
}

module.exports = router;
module.exports.ENDPOINTS = ENDPOINTS;
module.exports.buildOpenApi = buildOpenApi;

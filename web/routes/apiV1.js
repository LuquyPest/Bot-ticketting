// Public API authenticated by per-guild API keys (created in the dashboard, "Clés API").
// Key format: tb_<guildId>_<64 hex>. Send it as `Authorization: Bearer <key>`.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb } = require('../../utils/tenantDb');
const { createManager } = require('../../utils/ticketManager');
const { broadcast } = require('../../utils/sse');

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

router.use(apiKeyAuth);

// GET /api/v1/tickets?status=open|closed&page=1
router.get('/tickets', requirePerm('read_tickets'), async (req, res) => {
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

// GET /api/v1/tickets/:id — ticket + messages
router.get('/tickets/:id', requirePerm('read_tickets'), async (req, res) => {
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

// POST /api/v1/tickets/:id/close
router.post('/tickets/:id/close', requirePerm('close_tickets'), async (req, res) => {
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
    }
    broadcast('ticket', { id: ticket.id, status: 'closed' }, req.guildId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/v1/stats
router.get('/stats', requirePerm('read_stats'), async (req, res) => {
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

module.exports = router;

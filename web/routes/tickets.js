const express = require('express');
const router = express.Router();
const { query } = require('../../utils/db');

const VALID_STATUS   = new Set(['open', 'closed']);
const VALID_PRIORITY = new Set(['low', 'normal', 'urgent']);

router.get('/', async (req, res) => {
  try {
    const { status, priority, subject } = req.query;

    if (status   && !VALID_STATUS.has(status))   return res.status(400).json({ error: 'Statut invalide' });
    if (priority && !VALID_PRIORITY.has(priority)) return res.status(400).json({ error: 'Priorité invalide' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const isSupport = req.session.user.role === 'support';

    const where = [];
    const params = [];

    if (isSupport) {
      where.push('claimed_by = ?');
      params.push(req.session.user.id);
    }

    if (status)   { where.push('status = ?');       params.push(status); }
    if (priority) { where.push('priority = ?');      params.push(priority); }
    if (subject)  { where.push('subject LIKE ?');    params.push(`%${subject}%`); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [tickets, [{ total }]] = await Promise.all([
      query(
        `SELECT id, owner_id, owner_tag, channel_id, claimed_by, status, subject, priority, created_at, closed_at, closed_by_tag FROM tickets ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      query(`SELECT COUNT(*) as total FROM tickets ${whereClause}`, params)
    ]);

    res.json({ tickets, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [ticket] = await query('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    if (req.session.user.role === 'support' && ticket.claimed_by !== req.session.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const [participants, transcript, rating] = await Promise.all([
      query('SELECT user_id FROM ticket_participants WHERE ticket_id = ?', [ticket.id]),
      query('SELECT id, created_by_tag, created_at, message_count FROM transcript_snapshots WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1', [ticket.id]),
      query('SELECT rating, rated_at FROM ticket_ratings WHERE ticket_id = ? LIMIT 1', [ticket.id])
    ]);

    res.json({
      ...ticket,
      participants: participants.map(p => p.user_id),
      transcript: transcript[0] || null,
      rating: rating[0] || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id/priority', async (req, res) => {
  if (req.session.user.role !== 'fondateur') {
    return res.status(403).json({ error: 'Réservé au fondateur' });
  }
  try {
    const { priority } = req.body;
    if (!VALID_PRIORITY.has(priority)) {
      return res.status(400).json({ error: 'Priorité invalide' });
    }
    await query('UPDATE tickets SET priority = ? WHERE id = ?', [priority, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

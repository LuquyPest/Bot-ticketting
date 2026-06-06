const express = require('express');
const router = express.Router();
const { query } = require('../../utils/db');

router.get('/', async (req, res) => {
  try {
    const { status, priority, subject, page = 1 } = req.query;
    const limit = 20;
    const offset = (parseInt(page) - 1) * limit;

    const where = [];
    const params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (priority) { where.push('priority = ?'); params.push(priority); }
    if (subject) { where.push('subject LIKE ?'); params.push(`%${subject}%`); }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [tickets, [{ total }]] = await Promise.all([
      query(
        `SELECT id, owner_id, owner_tag, channel_id, claimed_by, status, subject, priority, created_at, closed_at, closed_by_tag FROM tickets ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      query(`SELECT COUNT(*) as total FROM tickets ${whereClause}`, params)
    ]);

    res.json({ tickets, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [ticket] = await query('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

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
    if (!['low', 'normal', 'urgent'].includes(priority)) {
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

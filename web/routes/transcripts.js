const express = require('express');
const router = express.Router();
const { query } = require('../../utils/db');

router.get('/', async (req, res) => {
  try {
    const { page = 1, ticketId, search } = req.query;
    const limit = 20;
    const offset = (parseInt(page) - 1) * limit;

    const where = [];
    const params = [];
    if (ticketId) { where.push('ts.ticket_id = ?'); params.push(ticketId); }
    if (search) { where.push('(t.owner_tag LIKE ? OR t.subject LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [snapshots, [{ total }]] = await Promise.all([
      query(
        `SELECT ts.id, ts.ticket_id, ts.created_by_tag, ts.created_at, ts.message_count, t.owner_tag, t.subject
         FROM transcript_snapshots ts JOIN tickets t ON t.id = ts.ticket_id
         ${whereClause} ORDER BY ts.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      query(
        `SELECT COUNT(*) as total FROM transcript_snapshots ts JOIN tickets t ON t.id = ts.ticket_id ${whereClause}`,
        params
      )
    ]);

    res.json({ snapshots, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/:id/html', async (req, res) => {
  try {
    const [snap] = await query('SELECT html FROM transcript_snapshots WHERE id = ?', [req.params.id]);
    if (!snap) return res.status(404).send('Introuvable');
    res.type('html').send(snap.html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur');
  }
});

router.get('/:id/txt', async (req, res) => {
  try {
    const [snap] = await query('SELECT txt, ticket_id FROM transcript_snapshots WHERE id = ?', [req.params.id]);
    if (!snap) return res.status(404).send('Introuvable');
    res.setHeader('Content-Disposition', `attachment; filename="transcript-${snap.ticket_id}.txt"`);
    res.type('text/plain').send(snap.txt);
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur');
  }
});

module.exports = router;

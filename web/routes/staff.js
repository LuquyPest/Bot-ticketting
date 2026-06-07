const express = require('express');
const router = express.Router();
const { query } = require('../../utils/db');

router.get('/', async (req, res) => {
  try {
    const user = req.session.user;
    const sql = 'SELECT admin_id, admin_tag, tickets_claimed, tickets_closed, total_ratings, total_rating_score, total_response_count, total_response_seconds, updated_at FROM admin_stats';

    const stats = user.role === 'support'
      ? await query(`${sql} WHERE admin_id = ?`, [user.id])
      : await query(`${sql} ORDER BY tickets_closed DESC`);

    res.json(stats.map(row => ({
      ...row,
      avgRating: row.total_ratings > 0
        ? (row.total_rating_score / row.total_ratings).toFixed(1)
        : null,
      avgResponseSeconds: row.total_response_count > 0
        ? Math.floor(row.total_response_seconds / row.total_response_count)
        : null
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Detailed stats for a single staff member
router.get('/:adminId', async (req, res) => {
  if (req.session.user.role !== 'fondateur') return res.status(403).json({ error: 'Réservé au fondateur' });
  try {
    const adminId = req.params.adminId;
    const [stats] = await query(
      'SELECT admin_id, admin_tag, tickets_claimed, tickets_closed, total_ratings, total_rating_score, total_response_count, total_response_seconds, updated_at FROM admin_stats WHERE admin_id = ?',
      [adminId]
    );
    if (!stats) return res.status(404).json({ error: 'Membre introuvable' });

    // Per-day ticket closures for last 30 days (by tag, best proxy we have)
    const activity = await query(
      `SELECT DATE_FORMAT(closed_at, '%Y-%m-%d') as day, COUNT(*) as count
       FROM tickets
       WHERE closed_by_tag = ? AND closed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND status = 'closed'
       GROUP BY day ORDER BY day ASC`,
      [stats.admin_tag]
    );

    // Recent closed tickets
    const recentTickets = await query(
      `SELECT id, owner_tag, subject, priority, closed_at, created_at
       FROM tickets WHERE closed_by_tag = ? AND status = 'closed'
       ORDER BY closed_at DESC LIMIT 10`,
      [stats.admin_tag]
    );

    res.json({
      ...stats,
      avgRating: stats.total_ratings > 0 ? (stats.total_rating_score / stats.total_ratings).toFixed(1) : null,
      avgResponseSeconds: stats.total_response_count > 0 ? Math.floor(stats.total_response_seconds / stats.total_response_count) : null,
      activity,
      recentTickets
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

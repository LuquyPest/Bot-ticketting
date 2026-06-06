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

module.exports = router;

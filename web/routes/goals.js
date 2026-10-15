const express = require('express');
const router = express.Router();

// GET /api/goals — current user's goal for this month
router.get('/', async (req, res) => {
  const userId = req.session.user.id;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  try {
    const cfg = await req.guildDb('SELECT monthly_goals_enabled FROM guild_config LIMIT 1');
    if (!cfg[0]?.monthly_goals_enabled) return res.json({ enabled: false });

    const [[goal], [achieved]] = await Promise.all([
      req.guildDb(
        'SELECT target FROM monthly_goals WHERE user_id = ? AND year = ? AND month = ?',
        [userId, year, month]
      ),
      req.guildDb(
        `SELECT COUNT(DISTINCT ticket_id) as cnt FROM ticket_notes
         WHERE author_id = ? AND source NOT IN ('user','scheduled')
         AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
        [userId]
      ),
    ]);

    res.json({
      enabled: true,
      year, month,
      target: goal?.target ?? 50,
      achieved: achieved?.cnt ?? 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

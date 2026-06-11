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

// PATCH /api/goals — update goal target (fondateur only)
router.patch('/', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Accès refusé' });
  const { userId, year, month, target } = req.body;
  if (!userId || !Number.isInteger(target) || target < 1 || target > 9999)
    return res.status(400).json({ error: 'Paramètres invalides' });

  const y = year || new Date().getFullYear();
  const m = month || new Date().getMonth() + 1;

  try {
    await req.guildDb(
      `INSERT INTO monthly_goals (user_id, year, month, target) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE target = VALUES(target)`,
      [userId, y, m, target]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/goals/team — all staff goals for current month (fondateur)
router.get('/team', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Accès refusé' });
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  try {
    const staff = await req.guildDb(
      `SELECT u.user_id, u.username, u.role,
              COALESCE(g.target, 50) as target,
              COUNT(DISTINCT n.ticket_id) as achieved
       FROM dashboard_users u
       LEFT JOIN monthly_goals g ON g.user_id = u.user_id AND g.year = ? AND g.month = ?
       LEFT JOIN ticket_notes n ON n.author_id = u.user_id
         AND n.source NOT IN ('user','scheduled')
         AND n.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
       WHERE u.role IN ('support','fondateur')
       GROUP BY u.user_id, u.username, u.role, g.target
       ORDER BY achieved DESC`,
      [year, month]
    );
    res.json(staff);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

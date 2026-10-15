const express = require('express');
const router = express.Router();
const { globalQuery }   = require('../../utils/globalDb');

// GET /api/login-logs — own login history (or all logs for fondateur)
router.get('/', async (req, res) => {
  const userId = req.session.user.id;
  const isFondateur = req.userIsFondateur;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    // login_logs is global: a fondateur only sees the members of their own guild
    const members = isFondateur
      ? (await req.guildDb('SELECT user_id FROM dashboard_users')).map(r => r.user_id)
      : [];
    const rows = isFondateur
      ? await globalQuery(
          `SELECT * FROM login_logs WHERE user_id IN (?) ORDER BY created_at DESC LIMIT ?`,
          [members.length ? members : ['0'], limit]
        )
      : await globalQuery(
          `SELECT * FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
          [userId, limit]
        );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

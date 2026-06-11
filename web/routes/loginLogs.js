const express = require('express');
const router = express.Router();
const { globalQuery } = require('../../utils/globalDb');

// GET /api/login-logs — own login history (or all logs for fondateur)
router.get('/', async (req, res) => {
  const userId = req.session.user.id;
  const isFondateur = req.userIsFondateur;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    const rows = isFondateur
      ? await globalQuery(
          `SELECT * FROM login_logs ORDER BY created_at DESC LIMIT ?`,
          [limit]
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

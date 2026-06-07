const express = require('express');
const router = express.Router();
const { query } = require('../../utils/db');

const SNOWFLAKE_RE = /^\d{17,20}$/;

router.get('/', async (req, res) => {
  try {
    const list = await query('SELECT * FROM blacklist ORDER BY added_at DESC');
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { userId, userTag, reason } = req.body;
    if (!userId || !userTag) return res.status(400).json({ error: 'userId et userTag requis' });

    if (!SNOWFLAKE_RE.test(userId)) return res.status(400).json({ error: 'userId invalide' });
    if (typeof userTag !== 'string' || userTag.length > 100) return res.status(400).json({ error: 'userTag invalide' });
    if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > 500)) {
      return res.status(400).json({ error: 'La raison ne peut pas dépasser 500 caractères' });
    }

    const adminTag = req.session.user.username;
    const adminId = req.session.user.id;

    await query(
      `INSERT INTO blacklist (user_id, user_tag, reason, added_by_id, added_by_tag)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason), added_by_id = VALUES(added_by_id), added_by_tag = VALUES(added_by_tag), added_at = NOW()`,
      [userId, userTag, reason || null, adminId, adminTag]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:userId', async (req, res) => {
  if (!SNOWFLAKE_RE.test(req.params.userId)) {
    return res.status(400).json({ error: 'userId invalide' });
  }
  try {
    await query('DELETE FROM blacklist WHERE user_id = ?', [req.params.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

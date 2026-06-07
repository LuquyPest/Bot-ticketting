const express = require('express');
const router = express.Router();
const { query } = require('../../utils/db');

const SNOWFLAKE_RE = /^\d{17,20}$/;
const VALID_DURATIONS = { '1d': 1, '7d': 7, '30d': 30, 'permanent': null };

router.get('/', async (req, res) => {
  try {
    // Auto-expire: remove entries whose expires_at has passed
    await query('DELETE FROM blacklist WHERE expires_at IS NOT NULL AND expires_at <= NOW()');
    const list = await query('SELECT * FROM blacklist ORDER BY added_at DESC');
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { userId, userTag, reason, duration } = req.body;
    if (!userId || !userTag) return res.status(400).json({ error: 'userId et userTag requis' });
    if (!SNOWFLAKE_RE.test(userId)) return res.status(400).json({ error: 'userId invalide' });
    if (typeof userTag !== 'string' || userTag.length > 100) return res.status(400).json({ error: 'userTag invalide' });
    if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > 500)) {
      return res.status(400).json({ error: 'La raison ne peut pas dépasser 500 caractères' });
    }

    let expiresAt = null;
    if (duration && duration !== 'permanent') {
      const days = VALID_DURATIONS[duration];
      if (days == null && duration !== 'permanent') {
        return res.status(400).json({ error: 'Durée invalide (1d, 7d, 30d, permanent)' });
      }
      if (days) {
        const d = new Date();
        d.setDate(d.getDate() + days);
        expiresAt = d;
      }
    }

    const adminTag = req.session.user.username;
    const adminId = req.session.user.id;

    await query(
      `INSERT INTO blacklist (user_id, user_tag, reason, added_by_id, added_by_tag, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason), added_by_id = VALUES(added_by_id),
         added_by_tag = VALUES(added_by_tag), added_at = NOW(), expires_at = VALUES(expires_at)`,
      [userId, userTag, reason || null, adminId, adminTag, expiresAt]
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

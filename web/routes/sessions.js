const express = require('express');
const router  = express.Router();
const { globalQuery } = require('../../utils/globalDb');

// GET /api/sessions — list active sessions for the logged-in user
router.get('/', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const sessions = await globalQuery(
      `SELECT session_id, ip, user_agent, created_at, last_seen_at
       FROM user_sessions WHERE user_id = ? ORDER BY last_seen_at DESC`,
      [req.session.user.id]
    );
    const currentSid = req.session.id;
    res.json(sessions.map(s => ({
      sessionId:   s.session_id,
      ip:          s.ip,
      userAgent:   s.user_agent,
      createdAt:   s.created_at,
      lastSeenAt:  s.last_seen_at,
      isCurrent:   s.session_id === currentSid,
    })));
  } catch (err) {
    console.error('sessions list error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/sessions/:sessionId — revoke a specific session
router.delete('/:sessionId', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  const { sessionId } = req.params;
  try {
    const [row] = await globalQuery(
      'SELECT user_id FROM user_sessions WHERE session_id = ?',
      [sessionId]
    );
    if (!row || row.user_id !== req.session.user.id) {
      return res.status(404).json({ error: 'Session introuvable' });
    }

    // Remove from MySQL session store
    await globalQuery('DELETE FROM web_sessions WHERE session_id = ?', [sessionId]);
    // Remove from our tracking table
    await globalQuery('DELETE FROM user_sessions WHERE session_id = ?', [sessionId]);

    res.json({ ok: true });
  } catch (err) {
    console.error('sessions delete error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/sessions — revoke all other sessions
router.delete('/', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  const currentSid = req.session.id;
  try {
    const others = await globalQuery(
      'SELECT session_id FROM user_sessions WHERE user_id = ? AND session_id != ?',
      [req.session.user.id, currentSid]
    );
    for (const { session_id } of others) {
      await globalQuery('DELETE FROM web_sessions WHERE session_id = ?', [session_id]).catch(() => null);
    }
    await globalQuery(
      'DELETE FROM user_sessions WHERE user_id = ? AND session_id != ?',
      [req.session.user.id, currentSid]
    );
    res.json({ ok: true, revoked: others.length });
  } catch (err) {
    console.error('sessions revoke-all error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

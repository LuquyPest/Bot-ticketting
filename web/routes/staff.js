const express = require('express');
const router = express.Router();

// GET /api/staff/me/activity?days=7|30|90 — the signed-in member's own figures
// GET / PUT /api/staff/me/signature { signature } — my signature under my e-mail replies in this
// space (markdown, 1000 characters at most; never under an anonymous reply)
router.get('/me/signature', async (req, res) => {
  const [u] = await req.guildDb('SELECT email_signature FROM dashboard_users WHERE user_id = ?', [req.session.user.id]).catch(() => []);
  res.json({ signature: u?.email_signature || '' });
});
router.put('/me/signature', async (req, res) => {
  if (req.session.user?.demo) return res.status(403).json({ error: 'Indisponible dans la démonstration', demo: true });
  const { cleanSignature } = require('../../utils/emailFormat');
  if (typeof req.body?.signature !== 'string') return res.status(400).json({ error: 'signature invalide' });
  const signature = cleanSignature(req.body.signature);
  await req.guildDb('UPDATE dashboard_users SET email_signature = ? WHERE user_id = ?', [signature || null, req.session.user.id]);
  res.json({ signature });
});

router.get('/me/activity', async (req, res) => {
  try {
    const days = [7, 30, 90].includes(parseInt(req.query.days)) ? parseInt(req.query.days) : 30;
    res.json(await require('../../utils/myActivity').myActivity(req.guildDb, req.session.user.id, days));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/', async (req, res) => {
  try {
    const user = req.session.user;
    const sql = 'SELECT admin_id, admin_tag, tickets_claimed, tickets_closed, total_ratings, total_rating_score, total_response_count, total_response_seconds, updated_at FROM admin_stats';

    const stats = user.role === 'support'
      ? await req.guildDb(`${sql} WHERE admin_id = ?`, [user.id])
      : await req.guildDb(`${sql} ORDER BY tickets_closed DESC`);

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

router.get('/:adminId', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  try {
    const [stats] = await req.guildDb(
      'SELECT admin_id, admin_tag, tickets_claimed, tickets_closed, total_ratings, total_rating_score, total_response_count, total_response_seconds, updated_at FROM admin_stats WHERE admin_id = ?',
      [req.params.adminId]
    );
    if (!stats) return res.status(404).json({ error: 'Membre introuvable' });

    const [activity, recentTickets] = await Promise.all([
      req.guildDb(
        `SELECT DATE_FORMAT(closed_at, '%Y-%m-%d') as day, COUNT(*) as count
         FROM tickets
         WHERE closed_by_tag = ? AND closed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND status = 'closed'
         GROUP BY day ORDER BY day ASC`,
        [stats.admin_tag]
      ),
      req.guildDb(
        `SELECT id, owner_tag, subject, priority, closed_at, created_at
         FROM tickets WHERE closed_by_tag = ? AND status = 'closed'
         ORDER BY closed_at DESC LIMIT 10`,
        [stats.admin_tag]
      )
    ]);

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

const express = require('express');
const router = express.Router();

router.get('/stats', async (req, res) => {
  try {
    const [[open], [closed], [unclaimed], [openedToday], [closedToday], [avgResp], [avgResolution], [avgRat], [claimRate], priorities] =
      await Promise.all([
        req.guildDb('SELECT COUNT(*) as c FROM tickets WHERE status = "open"'),
        req.guildDb('SELECT COUNT(*) as c FROM tickets WHERE status = "closed"'),
        req.guildDb('SELECT COUNT(*) as c FROM tickets WHERE status = "open" AND claimed_by IS NULL'),
        req.guildDb('SELECT COUNT(*) as c FROM tickets WHERE DATE(created_at) = CURDATE()'),
        req.guildDb('SELECT COUNT(*) as c FROM tickets WHERE DATE(closed_at) = CURDATE()'),
        req.guildDb('SELECT AVG(TIMESTAMPDIFF(SECOND, created_at, first_response_at)) as v FROM tickets WHERE first_response_at IS NOT NULL'),
        req.guildDb('SELECT AVG(TIMESTAMPDIFF(SECOND, created_at, closed_at)) as v FROM tickets WHERE status = "closed" AND closed_at IS NOT NULL'),
        req.guildDb('SELECT AVG(rating) as v, COUNT(*) as c FROM ticket_ratings'),
        req.guildDb('SELECT COUNT(*) as total, SUM(CASE WHEN claimed_by IS NOT NULL THEN 1 ELSE 0 END) as claimed FROM tickets WHERE status = "open"'),
        req.guildDb('SELECT priority, COUNT(*) as count FROM tickets GROUP BY priority')
      ]);

    const priorityMap = { low: 0, normal: 0, urgent: 0 };
    priorities.forEach(p => { priorityMap[p.priority] = p.count; });

    const claimRatePct = claimRate.total > 0
      ? Math.round((claimRate.claimed / claimRate.total) * 100)
      : 0;

    res.json({
      openTickets:          open.c,
      closedTickets:        closed.c,
      unclaimedTickets:     unclaimed.c,
      openedToday:          openedToday.c,
      closedToday:          closedToday.c,
      avgResponseSeconds:   Math.floor(avgResp.v || 0),
      avgResolutionSeconds: Math.floor(avgResolution.v || 0),
      avgRating:            avgRat.v ? parseFloat(avgRat.v).toFixed(1) : null,
      totalRatings:         avgRat.c,
      claimRate:            claimRatePct,
      priorityBreakdown:    priorityMap
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/activity', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const [opened, closed, unclaimed] = await Promise.all([
      req.guildDb(
        "SELECT DATE_FORMAT(created_at, '%Y-%m-%d') as date, COUNT(*) as count FROM tickets WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY DATE(created_at) ORDER BY date ASC",
        [days]
      ),
      req.guildDb(
        "SELECT DATE_FORMAT(closed_at, '%Y-%m-%d') as date, COUNT(*) as count FROM tickets WHERE closed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY DATE(closed_at) ORDER BY date ASC",
        [days]
      ),
      req.guildDb(
        "SELECT DATE_FORMAT(created_at, '%Y-%m-%d') as date, COUNT(*) as count FROM tickets WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) AND claimed_by IS NULL AND status = 'open' GROUP BY DATE(created_at) ORDER BY date ASC",
        [days]
      )
    ]);
    res.json({ opened, closed, unclaimed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/heatmap', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const rows = await req.guildDb(
      "SELECT HOUR(created_at) as hour, COUNT(*) as count FROM tickets WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY HOUR(created_at) ORDER BY hour ASC",
      [days]
    );
    const map = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    rows.forEach(r => { map[r.hour].count = r.count; });
    res.json(map);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/top-staff', async (req, res) => {
  try {
    const rows = await req.guildDb(
      `SELECT admin_id, admin_tag, tickets_closed, tickets_claimed,
              total_ratings, total_rating_score, updated_at
       FROM admin_stats
       WHERE updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       ORDER BY tickets_closed DESC LIMIT 3`
    );
    res.json(rows.map(r => ({
      ...r,
      avgRating: r.total_ratings > 0 ? (r.total_rating_score / r.total_ratings).toFixed(1) : null
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/pending', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 4;
    const tickets = await req.guildDb(
      `SELECT id, owner_tag, subject, priority, last_message_at, created_at
       FROM tickets
       WHERE status = 'open'
         AND claimed_by = ?
         AND (last_message_at IS NULL OR last_message_at < DATE_SUB(NOW(), INTERVAL ? HOUR))
       ORDER BY COALESCE(last_message_at, created_at) ASC`,
      [req.session.user.id, hours]
    );
    res.json(tickets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/recent', async (req, res) => {
  try {
    const { status } = req.query;
    const validStatus = new Set(['open', 'closed']);
    const user = req.session.user;

    let where = '';
    const params = [];

    if (user.role === 'support') {
      where = 'WHERE claimed_by = ?';
      params.push(user.id);
      if (status && validStatus.has(status)) {
        where += ' AND status = ?';
        params.push(status);
      }
    } else if (status && validStatus.has(status)) {
      where = 'WHERE status = ?';
      params.push(status);
    }

    const tickets = await req.guildDb(
      `SELECT id, owner_tag, subject, status, priority, created_at FROM tickets ${where} ORDER BY created_at DESC LIMIT 10`,
      params
    );
    res.json(tickets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Leaderboard — respects leaderboard_enabled flag
router.get('/leaderboard', async (req, res) => {
  try {
    const cfg = await req.guildDb('SELECT leaderboard_enabled FROM guild_config LIMIT 1');
    if (!cfg[0]?.leaderboard_enabled) return res.json({ enabled: false, staff: [] });

    const period = req.query.period === 'week' ? '7 DAY' : 'MONTH';
    const staff = await req.guildDb(
      `SELECT n.author_id as userId, n.author_tag as username,
              COUNT(DISTINCT n.ticket_id) as ticketsHandled,
              ROUND(AVG(tr.rating), 1) as avgRating
       FROM ticket_notes n
       LEFT JOIN ticket_ratings tr ON tr.closed_by_id = n.author_id
         AND tr.rated_at >= DATE_SUB(NOW(), INTERVAL 1 ${period})
       WHERE n.source NOT IN ('user','scheduled')
         AND n.created_at >= DATE_SUB(NOW(), INTERVAL 1 ${period})
       GROUP BY n.author_id, n.author_tag
       ORDER BY ticketsHandled DESC
       LIMIT 10`
    );
    res.json({ enabled: true, staff });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

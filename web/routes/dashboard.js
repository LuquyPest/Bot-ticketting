const express = require('express');
const router = express.Router();
const { query } = require('../../utils/db');

router.get('/stats', async (req, res) => {
  try {
    const [[open], [closed], [openedToday], [closedToday], [avgResp], [avgRat]] =
      await Promise.all([
        query('SELECT COUNT(*) as c FROM tickets WHERE status = "open"'),
        query('SELECT COUNT(*) as c FROM tickets WHERE status = "closed"'),
        query('SELECT COUNT(*) as c FROM tickets WHERE DATE(created_at) = CURDATE()'),
        query('SELECT COUNT(*) as c FROM tickets WHERE DATE(closed_at) = CURDATE()'),
        query('SELECT AVG(TIMESTAMPDIFF(SECOND, created_at, first_response_at)) as v FROM tickets WHERE first_response_at IS NOT NULL'),
        query('SELECT AVG(rating) as v, COUNT(*) as c FROM ticket_ratings')
      ]);

    res.json({
      openTickets: open.c,
      closedTickets: closed.c,
      openedToday: openedToday.c,
      closedToday: closedToday.c,
      avgResponseSeconds: Math.floor(avgResp.v || 0),
      avgRating: avgRat.v ? parseFloat(avgRat.v).toFixed(1) : null,
      totalRatings: avgRat.c
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/activity', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const [opened, closed] = await Promise.all([
      query(
        'SELECT DATE(created_at) as date, COUNT(*) as count FROM tickets WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY DATE(created_at) ORDER BY date ASC',
        [days]
      ),
      query(
        'SELECT DATE(closed_at) as date, COUNT(*) as count FROM tickets WHERE closed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY DATE(closed_at) ORDER BY date ASC',
        [days]
      )
    ]);
    res.json({ opened, closed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/recent', async (req, res) => {
  try {
    const tickets = await query(
      'SELECT id, owner_tag, subject, status, priority, created_at FROM tickets ORDER BY created_at DESC LIMIT 10'
    );
    res.json(tickets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

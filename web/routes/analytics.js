const express = require('express');
const router = express.Router();

// ── Volume chart: tickets opened/closed per day ───────────────────────────────
router.get('/volume', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 180);
    const [opened, closed] = await Promise.all([
      req.guildDb(
        `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') as date, COUNT(*) as count
         FROM tickets WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY DATE(created_at) ORDER BY date ASC`,
        [days]
      ),
      req.guildDb(
        `SELECT DATE_FORMAT(closed_at,'%Y-%m-%d') as date, COUNT(*) as count
         FROM tickets WHERE closed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY DATE(closed_at) ORDER BY date ASC`,
        [days]
      ),
    ]);
    res.json({ opened, closed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Hourly heatmap: tickets by hour of day ────────────────────────────────────
router.get('/hourly', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 180);
    const rows = await req.guildDb(
      `SELECT HOUR(created_at) as hour, COUNT(*) as count
       FROM tickets WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY HOUR(created_at) ORDER BY hour ASC`,
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

// ── Ticket distribution by subject ───────────────────────────────────────────
router.get('/subjects', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 180);
    const rows = await req.guildDb(
      `SELECT COALESCE(subject, '(sans sujet)') as subject, COUNT(*) as count
       FROM tickets WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY subject ORDER BY count DESC LIMIT 20`,
      [days]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Response time trend: avg first response per day ───────────────────────────
router.get('/response-trend', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 180);
    const rows = await req.guildDb(
      `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') as date,
              ROUND(AVG(TIMESTAMPDIFF(SECOND, created_at, first_response_at)) / 60) as avgMinutes
       FROM tickets
       WHERE first_response_at IS NOT NULL
         AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(created_at) ORDER BY date ASC`,
      [days]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── SLA view: open tickets with age buckets ───────────────────────────────────
router.get('/sla', async (req, res) => {
  try {
    const rows = await req.guildDb(
      `SELECT t.id, t.owner_tag, t.subject, t.priority, t.claimed_by,
              t.created_at, t.first_response_at,
              TIMESTAMPDIFF(MINUTE, t.created_at, NOW()) as age_minutes,
              TIMESTAMPDIFF(MINUTE, t.created_at, t.first_response_at) as first_response_minutes,
              u.username as claimer_name
       FROM tickets t
       LEFT JOIN dashboard_users u ON u.user_id = t.claimed_by
       WHERE t.status = 'open'
       ORDER BY t.created_at ASC`
    );

    const slaThresholds = { low: 60 * 24, normal: 60 * 8, urgent: 60 * 2 };

    const tickets = rows.map(t => {
      const thresh = slaThresholds[t.priority] ?? slaThresholds.normal;
      let slaStatus = 'ok';
      if (t.age_minutes > thresh * 2) slaStatus = 'critical';
      else if (t.age_minutes > thresh) slaStatus = 'warning';
      else if (t.age_minutes > thresh * 0.75) slaStatus = 'approaching';
      return { ...t, slaStatus };
    });

    res.json(tickets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Staff comparison table ────────────────────────────────────────────────────
router.get('/staff-compare', async (req, res) => {
  try {
    // INTERVAL unit must be a SQL keyword — cannot be parameterized.
    // The frozen map is the authoritative allowlist; any value not present falls back to 'month'.
    // Never interpolate req.query.period directly.
    const PERIOD_MAP = Object.freeze({ today: 'DAY', week: '7 DAY', month: 'MONTH', all: null });
    const period = Object.prototype.hasOwnProperty.call(PERIOD_MAP, req.query.period) ? req.query.period : 'month';
    const interval = PERIOD_MAP[period];

    const whereDate   = interval ? `AND n.created_at >= DATE_SUB(NOW(), INTERVAL 1 ${interval})` : '';
    const whereRating = interval ? `AND tr.rated_at   >= DATE_SUB(NOW(), INTERVAL 1 ${interval})` : '';
    const whereClose  = interval ? `AND t.closed_at   >= DATE_SUB(NOW(), INTERVAL 1 ${interval})` : '';

    const [notes, ratings, closures] = await Promise.all([
      req.guildDb(`
        SELECT n.author_id, n.author_tag,
               COUNT(DISTINCT n.ticket_id) as tickets_handled,
               COUNT(*) as total_notes,
               ROUND(AVG(TIMESTAMPDIFF(SECOND, t.created_at, t.first_response_at)) / 60) as avg_first_response_min
        FROM ticket_notes n
        JOIN tickets t ON t.id = n.ticket_id
        WHERE n.source NOT IN ('user', 'scheduled') ${whereDate}
        GROUP BY n.author_id, n.author_tag
      `),
      req.guildDb(`
        SELECT closed_by_id as author_id,
               ROUND(AVG(rating), 2) as avg_rating,
               COUNT(*) as rating_count
        FROM ticket_ratings tr WHERE 1=1 ${whereRating}
        GROUP BY closed_by_id
      `),
      req.guildDb(`
        SELECT claimed_by as author_id, COUNT(*) as closures
        FROM tickets t
        WHERE status = 'closed' AND claimed_by IS NOT NULL ${whereClose}
        GROUP BY claimed_by
      `),
    ]);

    const ratingMap = {};
    ratings.forEach(r => { ratingMap[r.author_id] = { avg: r.avg_rating, count: r.rating_count }; });
    const closureMap = {};
    closures.forEach(c => { closureMap[c.author_id] = c.closures; });

    const staffList = notes.map((n, idx) => ({
      rank: idx + 1,
      userId: n.author_id,
      username: n.author_tag,
      ticketsHandled: n.tickets_handled,
      totalNotes: n.total_notes,
      closures: closureMap[n.author_id] || 0,
      avgRating: ratingMap[n.author_id]?.avg || null,
      ratingCount: ratingMap[n.author_id]?.count || 0,
      avgFirstResponseMin: n.avg_first_response_min,
    })).sort((a, b) => b.ticketsHandled - a.ticketsHandled)
      .map((s, i) => ({ ...s, rank: i + 1 }));

    res.json(staffList);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Full-text search ──────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);
  if (q.length > 100) return res.status(400).json({ error: 'Recherche trop longue (max 100 caractères)' });

  try {
    const like = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    const rows = await req.guildDb(
      `SELECT t.id, t.owner_tag, t.subject, t.status, t.priority, t.created_at, t.closed_at,
              n.content as matched_note, n.author_tag as note_author, n.source as note_source,
              n.created_at as note_at
       FROM tickets t
       LEFT JOIN ticket_notes n ON n.ticket_id = t.id
         AND n.content LIKE ?
       WHERE (t.owner_tag LIKE ? OR t.subject LIKE ? OR n.content LIKE ?)
       ORDER BY t.created_at DESC
       LIMIT 50`,
      [like, like, like, like]
    );

    // Deduplicate — keep one row per ticket (best matching note)
    const ticketMap = new Map();
    for (const r of rows) {
      if (!ticketMap.has(r.id)) {
        ticketMap.set(r.id, {
          id: r.id, ownerTag: r.owner_tag, subject: r.subject,
          status: r.status, priority: r.priority,
          createdAt: r.created_at, closedAt: r.closed_at,
          matches: [],
        });
      }
      if (r.matched_note) {
        ticketMap.get(r.id).matches.push({
          content: r.matched_note.slice(0, 200),
          author: r.note_author,
          source: r.note_source,
          at: r.note_at,
        });
      }
    }

    res.json([...ticketMap.values()].slice(0, 30));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/analytics/export/csv — daily volume + staff stats combined
router.get('/export/csv', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  try {
    const [volume, staffStats, ratings] = await Promise.all([
      req.guildDb(
        `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') as date,
                COUNT(*) as opened,
                SUM(status='closed') as closed
         FROM tickets
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
         GROUP BY date ORDER BY date ASC`
      ),
      req.guildDb(
        `SELECT admin_tag, tickets_closed,
                ROUND(total_rating_score / NULLIF(total_ratings,0), 2) as avg_rating,
                ROUND(total_response_seconds / NULLIF(total_response_count,0)) as avg_response_sec
         FROM admin_stats ORDER BY tickets_closed DESC`
      ),
      req.guildDb(
        `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') as date, rating, COUNT(*) as count
         FROM ticket_ratings
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
         GROUP BY date, rating ORDER BY date ASC`
      ),
    ]);

    // Three sheets as separate CSV blocks separated by blank lines
    const toCSV = (headers, rows) => [
      headers.join(','),
      ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))
    ].join('\n');

    const csv = [
      '# Volume quotidien (90 jours)',
      toCSV(['date', 'opened', 'closed'], volume),
      '',
      '# Stats staff',
      toCSV(['admin_tag', 'tickets_closed', 'avg_rating', 'avg_response_sec'], staffStats),
      '',
      '# Notes de satisfaction',
      toCSV(['date', 'rating', 'count'], ratings),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="analytics.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

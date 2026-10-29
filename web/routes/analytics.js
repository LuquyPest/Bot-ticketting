const express = require('express');
const router = express.Router();
const { visibilityFilter } = require('../../utils/gradePermissions');

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
    const vis = await visibilityFilter(req); // a ticket's title is free text: restricted ones stay out
    const rows = await req.guildDb(
      `SELECT COALESCE(subject, '(sans sujet)') as subject, COUNT(*) as count
       FROM tickets WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND ${vis.sql}
       GROUP BY subject ORDER BY count DESC LIMIT 20`,
      [days, ...vis.params]
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
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    const rows = await req.guildDb(
      `SELECT t.id, t.owner_tag, t.subject, t.priority, t.claimed_by,
              t.created_at, t.first_response_at,
              TIMESTAMPDIFF(MINUTE, t.created_at, NOW()) as age_minutes,
              TIMESTAMPDIFF(MINUTE, t.created_at, t.first_response_at) as first_response_minutes,
              u.username as claimer_name
       FROM tickets t
       LEFT JOIN dashboard_users u ON u.user_id = t.claimed_by
       WHERE t.status = 'open' AND ${vis.sql}
       ORDER BY t.created_at ASC`,
      vis.params
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

// ── Quality: first response time, per-stage SLA compliance, satisfaction comments ──
// Stage durations are rebuilt from the journal (ticket_stage events): each ticket starts in
// "open" at creation, then follows its stage changes until closing (or now when still open).
const { stageCompliance, median, avg } = require('../../utils/stageStats');

// GET /api/analytics/time?days= — time spent per member, per subject, longest tickets. The
// per-member figures of others need fondateur or view_audit; otherwise only one's own time.
router.get('/time', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    const full = req.userIsFondateur || req.userPermissions?.has('view_audit');
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    const stats = await require('../../utils/ticketTime').timeStats(req.guildDb, days, { userId: full ? null : req.session.user.id, vis });
    res.json({ ...stats, scope: full ? 'team' : 'mine' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/quality', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    const db = req.guildDb;
    const [cfg] = await db('SELECT sla_open_hours, sla_waiting_hours, sla_in_progress_hours FROM guild_config WHERE id = 1');
    const slaMin = { open: (cfg?.sla_open_hours || 0) * 60, waiting: (cfg?.sla_waiting_hours || 0) * 60, in_progress: (cfg?.sla_in_progress_hours || 0) * 60 };

    // First response
    const fr = await db(
      `SELECT TIMESTAMPDIFF(MINUTE, t.created_at, t.first_response_at) AS m FROM tickets t
       WHERE t.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND ${vis.sql}`, [days, ...vis.params]);
    const answered = fr.filter(r => r.m !== null).map(r => Math.max(0, Number(r.m)));
    const within = h => (answered.length ? Math.round((answered.filter(m => m <= h * 60).length / answered.length) * 100) : null);
    const firstResponse = {
      tickets: fr.length, answered: answered.length, unanswered: fr.length - answered.length,
      avgMinutes: avg(answered), medianMinutes: median(answered),
      within1h: within(1), within4h: within(4), within24h: within(24),
    };

    // Stage durations
    const tickets = await db(
      `SELECT t.id, t.created_at, t.closed_at FROM tickets t
       WHERE (t.closed_at IS NULL OR t.closed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AND t.created_at <= NOW() AND ${vis.sql}
       ORDER BY t.id DESC LIMIT 3000`, [days, ...vis.params]);
    const stages = await stageCompliance(db, tickets, slaMin);

    // Satisfaction
    const [ratingRows, comments] = await Promise.all([
      db(`SELECT r.rating, COUNT(*) AS n FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id
          WHERE r.rated_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND ${vis.sql} GROUP BY r.rating`, [days, ...vis.params]),
      db(`SELECT r.rating, r.comment, r.rated_at, t.id AS ticket_id, t.subject, t.owner_tag FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id
          WHERE r.comment IS NOT NULL AND r.rated_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND ${vis.sql}
          ORDER BY r.rated_at DESC LIMIT 50`, [days, ...vis.params]),
    ]);
    const distribution = [1, 2, 3, 4, 5].map(rating => ({ rating, n: Number(ratingRows.find(r => r.rating === rating)?.n || 0) }));
    const totalRatings = distribution.reduce((a, d) => a + d.n, 0);
    res.json({
      days, firstResponse, stages,
      satisfaction: {
        total: totalRatings,
        average: totalRatings ? Math.round((distribution.reduce((a, d) => a + d.rating * d.n, 0) / totalRatings) * 10) / 10 : null,
        distribution, comments,
      },
    });
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

const teamStats = require('../../utils/teamStats');
const { csvCell } = require('../../utils/csv');
const clampDays = v => Math.min(Math.max(parseInt(v) || 30, 1), 365);
const fullAccess = req => req.userIsFondateur || req.userPermissions?.has('view_audit');

// GET /api/analytics/compare?period=month|week|30d|90d — this period so far vs the same length of the previous one
router.get('/compare', async (req, res) => {
  try {
    const period = ['month', 'week', '30d', '90d'].includes(req.query.period) ? req.query.period : 'month';
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    res.json(await teamStats.comparePeriods(req.guildDb, vis, period));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/analytics/reopens?days= — share of closures followed by a reopening, per subject and per agent
// (the per-agent detail of others needs fondateur or view_audit, like the time spent)
router.get('/reopens', async (req, res) => {
  try {
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    const data = await teamStats.reopenRates(req.guildDb, vis, clampDays(req.query.days));
    if (!fullAccess(req)) data.byAgent = data.byAgent.filter(a => a.userId === req.session.user.id);
    res.json({ ...data, scope: fullAccess(req) ? 'team' : 'mine' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

function sendCsv(res, name, header, rows) {
  const body = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send('﻿' + body); // BOM: accents shown correctly by spreadsheet software
}
const stamp = () => new Date().toISOString().slice(0, 10);

// GET /api/analytics/export/time.csv?days= — every time entry (one's own without fondateur / view_audit)
router.get('/export/time.csv', async (req, res) => {
  try {
    const days = clampDays(req.query.days);
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    const mine = !fullAccess(req);
    const rows = await req.guildDb(
      `SELECT tt.started_at, tt.ticket_id, t.subject, tt.user_tag, tt.source,
              COALESCE(tt.seconds, LEAST(TIMESTAMPDIFF(SECOND, tt.started_at, NOW()), 28800)) AS s, tt.note
       FROM ticket_time tt JOIN tickets t ON t.id = tt.ticket_id
       WHERE tt.started_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ${mine ? 'AND tt.user_id = ?' : ''} AND ${vis.sql}
       ORDER BY tt.started_at`, [days, ...(mine ? [req.session.user.id] : []), ...vis.params]);
    sendCsv(res, `temps-passe-${stamp()}.csv`, ['Début', 'Ticket', 'Sujet', 'Membre du staff', 'Type', 'Minutes', 'Note'],
      rows.map(r => [r.started_at, r.ticket_id, r.subject || '', r.user_tag, r.source === 'manual' ? 'ajout manuel' : 'chronomètre', Math.round(Number(r.s) / 60), r.note || '']));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/analytics/export/stats.csv?days= — one row per staff member (only one's own without fondateur / view_audit)
router.get('/export/stats.csv', async (req, res) => {
  try {
    const days = clampDays(req.query.days);
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    const rows = await teamStats.agentStats(req.guildDb, vis, days, fullAccess(req) ? null : req.session.user.id);
    sendCsv(res, `statistiques-${days}j-${stamp()}.csv`,
      ['Membre du staff', 'Réponses', 'Notes internes', 'Tickets traités', 'Fermetures', '1re réponse médiane (min)', 'Note moyenne', 'Notes reçues', 'Temps passé (h)', 'Taux de réouverture (%)'],
      rows.map(r => [r.username, r.replies, r.internalNotes, r.tickets, r.closures, r.firstResponseMedianMin ?? '', r.avgRating ?? '', r.ratings, r.timeHours, r.reopenRate ?? '']));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

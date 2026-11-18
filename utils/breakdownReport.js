// Reports by team, category, subject or channel (v4.2): for the tickets opened over a period,
// one row per group with volume, delays, satisfaction and time spent. Read through
// GET /api/analytics/breakdown and exported as CSV (web/routes/analytics.js).
const { median } = require('./stageStats');
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null); // stageStats.avg rounds to whole minutes

const DIMENSIONS = ['team', 'category', 'subject', 'channel', 'type'];
const MAX_TICKETS = 50000;
const SEP = ' › ';

// The channel a ticket came through, from who owns it (utils/emailTickets.js isExternalOwner)
const CHANNEL_SQL = "CASE WHEN t.owner_id LIKE 'mail:%' THEN 'email' WHEN t.owner_id LIKE 'web:%' THEN 'web' ELSE 'discord' END";
const CHANNEL_LABEL = { discord: 'Discord', email: 'E-mail', web: 'Web (espace membre, widget)' };

function keyOf(by, t) {
  if (by === 'team') return t.team_id ? String(t.team_id) : '';
  if (by === 'channel') return t.channel;
  if (by === 'type') return t.ticket_type || 'request';
  const s = String(t.subject || '').trim();
  return by === 'category' ? s.split(SEP)[0] : s;
}

// vis: visibilityFilter(req, 't.visibility_grade_id') — restricted tickets stay out of the figures
async function breakdown(db, vis, { by, days }) {
  if (!DIMENSIONS.includes(by)) throw Object.assign(new Error('Dimension inconnue'), { status: 400 });
  const tickets = await db(
    `SELECT t.id, t.subject, t.team_id, t.ticket_type, t.status, t.tto_due_at, t.ttr_due_at, t.resolved_at, t.created_at, t.first_response_at, t.closed_at, ${CHANNEL_SQL} AS channel,
            (SELECT AVG(r.rating) FROM ticket_ratings r WHERE r.ticket_id = t.id) AS rating,
            (SELECT COALESCE(SUM(COALESCE(tt.seconds, 0)), 0) FROM ticket_time tt WHERE tt.ticket_id = t.id) AS seconds
     FROM tickets t
     WHERE t.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND t.merged_into IS NULL AND ${vis.sql}
     ORDER BY t.id LIMIT ${MAX_TICKETS}`, [days, ...vis.params]);

  const typeLabels = by === 'type' ? (await require('./ticketTypes').typeSettings(db)).labels : null;
  const teams = by === 'team' ? new Map((await db('SELECT id, name FROM teams')).map(x => [String(x.id), x.name])) : null;
  const label = key => {
    if (by === 'team') return key ? (teams.get(key) || `Équipe supprimée (#${key})`) : 'Sans équipe';
    if (by === 'channel') return CHANNEL_LABEL[key] || key;
    if (by === 'type') return typeLabels[key] || key;
    return key || 'Sans sujet';
  };

  const groups = new Map();
  for (const t of tickets) {
    const k = keyOf(by, t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const minutes = (a, b) => (new Date(b) - new Date(a)) / 60000;
  const rows = [...groups.entries()].map(([key, list]) => {
    const responded = list.filter(t => t.first_response_at).map(t => minutes(t.created_at, t.first_response_at));
    const resolved = list.filter(t => t.status === 'closed' && t.closed_at).map(t => minutes(t.created_at, t.closed_at)); // minutes: stageStats.median rounds
    const ratings = list.filter(t => t.rating != null).map(t => Number(t.rating));
    const med = median(responded), res = median(resolved), rate = mean(ratings);
    // SLA objectives met (utils/slaPolicies.js), among the tickets that had one and reached it
    const pct = (list2, due, done) => { const l = list2.filter(t => t[due] && done(t)); return l.length ? Math.round(100 * l.filter(t => new Date(done(t)) <= new Date(t[due])).length / l.length) : null; };
    const ttoMetPct = pct(list, 'tto_due_at', t => t.first_response_at), ttrMetPct = pct(list, 'ttr_due_at', t => t.resolved_at || t.closed_at);
    return {
      key, label: label(key),
      opened: list.length,
      closed: resolved.length,
      stillOpen: list.filter(t => t.status !== 'closed').length,
      firstResponseMedianMin: med == null ? null : Math.round(med),
      resolutionMedianHours: res == null ? null : Math.round(res / 6) / 10,
      avgRating: rate == null ? null : Math.round(rate * 100) / 100,
      ratings: ratings.length,
      timeHours: Math.round(list.reduce((n, t) => n + Number(t.seconds || 0), 0) / 360) / 10,
      ttoMetPct, ttrMetPct,
    };
  }).sort((a, b) => b.opened - a.opened || a.label.localeCompare(b.label));
  return { by, days, total: tickets.length, truncated: tickets.length >= MAX_TICKETS, rows };
}

const CSV_HEADER = ['Groupe', 'Tickets ouverts', 'Fermés', 'Encore ouverts', '1re réponse médiane (min)', 'Résolution médiane (h)', 'Note moyenne', 'Notes reçues', 'Temps passé (h)', 'Prise en charge dans le délai (%)', 'Résolution dans le délai (%)'];
const csvRows = report => report.rows.map(r => [r.label, r.opened, r.closed, r.stillOpen, r.firstResponseMedianMin ?? '', r.resolutionMedianHours ?? '', r.avgRating ?? '', r.ratings, r.timeHours, r.ttoMetPct ?? '', r.ttrMetPct ?? '']);

module.exports = { breakdown, DIMENSIONS, CSV_HEADER, csvRows, CHANNEL_SQL };

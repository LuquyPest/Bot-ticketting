// "My activity": a staff member's own figures over a period (replies, tickets closed, first
// response time, ratings received) next to the team's, and their weekly evolution.
const { median } = require('./stageStats');

const STAFF_SOURCES = ['reply', 'scheduled'];
const WEEKS = 12;

// Monday 00:00 (local server time) of the week containing d
function weekStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Minutes between ticket creation and the first staff reply, with who sent it
async function firstResponses(db, since) {
  return db(
    `SELECT t.id, TIMESTAMPDIFF(MINUTE, t.created_at, f.first_at) AS mins,
            (SELECT n.author_id FROM ticket_notes n WHERE n.ticket_id = t.id AND n.source IN (?) ORDER BY n.created_at ASC, n.id ASC LIMIT 1) AS author_id
     FROM tickets t
     JOIN (SELECT ticket_id, MIN(created_at) AS first_at FROM ticket_notes WHERE source IN (?) GROUP BY ticket_id) f ON f.ticket_id = t.id
     WHERE t.created_at >= ?`,
    [STAFF_SOURCES, STAFF_SOURCES, since]
  );
}

async function myActivity(db, userId, days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const [[counts], [team], fr, ratings, comments, openAssigned] = await Promise.all([
    db(`SELECT
          (SELECT COUNT(*) FROM tickets WHERE closed_by_id = ? AND closed_at >= ?) AS closed,
          (SELECT COUNT(*) FROM ticket_notes WHERE author_id = ? AND source IN (?) AND created_at >= ?) AS replies,
          (SELECT COUNT(DISTINCT ticket_id) FROM ticket_notes WHERE author_id = ? AND source IN (?) AND created_at >= ?) AS tickets,
          (SELECT COUNT(*) FROM ticket_notes WHERE author_id = ? AND source = 'web' AND created_at >= ?) AS notes`,
      [userId, since, userId, STAFF_SOURCES, since, userId, STAFF_SOURCES, since, userId, since]),
    db(`SELECT COUNT(*) AS closed, COUNT(DISTINCT closed_by_id) AS closers FROM tickets WHERE closed_at >= ? AND closed_by_id IS NOT NULL`, [since]),
    firstResponses(db, since),
    db('SELECT rating, closed_by_id FROM ticket_ratings WHERE rated_at >= ?', [since]),
    db(`SELECT r.ticket_id, r.rating, r.comment, r.rated_at FROM ticket_ratings r
        WHERE r.closed_by_id = ? AND r.comment IS NOT NULL AND r.comment <> '' ORDER BY r.rated_at DESC LIMIT 5`, [userId]),
    db('SELECT COUNT(*) AS n FROM ticket_assignees a JOIN tickets t ON t.id = a.ticket_id WHERE a.user_id = ? AND t.status = \'open\'', [userId]),
  ]);

  const mineFr = fr.filter(r => r.author_id === userId).map(r => Number(r.mins));
  const allFr = fr.map(r => Number(r.mins));
  const mineRatings = ratings.filter(r => r.closed_by_id === userId).map(r => Number(r.rating));
  const avg = a => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 100) / 100 : null);
  const distribution = [1, 2, 3, 4, 5].map(n => ({ rating: n, count: mineRatings.filter(r => r === n).length }));

  // Weekly evolution over the last 12 weeks
  const from = weekStart(new Date(Date.now() - (WEEKS - 1) * 7 * 86400000));
  const [wReplies, wClosed, wRatings] = await Promise.all([
    db('SELECT created_at AS at FROM ticket_notes WHERE author_id = ? AND source IN (?) AND created_at >= ?', [userId, STAFF_SOURCES, from]),
    db('SELECT closed_at AS at FROM tickets WHERE closed_by_id = ? AND closed_at >= ?', [userId, from]),
    db('SELECT rated_at AS at, rating FROM ticket_ratings WHERE closed_by_id = ? AND rated_at >= ?', [userId, from]),
  ]);
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const start = new Date(from); start.setDate(start.getDate() + i * 7);
    return { week: isoDay(start), replies: 0, closed: 0, ratingSum: 0, ratingCount: 0 };
  });
  const slot = at => weeks[Math.floor((weekStart(at) - from) / (7 * 86400000))];
  for (const r of wReplies) { const w = slot(r.at); if (w) w.replies++; }
  for (const r of wClosed) { const w = slot(r.at); if (w) w.closed++; }
  for (const r of wRatings) { const w = slot(r.at); if (w) { w.ratingSum += Number(r.rating); w.ratingCount++; } }

  return {
    days,
    closed: Number(counts.closed), replies: Number(counts.replies), tickets: Number(counts.tickets), notes: Number(counts.notes),
    openAssigned: Number(openAssigned[0].n),
    firstResponse: { medianMinutes: median(mineFr), count: mineFr.length, teamMedianMinutes: median(allFr) },
    rating: { average: avg(mineRatings), count: mineRatings.length, teamAverage: avg(ratings.map(r => Number(r.rating))), distribution },
    team: { closedPerMember: Number(team.closers) ? Math.round(Number(team.closed) / Number(team.closers)) : null },
    comments,
    weekly: weeks.map(({ ratingSum, ratingCount, ...w }) => ({ ...w, rating: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null })),
  };
}

module.exports = { myActivity, weekStart };

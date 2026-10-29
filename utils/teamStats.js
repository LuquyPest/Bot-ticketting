// Analytics of the team: two periods side by side, reopen rates per subject and per agent, and
// the per-agent figures exported as CSV. `vis` is the visibility filter of the requesting user on
// the tickets table aliased `t` (gradePermissions.visibilityFilter(req, 't.visibility_grade_id')).
const { median } = require('./stageStats');

const DAY = 86400000;

// Current period so far and the same length of the previous one, so a month in progress is
// compared with the same number of days of last month.
function periodRanges(period, now = new Date()) {
  let start, prevStart;
  if (period === 'week') {
    start = new Date(now); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
    prevStart = new Date(start.getTime() - 7 * DAY);
  } else if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  } else {
    const days = period === '90d' ? 90 : 30;
    start = new Date(now.getTime() - days * DAY);
    prevStart = new Date(start.getTime() - days * DAY);
  }
  const length = now.getTime() - start.getTime();
  // Last month may be shorter than the elapsed part of this one (31 March vs February)
  const prevEnd = new Date(Math.min(prevStart.getTime() + length, start.getTime()));
  return { current: { from: start, to: now }, previous: { from: prevStart, to: prevEnd } };
}

async function periodMetrics(db, vis, { from, to }) {
  const range = [from, to];
  const [[opened], [closed], firsts, resolutions, [ratings], [reopened], [replies]] = await Promise.all([
    db(`SELECT COUNT(*) AS n FROM tickets t WHERE t.created_at >= ? AND t.created_at < ? AND ${vis.sql}`, [...range, ...vis.params]),
    db(`SELECT COUNT(*) AS n FROM tickets t WHERE t.closed_at >= ? AND t.closed_at < ? AND t.merged_into IS NULL AND ${vis.sql}`, [...range, ...vis.params]),
    db(`SELECT TIMESTAMPDIFF(MINUTE, t.created_at, t.first_response_at) AS m FROM tickets t
        WHERE t.created_at >= ? AND t.created_at < ? AND t.first_response_at IS NOT NULL AND ${vis.sql}`, [...range, ...vis.params]),
    db(`SELECT TIMESTAMPDIFF(MINUTE, t.created_at, t.closed_at) AS m FROM tickets t
        WHERE t.closed_at >= ? AND t.closed_at < ? AND t.merged_into IS NULL AND ${vis.sql}`, [...range, ...vis.params]),
    db(`SELECT AVG(r.rating) AS avg, COUNT(*) AS n FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id
        WHERE r.rated_at >= ? AND r.rated_at < ? AND ${vis.sql}`, [...range, ...vis.params]),
    db(`SELECT COUNT(DISTINCT a.ticket_id) AS n FROM audit_log a JOIN tickets t ON t.id = a.ticket_id
        WHERE a.action = 'ticket_reopen' AND a.created_at >= ? AND a.created_at < ? AND ${vis.sql}`, [...range, ...vis.params]),
    db(`SELECT COUNT(*) AS n FROM ticket_notes n JOIN tickets t ON t.id = n.ticket_id
        WHERE n.source = 'reply' AND n.created_at >= ? AND n.created_at < ? AND ${vis.sql}`, [...range, ...vis.params]),
  ]);
  const minutes = rows => rows.map(r => Math.max(0, Number(r.m)));
  const resMed = median(minutes(resolutions));
  return {
    from, to,
    opened: Number(opened.n), closed: Number(closed.n), replies: Number(replies.n), reopened: Number(reopened.n),
    firstResponseMedianMin: median(minutes(firsts)),
    resolutionMedianHours: resMed === null ? null : Math.round((resMed / 60) * 10) / 10,
    satisfaction: ratings.n ? Math.round(Number(ratings.avg) * 10) / 10 : null, ratings: Number(ratings.n),
  };
}

async function comparePeriods(db, vis, period) {
  const ranges = periodRanges(period);
  const [current, previous] = await Promise.all([periodMetrics(db, vis, ranges.current), periodMetrics(db, vis, ranges.previous)]);
  return { period, current, previous };
}

// Of the closures in the period, how many were followed by a reopening (whenever it happened).
// Per agent: closures by a staff member; the others (automations, members) are grouped.
async function reopenRates(db, vis, days) {
  const since = new Date(Date.now() - days * DAY);
  const closes = await db(
    `SELECT a.id, a.ticket_id, a.actor_id, a.actor_tag, a.created_at, COALESCE(t.subject, '(sans sujet)') AS subject
     FROM audit_log a JOIN tickets t ON t.id = a.ticket_id
     WHERE a.action = 'ticket_close' AND a.created_at >= ? AND t.merged_into IS NULL AND ${vis.sql}
     ORDER BY a.created_at, a.id`, [since, ...vis.params]);
  if (!closes.length) return { days, overall: { closures: 0, reopened: 0, rate: null }, bySubject: [], byAgent: [] };
  const events = await db(
    `SELECT id, ticket_id, action, created_at FROM audit_log
     WHERE action IN ('ticket_close', 'ticket_reopen') AND ticket_id IN (?) AND created_at >= ? ORDER BY created_at, id`,
    [[...new Set(closes.map(c => c.ticket_id))], since]);
  const byTicket = new Map();
  for (const e of events) {
    if (!byTicket.has(e.ticket_id)) byTicket.set(e.ticket_id, []);
    byTicket.get(e.ticket_id).push(e);
  }
  const staffIds = new Set((await db("SELECT user_id FROM dashboard_users WHERE role IN ('support', 'fondateur')")).map(u => u.user_id));
  const reopenedAfter = c => {
    const list = byTicket.get(c.ticket_id) || [];
    const i = list.findIndex(e => e.id === c.id);
    return list[i + 1]?.action === 'ticket_reopen';
  };
  const subjects = new Map(), agents = new Map();
  const add = (map, key, label, reopened) => {
    const row = map.get(key) || { key, label, closures: 0, reopened: 0 };
    row.closures++; if (reopened) row.reopened++;
    map.set(key, row);
  };
  let total = 0;
  for (const c of closes) {
    const reopened = reopenedAfter(c);
    if (reopened) total++;
    add(subjects, c.subject, c.subject, reopened);
    const staff = staffIds.has(c.actor_id);
    add(agents, staff ? c.actor_id : 'other', staff ? c.actor_tag : 'Automatismes et membres', reopened);
  }
  const rate = r => ({ ...r, rate: r.closures ? Math.round((r.reopened / r.closures) * 1000) / 10 : null });
  const sort = (a, b) => b.reopened - a.reopened || b.closures - a.closures;
  return {
    days,
    overall: rate({ closures: closes.length, reopened: total }),
    bySubject: [...subjects.values()].map(rate).sort(sort),
    byAgent: [...agents.values()].map(r => rate({ ...r, userId: r.key === 'other' ? null : r.key })).sort(sort),
  };
}

// One row per staff member over the period (CSV export of Analytique).
async function agentStats(db, vis, days, onlyUserId = null) {
  const since = new Date(Date.now() - days * DAY);
  const only = onlyUserId ? 'AND u.user_id = ?' : '';
  const staff = await db(`SELECT u.user_id, u.username FROM dashboard_users u WHERE u.role IN ('support', 'fondateur') ${only} ORDER BY u.username`, onlyUserId ? [onlyUserId] : []);
  const [notes, closes, firsts, ratings, time, reopens] = await Promise.all([
    db(`SELECT n.author_id, SUM(n.source = 'reply') AS replies, SUM(n.source IN ('web', 'discord')) AS internal, COUNT(DISTINCT n.ticket_id) AS tickets
        FROM ticket_notes n JOIN tickets t ON t.id = n.ticket_id WHERE n.created_at >= ? AND ${vis.sql} GROUP BY n.author_id`, [since, ...vis.params]),
    db(`SELECT t.closed_by_id AS user_id, COUNT(*) AS n FROM tickets t WHERE t.closed_at >= ? AND t.closed_by_id IS NOT NULL AND ${vis.sql} GROUP BY t.closed_by_id`, [since, ...vis.params]),
    db(`SELECT a.user_id, TIMESTAMPDIFF(MINUTE, t.created_at, t.first_response_at) AS m
        FROM tickets t JOIN ticket_assignees a ON a.ticket_id = t.id
        WHERE t.created_at >= ? AND t.first_response_at IS NOT NULL AND ${vis.sql}`, [since, ...vis.params]),
    db(`SELECT t.claimed_by AS user_id, AVG(r.rating) AS avg, COUNT(*) AS n FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id
        WHERE r.rated_at >= ? AND t.claimed_by IS NOT NULL AND ${vis.sql} GROUP BY t.claimed_by`, [since, ...vis.params]),
    db(`SELECT tt.user_id, SUM(COALESCE(tt.seconds, LEAST(TIMESTAMPDIFF(SECOND, tt.started_at, NOW()), 28800))) AS s
        FROM ticket_time tt JOIN tickets t ON t.id = tt.ticket_id WHERE tt.started_at >= ? AND ${vis.sql} GROUP BY tt.user_id`, [since, ...vis.params]),
    reopenRates(db, vis, days),
  ]);
  const byUser = (rows, key = 'user_id') => new Map(rows.map(r => [r[key], r]));
  const n = byUser(notes, 'author_id'), c = byUser(closes), r = byUser(ratings), tm = byUser(time);
  const reopen = new Map(reopens.byAgent.filter(a => a.userId).map(a => [a.userId, a]));
  return staff.map(u => {
    const fr = firsts.filter(f => f.user_id === u.user_id).map(f => Math.max(0, Number(f.m)));
    return {
      userId: u.user_id, username: u.username,
      replies: Number(n.get(u.user_id)?.replies || 0), internalNotes: Number(n.get(u.user_id)?.internal || 0),
      tickets: Number(n.get(u.user_id)?.tickets || 0), closures: Number(c.get(u.user_id)?.n || 0),
      firstResponseMedianMin: median(fr),
      avgRating: r.get(u.user_id) ? Math.round(Number(r.get(u.user_id).avg) * 10) / 10 : null, ratings: Number(r.get(u.user_id)?.n || 0),
      timeHours: Math.round((Number(tm.get(u.user_id)?.s || 0) / 3600) * 10) / 10,
      reopenRate: reopen.get(u.user_id)?.rate ?? null,
    };
  });
}

module.exports = { periodRanges, comparePeriods, reopenRates, agentStats };

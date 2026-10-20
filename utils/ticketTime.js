// Time spent on tickets: a stopwatch per staff member (one running at a time: starting another
// one stops it) and time added by hand. A forgotten stopwatch counts 8 hours at most, and the
// stopwatches of a ticket stop when it is closed.
const MAX_SESSION_S = 8 * 3600;

const elapsedSql = `LEAST(TIMESTAMPDIFF(SECOND, started_at, NOW()), ${MAX_SESSION_S})`;

async function stopRunning(db, where, params) {
  await db(`UPDATE ticket_time SET ended_at = NOW(), seconds = ${elapsedSql} WHERE ended_at IS NULL AND ${where}`, params);
}

const stopUserTimer = (db, userId) => stopRunning(db, 'user_id = ?', [userId]);
const stopTicketTimers = (db, ticketId) => stopRunning(db, 'ticket_id = ?', [ticketId]);

async function startTimer(db, ticketId, user) {
  await stopUserTimer(db, user.id);
  await db('INSERT INTO ticket_time (ticket_id, user_id, user_tag) VALUES (?, ?, ?)', [ticketId, user.id, user.username]);
}

// The signed-in member's running stopwatch, on any ticket
async function runningTimer(db, userId) {
  const [row] = await db(
    `SELECT tt.id, tt.ticket_id, tt.started_at, TIMESTAMPDIFF(SECOND, tt.started_at, NOW()) AS elapsed, t.subject
     FROM ticket_time tt JOIN tickets t ON t.id = tt.ticket_id WHERE tt.user_id = ? AND tt.ended_at IS NULL ORDER BY tt.id DESC LIMIT 1`, [userId]);
  return row ? { ...row, elapsed: Math.min(Number(row.elapsed), MAX_SESSION_S) } : null;
}

// Totals of a ticket: overall, per member, and the entries
async function ticketTime(db, ticketId, userId) {
  const rows = await db(
    `SELECT id, user_id, user_tag, source, started_at, ended_at, note,
            COALESCE(seconds, ${elapsedSql}) AS seconds, ended_at IS NULL AS running
     FROM ticket_time WHERE ticket_id = ? ORDER BY started_at DESC`, [ticketId]);
  const entries = rows.map(r => ({ ...r, seconds: Number(r.seconds), running: !!Number(r.running) }));
  const byUser = new Map();
  for (const e of entries) byUser.set(e.user_id, { user_id: e.user_id, user_tag: e.user_tag, seconds: (byUser.get(e.user_id)?.seconds || 0) + e.seconds });
  return {
    total: entries.reduce((n, e) => n + e.seconds, 0),
    mine: entries.filter(e => e.user_id === userId).reduce((n, e) => n + e.seconds, 0),
    running: entries.find(e => e.running && e.user_id === userId) || null,
    byUser: [...byUser.values()].sort((a, b) => b.seconds - a.seconds),
    entries: entries.slice(0, 50),
  };
}

// Analytics: per member, per subject, longest tickets over the last `days` days
async function timeStats(db, days, { userId = null } = {}) {
  const since = new Date(Date.now() - days * 86400000);
  const userFilter = userId ? 'AND tt.user_id = ?' : '';
  const params = userId ? [since, userId] : [since];
  const sec = `COALESCE(tt.seconds, ${elapsedSql.replace('started_at', 'tt.started_at')})`;
  const [byUser, bySubject, top] = await Promise.all([
    db(`SELECT tt.user_id, MAX(tt.user_tag) AS user_tag, SUM(${sec}) AS seconds, COUNT(DISTINCT tt.ticket_id) AS tickets
        FROM ticket_time tt WHERE tt.started_at >= ? ${userFilter} GROUP BY tt.user_id ORDER BY seconds DESC`, params),
    db(`SELECT COALESCE(t.subject, '(sans sujet)') AS subject, SUM(${sec}) AS seconds, COUNT(DISTINCT tt.ticket_id) AS tickets
        FROM ticket_time tt JOIN tickets t ON t.id = tt.ticket_id WHERE tt.started_at >= ? ${userFilter} GROUP BY t.subject ORDER BY seconds DESC LIMIT 20`, params),
    db(`SELECT tt.ticket_id, MAX(t.subject) AS subject, SUM(${sec}) AS seconds
        FROM ticket_time tt JOIN tickets t ON t.id = tt.ticket_id WHERE tt.started_at >= ? ${userFilter} GROUP BY tt.ticket_id ORDER BY seconds DESC LIMIT 10`, params),
  ]);
  const num = rows => rows.map(r => ({ ...r, seconds: Number(r.seconds), ...(r.tickets !== undefined ? { tickets: Number(r.tickets), perTicket: Math.round(Number(r.seconds) / Math.max(1, Number(r.tickets))) } : {}) }));
  return { days, byUser: num(byUser), bySubject: num(bySubject), top: num(top), total: num(byUser).reduce((n, r) => n + r.seconds, 0) };
}

module.exports = { startTimer, stopUserTimer, stopTicketTimers, runningTimer, ticketTime, timeStats, MAX_SESSION_S };

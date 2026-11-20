// Planning (v5.4, conception/v5.md §3.10): what is planned for a person or a team over a period —
// the tasks with a planned date (utils/tasks.js), the resolution deadlines of their open tickets,
// the absences — through the visibility of whoever reads it. Tasks move by drag and drop (their
// date, through the task routes). A personal iCal feed (a secret link, revocable) gives the same
// tasks and deadlines to a calendar app.
const crypto = require('crypto');
const { visibilityFilter } = require('./gradePermissions');

const MAX_DAYS = 62;

// The visibility of a staff member, without a request (iCal feed)
async function visFor(db, userId) {
  const [u] = await db('SELECT role FROM dashboard_users WHERE user_id = ?', [userId]);
  return visibilityFilter({ userIsFondateur: u?.role === 'fondateur', session: { user: { id: userId } }, guildDb: db }, 't.visibility_grade_id');
}

// { tasks, deadlines, absences } between from and to, for userIds (a person or a team's members)
async function events(db, { userIds, teamId = null, from, to, vis }) {
  const ids = userIds.length ? userIds : ['-'];
  const tasks = await db(`SELECT k.id, k.ticket_id, k.title, k.due_at, k.planned_minutes, k.state, k.assignee_id, u.username AS assignee_name, t.subject
    FROM ticket_tasks k JOIN tickets t ON t.id = k.ticket_id LEFT JOIN dashboard_users u ON u.user_id = k.assignee_id
    WHERE k.due_at >= ? AND k.due_at < ? AND (k.assignee_id IN (?)${teamId ? ' OR k.team_id = ?' : ''}) AND ${vis.sql}
    ORDER BY k.due_at LIMIT 500`, [from, to, ids, ...(teamId ? [teamId] : []), ...vis.params]);
  const deadlines = await db(`SELECT t.id, t.subject, t.ttr_due_at AS due_at, t.priority FROM tickets t
    WHERE t.status = 'open' AND t.resolved_at IS NULL AND t.ttr_due_at >= ? AND t.ttr_due_at < ?
      AND (EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id IN (?))${teamId ? ' OR t.team_id = ?' : ''}) AND ${vis.sql}
    ORDER BY t.ttr_due_at LIMIT 500`, [from, to, ids, ...(teamId ? [teamId] : []), ...vis.params]);
  const absences = await db(`SELECT a.id, a.user_id, u.username, a.starts_at, a.ends_at, a.reason FROM staff_absences a LEFT JOIN dashboard_users u ON u.user_id = a.user_id
    WHERE a.user_id IN (?) AND a.starts_at < ? AND a.ends_at > ? ORDER BY a.starts_at LIMIT 200`, [ids, to, from]);
  // Changes they lead (v5.5), when the space uses them
  const changes = (await require('./changes').enabled(db).catch(() => false)) ? await require('./changes').inPeriod(db, userIds, teamId, from, to) : [];
  return {
    changes,
    tasks: tasks.map(k => ({ id: k.id, ticketId: k.ticket_id, title: k.title, subject: k.subject, dueAt: k.due_at, plannedMinutes: k.planned_minutes, state: k.state, assigneeId: k.assignee_id, assigneeName: k.assignee_name })),
    deadlines: deadlines.map(d => ({ ticketId: d.id, subject: d.subject, dueAt: d.due_at, priority: d.priority })),
    absences: absences.map(a => ({ id: a.id, userId: a.user_id, username: a.username, startsAt: a.starts_at, endsAt: a.ends_at, reason: a.reason })),
  };
}

// ── iCal feed: a secret per staff member, stored hashed ──
const hash = t => crypto.createHash('sha256').update(t).digest('hex');
async function newIcalToken(db, guildId, userId) {
  const token = `${guildId}.${crypto.randomBytes(24).toString('base64url')}`;
  await db('UPDATE dashboard_users SET ical_token_hash = ? WHERE user_id = ?', [hash(token), userId]);
  return token;
}
async function revokeIcal(db, userId) { await db('UPDATE dashboard_users SET ical_token_hash = NULL WHERE user_id = ?', [userId]); }
async function userOfToken(db, token) {
  const [u] = await db("SELECT user_id FROM dashboard_users WHERE ical_token_hash = ? AND role IN ('support', 'fondateur')", [hash(token)]);
  return u?.user_id || null;
}
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Lines folded at 75 octets (RFC 5545)
const fold = line => { const out = []; let s = line; while (Buffer.byteLength(s) > 75) { let n = 75; while (Buffer.byteLength(s.slice(0, n)) > 75) n--; out.push(s.slice(0, n)); s = ` ${s.slice(n)}`; } out.push(s); return out.join('\r\n'); };
function ical({ tasks, deadlines, absences, slots = [] }, { name, base }) {
  const now = stamp(new Date());
  const ev = (uid, start, end, summary, url) => ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${now}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(summary)}`, ...(url ? [`URL:${url}`] : []), 'END:VEVENT'];
  const link = id => (base ? `${base}/tickets/${id}` : null);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Datick//Planning//FR', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`,
    ...tasks.filter(k => k.state === 'todo').flatMap(k => ev(`task-${k.id}@datick`, k.dueAt, new Date(new Date(k.dueAt).getTime() + (k.plannedMinutes || 30) * 60000), `Tâche : ${k.title} (#${k.ticketId})`, link(k.ticketId))),
    ...deadlines.flatMap(d => ev(`deadline-${d.ticketId}@datick`, d.dueAt, new Date(new Date(d.dueAt).getTime() + 15 * 60000), `Échéance : #${d.ticketId}${d.subject ? ` ${d.subject}` : ''}`, link(d.ticketId))),
    ...absences.flatMap(a => ev(`absence-${a.id}@datick`, a.startsAt, a.endsAt, `Absence${a.username ? ` : ${a.username}` : ''}`, null)),
    ...slots.flatMap(s => ev(`slot-${s.key.replace(':', '-')}@datick`, s.startsAt, s.endsAt, `${s.planning} : ${s.title}`, null)),
    'END:VCALENDAR'];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

module.exports = { MAX_DAYS, visFor, events, newIcalToken, revokeIcal, userOfToken, ical };

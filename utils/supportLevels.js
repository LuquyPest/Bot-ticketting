// Support levels (v7, conception/v7.md §3.2): a team may have a level (1, 2, 3…). « Escalate » on a
// ticket (or a rule action) hands it to the team of the next level up — the lowest level above
// that of its current team (a ticket without a team, or whose team has no level, goes to the
// lowest one) — with a reason, in the log and as an internal note. The people it was assigned to
// let go (unless kept), so the new team assigns it as it does. Reports count the escalations.
const { recordEvent } = require('./audit');
const { CONFIDENTIAL } = require('./gradePermissions');

const MAX_LEVEL = 9;

async function levelOf(db, teamId) {
  if (!teamId) return 0;
  const [t] = await db('SELECT level FROM teams WHERE id = ?', [teamId]).catch(() => []);
  return Number(t?.level || 0);
}
// The team of the next level for a ticket: { id, name, level } or null
async function nextTeam(db, ticket) {
  const current = await levelOf(db, ticket.team_id);
  const [t] = await db('SELECT id, name, level FROM teams WHERE level IS NOT NULL AND level > ? ORDER BY level, name LIMIT 1', [current]).catch(() => []);
  return t ? { id: t.id, name: t.name, level: Number(t.level) } : null;
}

// → { ok, team, assignee } or { error, status }
async function escalate({ db, tm, ticket, reason, actor, keepAssignees = false }) {
  if (!ticket || ticket.status !== 'open') return { error: 'Ticket fermé', status: 400 };
  if (ticket.visibility_grade_id === CONFIDENTIAL) return { error: 'Un ticket confidentiel ne change pas d\'équipe', status: 400 };
  const why = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
  if (!why) return { error: 'Motif de l\'escalade requis', status: 400 };
  const next = await nextTeam(db, ticket);
  if (!next) return { error: 'Aucune équipe d\'un niveau supérieur', status: 409 };
  const fromLevel = await levelOf(db, ticket.team_id);
  const [from] = ticket.team_id ? await db('SELECT name FROM teams WHERE id = ?', [ticket.team_id]) : [];
  if (!keepAssignees) {
    for (const a of await db('SELECT user_id FROM ticket_assignees WHERE ticket_id = ?', [ticket.id])) await tm.removeAssignee(ticket.id, a.user_id, actor).catch(() => null);
  }
  const r = await require('./teams').routeTicket({ db, tm, ticket: { ...ticket }, teamId: next.id, actor });
  const by = actor?.username || actor?.tag || 'Système';
  await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, 'system')",
    [ticket.id, String(actor?.id || 'system'), String(by).slice(0, 100), `⬆️ Escaladé au niveau ${next.level} (${next.name}) par ${by} : ${why}`]);
  await recordEvent(db, { actor, action: 'level_escalate', ticketId: ticket.id, details: { fromTeamId: ticket.team_id || null, fromTeam: from?.name || null, fromLevel, toTeamId: next.id, toTeam: next.name, toLevel: next.level, reason: why } });
  return { ok: true, team: next, assignee: r.assignee || null };
}

module.exports = { MAX_LEVEL, levelOf, nextTeam, escalate };

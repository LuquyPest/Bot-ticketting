// Teams of staff (v4.2): a team receives the tickets of some subjects and/or tags, has its own
// queue, and can assign them automatically — in turn (round_robin) or to the member with the
// fewest open tickets (load). A member is skipped when away or on holiday, when they cannot see
// the ticket (grade, roles tied to tags) or when they reached the team's cap of open tickets.
// v7: among them, those with the ticket's skills, then its language (utils/skills.js).
// Confidential tickets are never routed (founders only).
const { recordEvent } = require('./audit');
const { parseJsonField } = require('./jsonField');
const { CONFIDENTIAL } = require('./gradePermissions');

const MODES = ['none', 'round_robin', 'load'];
const COLORS = ['sky', 'amber', 'emerald', 'violet', 'rose', 'orange', 'teal', 'indigo', 'slate'];
const MAX_TEAMS = 30;
const TEAM_ACTOR = { id: 'system', tag: 'Attribution automatique', source: 'system' };

const shape = (t, members) => ({
  id: t.id, name: t.name, color: t.color, assignMode: t.assign_mode, maxOpen: Number(t.max_open) || 0,
  subjects: parseJsonField(t.subjects, []), tagIds: parseJsonField(t.tag_ids, []).map(Number), calendarId: t.calendar_id || null, olaMinutes: t.ola_minutes || null,
  members: members.filter(m => m.team_id === t.id).map(m => ({ userId: m.user_id, username: m.username || m.user_id, open: Number(m.open || 0) })),
});

async function listTeams(db) {
  const teams = await db('SELECT * FROM teams ORDER BY name').catch(() => []);
  if (!teams.length) return [];
  const members = await db(
    `SELECT m.team_id, m.user_id, u.username,
            (SELECT COUNT(*) FROM ticket_assignees a JOIN tickets t ON t.id = a.ticket_id WHERE a.user_id = m.user_id AND t.status = 'open') AS open
     FROM team_members m LEFT JOIN dashboard_users u ON u.user_id = m.user_id ORDER BY u.username`);
  const esc = require('./slaEscalation').levelsOf;
  return Promise.all(teams.map(async t => ({ ...shape(t, members), escalations: await esc(db, { teamId: t.id }) })));
}
async function teamOf(db, id) { return (await listTeams(db)).find(t => t.id === Number(id)) || null; }
const teamIdsOf = async (db, userId) => (await db('SELECT team_id FROM team_members WHERE user_id = ?', [String(userId)])).map(r => r.team_id);

// ── Settings ──
async function clean(db, input = {}) {
  const name = typeof input.name === 'string' ? input.name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60) : '';
  if (!name) return { error: 'Nom de l\'équipe requis (60 caractères au plus)' };
  const assignMode = MODES.includes(input.assignMode) ? input.assignMode : 'none';
  const maxOpen = input.maxOpen === undefined || input.maxOpen === '' ? 0 : Number(input.maxOpen);
  if (!Number.isInteger(maxOpen) || maxOpen < 0 || maxOpen > 500) return { error: 'Plafond : entre 0 et 500 tickets ouverts par personne' };
  const [cfg] = await db('SELECT ticket_subjects FROM guild_config WHERE id = 1');
  const known = parseJsonField(cfg?.ticket_subjects, []).map(x => (typeof x === 'string' ? x : x?.label || x?.name)).filter(Boolean);
  const subjects = [...new Set((Array.isArray(input.subjects) ? input.subjects : []).map(String))];
  if (subjects.some(s => !known.includes(s))) return { error: 'Sujet inconnu (Paramètres → Tickets → Sujets)' };
  const tagIds = [...new Set((Array.isArray(input.tagIds) ? input.tagIds : []).map(Number).filter(Number.isInteger))];
  if (tagIds.length) {
    const found = await db('SELECT id FROM ticket_tags WHERE id IN (?)', [tagIds]);
    if (found.length !== tagIds.length) return { error: 'Tag introuvable' };
  }
  const memberIds = [...new Set((Array.isArray(input.members) ? input.members : []).map(String))].slice(0, 100);
  if (memberIds.length) {
    const staff = await db("SELECT user_id FROM dashboard_users WHERE user_id IN (?) AND role IN ('support', 'fondateur')", [memberIds]);
    if (staff.length !== memberIds.length) return { error: 'Seul le staff de l\'espace peut faire partie d\'une équipe' };
  }
  const calendarId = input.calendarId ? Number(input.calendarId) : null;
  if (calendarId && !(await require('./calendars').calendarOf(db, calendarId))) return { error: 'Calendrier introuvable' };
  const E = require('./slaEscalation');
  const ola = E.cleanOla(input.olaMinutes);
  if (ola.error) return ola;
  const escalations = await E.cleanLevels(db, input.escalations, ['ola']);
  if (escalations.error) return escalations;
  return { value: { name, color: COLORS.includes(input.color) ? input.color : 'violet', assignMode, maxOpen, subjects, tagIds, memberIds, calendarId, olaMinutes: ola.value, escalations: escalations.value } };
}

async function saveMembers(db, teamId, memberIds) {
  await db('DELETE FROM team_members WHERE team_id = ?', [teamId]);
  for (const id of memberIds) await db('INSERT IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)', [teamId, id]);
}

async function createTeam(db, input) {
  const [n] = await db('SELECT COUNT(*) AS n FROM teams');
  if (Number(n.n) >= MAX_TEAMS) return { error: `${MAX_TEAMS} équipes au plus` };
  const r = await clean(db, input);
  if (r.error) return r;
  const v = r.value;
  const { insertId } = await db('INSERT INTO teams (name, color, assign_mode, max_open, subjects, tag_ids, calendar_id, ola_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [v.name, v.color, v.assignMode, v.maxOpen, JSON.stringify(v.subjects), JSON.stringify(v.tagIds), v.calendarId, v.olaMinutes]);
  await saveMembers(db, insertId, v.memberIds);
  await require('./slaEscalation').saveLevels(db, { teamId: insertId }, v.escalations);
  return { ok: true, id: insertId };
}

async function updateTeam(db, id, input) {
  const [row] = await db('SELECT id FROM teams WHERE id = ?', [id]);
  if (!row) return { error: 'Équipe introuvable', status: 404 };
  const r = await clean(db, input);
  if (r.error) return r;
  const v = r.value;
  await db('UPDATE teams SET name = ?, color = ?, assign_mode = ?, max_open = ?, subjects = ?, tag_ids = ?, calendar_id = ?, ola_minutes = ? WHERE id = ?',
    [v.name, v.color, v.assignMode, v.maxOpen, JSON.stringify(v.subjects), JSON.stringify(v.tagIds), v.calendarId, v.olaMinutes, id]);
  await saveMembers(db, id, v.memberIds);
  const E = require('./slaEscalation');
  await E.saveLevels(db, { teamId: id }, v.escalations);
  await E.refreshTeamTickets(db, id); // OLA or calendar changed
  await require('./slaPolicies').refreshOpenTickets(db).catch(() => null);
  return { ok: true };
}

// Its tickets stay, without a team
async function deleteTeam(db, id) {
  const [row] = await db('SELECT id FROM teams WHERE id = ?', [id]);
  if (!row) return { error: 'Équipe introuvable', status: 404 };
  await db('UPDATE tickets SET team_id = NULL, team_since = NULL, ola_due_at = NULL WHERE team_id = ?', [id]);
  await require('./slaEscalation').dropLevels(db, { teamId: id });
  await db('DELETE FROM teams WHERE id = ?', [id]);
  return { ok: true };
}

// ── Routing ──
// The team of a ticket: the first one (by name) that takes its subject, else one of its tags
async function matchTeam(db, ticket) {
  const teams = await listTeams(db);
  if (!teams.length) return null;
  // The team of the sub-category, else of its category (utils/subjectTree.js)
  for (const s of require('./subjectTree').lineage(ticket.subject)) {
    const bySubject = teams.find(t => t.subjects.includes(s));
    if (bySubject) return bySubject;
  }
  const tags = (await db('SELECT tag_id FROM ticket_tag_assignments WHERE ticket_id = ?', [ticket.id])).map(r => Number(r.tag_id));
  const byTag = teams.find(t => t.tagIds.some(id => tags.includes(id)));
  if (byTag) return byTag;
  // Else the team of the requester's organisation (utils/organizations.js), or of its parent
  if (!ticket.organization_id) return null;
  const [o] = await db('SELECT o.team_id, p.team_id AS parent_team FROM organizations o LEFT JOIN organizations p ON p.id = o.parent_id WHERE o.id = ?', [ticket.organization_id]).catch(() => []);
  return teams.find(t => t.id === (o?.team_id || o?.parent_team)) || null;
}

// Can this staff member see the ticket (grade restriction, roles tied to tags)?
async function canSee(db, userId, ticketId) {
  const [u] = await db('SELECT role FROM dashboard_users WHERE user_id = ?', [userId]);
  if (!u) return false;
  if (u.role === 'fondateur') return true;
  const { visibilityFilter } = require('./gradePermissions');
  const vis = await visibilityFilter({ userIsFondateur: false, session: { user: { id: userId } }, guildDb: db });
  const [row] = await db(`SELECT 1 AS ok FROM tickets WHERE id = ? AND ${vis.sql}`, [ticketId, ...vis.params]);
  return !!row;
}

// Who gets the ticket: null when nobody is available
async function pickAssignee(db, team, ticketId) {
  if (!team || team.assignMode === 'none' || !team.members.length) return null;
  const rows = await db(
    `SELECT u.user_id, u.username, u.availability, u.vacation_mode, u.role,
            (SELECT MAX(a.assigned_at) FROM ticket_assignees a WHERE a.user_id = u.user_id) AS last_at
     FROM dashboard_users u WHERE u.user_id IN (?) AND u.role IN ('support', 'fondateur')`, [team.members.map(m => m.userId)]);
  const open = Object.fromEntries(team.members.map(m => [m.userId, m.open]));
  let eligible = [];
  for (const r of rows.sort((a, b) => String(a.user_id).localeCompare(String(b.user_id)))) {
    if (r.availability === 'away' || Number(r.vacation_mode) === 1) continue;
    if (team.maxOpen && open[r.user_id] >= team.maxOpen) continue;
    if (!(await canSee(db, r.user_id, ticketId))) continue;
    eligible.push({ ...r, open: open[r.user_id] || 0 });
  }
  if (!eligible.length) return null;
  // v7: the members with the skills the ticket asks for, then those who speak its language (utils/skills.js)
  const [tk] = await db('SELECT id, subject, owner_id FROM tickets WHERE id = ?', [ticketId]).catch(() => []);
  if (tk) eligible = (await require('./skills').narrow(db, tk, eligible).catch(() => ({ list: eligible }))).list;
  if (team.assignMode === 'load') {
    // Fewest open tickets; on a tie, the one who was given a ticket longest ago
    return eligible.sort((a, b) => a.open - b.open || (new Date(a.last_at || 0) - new Date(b.last_at || 0)))[0];
  }
  // In turn: the next one after the last person this team gave a ticket to
  const [t] = await db('SELECT last_user_id FROM teams WHERE id = ?', [team.id]);
  const i = eligible.findIndex(e => String(e.user_id) > String(t?.last_user_id || ''));
  return eligible[i === -1 ? 0 : i];
}

// Sets the team of a ticket (found from its subject/tags unless given) and, for a team that
// assigns, gives it to someone if nobody has it yet. Returns { teamId, assignee }.
async function routeTicket({ db, tm, ticket, teamId, actor = TEAM_ACTOR }) {
  if (!ticket || ticket.status === 'closed' || ticket.visibility_grade_id === CONFIDENTIAL) return { teamId: null, assignee: null };
  const team = teamId !== undefined ? (teamId ? await teamOf(db, teamId) : null) : (ticket.team_id ? await teamOf(db, ticket.team_id) : await matchTeam(db, ticket));
  if (!team) return { teamId: null, assignee: null };
  if (ticket.team_id !== team.id) {
    await db('UPDATE tickets SET team_id = ? WHERE id = ?', [team.id, ticket.id]);
    await recordEvent(db, { actor, action: 'ticket_team', ticketId: ticket.id, details: { team: team.name } });
    await require('./slaEscalation').onTeamChange(db, ticket.id); // its internal objective (OLA) starts
    await require('./slaPolicies').refreshQuietly(db, ticket.id); // the team's calendar may differ
  }
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM ticket_assignees WHERE ticket_id = ?', [ticket.id]);
  if (Number(n) > 0) return { teamId: team.id, assignee: null };
  const who = await pickAssignee(db, team, ticket.id);
  if (!who) return { teamId: team.id, assignee: null };
  await db('UPDATE teams SET last_user_id = ? WHERE id = ?', [who.user_id, team.id]);
  await tm.addAssignee(ticket.id, { id: who.user_id, username: who.username, tag: who.username }, { ...TEAM_ACTOR, tag: `${TEAM_ACTOR.tag} · ${team.name}`, username: `${TEAM_ACTOR.tag} · ${team.name}` });
  return { teamId: team.id, assignee: who.user_id };
}

module.exports = { MODES, COLORS, MAX_TEAMS, listTeams, teamOf, teamIdsOf, createTeam, updateTeam, deleteTeam, matchTeam, pickAssignee, routeTicket, canSee };

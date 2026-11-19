// Problems (v5.5, conception/v5.md §3.13, ITIL made light): the common cause of several incidents.
// A title, a description, symptoms, a cause, a workaround, a status (open, known error, resolved,
// closed), a person and/or a team, tasks, and the tickets it explains. The workaround is offered
// on the linked tickets (inserted into a reply); resolving the problem can resolve its open
// tickets at once (proposing the solution, utils/resolution.js). Off until a space turns it on.
const { recordEvent } = require('./audit');

const STATUSES = ['open', 'known_error', 'resolved', 'closed'];
const MAX_TEXT = 5000;

async function enabled(db) {
  const [c] = await db('SELECT problems_enabled FROM guild_config WHERE id = 1').catch(() => []);
  return Number(c?.problems_enabled) === 1;
}
const shape = p => ({
  id: p.id, title: p.title, description: p.description || '', symptoms: p.symptoms || '', cause: p.cause || '', workaround: p.workaround || '', solution: p.solution || '',
  status: p.status, assigneeId: p.assignee_id || null, assigneeName: p.assignee_name || null, teamId: p.team_id || null,
  tickets: Number(p.tickets || 0), openTickets: Number(p.open_tickets || 0), createdAt: p.created_at, resolvedAt: p.resolved_at || null,
});
const COUNTS = `(SELECT COUNT(*) FROM problem_tickets pt WHERE pt.problem_id = p.id) AS tickets,
  (SELECT COUNT(*) FROM problem_tickets pt JOIN tickets t ON t.id = pt.ticket_id WHERE pt.problem_id = p.id AND t.status = 'open') AS open_tickets`;
async function listProblems(db, { status = null } = {}) {
  return (await db(`SELECT p.*, u.username AS assignee_name, ${COUNTS} FROM problems p LEFT JOIN dashboard_users u ON u.user_id = p.assignee_id
    ${status ? 'WHERE p.status = ?' : ''} ORDER BY p.status = 'closed', p.id DESC LIMIT 500`, status ? [status] : []).catch(() => [])).map(shape);
}
// One problem with its tickets (through the reader's visibility) and tasks
async function getProblem(db, id, vis) {
  const [p] = await db(`SELECT p.*, u.username AS assignee_name, ${COUNTS} FROM problems p LEFT JOIN dashboard_users u ON u.user_id = p.assignee_id WHERE p.id = ?`, [id]);
  if (!p) return null;
  const tickets = await db(`SELECT t.id, t.subject, t.status, t.owner_tag, t.resolved_at, t.created_at FROM problem_tickets pt JOIN tickets t ON t.id = pt.ticket_id
    WHERE pt.problem_id = ? AND ${vis.sql} ORDER BY t.id DESC`, [id, ...vis.params]);
  const tasks = await db('SELECT id, title, done FROM problem_tasks WHERE problem_id = ? ORDER BY id', [id]);
  return { ...shape(p), linked: tickets, tasks: tasks.map(k => ({ id: k.id, title: k.title, done: !!Number(k.done) })) };
}

async function clean(db, input = {}, partial = false) {
  const v = {};
  const text = k => (typeof input[k] === 'string' ? input[k].slice(0, MAX_TEXT) : '');
  if (!partial || input.title !== undefined) {
    v.title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    if (!v.title) return { error: 'Titre du problème requis' };
  }
  for (const k of ['description', 'symptoms', 'cause', 'workaround']) if (!partial || input[k] !== undefined) v[k] = text(k);
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) return { error: 'Statut invalide' };
    v.status = input.status;
  }
  if (input.assigneeId !== undefined) {
    v.assigneeId = input.assigneeId ? String(input.assigneeId) : null;
    if (v.assigneeId && !(await db("SELECT 1 FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [v.assigneeId])).length) return { error: 'Seul le staff peut s\'en occuper' };
  }
  if (input.teamId !== undefined) {
    v.teamId = input.teamId ? Number(input.teamId) : null;
    if (v.teamId && !(await db('SELECT 1 FROM teams WHERE id = ?', [v.teamId])).length) return { error: 'Équipe introuvable' };
  }
  return { value: v };
}
const COL = { title: 'title', description: 'description', symptoms: 'symptoms', cause: 'cause', workaround: 'workaround', status: 'status', assigneeId: 'assignee_id', teamId: 'team_id' };
async function createProblem(db, input, actor) {
  const r = await clean(db, input);
  if (r.error) return r;
  const v = r.value;
  const ins = await db('INSERT INTO problems (title, description, symptoms, cause, workaround, status, assignee_id, team_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [v.title, v.description || null, v.symptoms || null, v.cause || null, v.workaround || null, v.status || 'open', v.assigneeId || null, v.teamId || null, actor?.id || null]);
  await recordEvent(db, { actor, action: 'problem_create', targetType: 'problem', targetId: ins.insertId, details: { title: v.title } });
  return { ok: true, id: ins.insertId };
}
async function updateProblem(db, id, input, actor) {
  if (!(await db('SELECT 1 FROM problems WHERE id = ?', [id])).length) return { error: 'Problème introuvable', status: 404 };
  const r = await clean(db, input, true);
  if (r.error) return r;
  const sets = [], params = [];
  for (const [k, c] of Object.entries(COL)) if (k in r.value) { sets.push(`${c} = ?`); params.push(r.value[k] === '' ? null : r.value[k]); }
  if (!sets.length) return { ok: true };
  await db(`UPDATE problems SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  await recordEvent(db, { actor, action: 'problem_update', targetType: 'problem', targetId: id, details: { fields: Object.keys(r.value) } });
  return { ok: true };
}

// Links: a ticket the person sees, to an existing problem
async function link(db, problemId, ticketId, actor) {
  if (!(await db('SELECT 1 FROM problems WHERE id = ?', [problemId])).length) return { error: 'Problème introuvable', status: 404 };
  const r = await db('INSERT IGNORE INTO problem_tickets (problem_id, ticket_id) VALUES (?, ?)', [problemId, ticketId]);
  if (r.affectedRows) await recordEvent(db, { actor, action: 'problem_link', ticketId, targetType: 'problem', targetId: problemId });
  return { ok: true };
}
async function unlink(db, problemId, ticketId, actor) {
  const r = await db('DELETE FROM problem_tickets WHERE problem_id = ? AND ticket_id = ?', [problemId, ticketId]);
  if (r.affectedRows) await recordEvent(db, { actor, action: 'problem_unlink', ticketId, targetType: 'problem', targetId: problemId });
  return { ok: true };
}
// The problems of a ticket (ticket view): with their workaround, to offer it in a reply
async function ofTicket(db, ticketId) {
  return (await db(`SELECT p.id, p.title, p.status, p.workaround FROM problem_tickets pt JOIN problems p ON p.id = pt.problem_id WHERE pt.ticket_id = ? ORDER BY p.id`, [ticketId]).catch(() => []))
    .map(p => ({ id: p.id, title: p.title, status: p.status, workaround: p.workaround || '' }));
}

async function addTask(db, problemId, title) {
  const t = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (!t) return { error: 'Intitulé requis' };
  const [n] = await db('SELECT COUNT(*) AS n FROM problem_tasks WHERE problem_id = ?', [problemId]);
  if (Number(n.n) >= 50) return { error: '50 tâches au plus' };
  await db('INSERT INTO problem_tasks (problem_id, title) VALUES (?, ?)', [problemId, t]);
  return { ok: true };
}
async function setTask(db, problemId, taskId, done) {
  const r = await db('UPDATE problem_tasks SET done = ? WHERE id = ? AND problem_id = ?', [done ? 1 : 0, taskId, problemId]);
  return r.affectedRows ? { ok: true } : { error: 'Tâche introuvable', status: 404 };
}

// Resolves the problem; resolveTickets: propose the solution on each of its open tickets the
// person sees (utils/resolution.js). → { resolved, skipped }
async function resolve({ db, client, guildId, id, solution, resolveTickets, actor, vis }) {
  const text = typeof solution === 'string' ? solution.trim().slice(0, 2000) : '';
  if (!text) return { error: 'Écris la solution du problème' };
  if (!(await db('SELECT 1 FROM problems WHERE id = ?', [id])).length) return { error: 'Problème introuvable', status: 404 };
  await db("UPDATE problems SET status = 'resolved', solution = ?, resolved_at = NOW() WHERE id = ?", [text, id]);
  await recordEvent(db, { actor, action: 'problem_resolve', targetType: 'problem', targetId: id, details: { tickets: !!resolveTickets } });
  let resolved = 0, skipped = 0;
  if (resolveTickets) {
    const R = require('./resolution');
    const open = await db(`SELECT t.* FROM problem_tickets pt JOIN tickets t ON t.id = pt.ticket_id WHERE pt.problem_id = ? AND t.status = 'open' AND t.resolved_at IS NULL AND ${vis.sql}`, [id, ...vis.params]);
    for (const t of open) {
      try { await R.resolveTicket({ db, client, guildId, ticket: t, solution: text, actor }); resolved++; } catch { skipped++; }
    }
  }
  return { ok: true, resolved, skipped };
}

module.exports = { STATUSES, enabled, listProblems, getProblem, createProblem, updateProblem, link, unlink, ofTicket, addTask, setTask, resolve };

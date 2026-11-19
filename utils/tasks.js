// Tasks of a ticket (v5.4, conception/v5.md §3.10): steps of work — a title, a description, a
// person and/or a team, a planned duration and the time spent (stopwatch and time added by hand,
// ticket_time.task_id), a planned date, a state (to do, done, not needed), private or visible to
// the requester. Task templates (« new employee » = 6 tasks) are applied by hand or by a rule.
const { parseJsonField } = require('./jsonField');
const { recordEvent } = require('./audit');

const STATES = ['todo', 'done', 'na'];
const MAX_TASKS = 50, MAX_TEMPLATES = 50, MAX_TEMPLATE_TASKS = 30;

const shape = t => ({
  id: t.id, ticketId: t.ticket_id, title: t.title, description: t.description || '', assigneeId: t.assignee_id || null, assigneeName: t.assignee_name || null,
  teamId: t.team_id || null, plannedMinutes: t.planned_minutes || null, spentSeconds: Number(t.spent_seconds || 0), dueAt: t.due_at || null,
  state: t.state, visible: !!Number(t.visible), position: t.position, doneAt: t.done_at || null, doneBy: t.done_by_tag || null, createdAt: t.created_at,
});
async function listTasks(db, ticketId) {
  return (await db(`SELECT k.*, u.username AS assignee_name,
      (SELECT COALESCE(SUM(COALESCE(tt.seconds, LEAST(TIMESTAMPDIFF(SECOND, tt.started_at, NOW()), 28800))), 0) FROM ticket_time tt WHERE tt.task_id = k.id) AS spent_seconds
    FROM ticket_tasks k LEFT JOIN dashboard_users u ON u.user_id = k.assignee_id WHERE k.ticket_id = ? ORDER BY k.position, k.id`, [ticketId]).catch(() => [])).map(shape);
}
const progress = tasks => {
  const counted = tasks.filter(t => t.state !== 'na');
  return { total: counted.length, done: counted.filter(t => t.state === 'done').length };
};

async function clean(db, input = {}, { partial = false } = {}) {
  const v = {};
  if (!partial || input.title !== undefined) {
    v.title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    if (!v.title) return { error: 'Intitulé de la tâche requis (200 caractères au plus)' };
  }
  if (input.description !== undefined) v.description = typeof input.description === 'string' ? input.description.slice(0, 2000) : '';
  if (input.assigneeId !== undefined) {
    v.assigneeId = input.assigneeId ? String(input.assigneeId) : null;
    if (v.assigneeId && !(await db("SELECT 1 FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [v.assigneeId])).length) return { error: 'Seul le staff peut recevoir une tâche' };
  }
  if (input.teamId !== undefined) {
    v.teamId = input.teamId ? Number(input.teamId) : null;
    if (v.teamId && !(await db('SELECT 1 FROM teams WHERE id = ?', [v.teamId])).length) return { error: 'Équipe introuvable' };
  }
  if (input.plannedMinutes !== undefined) {
    const n = input.plannedMinutes === null || input.plannedMinutes === '' ? null : Number(input.plannedMinutes);
    if (n !== null && !(Number.isInteger(n) && n > 0 && n <= 100000)) return { error: 'Durée prévue : en minutes' };
    v.plannedMinutes = n;
  }
  if (input.dueAt !== undefined) {
    v.dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (v.dueAt && Number.isNaN(v.dueAt.getTime())) return { error: 'Date planifiée invalide' };
  }
  if (input.state !== undefined) {
    if (!STATES.includes(input.state)) return { error: 'État invalide' };
    v.state = input.state;
  }
  if (input.visible !== undefined) v.visible = !!input.visible;
  return { value: v };
}

async function addTask(db, ticketId, input, actor, { guildId = null } = {}) {
  const [n] = await db('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS pos FROM ticket_tasks WHERE ticket_id = ?', [ticketId]);
  if (Number(n.n) >= MAX_TASKS) return { error: `${MAX_TASKS} tâches au plus par ticket` };
  const r = await clean(db, input);
  if (r.error) return r;
  const v = r.value;
  const ins = await db('INSERT INTO ticket_tasks (ticket_id, title, description, assignee_id, team_id, planned_minutes, due_at, visible, position, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [ticketId, v.title, v.description || null, v.assigneeId || null, v.teamId || null, v.plannedMinutes || null, v.dueAt || null, v.visible ? 1 : 0, Number(n.pos) + 1, actor?.id || null]);
  await recordEvent(db, { actor, action: 'task_add', ticketId, targetType: 'task', targetId: ins.insertId, details: { title: v.title } });
  if (v.assigneeId && v.assigneeId !== String(actor?.id)) notifyAssignee(db, guildId, ticketId, v.assigneeId, v.title, actor);
  return { ok: true, id: ins.insertId };
}
async function updateTask(db, ticketId, taskId, input, actor, { guildId = null } = {}) {
  const [cur] = await db('SELECT * FROM ticket_tasks WHERE id = ? AND ticket_id = ?', [taskId, ticketId]);
  if (!cur) return { error: 'Tâche introuvable', status: 404 };
  const r = await clean(db, input, { partial: true });
  if (r.error) return r;
  const v = r.value;
  const sets = [], params = [];
  const col = { title: 'title', description: 'description', assigneeId: 'assignee_id', teamId: 'team_id', plannedMinutes: 'planned_minutes', dueAt: 'due_at', visible: 'visible' };
  for (const [k, c] of Object.entries(col)) if (k in v) { sets.push(`${c} = ?`); params.push(k === 'visible' ? (v[k] ? 1 : 0) : v[k] ?? null); }
  if ('state' in v && v.state !== cur.state) {
    sets.push('state = ?', 'done_at = ?', 'done_by_tag = ?');
    params.push(v.state, v.state === 'todo' ? null : new Date(), v.state === 'todo' ? null : (actor?.username || actor?.tag || null));
  }
  if (!sets.length) return { ok: true };
  await db(`UPDATE ticket_tasks SET ${sets.join(', ')} WHERE id = ?`, [...params, taskId]);
  if ('state' in v && v.state !== cur.state) await recordEvent(db, { actor, action: 'task_state', ticketId, targetType: 'task', targetId: taskId, details: { title: cur.title, state: v.state } });
  if (v.assigneeId && v.assigneeId !== cur.assignee_id && v.assigneeId !== String(actor?.id)) notifyAssignee(db, guildId, ticketId, v.assigneeId, v.title || cur.title, actor);
  return { ok: true };
}
async function deleteTask(db, ticketId, taskId, actor) {
  const [cur] = await db('SELECT title FROM ticket_tasks WHERE id = ? AND ticket_id = ?', [taskId, ticketId]);
  if (!cur) return { error: 'Tâche introuvable', status: 404 };
  await db('UPDATE ticket_time SET task_id = NULL WHERE task_id = ?', [taskId]); // the time stays on the ticket
  await db('DELETE FROM ticket_tasks WHERE id = ?', [taskId]);
  await recordEvent(db, { actor, action: 'task_delete', ticketId, targetType: 'task', targetId: taskId, details: { title: cur.title } });
  return { ok: true };
}

// The person given a task is told in the dashboard (if they can see the ticket)
function notifyAssignee(db, guildId, ticketId, userId, title, actor) {
  if (!guildId) return;
  (async () => {
    const [t] = await db('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    if (!t || !(await require('./gradePermissions').canUserSeeTicket(db, userId, t).catch(() => false))) return;
    const by = actor?.username || actor?.tag || 'Quelqu\'un';
    require('./sse').sendToUser(guildId, userId, 'followed', { ticketId, subject: null, kind: 'task', title: `Tâche pour toi · #${ticketId}`, body: `${by} : ${title}`.slice(0, 160) });
  })().catch(() => null);
}

// ── Templates ──
const shapeTpl = r => ({ id: r.id, name: r.name, tasks: parseJsonField(r.tasks, []) || [] });
async function listTemplates(db) { return (await db('SELECT * FROM task_templates ORDER BY name').catch(() => [])).map(shapeTpl); }
async function saveTemplate(db, id, input = {}) {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  if (!name) return { error: 'Nom du modèle requis' };
  const raw = Array.isArray(input.tasks) ? input.tasks : [];
  if (!raw.length || raw.length > MAX_TEMPLATE_TASKS) return { error: `De 1 à ${MAX_TEMPLATE_TASKS} tâches` };
  const tasks = [];
  for (const t of raw) {
    const r = await clean(db, { title: t.title, description: t.description, teamId: t.teamId, plannedMinutes: t.plannedMinutes, visible: t.visible });
    if (r.error) return r;
    const days = t.dueInDays === undefined || t.dueInDays === null || t.dueInDays === '' ? null : Number(t.dueInDays);
    if (days !== null && !(Number.isInteger(days) && days >= 0 && days <= 365)) return { error: 'Échéance : de 0 à 365 jours après l\'application' };
    tasks.push({ title: r.value.title, description: r.value.description || '', teamId: r.value.teamId || null, plannedMinutes: r.value.plannedMinutes || null, visible: !!r.value.visible, dueInDays: days });
  }
  if (id) {
    const res = await db('UPDATE task_templates SET name = ?, tasks = ? WHERE id = ?', [name, JSON.stringify(tasks), id]);
    return res.affectedRows ? { ok: true, id } : { error: 'Modèle introuvable', status: 404 };
  }
  const [n] = await db('SELECT COUNT(*) AS n FROM task_templates');
  if (Number(n.n) >= MAX_TEMPLATES) return { error: `${MAX_TEMPLATES} modèles au plus` };
  return { ok: true, id: (await db('INSERT INTO task_templates (name, tasks) VALUES (?, ?)', [name, JSON.stringify(tasks)])).insertId };
}
async function deleteTemplate(db, id) {
  const r = await db('DELETE FROM task_templates WHERE id = ?', [id]);
  return r.affectedRows ? { ok: true } : { error: 'Modèle introuvable', status: 404 };
}
// Adds the tasks of a template to a ticket: { added } or { error }
async function applyTemplate(db, ticketId, templateId, actor, opts = {}) {
  const [row] = await db('SELECT * FROM task_templates WHERE id = ?', [templateId]);
  if (!row) return { error: 'Modèle introuvable', status: 404 };
  const tpl = shapeTpl(row);
  let added = 0;
  for (const t of tpl.tasks) {
    const r = await addTask(db, ticketId, { ...t, dueAt: t.dueInDays !== null && t.dueInDays !== undefined ? new Date(Date.now() + t.dueInDays * 864e5) : null }, actor, opts);
    if (r.error) return added ? { added, error: r.error } : r;
    added++;
  }
  await recordEvent(db, { actor, action: 'task_template_apply', ticketId, details: { template: tpl.name, tasks: added } });
  return { added };
}

// Tasks the requester may see (member space)
async function visibleTasks(db, ticketId) {
  return (await db("SELECT title, state, due_at FROM ticket_tasks WHERE ticket_id = ? AND visible = 1 ORDER BY position, id", [ticketId]).catch(() => []))
    .map(t => ({ title: t.title, state: t.state, dueAt: t.due_at }));
}

module.exports = { STATES, listTasks, progress, addTask, updateTask, deleteTask, listTemplates, saveTemplate, deleteTemplate, applyTemplate, visibleTasks };

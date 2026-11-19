// Changes (v5.5, conception/v5.md §3.13, ITIL made light): a planned change (an update, a
// migration). A description, the deployment plan and the rollback plan, the risks and the
// impact, a planned window, a person and/or a team, tasks, the tickets and problems it deals
// with, and approvals by staff members. Status: draft → pending approval → approved (or refused)
// → in progress → done (or failed); cancelled at any time. It can start only once approved.
// Off until a space turns it on.
const { recordEvent } = require('./audit');

const STATUSES = ['draft', 'pending', 'approved', 'refused', 'in_progress', 'done', 'failed', 'cancelled'];
const RISKS = ['low', 'medium', 'high'];
// Which status may follow which (approval and refusal come from the approvals)
const NEXT = { draft: ['pending', 'cancelled'], pending: ['draft', 'cancelled'], approved: ['in_progress', 'cancelled'], refused: ['draft', 'cancelled'],
  in_progress: ['done', 'failed'], done: [], failed: ['draft'], cancelled: ['draft'] };
const MAX_TEXT = 5000;

async function enabled(db) {
  const [c] = await db('SELECT changes_enabled FROM guild_config WHERE id = 1').catch(() => []);
  return Number(c?.changes_enabled) === 1;
}
const shape = c => ({
  id: c.id, title: c.title, description: c.description || '', deployPlan: c.deploy_plan || '', rollbackPlan: c.rollback_plan || '', risks: c.risks || '', impact: c.impact || '',
  risk: c.risk_level, status: c.status, assigneeId: c.assignee_id || null, assigneeName: c.assignee_name || null, teamId: c.team_id || null,
  startsAt: c.starts_at || null, endsAt: c.ends_at || null, createdAt: c.created_at,
});
async function listChanges(db) {
  return (await db(`SELECT c.*, u.username AS assignee_name FROM changes c LEFT JOIN dashboard_users u ON u.user_id = c.assignee_id
    ORDER BY c.status IN ('done', 'cancelled'), COALESCE(c.starts_at, c.created_at) DESC LIMIT 500`).catch(() => [])).map(shape);
}
async function getChange(db, id, vis) {
  const [c] = await db('SELECT c.*, u.username AS assignee_name FROM changes c LEFT JOIN dashboard_users u ON u.user_id = c.assignee_id WHERE c.id = ?', [id]);
  if (!c) return null;
  const tickets = await db(`SELECT t.id, t.subject, t.status FROM change_links l JOIN tickets t ON t.id = l.target_id WHERE l.change_id = ? AND l.kind = 'ticket' AND ${vis.sql} ORDER BY t.id DESC`, [id, ...vis.params]);
  const problems = await db("SELECT p.id, p.title, p.status FROM change_links l JOIN problems p ON p.id = l.target_id WHERE l.change_id = ? AND l.kind = 'problem' ORDER BY p.id DESC", [id]).catch(() => []);
  const approvals = await db('SELECT a.id, a.approver_id, u.username, a.decision, a.comment, a.decided_at FROM change_approvals a LEFT JOIN dashboard_users u ON u.user_id = a.approver_id WHERE a.change_id = ? ORDER BY a.id', [id]);
  const tasks = await db('SELECT id, title, done FROM change_tasks WHERE change_id = ? ORDER BY id', [id]);
  return { ...shape(c), tickets, problems,
    approvals: approvals.map(a => ({ id: a.id, approverId: a.approver_id, approverName: a.username || a.approver_id, decision: a.decision, comment: a.comment || '', decidedAt: a.decided_at })),
    tasks: tasks.map(k => ({ id: k.id, title: k.title, done: !!Number(k.done) })) };
}

async function clean(db, input = {}, partial = false) {
  const v = {};
  if (!partial || input.title !== undefined) {
    v.title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    if (!v.title) return { error: 'Titre du changement requis' };
  }
  for (const [k, c] of [['description', 'description'], ['deployPlan', 'deploy_plan'], ['rollbackPlan', 'rollback_plan'], ['risks', 'risks'], ['impact', 'impact']]) {
    if (!partial || input[k] !== undefined) v[c] = typeof input[k] === 'string' ? input[k].slice(0, MAX_TEXT) : '';
  }
  if (input.risk !== undefined) { if (!RISKS.includes(input.risk)) return { error: 'Niveau de risque invalide' }; v.risk_level = input.risk; }
  if (input.assigneeId !== undefined) {
    v.assignee_id = input.assigneeId ? String(input.assigneeId) : null;
    if (v.assignee_id && !(await db("SELECT 1 FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [v.assignee_id])).length) return { error: 'Seul le staff peut le mener' };
  }
  if (input.teamId !== undefined) {
    v.team_id = input.teamId ? Number(input.teamId) : null;
    if (v.team_id && !(await db('SELECT 1 FROM teams WHERE id = ?', [v.team_id])).length) return { error: 'Équipe introuvable' };
  }
  for (const [k, c] of [['startsAt', 'starts_at'], ['endsAt', 'ends_at']]) {
    if (input[k] === undefined) continue;
    v[c] = input[k] ? new Date(input[k]) : null;
    if (v[c] && Number.isNaN(v[c].getTime())) return { error: 'Date du créneau invalide' };
  }
  if (v.starts_at && v.ends_at && v.ends_at <= v.starts_at) return { error: 'La fin du créneau doit suivre son début' };
  return { value: v };
}
async function createChange(db, input, actor) {
  const r = await clean(db, input);
  if (r.error) return r;
  const v = r.value;
  const cols = Object.keys(v);
  const ins = await db(`INSERT INTO changes (${cols.join(', ')}, created_by) VALUES (${cols.map(() => '?').join(', ')}, ?)`, [...cols.map(k => (v[k] === '' ? null : v[k])), actor?.id || null]);
  await recordEvent(db, { actor, action: 'change_create', targetType: 'change', targetId: ins.insertId, details: { title: v.title } });
  return { ok: true, id: ins.insertId };
}
async function updateChange(db, id, input, actor) {
  const [cur] = await db('SELECT status FROM changes WHERE id = ?', [id]);
  if (!cur) return { error: 'Changement introuvable', status: 404 };
  // The plans are frozen once approved: changing them goes back through the approvals
  if (['approved', 'in_progress', 'done'].includes(cur.status) && ['deployPlan', 'rollbackPlan', 'risks', 'risk'].some(k => input[k] !== undefined)) return { error: 'Plans et risques figés une fois validé : repasse en brouillon pour les changer', status: 409 };
  const r = await clean(db, input, true);
  if (r.error) return r;
  const cols = Object.keys(r.value);
  if (!cols.length) return { ok: true };
  await db(`UPDATE changes SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map(k => (r.value[k] === '' ? null : r.value[k])), id]);
  await recordEvent(db, { actor, action: 'change_update', targetType: 'change', targetId: id, details: { fields: cols } });
  return { ok: true };
}

// Status change by hand (approved / refused come from the approvals)
async function setStatus(db, id, status, actor) {
  const [cur] = await db('SELECT status FROM changes WHERE id = ?', [id]);
  if (!cur) return { error: 'Changement introuvable', status: 404 };
  if (!STATUSES.includes(status) || !(NEXT[cur.status] || []).includes(status)) return { error: `Impossible de passer de « ${cur.status} » à « ${status} »`, status: 409 };
  if (status === 'pending' && !(await db('SELECT 1 FROM change_approvals WHERE change_id = ?', [id])).length) return { error: 'Ajoute au moins une validation avant de la demander', status: 409 };
  if (status === 'draft') await db("UPDATE change_approvals SET decision = 'pending', comment = NULL, decided_at = NULL WHERE change_id = ?", [id]);
  await db('UPDATE changes SET status = ? WHERE id = ?', [status, id]);
  await recordEvent(db, { actor, action: 'change_status', targetType: 'change', targetId: id, details: { from: cur.status, to: status } });
  return { ok: true };
}

// ── Approvals: staff members; the change is approved when all approved, refused at the first no ──
async function addApprover(db, id, userId, actor) {
  const [cur] = await db('SELECT status FROM changes WHERE id = ?', [id]);
  if (!cur) return { error: 'Changement introuvable', status: 404 };
  if (!['draft', 'refused'].includes(cur.status)) return { error: 'Les validations se choisissent en brouillon', status: 409 };
  if (!(await db("SELECT 1 FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [String(userId)])).length) return { error: 'Seul le staff valide un changement' };
  const [n] = await db('SELECT COUNT(*) AS n FROM change_approvals WHERE change_id = ?', [id]);
  if (Number(n.n) >= 10) return { error: '10 validations au plus' };
  await db("INSERT IGNORE INTO change_approvals (change_id, approver_id, decision) VALUES (?, ?, 'pending')", [id, String(userId)]);
  return { ok: true };
}
async function removeApprover(db, id, approvalId) {
  const [cur] = await db('SELECT status FROM changes WHERE id = ?', [id]);
  if (!cur || !['draft', 'refused'].includes(cur.status)) return { error: 'Les validations se choisissent en brouillon', status: 409 };
  await db('DELETE FROM change_approvals WHERE id = ? AND change_id = ?', [approvalId, id]);
  return { ok: true };
}
async function decide(db, id, approverId, decision, comment, actor) {
  const [cur] = await db('SELECT status FROM changes WHERE id = ?', [id]);
  if (!cur) return { error: 'Changement introuvable', status: 404 };
  if (cur.status !== 'pending') return { error: 'Ce changement n\'attend pas de validation', status: 409 };
  if (!['approved', 'refused'].includes(decision)) return { error: 'Décision invalide' };
  const r = await db("UPDATE change_approvals SET decision = ?, comment = ?, decided_at = NOW() WHERE change_id = ? AND approver_id = ? AND decision = 'pending'",
    [decision, typeof comment === 'string' ? comment.slice(0, 1000) : null, id, String(approverId)]);
  if (!r.affectedRows) return { error: 'Tu n\'es pas parmi les personnes qui valident ce changement, ou tu as déjà répondu', status: 403 };
  await recordEvent(db, { actor, action: 'change_approval', targetType: 'change', targetId: id, details: { decision } });
  const all = await db('SELECT decision FROM change_approvals WHERE change_id = ?', [id]);
  const next = all.some(a => a.decision === 'refused') ? 'refused' : all.every(a => a.decision === 'approved') ? 'approved' : null;
  if (next) {
    await db('UPDATE changes SET status = ? WHERE id = ?', [next, id]);
    await recordEvent(db, { actor, action: 'change_status', targetType: 'change', targetId: id, details: { from: 'pending', to: next } });
  }
  return { ok: true, status: next || 'pending' };
}

async function link(db, id, kind, targetId, actor) {
  if (!(await db('SELECT 1 FROM changes WHERE id = ?', [id])).length) return { error: 'Changement introuvable', status: 404 };
  if (kind === 'problem' && !(await db('SELECT 1 FROM problems WHERE id = ?', [targetId]).catch(() => [])).length) return { error: 'Problème introuvable', status: 404 };
  const r = await db('INSERT IGNORE INTO change_links (change_id, kind, target_id) VALUES (?, ?, ?)', [id, kind, targetId]);
  if (r.affectedRows) await recordEvent(db, { actor, action: 'change_link', ticketId: kind === 'ticket' ? targetId : null, targetType: 'change', targetId: id, details: { kind, id: targetId } });
  return { ok: true };
}
async function unlink(db, id, kind, targetId) { await db('DELETE FROM change_links WHERE change_id = ? AND kind = ? AND target_id = ?', [id, kind, targetId]); return { ok: true }; }
async function addTask(db, id, title) {
  const t = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (!t) return { error: 'Intitulé requis' };
  const [n] = await db('SELECT COUNT(*) AS n FROM change_tasks WHERE change_id = ?', [id]);
  if (Number(n.n) >= 50) return { error: '50 tâches au plus' };
  await db('INSERT INTO change_tasks (change_id, title) VALUES (?, ?)', [id, t]);
  return { ok: true };
}
async function setTask(db, id, taskId, done) {
  const r = await db('UPDATE change_tasks SET done = ? WHERE id = ? AND change_id = ?', [done ? 1 : 0, taskId, id]);
  return r.affectedRows ? { ok: true } : { error: 'Tâche introuvable', status: 404 };
}
// Changes of a ticket (ticket view)
async function ofTicket(db, ticketId) {
  return (await db("SELECT c.id, c.title, c.status, c.starts_at FROM change_links l JOIN changes c ON c.id = l.change_id WHERE l.kind = 'ticket' AND l.target_id = ? ORDER BY c.id", [ticketId]).catch(() => []))
    .map(c => ({ id: c.id, title: c.title, status: c.status, startsAt: c.starts_at }));
}
// For the planning (utils/planning.js): the changes someone leads in a period
async function inPeriod(db, userIds, teamId, from, to) {
  return (await db(`SELECT id, title, status, starts_at, ends_at, assignee_id FROM changes WHERE starts_at < ? AND COALESCE(ends_at, starts_at) >= ?
    AND status NOT IN ('cancelled', 'draft', 'refused') AND (assignee_id IN (?)${teamId ? ' OR team_id = ?' : ''}) LIMIT 200`, [to, from, userIds.length ? userIds : ['-'], ...(teamId ? [teamId] : [])]).catch(() => []))
    .map(c => ({ id: c.id, title: c.title, status: c.status, startsAt: c.starts_at, endsAt: c.ends_at }));
}

module.exports = { STATUSES, RISKS, enabled, listChanges, getChange, createChange, updateChange, setStatus, addApprover, removeApprover, decide, link, unlink, addTask, setTask, ofTicket, inPeriod };

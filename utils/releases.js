// Releases (v7, conception/v7.md §3.5, ITIL made light): a release groups changes and takes them
// to production together. Stages: preparation → test → deployment → verification → done; it can
// be rolled back once deploying, or cancelled before. Each stage has its checklist: a stage is left
// only once its steps are done. Deploying needs every change approved (they go « in progress »);
// done makes them « done », rolled back makes them « failed ». A rollback plan and a review (what
// went well or not) are written on it; the review is required to finish. On with the changes.
const { recordEvent } = require('./audit');

const STAGES = ['preparation', 'test', 'deployment', 'verification'];
const STATUSES = [...STAGES, 'done', 'rolled_back', 'cancelled'];
const NEXT = { preparation: ['test', 'cancelled'], test: ['deployment', 'preparation', 'cancelled'], deployment: ['verification', 'rolled_back'], verification: ['done', 'rolled_back'], done: [], rolled_back: ['preparation'], cancelled: ['preparation'] };
const MAX_TEXT = 5000, MAX_STEPS = 60, MAX_CHANGES = 50;

const shape = r => ({
  id: r.id, title: r.title, description: r.description || '', status: r.status, rollbackPlan: r.rollback_plan || '', review: r.review || '',
  assigneeId: r.assignee_id || null, assigneeName: r.assignee_name || null, startsAt: r.starts_at || null, endsAt: r.ends_at || null,
  changes: Number(r.changes || 0), createdAt: r.created_at, finishedAt: r.finished_at || null,
});
const SELECT = `SELECT r.*, u.username AS assignee_name, (SELECT COUNT(*) FROM release_changes rc WHERE rc.release_id = r.id) AS changes
  FROM releases r LEFT JOIN dashboard_users u ON u.user_id = r.assignee_id`;

async function listReleases(db) {
  return (await db(`${SELECT} ORDER BY r.status IN ('done', 'cancelled', 'rolled_back'), COALESCE(r.starts_at, r.created_at) DESC LIMIT 300`).catch(() => [])).map(shape);
}
async function getRelease(db, id) {
  const [r] = await db(`${SELECT} WHERE r.id = ?`, [id]);
  if (!r) return null;
  const changes = await db('SELECT c.id, c.title, c.status, c.risk_level FROM release_changes rc JOIN changes c ON c.id = rc.change_id WHERE rc.release_id = ? ORDER BY c.id', [id]);
  const steps = await db('SELECT id, stage, title, done, done_by_tag, done_at FROM release_steps WHERE release_id = ? ORDER BY FIELD(stage, ?, ?, ?, ?), id', [id, ...STAGES]);
  return { ...shape(r), changes: changes.map(c => ({ id: c.id, title: c.title, status: c.status, risk: c.risk_level })),
    steps: steps.map(s => ({ id: s.id, stage: s.stage, title: s.title, done: !!Number(s.done), doneBy: s.done_by_tag || null, doneAt: s.done_at || null })) };
}

async function clean(db, input = {}, partial = false) {
  const v = {};
  if (!partial || input.title !== undefined) {
    v.title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    if (!v.title) return { error: 'Titre de la mise en production requis' };
  }
  for (const [k, c] of [['description', 'description'], ['rollbackPlan', 'rollback_plan'], ['review', 'review']]) {
    if (input[k] !== undefined) v[c] = typeof input[k] === 'string' ? input[k].slice(0, MAX_TEXT) : '';
  }
  if (input.assigneeId !== undefined) {
    v.assignee_id = input.assigneeId ? String(input.assigneeId) : null;
    if (v.assignee_id && !(await db("SELECT 1 FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [v.assignee_id])).length) return { error: 'Seul le staff peut la mener' };
  }
  for (const [k, c] of [['startsAt', 'starts_at'], ['endsAt', 'ends_at']]) {
    if (input[k] === undefined) continue;
    v[c] = input[k] ? new Date(input[k]) : null;
    if (v[c] && Number.isNaN(v[c].getTime())) return { error: 'Date invalide' };
  }
  if (v.starts_at && v.ends_at && v.ends_at <= v.starts_at) return { error: 'La fin du créneau doit suivre son début' };
  return { value: v };
}
async function createRelease(db, input, actor) {
  const r = await clean(db, input);
  if (r.error) return r;
  const v = r.value;
  const cols = Object.keys(v);
  const id = (await db(`INSERT INTO releases (${cols.join(', ')}, created_by) VALUES (${cols.map(() => '?').join(', ')}, ?)`, [...cols.map(c => v[c]), actor?.id || null])).insertId;
  await recordEvent(db, { actor, action: 'release_create', targetType: 'release', targetId: id, details: { title: v.title } });
  return { ok: true, id };
}
async function updateRelease(db, id, input, actor) {
  if (!(await db('SELECT 1 FROM releases WHERE id = ?', [id])).length) return { error: 'Mise en production introuvable', status: 404 };
  const r = await clean(db, input, true);
  if (r.error) return r;
  const cols = Object.keys(r.value);
  if (!cols.length) return { ok: true };
  await db(`UPDATE releases SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => r.value[c]), id]);
  await recordEvent(db, { actor, action: 'release_update', targetType: 'release', targetId: id, details: { fields: cols } });
  return { ok: true };
}
async function deleteRelease(db, id) {
  const [r] = await db('SELECT status FROM releases WHERE id = ?', [id]);
  if (!r) return { error: 'Mise en production introuvable', status: 404 };
  if (['deployment', 'verification'].includes(r.status)) return { error: 'Une mise en production en cours ne se supprime pas', status: 409 };
  await db('DELETE FROM releases WHERE id = ?', [id]);
  return { ok: true };
}

// ── Changes and steps ──
async function addChange(db, id, changeId, actor) {
  const [r] = await db('SELECT status FROM releases WHERE id = ?', [id]);
  if (!r) return { error: 'Mise en production introuvable', status: 404 };
  if (!['preparation', 'test'].includes(r.status)) return { error: 'On n\'ajoute un changement qu\'en préparation ou en test', status: 409 };
  const [c] = await db('SELECT id, status FROM changes WHERE id = ?', [changeId]);
  if (!c) return { error: 'Changement introuvable', status: 404 };
  if (['done', 'cancelled'].includes(c.status)) return { error: 'Ce changement est déjà terminé ou annulé' };
  const [other] = await db("SELECT r.id FROM release_changes rc JOIN releases r ON r.id = rc.release_id WHERE rc.change_id = ? AND r.id <> ? AND r.status NOT IN ('done', 'rolled_back', 'cancelled')", [changeId, id]);
  if (other) return { error: `Ce changement est déjà dans la mise en production #${other.id}` };
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM release_changes WHERE release_id = ?', [id]);
  if (Number(n) >= MAX_CHANGES) return { error: `${MAX_CHANGES} changements au plus` };
  const ins = await db('INSERT IGNORE INTO release_changes (release_id, change_id) VALUES (?, ?)', [id, changeId]);
  if (ins.affectedRows) await recordEvent(db, { actor, action: 'release_change_add', targetType: 'release', targetId: id, details: { change: changeId } });
  return { ok: true };
}
async function removeChange(db, id, changeId) {
  const [r] = await db('SELECT status FROM releases WHERE id = ?', [id]);
  if (r && !['preparation', 'test'].includes(r.status)) return { error: 'On ne retire un changement qu\'en préparation ou en test', status: 409 };
  await db('DELETE FROM release_changes WHERE release_id = ? AND change_id = ?', [id, changeId]);
  return { ok: true };
}
async function addStep(db, id, stage, title) {
  if (!STAGES.includes(stage)) return { error: 'Étape : préparation, test, déploiement ou vérification' };
  const t = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (!t) return { error: 'Intitulé requis' };
  if (!(await db('SELECT 1 FROM releases WHERE id = ?', [id])).length) return { error: 'Mise en production introuvable', status: 404 };
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM release_steps WHERE release_id = ?', [id]);
  if (Number(n) >= MAX_STEPS) return { error: `${MAX_STEPS} points au plus` };
  await db('INSERT INTO release_steps (release_id, stage, title) VALUES (?, ?, ?)', [id, stage, t]);
  return { ok: true };
}
async function setStep(db, id, stepId, done, actor) {
  const r = await db('UPDATE release_steps SET done = ?, done_by_tag = ?, done_at = ? WHERE id = ? AND release_id = ?',
    [done ? 1 : 0, done ? String(actor?.username || actor?.tag || '').slice(0, 100) : null, done ? new Date() : null, stepId, id]);
  return r.affectedRows ? { ok: true } : { error: 'Point introuvable', status: 404 };
}
async function deleteStep(db, id, stepId) {
  await db('DELETE FROM release_steps WHERE id = ? AND release_id = ?', [stepId, id]);
  return { ok: true };
}

// ── Status ──
async function setStatus(db, id, status, actor) {
  const rel = await getRelease(db, id);
  if (!rel) return { error: 'Mise en production introuvable', status: 404 };
  if (!STATUSES.includes(status) || !NEXT[rel.status].includes(status)) return { error: `On ne passe pas de « ${rel.status} » à « ${status} »`, status: 409 };
  const forward = STAGES.indexOf(status) > STAGES.indexOf(rel.status) || status === 'done';
  if (forward && STAGES.includes(rel.status)) {
    const left = rel.steps.filter(s => s.stage === rel.status && !s.done).length;
    if (left) return { error: `Il reste ${left} point(s) à cocher dans cette étape`, status: 409 };
  }
  if (status === 'deployment') {
    if (!rel.changes.length) return { error: 'Ajoute d\'abord au moins un changement', status: 409 };
    const notReady = rel.changes.filter(c => !['approved', 'in_progress'].includes(c.status));
    if (notReady.length) return { error: `Changements pas encore approuvés : ${notReady.map(c => `#${c.id}`).join(', ')}`, status: 409 };
  }
  if (['done', 'rolled_back'].includes(status) && !rel.review.trim()) return { error: 'Écris d\'abord le bilan', status: 409 };
  await db(`UPDATE releases SET status = ?, finished_at = ${['done', 'rolled_back', 'cancelled'].includes(status) ? 'NOW()' : 'NULL'} WHERE id = ?`, [status, id]);
  // The changes follow
  const ids = rel.changes.map(c => c.id);
  const move = async (from, to) => {
    for (const c of rel.changes.filter(x => from.includes(x.status))) {
      await db('UPDATE changes SET status = ? WHERE id = ?', [to, c.id]);
      await recordEvent(db, { actor, action: 'change_status', targetType: 'change', targetId: c.id, details: { status: to, release: id } });
    }
  };
  if (ids.length && status === 'deployment') await move(['approved'], 'in_progress');
  if (ids.length && status === 'done') await move(['in_progress'], 'done');
  if (ids.length && status === 'rolled_back') await move(['in_progress'], 'failed');
  await recordEvent(db, { actor, action: 'release_status', targetType: 'release', targetId: id, details: { status } });
  return { ok: true };
}

// The release a change belongs to (change view)
async function ofChange(db, changeId) {
  const [r] = await db("SELECT r.id, r.title, r.status FROM release_changes rc JOIN releases r ON r.id = rc.release_id WHERE rc.change_id = ? ORDER BY r.status IN ('done', 'rolled_back', 'cancelled'), r.id DESC LIMIT 1", [changeId]).catch(() => []);
  return r || null;
}

module.exports = { STAGES, STATUSES, NEXT, listReleases, getRelease, createRelease, updateRelease, deleteRelease, addChange, removeChange, addStep, setStep, deleteStep, setStatus, ofChange };

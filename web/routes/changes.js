// Changes (utils/changes.js), when the space turned them on (founders). Read by the staff;
// written with the reply_ticket permission; each approver decides for themself.
const express = require('express');
const router = express.Router();
const C = require('../../utils/changes');
const { visibilityFilter, getUserPermissions } = require('../../utils/gradePermissions');
const { recordEvent, dashboardActor } = require('../../utils/audit');

router.get('/settings', async (req, res, next) => { try { res.json({ enabled: await C.enabled(req.guildDb) }); } catch (err) { next(err); } });
router.put('/settings', async (req, res, next) => {
  try {
    if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé aux fondateurs' });
    await req.guildDb('UPDATE guild_config SET changes_enabled = ? WHERE id = 1', [req.body?.enabled ? 1 : 0]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'changes_toggle', details: { enabled: !!req.body?.enabled } });
    res.json({ enabled: !!req.body?.enabled });
  } catch (err) { next(err); }
});
router.use(async (req, res, next) => ((await C.enabled(req.guildDb).catch(() => false)) ? next() : res.status(404).json({ error: 'Les changements ne sont pas activés' })));
const canWrite = async req => req.userIsFondateur || (req.userPermissions || await getUserPermissions(req.session.user.id, req.guildDb)).has('reply_ticket');
router.use(async (req, res, next) => {
  // Deciding is for the approvers themselves, whatever their permissions
  if (req.method === 'GET' || /\/decide$/.test(req.path)) return next();
  return (await canWrite(req)) ? next() : res.status(403).json({ error: 'Permission « Répondre » requise' });
});

const one = async (req, id) => { const c = await C.getChange(req.guildDb, id, await visibilityFilter(req, 't.visibility_grade_id')); return c && { ...c, release: await require('../../utils/releases').ofChange(req.guildDb, id) }; };
const visibleTicket = async (req, id) => {
  const vis = await visibilityFilter(req, 'visibility_grade_id');
  const [t] = await req.guildDb(`SELECT id FROM tickets WHERE id = ? AND ${vis.sql}`, [id, ...vis.params]);
  return t || null;
};
const send = async (req, res, r, id) => (r.error ? res.status(r.status || 400).json({ error: r.error }) : res.json(await one(req, id)));

router.get('/', async (req, res, next) => { try { res.json({ changes: await C.listChanges(req.guildDb) }); } catch (err) { next(err); } });
router.get('/ticket/:ticketId', async (req, res, next) => {
  try {
    const t = await visibleTicket(req, parseInt(req.params.ticketId) || 0);
    if (!t) return res.status(404).json({ error: 'Ticket introuvable' });
    res.json({ changes: await C.ofTicket(req.guildDb, t.id) });
  } catch (err) { next(err); }
});
router.get('/:id', async (req, res, next) => {
  try { const c = await one(req, parseInt(req.params.id) || 0); return c ? res.json(c) : res.status(404).json({ error: 'Changement introuvable' }); } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try {
    const r = await C.createChange(req.guildDb, req.body || {}, dashboardActor(req));
    if (r.error) return res.status(400).json({ error: r.error });
    if (req.body?.ticketId && await visibleTicket(req, parseInt(req.body.ticketId) || 0)) await C.link(req.guildDb, r.id, 'ticket', parseInt(req.body.ticketId), dashboardActor(req));
    res.json(await one(req, r.id));
  } catch (err) { next(err); }
});
router.patch('/:id', async (req, res, next) => {
  try { const id = parseInt(req.params.id) || 0; await send(req, res, await C.updateChange(req.guildDb, id, req.body || {}, dashboardActor(req)), id); } catch (err) { next(err); }
});
router.post('/:id/status', async (req, res, next) => {
  try { const id = parseInt(req.params.id) || 0; await send(req, res, await C.setStatus(req.guildDb, id, req.body?.status, dashboardActor(req)), id); } catch (err) { next(err); }
});
router.post('/:id/approvers', async (req, res, next) => {
  try { const id = parseInt(req.params.id) || 0; await send(req, res, await C.addApprover(req.guildDb, id, req.body?.userId, dashboardActor(req)), id); } catch (err) { next(err); }
});
router.delete('/:id/approvers/:approvalId', async (req, res, next) => {
  try { const id = parseInt(req.params.id) || 0; await send(req, res, await C.removeApprover(req.guildDb, id, parseInt(req.params.approvalId) || 0), id); } catch (err) { next(err); }
});
// POST /api/changes/:id/decide { decision: approved | refused, comment } — by an approver
router.post('/:id/decide', async (req, res, next) => {
  try { const id = parseInt(req.params.id) || 0; await send(req, res, await C.decide(req.guildDb, id, req.session.user.id, req.body?.decision, req.body?.comment, dashboardActor(req)), id); } catch (err) { next(err); }
});
router.post('/:id/links', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const kind = req.body?.kind === 'problem' ? 'problem' : 'ticket';
    const target = parseInt(req.body?.targetId) || 0;
    if (kind === 'ticket' && !(await visibleTicket(req, target))) return res.status(404).json({ error: 'Ticket introuvable' });
    await send(req, res, await C.link(req.guildDb, id, kind, target, dashboardActor(req)), id);
  } catch (err) { next(err); }
});
router.delete('/:id/links/:kind/:targetId', async (req, res, next) => {
  try { const id = parseInt(req.params.id) || 0; await send(req, res, await C.unlink(req.guildDb, id, req.params.kind === 'problem' ? 'problem' : 'ticket', parseInt(req.params.targetId) || 0), id); } catch (err) { next(err); }
});
router.post('/:id/tasks', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    if (!(await req.guildDb('SELECT 1 FROM changes WHERE id = ?', [id])).length) return res.status(404).json({ error: 'Changement introuvable' });
    await send(req, res, await C.addTask(req.guildDb, id, req.body?.title), id);
  } catch (err) { next(err); }
});
router.patch('/:id/tasks/:taskId', async (req, res, next) => {
  try { const id = parseInt(req.params.id) || 0; await send(req, res, await C.setTask(req.guildDb, id, parseInt(req.params.taskId) || 0, !!req.body?.done), id); } catch (err) { next(err); }
});

module.exports = router;

// Problems (utils/problems.js), when the space turned them on (founders: Problèmes → activer).
// Read by the staff; written with the reply_ticket permission. Tickets through the visibility.
const express = require('express');
const router = express.Router();
const P = require('../../utils/problems');
const { visibilityFilter, getUserPermissions } = require('../../utils/gradePermissions');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const canWrite = async req => req.userIsFondateur || (req.userPermissions || await getUserPermissions(req.session.user.id, req.guildDb)).has('reply_ticket');
router.get('/settings', async (req, res, next) => { try { res.json({ enabled: await P.enabled(req.guildDb) }); } catch (err) { next(err); } });
router.put('/settings', async (req, res, next) => {
  try {
    if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé aux fondateurs' });
    await req.guildDb('UPDATE guild_config SET problems_enabled = ? WHERE id = 1', [req.body?.enabled ? 1 : 0]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'problems_toggle', details: { enabled: !!req.body?.enabled } });
    res.json({ enabled: !!req.body?.enabled });
  } catch (err) { next(err); }
});
// Everything below: only when turned on
router.use(async (req, res, next) => ((await P.enabled(req.guildDb).catch(() => false)) ? next() : res.status(404).json({ error: 'Les problèmes ne sont pas activés' })));
router.use(async (req, res, next) => {
  if (req.method === 'GET') return next();
  return (await canWrite(req)) ? next() : res.status(403).json({ error: 'Permission « Répondre » requise' });
});

const visibleTicket = async (req, id) => {
  const vis = await visibilityFilter(req, 'visibility_grade_id');
  const [t] = await req.guildDb(`SELECT id FROM tickets WHERE id = ? AND ${vis.sql}`, [id, ...vis.params]);
  return t || null;
};
const one = async (req, id) => P.getProblem(req.guildDb, id, await visibilityFilter(req, 't.visibility_grade_id'));

router.get('/', async (req, res, next) => { try { res.json({ problems: await P.listProblems(req.guildDb, { status: P.STATUSES.includes(req.query.status) ? req.query.status : null }) }); } catch (err) { next(err); } });
router.get('/ticket/:ticketId', async (req, res, next) => {
  try {
    const t = await visibleTicket(req, parseInt(req.params.ticketId) || 0);
    if (!t) return res.status(404).json({ error: 'Ticket introuvable' });
    res.json({ problems: await P.ofTicket(req.guildDb, t.id) });
  } catch (err) { next(err); }
});
router.get('/:id', async (req, res, next) => {
  try { const p = await one(req, parseInt(req.params.id) || 0); return p ? res.json(p) : res.status(404).json({ error: 'Problème introuvable' }); } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try {
    const r = await P.createProblem(req.guildDb, req.body || {}, dashboardActor(req));
    if (r.error) return res.status(400).json({ error: r.error });
    // Created from a ticket: linked to it
    if (req.body?.ticketId && await visibleTicket(req, parseInt(req.body.ticketId) || 0)) await P.link(req.guildDb, r.id, parseInt(req.body.ticketId), dashboardActor(req));
    res.json(await one(req, r.id));
  } catch (err) { next(err); }
});
router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await P.updateProblem(req.guildDb, id, req.body || {}, dashboardActor(req));
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json(await one(req, id));
  } catch (err) { next(err); }
});
router.post('/:id/tickets', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const t = await visibleTicket(req, parseInt(req.body?.ticketId) || 0);
    if (!t) return res.status(404).json({ error: 'Ticket introuvable' });
    const r = await P.link(req.guildDb, id, t.id, dashboardActor(req));
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json(await one(req, id));
  } catch (err) { next(err); }
});
router.delete('/:id/tickets/:ticketId', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const t = await visibleTicket(req, parseInt(req.params.ticketId) || 0);
    if (!t) return res.status(404).json({ error: 'Ticket introuvable' });
    await P.unlink(req.guildDb, id, t.id, dashboardActor(req));
    res.json(await one(req, id));
  } catch (err) { next(err); }
});
router.post('/:id/tasks', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    if (!(await req.guildDb('SELECT 1 FROM problems WHERE id = ?', [id])).length) return res.status(404).json({ error: 'Problème introuvable' });
    const r = await P.addTask(req.guildDb, id, req.body?.title);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(await one(req, id));
  } catch (err) { next(err); }
});
router.patch('/:id/tasks/:taskId', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await P.setTask(req.guildDb, id, parseInt(req.params.taskId) || 0, !!req.body?.done);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json(await one(req, id));
  } catch (err) { next(err); }
});
// POST /api/problems/:id/resolve { solution, resolveTickets }
router.post('/:id/resolve', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await P.resolve({ db: req.guildDb, client: req.app.locals.client, guildId: req.guildId, id, solution: req.body?.solution, resolveTickets: !!req.body?.resolveTickets,
      actor: dashboardActor(req), vis: await visibilityFilter(req, 't.visibility_grade_id') });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ...(await one(req, id)), result: { resolved: r.resolved, skipped: r.skipped } });
  } catch (err) { next(err); }
});

module.exports = router;

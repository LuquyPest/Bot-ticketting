// SLA objectives of the space (utils/slaPolicies.js). Read: the staff; write: founders.
// GET / ; POST / ; PUT /order { ids } ; PUT /:id ; DELETE /:id — every change computes the
// deadlines of the open tickets again.
const express = require('express');
const router = express.Router();
const sla = require('../../utils/slaPolicies');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const founders = (req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' }));
const answer = async (req, res) => {
  const refreshed = await sla.refreshOpenTickets(req.guildDb);
  res.json({ policies: await sla.listPolicies(req.guildDb, { escalations: true }), refreshed });
};

router.get('/', async (req, res, next) => {
  try { res.json({ policies: await sla.listPolicies(req.guildDb, { escalations: true }) }); } catch (err) { next(err); }
});
router.post('/', founders, async (req, res, next) => {
  try {
    const r = await sla.savePolicy(req.guildDb, null, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'sla_policy_save', targetType: 'sla_policy', targetId: r.id, details: { name: req.body?.name } });
    await answer(req, res);
  } catch (err) { next(err); }
});
router.put('/order', founders, async (req, res, next) => {
  try { await sla.reorderPolicies(req.guildDb, req.body?.ids); await answer(req, res); } catch (err) { next(err); }
});
router.put('/:id', founders, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await sla.savePolicy(req.guildDb, id, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'sla_policy_save', targetType: 'sla_policy', targetId: id, details: { name: req.body?.name } });
    await answer(req, res);
  } catch (err) { next(err); }
});
router.delete('/:id', founders, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await sla.deletePolicy(req.guildDb, id);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'sla_policy_delete', targetType: 'sla_policy', targetId: id });
    await answer(req, res);
  } catch (err) { next(err); }
});

module.exports = router;

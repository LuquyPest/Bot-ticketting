// Ticket statuses (utils/stages.js): GET / for the whole staff (Kanban, lists, ticket view),
// changes for the founders (Paramètres → Tickets → Statuts), each one in the space's journal.
const express = require('express');
const router = express.Router();
const stages = require('../../utils/stages');
const { recordEvent, dashboardActor } = require('../../utils/audit');
const { broadcast } = require('../../utils/sse');

router.get('/', async (req, res, next) => {
  try { res.json(await stages.listStages(req.guildDb)); } catch (err) { next(err); }
});

const founders = (req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' }));
const done = async (req, res, action, details) => {
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action, details });
  broadcast('stages', {}, req.guildId);
  res.json(await stages.listStages(req.guildDb));
};

router.post('/', founders, async (req, res, next) => {
  try {
    const r = await stages.createStage(req.guildDb, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    await done(req, res, 'stage_create', { key: r.key, label: req.body?.label });
  } catch (err) { next(err); }
});

router.put('/order', founders, async (req, res, next) => {
  try {
    const r = await stages.reorderStages(req.guildDb, req.body?.ids);
    if (r.error) return res.status(400).json({ error: r.error });
    await done(req, res, 'stage_reorder', null);
  } catch (err) { next(err); }
});

router.put('/:id', founders, async (req, res, next) => {
  try {
    const r = await stages.updateStage(req.guildDb, parseInt(req.params.id) || 0, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await done(req, res, 'stage_update', { key: `s_${parseInt(req.params.id)}`, label: req.body?.label });
  } catch (err) { next(err); }
});

// Its tickets go back to the built-in stage it behaved like
router.delete('/:id', founders, async (req, res, next) => {
  try {
    const r = await stages.deleteStage(req.guildDb, parseInt(req.params.id) || 0);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await done(req, res, 'stage_delete', { key: `s_${parseInt(req.params.id)}`, moved: r.moved, to: r.to });
  } catch (err) { next(err); }
});

module.exports = router;

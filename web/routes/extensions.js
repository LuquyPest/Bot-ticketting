// Extensions of the space (utils/extensions.js, v7): installed, turned off and removed by the
// founders; the staff reads the active panels (ticket view).
const express = require('express');
const router = express.Router();
const X = require('../../utils/extensions');
const { dashboardActor } = require('../../utils/audit');

const founders = (req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' }));
router.get('/', async (req, res, next) => {
  try {
    const all = await X.list(req.guildDb);
    // The staff only needs the active panels; the rest is for the founders
    res.json(req.userIsFondateur ? { extensions: all, permissions: X.PERMISSIONS, events: X.EVENTS } : { extensions: all.filter(e => e.active && e.panel).map(({ id, name, panel }) => ({ id, name, panel, active: true })) });
  } catch (err) { next(err); }
});
router.post('/', founders, async (req, res, next) => {
  try {
    const r = await X.install(req.guildDb, req.guildId, req.body || {}, dashboardActor(req));
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json(r);
  } catch (err) { next(err); }
});
router.patch('/:id', founders, async (req, res, next) => {
  try {
    const r = await X.setActive(req.guildDb, req.guildId, parseInt(req.params.id) || 0, !!req.body?.active);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json({ extensions: await X.list(req.guildDb) });
  } catch (err) { next(err); }
});
router.delete('/:id', founders, async (req, res, next) => {
  try {
    const r = await X.uninstall(req.guildDb, req.guildId, parseInt(req.params.id) || 0, dashboardActor(req));
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json({ extensions: await X.list(req.guildDb) });
  } catch (err) { next(err); }
});

module.exports = router;

// Service catalogue (utils/catalog.js): read by the staff, written by the founders and the
// manage_settings permission (Paramètres → Catalogue). Each change in the journal.
const express = require('express');
const router = express.Router();
const catalog = require('../../utils/catalog');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const manage = (req, res, next) => (req.userIsFondateur || req.userPermissions?.has('manage_settings') ? next() : res.status(403).json({ error: 'Réservé aux fondateurs et à la permission « Paramètres »' }));
const list = async req => ({ services: await catalog.listServices(req.guildDb) });

router.get('/', async (req, res, next) => { try { res.json(await list(req)); } catch (err) { next(err); } });
router.post('/', manage, async (req, res, next) => {
  try {
    const r = await catalog.saveService(req.guildDb, null, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'catalog_save', targetType: 'service', targetId: r.id, details: { name: req.body?.name } });
    res.json({ id: r.id, ...(await list(req)) });
  } catch (err) { next(err); }
});
router.put('/:id', manage, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await catalog.saveService(req.guildDb, id, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'catalog_save', targetType: 'service', targetId: id, details: { name: req.body?.name } });
    res.json(await list(req));
  } catch (err) { next(err); }
});
router.delete('/:id', manage, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await catalog.deleteService(req.guildDb, id);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'catalog_delete', targetType: 'service', targetId: id });
    res.json(await list(req));
  } catch (err) { next(err); }
});

module.exports = router;

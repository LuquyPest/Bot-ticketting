// Task templates (utils/tasks.js): read by the staff (to apply them), written by the founders and
// the manage_settings permission (Paramètres → Catalogue). Each change in the journal.
const express = require('express');
const router = express.Router();
const tasks = require('../../utils/tasks');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const manage = (req, res, next) => (req.userIsFondateur || req.userPermissions?.has('manage_settings') ? next() : res.status(403).json({ error: 'Réservé aux fondateurs et à la permission « Paramètres »' }));
const list = async req => ({ templates: await tasks.listTemplates(req.guildDb) });
router.get('/', async (req, res, next) => { try { res.json(await list(req)); } catch (err) { next(err); } });
router.post('/', manage, async (req, res, next) => {
  try {
    const r = await tasks.saveTemplate(req.guildDb, null, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'task_template_save', targetType: 'task_template', targetId: r.id, details: { name: req.body?.name } });
    res.json({ id: r.id, ...(await list(req)) });
  } catch (err) { next(err); }
});
router.put('/:id', manage, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await tasks.saveTemplate(req.guildDb, id, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'task_template_save', targetType: 'task_template', targetId: id, details: { name: req.body?.name } });
    res.json(await list(req));
  } catch (err) { next(err); }
});
router.delete('/:id', manage, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await tasks.deleteTemplate(req.guildDb, id);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'task_template_delete', targetType: 'task_template', targetId: id });
    res.json(await list(req));
  } catch (err) { next(err); }
});
module.exports = router;

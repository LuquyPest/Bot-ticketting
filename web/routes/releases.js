// Releases (utils/releases.js, v7), with the changes (same switch). Read by the staff; written with
// the reply_ticket permission. Each change of status in the space's journal.
const express = require('express');
const router = express.Router();
const R = require('../../utils/releases');
const { getUserPermissions } = require('../../utils/gradePermissions');
const { dashboardActor } = require('../../utils/audit');

router.use(async (req, res, next) => ((await require('../../utils/changes').enabled(req.guildDb).catch(() => false)) ? next() : res.status(404).json({ error: 'Les changements ne sont pas activés' })));
const canWrite = async req => req.userIsFondateur || (req.userPermissions || await getUserPermissions(req.session.user.id, req.guildDb)).has('reply_ticket');
router.use(async (req, res, next) => (req.method === 'GET' || await canWrite(req) ? next() : res.status(403).json({ error: 'Permission « Répondre » requise' })));

const id = req => parseInt(req.params.id) || 0;
const send = async (req, res, r, relId = id(req)) => {
  if (r?.error) return res.status(r.status || 400).json({ error: r.error });
  const rel = await R.getRelease(req.guildDb, relId);
  return rel ? res.json(rel) : res.status(404).json({ error: 'Mise en production introuvable' });
};

router.get('/', async (req, res, next) => { try { res.json({ releases: await R.listReleases(req.guildDb), stages: R.STAGES }); } catch (err) { next(err); } });
router.get('/:id', async (req, res, next) => { try { await send(req, res, null); } catch (err) { next(err); } });
router.post('/', async (req, res, next) => {
  try { const r = await R.createRelease(req.guildDb, req.body || {}, dashboardActor(req)); await send(req, res, r, r.id); } catch (err) { next(err); }
});
router.patch('/:id', async (req, res, next) => { try { await send(req, res, await R.updateRelease(req.guildDb, id(req), req.body || {}, dashboardActor(req))); } catch (err) { next(err); } });
router.delete('/:id', async (req, res, next) => {
  try { const r = await R.deleteRelease(req.guildDb, id(req)); if (r.error) return res.status(r.status || 400).json({ error: r.error }); res.json({ ok: true }); } catch (err) { next(err); }
});
router.post('/:id/status', async (req, res, next) => { try { await send(req, res, await R.setStatus(req.guildDb, id(req), String(req.body?.status || ''), dashboardActor(req))); } catch (err) { next(err); } });
router.post('/:id/changes', async (req, res, next) => { try { await send(req, res, await R.addChange(req.guildDb, id(req), parseInt(req.body?.changeId) || 0, dashboardActor(req))); } catch (err) { next(err); } });
router.delete('/:id/changes/:changeId', async (req, res, next) => { try { await send(req, res, await R.removeChange(req.guildDb, id(req), parseInt(req.params.changeId) || 0)); } catch (err) { next(err); } });
router.post('/:id/steps', async (req, res, next) => { try { await send(req, res, await R.addStep(req.guildDb, id(req), String(req.body?.stage || ''), req.body?.title)); } catch (err) { next(err); } });
router.patch('/:id/steps/:stepId', async (req, res, next) => { try { await send(req, res, await R.setStep(req.guildDb, id(req), parseInt(req.params.stepId) || 0, !!req.body?.done, dashboardActor(req))); } catch (err) { next(err); } });
router.delete('/:id/steps/:stepId', async (req, res, next) => { try { await send(req, res, await R.deleteStep(req.guildDb, id(req), parseInt(req.params.stepId) || 0)); } catch (err) { next(err); } });

module.exports = router;

// Status page of the space (utils/statusPage.js, v7): settings and components, for the founders and
// the manage_settings permission; the staff reads them. The public page: routes/statusPublic.js.
const express = require('express');
const router = express.Router();
const S = require('../../utils/statusPage');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const canManage = req => req.userIsFondateur || req.userPermissions?.has('manage_settings');
router.use((req, res, next) => (req.method === 'GET' || canManage(req) ? next() : res.status(403).json({ error: 'Réservé aux fondateurs et à la permission « Paramètres »' })));
const all = async req => ({ ...(await S.settings(req.guildDb)), components: await S.listComponents(req.guildDb), states: S.STATES, subscribers: await S.subscriberCount(req.guildDb), url: `/statut/${req.guildId}` });
const out = async (req, res, r) => (r?.error ? res.status(r.status || 400).json({ error: r.error }) : res.json(await all(req)));
const id = req => parseInt(req.params.id) || 0;

router.get('/', async (req, res, next) => { try { res.json(await all(req)); } catch (err) { next(err); } });
router.put('/', async (req, res, next) => {
  try {
    await S.saveSettings(req.guildDb, req.body || {});
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'status_page', details: { enabled: !!req.body?.enabled } });
    await out(req, res);
  } catch (err) { next(err); }
});
router.post('/components', async (req, res, next) => { try { await out(req, res, await S.saveComponent(req.guildDb, null, req.body || {})); } catch (err) { next(err); } });
router.put('/components/:id', async (req, res, next) => { try { await out(req, res, await S.saveComponent(req.guildDb, id(req), req.body || {})); } catch (err) { next(err); } });
router.delete('/components/:id', async (req, res, next) => { try { await out(req, res, await S.deleteComponent(req.guildDb, id(req))); } catch (err) { next(err); } });
router.patch('/components/:id/status', async (req, res, next) => { try { await out(req, res, await S.setComponentStatus(req.guildDb, id(req), String(req.body?.status || ''), dashboardActor(req))); } catch (err) { next(err); } });

module.exports = router;

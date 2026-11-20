// E-mail template of the space (utils/emailTemplate.js, v7): founders and the manage_settings permission.
const express = require('express');
const router = express.Router();
const T = require('../../utils/emailTemplate');
const { recordEvent, dashboardActor } = require('../../utils/audit');

router.use((req, res, next) => (req.userIsFondateur || req.userPermissions?.has('manage_settings') ? next() : res.status(403).json({ error: 'Réservé aux fondateurs et à la permission « Paramètres »' })));
router.get('/', async (req, res, next) => { try { res.json(await T.getTemplate(req.guildDb)); } catch (err) { next(err); } });
router.put('/', async (req, res, next) => {
  try {
    const r = await T.saveTemplate(req.guildDb, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'email_template', details: null });
    res.json(await T.getTemplate(req.guildDb));
  } catch (err) { next(err); }
});
// POST /api/email-template/preview { logo, color, header, footer } — the HTML of an example e-mail
router.post('/preview', async (req, res, next) => {
  try {
    const r = await T.preview(req.guildDb, req.guildId, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) { next(err); }
});

module.exports = router;

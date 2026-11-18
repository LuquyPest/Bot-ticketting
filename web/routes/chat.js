// Slack and Microsoft Teams settings (Paramètres → Intégrations, founders) and the linking of a
// Slack user to one's own account (any staff member). utils/chatIntegrations.js
const express = require('express');
const router = express.Router();
const chat = require('../../utils/chatIntegrations');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const founders = (req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' }));

router.post('/slack/link', async (req, res, next) => {
  try {
    const r = await chat.useLinkToken(req.guildDb, req.guildId, req.body?.token, req.session.user.id);
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'chat_link', details: { provider: 'slack' } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.get('/', founders, async (req, res, next) => {
  try { res.json(await chat.view(req.guildDb, req.guildId)); } catch (err) { next(err); }
});
router.put('/:kind', founders, async (req, res, next) => {
  try {
    const r = await chat.save(req.guildDb, req.params.kind, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'chat_integration_update', details: { kind: req.params.kind, active: !!req.body?.active, url: typeof req.body?.webhookUrl === 'string' } });
    res.json(await chat.view(req.guildDb, req.guildId));
  } catch (err) { next(err); }
});
router.post('/:kind/test', founders, async (req, res, next) => {
  try {
    if (!chat.KINDS.includes(req.params.kind)) return res.status(404).json({ error: 'Intégration inconnue' });
    const r = await chat.test(req.guildDb, req.guildId, req.params.kind);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) { next(err); }
});

module.exports = router;

// Notifications (utils/notifications.js): the rules and the requester texts for the founders
// (Paramètres → Notifications); each staff member's own preferences (Profil → Notifications).
const express = require('express');
const router = express.Router();
const N = require('../../utils/notifications');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const founders = (req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' }));

// ── Own preferences (any staff member) ──
router.get('/prefs', async (req, res, next) => {
  try {
    res.json({ prefs: await N.prefsOf(req.guildDb, req.session.user.id), rules: await N.reachingRules(req.guildDb), events: N.EVENTS, channels: N.CHANNELS });
  } catch (err) { next(err); }
});
router.put('/prefs', async (req, res, next) => {
  try {
    const r = await N.savePrefs(req.guildDb, req.session.user.id, req.body?.prefs);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ prefs: await N.prefsOf(req.guildDb, req.session.user.id) });
  } catch (err) { next(err); }
});

// ── Rules of the space ──
router.get('/', founders, async (req, res, next) => {
  try { res.json({ rules: await N.listRules(req.guildDb), events: N.EVENTS, recipients: N.RECIPIENTS, channels: N.CHANNELS }); } catch (err) { next(err); }
});
router.put('/rules', founders, async (req, res, next) => {
  try {
    const r = await N.saveRules(req.guildDb, req.body?.rules);
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'notifications_update', details: { rules: (req.body.rules || []).length } });
    res.json({ rules: await N.listRules(req.guildDb) });
  } catch (err) { next(err); }
});

// ── Requester texts ──
router.get('/templates', founders, async (req, res, next) => {
  try { res.json({ templates: await N.listTemplates(req.guildDb) }); } catch (err) { next(err); }
});
router.put('/templates', founders, async (req, res, next) => {
  try {
    const r = await N.saveTemplates(req.guildDb, req.guildId, req.body?.texts);
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'notification_templates_update', details: { keys: [...new Set((req.body.texts || []).map(x => x.key))].slice(0, 20) } });
    res.json({ templates: await N.listTemplates(req.guildDb) });
  } catch (err) { next(err); }
});
router.post('/templates/preview', founders, (req, res) => {
  res.json({ text: N.preview(typeof req.body?.text === 'string' ? req.body.text.slice(0, 1500) : '') });
});

module.exports = router;

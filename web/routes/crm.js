// CRM of the space (utils/crm.js, v7): settings and synchronisation for the founders; the card of
// a ticket's requester for the staff who see the ticket.
const express = require('express');
const router = express.Router();
const crm = require('../../utils/crm');
const { recordEvent, dashboardActor } = require('../../utils/audit');
const { allowBurst } = require('../../utils/rateLimit');

const founders = (req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' }));

router.get('/settings', founders, async (req, res, next) => { try { res.json(await crm.settings(req.guildDb)); } catch (err) { next(err); } });
router.put('/settings', founders, async (req, res, next) => {
  try {
    const r = await crm.saveSettings(req.guildDb, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'crm_settings', details: { provider: req.body?.provider || null } });
    res.json(await crm.settings(req.guildDb));
  } catch (err) { next(err); }
});
router.post('/sync', founders, async (req, res, next) => {
  try {
    if (!(await allowBurst(`crmsync:${req.guildId}`, 3, 10 * 60 * 1000))) return res.status(429).json({ error: 'Trois synchronisations au plus toutes les 10 minutes' });
    const r = await crm.syncNow(req.guildDb);
    if (r.error) return res.status(502).json({ error: r.error });
    res.json(r);
  } catch (err) { next(err); }
});
// GET /api/crm/tickets/:id — the CRM card of the requester of a ticket the reader sees
router.get('/tickets/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const { visibilityFilter } = require('../../utils/gradePermissions');
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    const [t] = await req.guildDb(`SELECT t.id, t.owner_id FROM tickets t WHERE t.id = ? AND ${vis.sql}`, [id, ...vis.params]);
    if (!t) return res.status(404).json({ error: 'Ticket introuvable' });
    const email = await crm.requesterEmail(req.guildDb, t);
    if (!email) return res.json({ card: null });
    if (!(await allowBurst(`crmcard:${req.guildId}`, 120, 60 * 1000))) return res.json({ card: null });
    res.json(await crm.lookup(req.guildDb, req.guildId, email));
  } catch (err) { next(err); }
});

module.exports = router;

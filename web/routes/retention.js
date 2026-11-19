// Retention of closed tickets and archives of the space (utils/ticketRetention.js, v5.7). Founders.
//   GET /api/ticket-retention   → settings + how many tickets the next run would treat
//   PUT /api/ticket-retention   { mode: off | anonymize | delete, months, archiveMonths }
const express = require('express');
const router = express.Router();
const R = require('../../utils/ticketRetention');
const { recordEvent, dashboardActor } = require('../../utils/audit');

router.use((req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' })));
router.get('/', async (req, res, next) => {
  try { const s = await R.settings(req.guildDb); res.json({ ...s, due: await R.due(req.guildDb, s) }); } catch (err) { next(err); }
});
router.put('/', async (req, res, next) => {
  try {
    const r = await R.save(req.guildDb, req.body);
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'ticket_retention_update', details: r.settings });
    res.json({ ...r.settings, due: await R.due(req.guildDb, r.settings) });
  } catch (err) { next(err); }
});

module.exports = router;

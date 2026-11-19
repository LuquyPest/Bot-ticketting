// Retention of closed tickets and archives of the space (utils/ticketRetention.js, v5.7). Founders.
//   GET /api/ticket-retention   → settings + how many tickets the next run would treat
//   PUT /api/ticket-retention   { mode: off | anonymize | delete, months, archiveMonths }
//   POST /api/ticket-retention/apply { confirm: true } → everything due now, by batches (v6)
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

router.post('/apply', async (req, res, next) => {
  try {
    if (req.session.user?.demo) return res.status(403).json({ error: 'Indisponible dans la démonstration' });
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirmation requise' });
    const s = await R.settings(req.guildDb);
    if (s.mode === 'off') return res.status(400).json({ error: 'La rétention est coupée : choisis d\'abord d\'anonymiser ou de supprimer' });
    // One run at a time per space
    const { getRedis } = require('../../utils/redis');
    const lock = `retention:apply:${req.guildId}`;
    if (!(await getRedis().set(lock, '1', 'PX', 180000, 'NX').catch(() => 'OK'))) return res.status(409).json({ error: 'Déjà en cours' });
    try {
      const r = await R.applyAll(req.guildDb, req.guildId);
      await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'ticket_retention', details: { mode: s.mode, months: s.months, anonymized: r.anonymized, deleted: r.deleted, manual: true } });
      res.json({ ...r, mode: s.mode });
    } finally { await getRedis().del(lock).catch(() => null); }
  } catch (err) { next(err); }
});

module.exports = router;

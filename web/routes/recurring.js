// Recurring tickets (utils/recurring.js): founders and the manage_settings permission
// (Paramètres → Catalogue → Tickets récurrents). Each change in the journal.
const express = require('express');
const router = express.Router();
const rec = require('../../utils/recurring');
const { recordEvent, dashboardActor } = require('../../utils/audit');

router.use((req, res, next) => (req.userIsFondateur || req.userPermissions?.has('manage_settings') ? next() : res.status(403).json({ error: 'Réservé aux fondateurs et à la permission « Paramètres »' })));
const list = async req => ({ recurring: await rec.list(req.guildDb) });

router.get('/', async (req, res, next) => { try { res.json(await list(req)); } catch (err) { next(err); } });
router.post('/', async (req, res, next) => {
  try {
    const r = await rec.save(req.guildDb, null, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'recurring_save', targetType: 'recurring', targetId: r.id, details: { name: req.body?.name } });
    res.json({ id: r.id, ...(await list(req)) });
  } catch (err) { next(err); }
});
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await rec.save(req.guildDb, id, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'recurring_save', targetType: 'recurring', targetId: id, details: { name: req.body?.name } });
    res.json(await list(req));
  } catch (err) { next(err); }
});
// Opens it now (to try it), without moving the schedule
router.post('/:id/run', async (req, res, next) => {
  try {
    const one = (await rec.list(req.guildDb)).find(x => x.id === (parseInt(req.params.id) || 0));
    if (!one) return res.status(404).json({ error: 'Récurrence introuvable' });
    const r = await rec.openNow({ db: req.guildDb, client: req.app.locals.client, guildId: req.guildId, rec: { ...one, skipIfOpen: false } });
    if (!r.ticketId) return res.status(409).json({ error: `Pas de ticket : ${r.skipped}` });
    await req.guildDb('UPDATE recurring_tickets SET last_ticket_id = ? WHERE id = ?', [r.ticketId, one.id]);
    res.json({ ticketId: r.ticketId, ...(await list(req)) });
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await rec.remove(req.guildDb, id);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'recurring_delete', targetType: 'recurring', targetId: id });
    res.json(await list(req));
  } catch (err) { next(err); }
});

module.exports = router;

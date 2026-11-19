// Costs (utils/costs.js): founders and the manage_costs permission. Settings (rates, fixed
// amount), the cost of a ticket and its added costs, reports by period (JSON or CSV).
const express = require('express');
const router = express.Router();
const costs = require('../../utils/costs');
const { visibilityFilter } = require('../../utils/gradePermissions');
const { recordEvent, dashboardActor } = require('../../utils/audit');

router.use((req, res, next) => (req.userIsFondateur || req.userPermissions?.has('manage_costs') ? next() : res.status(403).json({ error: 'Réservé aux fondateurs et à la permission « Coûts »' })));

router.get('/settings', async (req, res, next) => { try { res.json(await costs.settings(req.guildDb)); } catch (err) { next(err); } });
router.put('/settings', async (req, res, next) => {
  try {
    if (!req.userIsFondateur) return res.status(403).json({ error: 'Les taux sont réglés par les fondateurs' });
    const r = await costs.saveSettings(req.guildDb, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'cost_settings', details: { currency: req.body?.currency } });
    res.json(await costs.settings(req.guildDb));
  } catch (err) { next(err); }
});

// The ticket must be one the person sees
async function visibleTicket(req, res) {
  const vis = await visibilityFilter(req, 'visibility_grade_id');
  const [t] = await req.guildDb(`SELECT id FROM tickets WHERE id = ? AND ${vis.sql}`, [parseInt(req.params.id) || 0, ...vis.params]);
  if (!t) res.status(404).json({ error: 'Ticket introuvable' });
  return t;
}
router.get('/tickets/:id', async (req, res, next) => {
  try { const t = await visibleTicket(req, res); if (t) res.json(await costs.ticketCost(req.guildDb, t.id)); } catch (err) { next(err); }
});
router.post('/tickets/:id', async (req, res, next) => {
  try {
    const t = await visibleTicket(req, res); if (!t) return;
    const r = await costs.addExtra(req.guildDb, t.id, req.body || {}, dashboardActor(req));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(await costs.ticketCost(req.guildDb, t.id));
  } catch (err) { next(err); }
});
router.delete('/tickets/:id/:costId', async (req, res, next) => {
  try {
    const t = await visibleTicket(req, res); if (!t) return;
    const r = await costs.removeExtra(req.guildDb, t.id, parseInt(req.params.costId) || 0, dashboardActor(req));
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json(await costs.ticketCost(req.guildDb, t.id));
  } catch (err) { next(err); }
});

// GET /api/costs/report?from&to&by=organization|ticket|user|team[&format=csv]
router.get('/report', async (req, res, next) => {
  try {
    const from = new Date(req.query.from || Date.now() - 30 * 864e5), to = new Date(req.query.to || Date.now());
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to - from > 400 * 864e5) return res.status(400).json({ error: 'Période invalide (400 jours au plus)' });
    const by = ['organization', 'ticket', 'user', 'team'].includes(req.query.by) ? req.query.by : 'organization';
    const r = await costs.report(req.guildDb, { from, to, by, vis: await visibilityFilter(req, 't.visibility_grade_id') });
    if (req.query.format === 'csv') {
      res.setHeader('Content-Disposition', `attachment; filename="couts-${by}-${from.toISOString().slice(0, 10)}.csv"`);
      return res.type('text/csv; charset=utf-8').send(costs.reportCsv(r));
    }
    res.json(r);
  } catch (err) { next(err); }
});

module.exports = router;

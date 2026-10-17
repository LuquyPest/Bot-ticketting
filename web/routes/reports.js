// GET /api/reports/monthly?month=YYYY-MM — monthly report as a PDF (founders, view_audit)
const express = require('express');
const router = express.Router();
const { computeMonthlyStats, renderReportPdf, previousMonth } = require('../../utils/monthlyReport');

router.get('/monthly', async (req, res) => {
  if (!(req.userIsFondateur || req.userPermissions?.has('view_audit'))) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const month = typeof req.query.month === 'string' ? req.query.month : previousMonth();
    const stats = await computeMonthlyStats(req.guildDb, month);
    if (req.query.format === 'json') return res.json(stats);
    const pdf = await renderReportPdf(stats, req.guild?.guild_name || req.guildId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rapport-${month}.pdf"`);
    res.send(pdf);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

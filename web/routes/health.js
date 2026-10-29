// GET /api/server-health — « Santé du serveur »: bot permissions, configured channels, categories and
// roles (utils/guildHealth.js). PUT /api/server-health/alerts turns the founders' DM alerts on or off.
const express = require('express');
const router = express.Router();
const { checkGuildHealth } = require('../../utils/guildHealth');

const canSee = req => req.userIsFondateur || req.userPermissions?.has('manage_settings');

router.get('/', async (req, res) => {
  if (!canSee(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const [cfg] = await req.guildDb('SELECT health_alerts_enabled FROM guild_config LIMIT 1');
    const report = await checkGuildHealth(req.guildDb, req.app.locals.client, req.guildId);
    res.json({ ...report, alertsEnabled: Number(cfg?.health_alerts_enabled ?? 1) === 1 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/alerts', async (req, res) => {
  if (!canSee(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const enabled = req.body.enabled ? 1 : 0;
  await req.guildDb('UPDATE guild_config SET health_alerts_enabled = ? WHERE id = 1', [enabled]);
  await require('../../utils/audit').recordEvent(req.guildDb, { actor: require('../../utils/audit').dashboardActor(req), action: 'config_update', details: { healthAlertsEnabled: !!enabled } });
  res.json({ ok: true, alertsEnabled: !!enabled });
});

module.exports = router;

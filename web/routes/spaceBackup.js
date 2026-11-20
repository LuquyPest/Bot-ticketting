// Backup of the space, downloaded by a founder (utils/spaceBackup.js, v8):
//   POST /api/space-backup/export { passphrase } → the encrypted archive (application/octet-stream)
// Restoring is in the Instance section (owner of the instance): POST /api/instance/guilds/:id/restore
const express = require('express');
const router = express.Router();
const B = require('../../utils/spaceBackup');
const { recordEvent, dashboardActor } = require('../../utils/audit');
const { allowBurst } = require('../../utils/rateLimit');

router.post('/export', async (req, res, next) => {
  try {
    const bad = B.checkPassphrase(req.body?.passphrase);
    if (bad) return res.status(400).json({ error: bad });
    if (!(await allowBurst(`spacebackup:${req.guildId}`, 5, 60 * 60 * 1000))) return res.status(429).json({ error: 'Cinq sauvegardes au plus par heure' });
    const [g] = await require('../../utils/globalDb').globalQuery('SELECT guild_name FROM guilds WHERE guild_id = ?', [req.guildId]);
    const stream = await B.exportSpace(req.guildId, req.body.passphrase, { guildId: req.guildId, guildName: g?.guild_name || null, by: req.session.user.username || null });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'space_export' });
    const day = new Date().toISOString().slice(0, 10);
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="datick-espace-${req.guildId}-${day}.datick"`, 'Cache-Control': 'no-store' });
    stream.on('error', err => { console.error('sauvegarde espace:', err.message); res.destroy(err); });
    stream.pipe(res);
  } catch (err) { next(err); }
});

module.exports = router;

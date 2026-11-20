// The iCal feed of a staff member's planning (utils/planning.js), public by its secret:
//   GET /api/ical/<space>.<secret>.ics
// The secret is stored hashed; the feed has what its owner sees (their tasks with a date, the
// deadlines of their tickets, their absences), over 30 days back and 90 ahead.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const planning = require('../../utils/planning');
const { allowBurst } = require('../../utils/rateLimit');

router.get('/:file', async (req, res) => {
  const ip = crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 24);
  if (!(await allowBurst(`icalip:${ip}`, 60, 60 * 1000))) return res.status(429).end();
  const m = /^(\d{17,20})\.([A-Za-z0-9_-]{32})\.ics$/.exec(req.params.file || '');
  if (!m) return res.status(404).end();
  const [, guildId] = m;
  const token = req.params.file.slice(0, -4);
  try {
    const [space] = await require('../../utils/globalDb').globalQuery('SELECT guild_id FROM guilds WHERE guild_id = ?', [guildId]).catch(() => []);
    if (!space) return res.status(404).end();
    const db = require('../../utils/tenantDb').getTenantDb(guildId);
    const userId = await planning.userOfToken(db, token);
    if (!userId) return res.status(404).end();
    const from = new Date(Date.now() - 30 * 864e5), to = new Date(Date.now() + 90 * 864e5);
    const data = await planning.events(db, { userIds: [userId], from, to, vis: await planning.visFor(db, userId) });
    data.slots = await require('../../utils/sharedPlanning').slots(db, { userIds: [userId], from, to }); // shared plannings (v8)
    const base = String(require('../../utils/config').config.webServerBaseUrl || '').replace(/\/$/, '');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.type('text/calendar; charset=utf-8').send(planning.ical(data, { name: 'Datick · planning', base }));
  } catch (err) { console.error('ical', guildId, err.message); res.status(500).end(); }
});

module.exports = router;

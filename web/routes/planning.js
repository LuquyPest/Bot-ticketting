// Planning (utils/planning.js): my planning, a colleague's or a team's (founders: anyone; the
// others: themselves and the teams they belong to), through the visibility of whoever reads it.
// The iCal link of one's own planning is created and removed here; the feed itself is
// web/routes/ical.js (public, by its secret).
const express = require('express');
const router = express.Router();
const planning = require('../../utils/planning');
const { visibilityFilter } = require('../../utils/gradePermissions');
const { recordEvent, dashboardActor } = require('../../utils/audit');

router.get('/', async (req, res, next) => {
  try {
    const me = String(req.session.user.id);
    const from = new Date(req.query.from || Date.now());
    const to = new Date(req.query.to || from.getTime() + 7 * 864e5);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to - from > planning.MAX_DAYS * 864e5) return res.status(400).json({ error: `Période invalide (${planning.MAX_DAYS} jours au plus)` });
    const myTeams = await require('../../utils/teams').teamIdsOf(req.guildDb, me);
    let userIds = [me], teamId = null;
    if (req.query.team) {
      teamId = parseInt(req.query.team) || 0;
      if (!req.userIsFondateur && !myTeams.includes(teamId)) return res.status(403).json({ error: 'Planning réservé aux membres de l\'équipe' });
      userIds = (await req.guildDb('SELECT user_id FROM team_members WHERE team_id = ?', [teamId])).map(r => String(r.user_id));
    } else if (req.query.user && String(req.query.user) !== me) {
      const other = String(req.query.user);
      const shared = myTeams.length && (await req.guildDb('SELECT 1 FROM team_members WHERE user_id = ? AND team_id IN (?)', [other, myTeams])).length;
      if (!req.userIsFondateur && !shared) return res.status(403).json({ error: 'Planning d\'un collègue : réservé à son équipe' });
      userIds = [other];
    }
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    res.json({ from, to, ...(await planning.events(req.guildDb, { userIds, teamId, from, to, vis })) });
  } catch (err) { next(err); }
});

// POST /api/planning/ical — a new secret link (the previous one stops working); DELETE removes it
router.post('/ical', async (req, res, next) => {
  try {
    const token = await planning.newIcalToken(req.guildDb, req.guildId, req.session.user.id);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'ical_link', details: { created: true } });
    const base = String(require('../../utils/config').config.webServerBaseUrl || '').replace(/\/$/, '');
    res.json({ url: `${base}/api/ical/${token}.ics` });
  } catch (err) { next(err); }
});
router.delete('/ical', async (req, res, next) => {
  try {
    await planning.revokeIcal(req.guildDb, req.session.user.id);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'ical_link', details: { created: false } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

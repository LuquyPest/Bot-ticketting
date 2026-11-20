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
    const SP = require('../../utils/sharedPlanning');
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    // v8: a shared planning, or everyone with a skill or a language, with the coverage of each day
    if (req.query.shared) {
      const id = parseInt(req.query.shared) || 0;
      if (!req.userIsFondateur && !(await SP.isMember(req.guildDb, id, me))) return res.status(403).json({ error: 'Planning commun réservé à ses membres' });
      const people = await SP.peopleOf(req.guildDb, id);
      const ev = await planning.events(req.guildDb, { userIds: people, from, to, vis });
      return res.json({ from, to, ...ev, tasks: [], deadlines: [], changes: [], slots: await SP.slots(req.guildDb, { planningId: id, from, to }), coverage: await SP.coverage(req.guildDb, people, from, to) });
    }
    if (req.query.skill || req.query.lang) {
      const people = await SP.holders(req.guildDb, { skillId: parseInt(req.query.skill) || 0, lang: /^[a-z]{2}$/.test(String(req.query.lang || '')) ? String(req.query.lang) : null });
      // Their tasks and deadlines for the founders; for the others, who is there and their slots
      const ev = await planning.events(req.guildDb, { userIds: people, from, to, vis });
      const full = req.userIsFondateur ? ev : { ...ev, tasks: [], deadlines: [], changes: [] };
      return res.json({ from, to, ...full, slots: await SP.slots(req.guildDb, { userIds: people, from, to }), coverage: await SP.coverage(req.guildDb, people, from, to) });
    }
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
    const ev = await planning.events(req.guildDb, { userIds, teamId, from, to, vis });
    res.json({ from, to, ...ev, slots: await SP.slots(req.guildDb, { userIds, from, to }), ...(teamId ? { coverage: await SP.coverage(req.guildDb, userIds, from, to) } : {}) });
  } catch (err) { next(err); }
});

// ── Shared plannings (v8): founders create them and choose their members; members fill the slots ──
const SPm = () => require('../../utils/sharedPlanning');
const founders = (req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' }));
const out = (res, r) => (r?.error ? res.status(r.status || 400).json({ error: r.error }) : res.json(r));
router.get('/shared', async (req, res, next) => {
  try { res.json({ plannings: await SPm().list(req.guildDb, { userId: req.session.user.id, all: req.userIsFondateur }) }); } catch (err) { next(err); }
});
router.post('/shared', founders, async (req, res, next) => {
  try { const r = await SPm().save(req.guildDb, null, req.body || {}); if (r.ok) await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'shared_planning', details: { name: req.body?.name } }); out(res, r); } catch (err) { next(err); }
});
router.put('/shared/:id', founders, async (req, res, next) => {
  try { out(res, await SPm().save(req.guildDb, parseInt(req.params.id) || 0, req.body || {})); } catch (err) { next(err); }
});
router.delete('/shared/:id', founders, async (req, res, next) => {
  try { out(res, await SPm().remove(req.guildDb, parseInt(req.params.id) || 0)); } catch (err) { next(err); }
});
const slotAccess = async (req, res, next) => {
  try {
    if (req.userIsFondateur || await SPm().isMember(req.guildDb, parseInt(req.params.id) || 0, req.session.user.id)) return next();
    res.status(403).json({ error: 'Planning commun réservé à ses membres' });
  } catch (err) { next(err); }
};
router.post('/shared/:id/slots', slotAccess, async (req, res, next) => {
  try { out(res, await SPm().saveSlot(req.guildDb, parseInt(req.params.id) || 0, null, req.body || {}, dashboardActor(req))); } catch (err) { next(err); }
});
router.put('/shared/:id/slots/:slotId', slotAccess, async (req, res, next) => {
  try { out(res, await SPm().saveSlot(req.guildDb, parseInt(req.params.id) || 0, parseInt(req.params.slotId) || 0, req.body || {}, dashboardActor(req))); } catch (err) { next(err); }
});
router.delete('/shared/:id/slots/:slotId', slotAccess, async (req, res, next) => {
  try { out(res, await SPm().deleteSlot(req.guildDb, parseInt(req.params.id) || 0, parseInt(req.params.slotId) || 0)); } catch (err) { next(err); }
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

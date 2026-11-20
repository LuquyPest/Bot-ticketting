// Change advisory board (utils/cab.js, v7), with the changes (same switch). Read by the staff;
// members chosen by the founders and the manage_settings permission; meetings, agenda and
// decisions by the members of the board and the founders; each member gives their own opinion.
const express = require('express');
const router = express.Router();
const B = require('../../utils/cab');
const { getUserPermissions } = require('../../utils/gradePermissions');
const { recordEvent, dashboardActor } = require('../../utils/audit');

router.use(async (req, res, next) => ((await require('../../utils/changes').enabled(req.guildDb).catch(() => false)) ? next() : res.status(404).json({ error: 'Les changements ne sont pas activés' })));
const canMembers = async req => req.userIsFondateur || (req.userPermissions || await getUserPermissions(req.session.user.id, req.guildDb)).has('manage_settings');
const canRun = async req => req.userIsFondateur || await B.isMember(req.guildDb, req.session.user.id);
const id = req => parseInt(req.params.id) || 0;
const meeting = async (req, res, r, mid = id(req)) => {
  if (r?.error) return res.status(r.status || 400).json({ error: r.error });
  const m = await B.getMeeting(req.guildDb, mid);
  return m ? res.json(m) : res.status(404).json({ error: 'Réunion introuvable' });
};

router.get('/', async (req, res, next) => {
  try { res.json({ members: await B.members(req.guildDb), meetings: await B.listMeetings(req.guildDb), member: await B.isMember(req.guildDb, req.session.user.id) }); } catch (err) { next(err); }
});
router.put('/members', async (req, res, next) => {
  try {
    if (!(await canMembers(req))) return res.status(403).json({ error: 'Réservé aux fondateurs et à la permission « Paramètres »' });
    const r = await B.setMembers(req.guildDb, req.body?.members);
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'cab_members', details: { count: (req.body?.members || []).length } });
    res.json({ members: await B.members(req.guildDb) });
  } catch (err) { next(err); }
});
router.get('/changes/:id', async (req, res, next) => { try { res.json({ decisions: await B.ofChange(req.guildDb, id(req)) }); } catch (err) { next(err); } });
router.get('/meetings/:id', async (req, res, next) => { try { await meeting(req, res, null); } catch (err) { next(err); } });
// Opinions: each member for themself
router.post('/meetings/:id/agenda/:changeId/vote', async (req, res, next) => {
  try { await meeting(req, res, await B.vote(req.guildDb, id(req), parseInt(req.params.changeId) || 0, req.session.user.id, req.body?.vote, req.body?.comment)); } catch (err) { next(err); }
});
// The rest: members of the board and founders
router.use(async (req, res, next) => (req.method === 'GET' || await canRun(req) ? next() : res.status(403).json({ error: 'Réservé aux membres du comité et aux fondateurs' })));
router.post('/meetings', async (req, res, next) => {
  try { const r = await B.saveMeeting(req.guildDb, null, req.body || {}, dashboardActor(req)); await meeting(req, res, r, r.id); } catch (err) { next(err); }
});
router.put('/meetings/:id', async (req, res, next) => { try { await meeting(req, res, await B.saveMeeting(req.guildDb, id(req), req.body || {}, dashboardActor(req))); } catch (err) { next(err); } });
router.delete('/meetings/:id', async (req, res, next) => {
  try { const r = await B.deleteMeeting(req.guildDb, id(req)); if (r.error) return res.status(r.status || 400).json({ error: r.error }); res.json({ ok: true }); } catch (err) { next(err); }
});
router.post('/meetings/:id/agenda', async (req, res, next) => { try { await meeting(req, res, await B.addToAgenda(req.guildDb, id(req), parseInt(req.body?.changeId) || 0)); } catch (err) { next(err); } });
router.delete('/meetings/:id/agenda/:changeId', async (req, res, next) => { try { await meeting(req, res, await B.removeFromAgenda(req.guildDb, id(req), parseInt(req.params.changeId) || 0)); } catch (err) { next(err); } });
router.post('/meetings/:id/agenda/:changeId/decide', async (req, res, next) => {
  try { await meeting(req, res, await B.decide(req.guildDb, id(req), parseInt(req.params.changeId) || 0, req.body?.decision, req.body?.note, dashboardActor(req))); } catch (err) { next(err); }
});

module.exports = router;

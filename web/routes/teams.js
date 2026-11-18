// Teams (utils/teams.js): GET / and /mine for the staff (queues, ticket view), changes for the
// founders (Équipe → Équipes), each one in the space's journal.
const express = require('express');
const router = express.Router();
const teams = require('../../utils/teams');
const { recordEvent, dashboardActor } = require('../../utils/audit');

router.get('/', async (req, res, next) => {
  try { res.json(await teams.listTeams(req.guildDb)); } catch (err) { next(err); }
});
// What a team can receive: the subjects and tags of the space
router.get('/options', async (req, res, next) => {
  try {
    const [cfg] = await req.guildDb('SELECT ticket_subjects FROM guild_config WHERE id = 1');
    const subjects = require('../../utils/jsonField').parseJsonField(cfg?.ticket_subjects, []).map(x => (typeof x === 'string' ? x : x?.label || x?.name)).filter(Boolean);
    res.json({ subjects, tags: await req.guildDb('SELECT id, name FROM ticket_tags ORDER BY name') });
  } catch (err) { next(err); }
});
router.get('/mine', async (req, res, next) => {
  try {
    const mine = await teams.teamIdsOf(req.guildDb, req.session.user.id);
    res.json((await teams.listTeams(req.guildDb)).filter(t => mine.includes(t.id)).map(({ id, name, color }) => ({ id, name, color })));
  } catch (err) { next(err); }
});

const founders = (req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' }));
const done = async (req, res, action, details) => {
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action, details });
  res.json(await teams.listTeams(req.guildDb));
};

router.post('/', founders, async (req, res, next) => {
  try {
    const r = await teams.createTeam(req.guildDb, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    await done(req, res, 'team_create', { id: r.id, name: req.body?.name });
  } catch (err) { next(err); }
});
router.put('/:id', founders, async (req, res, next) => {
  try {
    const r = await teams.updateTeam(req.guildDb, parseInt(req.params.id) || 0, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await done(req, res, 'team_update', { id: parseInt(req.params.id), name: req.body?.name, mode: req.body?.assignMode });
  } catch (err) { next(err); }
});
router.delete('/:id', founders, async (req, res, next) => {
  try {
    const r = await teams.deleteTeam(req.guildDb, parseInt(req.params.id) || 0);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await done(req, res, 'team_delete', { id: parseInt(req.params.id) });
  } catch (err) { next(err); }
});

module.exports = router;

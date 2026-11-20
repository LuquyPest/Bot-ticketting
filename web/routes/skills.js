// Skills and languages of the staff (utils/skills.js, v7): the staff reads them (ticket view,
// Équipe → Équipes); the founders change the list, each person's skills and the skills of the
// subjects; anyone of the staff says which languages they answer in. In the space's journal.
const express = require('express');
const router = express.Router();
const S = require('../../utils/skills');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const founders = (req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' }));
const all = async db => ({ skills: await S.listSkills(db), staff: await S.staffList(db), subjects: await S.subjectMap(db), languages: S.LANGS });
const reply = async (req, res, r, action, details) => {
  if (r.error) return res.status(r.status || 400).json({ error: r.error });
  if (action) await recordEvent(req.guildDb, { actor: dashboardActor(req), action, details });
  res.json(await all(req.guildDb));
};

router.get('/', async (req, res, next) => { try { res.json(await all(req.guildDb)); } catch (err) { next(err); } });
router.post('/', founders, async (req, res, next) => {
  try { await reply(req, res, await S.createSkill(req.guildDb, req.body?.name), 'skill_create', { name: req.body?.name }); } catch (err) { next(err); }
});
router.patch('/:id', founders, async (req, res, next) => {
  try { await reply(req, res, await S.renameSkill(req.guildDb, (parseInt(req.params.id) || 0), req.body?.name), 'skill_update', { id: (parseInt(req.params.id) || 0), name: req.body?.name }); } catch (err) { next(err); }
});
router.delete('/:id', founders, async (req, res, next) => {
  try { await reply(req, res, await S.deleteSkill(req.guildDb, (parseInt(req.params.id) || 0)), 'skill_delete', { id: (parseInt(req.params.id) || 0) }); } catch (err) { next(err); }
});
// PUT /api/skills/staff/:userId { skills?, languages? } — founders; one's own languages for anyone
router.put('/staff/:userId', async (req, res, next) => {
  try {
    const self = String(req.params.userId) === String(req.session.user.id);
    if (!req.userIsFondateur && (!self || req.body?.skills !== undefined)) return res.status(403).json({ error: 'Réservé aux fondateurs (chacun règle ses propres langues)' });
    const input = { languages: req.body?.languages, ...(req.userIsFondateur ? { skills: req.body?.skills } : {}) };
    await reply(req, res, await S.saveStaff(req.guildDb, req.params.userId, input), 'staff_skills', { user: String(req.params.userId) });
  } catch (err) { next(err); }
});
router.put('/subjects', founders, async (req, res, next) => {
  try { await reply(req, res, await S.saveSubjectMap(req.guildDb, req.body?.subjects), 'subject_skills', null); } catch (err) { next(err); }
});

module.exports = router;

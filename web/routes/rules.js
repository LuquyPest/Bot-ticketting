// Business rules (utils/ruleEngine.js): read and write for the founders and the manage_rules
// permission; restricting tickets to a grade also needs manage_grades. Each change in the journal.
const express = require('express');
const router = express.Router();
const engine = require('../../utils/ruleEngine');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const canManage = req => req.userIsFondateur || req.userPermissions?.has('manage_rules');
const canGrade = req => req.userIsFondateur || req.userPermissions?.has('manage_grades');
router.use((req, res, next) => (canManage(req) ? next() : res.status(403).json({ error: 'Réservé aux fondateurs et à la permission manage_rules' })));

const list = async req => ({ rules: (await engine.listRules(req.guildDb)).filter(r => r.origin !== 'subject'), simple: (await engine.listRules(req.guildDb)).filter(r => r.origin === 'subject').length });
// A rule that already restricts to a grade can only be changed by someone who could have written it
const touchesGrade = r => (r?.actions || []).some(a => a.type === 'grade');

router.get('/', async (req, res, next) => {
  try { res.json(await list(req)); } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try {
    const r = await engine.saveRule(req.guildDb, null, req.body || {}, { canGrade: canGrade(req) });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'rule_save', targetType: 'rule', targetId: r.id, details: { name: r.value.name } });
    res.json({ id: r.id, ...(await list(req)) });
  } catch (err) { next(err); }
});
router.post('/test', async (req, res, next) => {
  try {
    const ticketId = parseInt(req.body?.ticketId) || 0;
    // The ticket must be one the person can see
    const { visibilityFilter } = require('../../utils/gradePermissions');
    const vis = await visibilityFilter(req);
    const [t] = await req.guildDb(`SELECT id FROM tickets WHERE id = ? AND ${vis.sql}`, [ticketId, ...vis.params]);
    if (!t) return res.status(404).json({ error: 'Ticket introuvable' });
    const r = await engine.testRule(req.guildDb, req.guildId, req.body?.rule || {}, t.id, { message: typeof req.body?.message === 'string' ? req.body.message.slice(0, 4000) : '' });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json(r);
  } catch (err) { next(err); }
});
router.put('/order', async (req, res, next) => {
  try { await engine.reorderRules(req.guildDb, req.body?.ids); res.json(await list(req)); } catch (err) { next(err); }
});
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const old = (await engine.listRules(req.guildDb)).find(r => r.id === id && r.origin !== 'subject');
    if (!old) return res.status(404).json({ error: 'Règle introuvable' });
    if (touchesGrade(old) && !canGrade(req)) return res.status(403).json({ error: 'Cette règle restreint à un grade : permission manage_grades requise' });
    const r = await engine.saveRule(req.guildDb, id, req.body || {}, { canGrade: canGrade(req) });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'rule_save', targetType: 'rule', targetId: id, details: { name: r.value.name } });
    res.json(await list(req));
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const old = (await engine.listRules(req.guildDb)).find(r => r.id === id && r.origin !== 'subject');
    if (!old) return res.status(404).json({ error: 'Règle introuvable' });
    if (touchesGrade(old) && !canGrade(req)) return res.status(403).json({ error: 'Cette règle restreint à un grade : permission manage_grades requise' });
    await engine.deleteRule(req.guildDb, id);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'rule_delete', targetType: 'rule', targetId: id, details: { name: old.name } });
    res.json(await list(req));
  } catch (err) { next(err); }
});

module.exports = router;

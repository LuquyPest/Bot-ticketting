// Satisfaction survey (utils/surveys.js).
// Public, by its link /enquete#<space>.<token> (the token stays in the fragment, sent in the body):
//   POST /api/survey/link   { token }                              → what the page shows
//   POST /api/survey/answer { token, rating, comment, answers }    → saved once
// Staff: GET /api/surveys/stats, GET / PUT /api/surveys/settings (founders, manage_settings)
const express = require('express');
const S = require('../../utils/surveys');
const { visibilityFilter } = require('../../utils/gradePermissions');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const GONE = 'Ce lien a expiré ou a déjà servi';
const pub = express.Router();
pub.post('/link', async (req, res) => {
  try {
    const f = await S.findByToken(req.body?.token);
    if (!f) return res.status(410).json({ error: GONE });
    const s = await S.settings(f.db);
    // The subject and the questions, never the conversation
    res.json({ space: f.space || 'Support', ticketId: f.ticket.id, subject: f.ticket.subject || null, questions: s.questions });
  } catch (err) { console.error('enquête: lien', err.message); res.status(500).json({ error: 'Erreur serveur' }); }
});
pub.post('/answer', async (req, res) => {
  try {
    const f = await S.findByToken(req.body?.token);
    if (!f) return res.status(410).json({ error: GONE });
    const r = await S.submit(f, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true });
  } catch (err) { console.error('enquête: réponse', err.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

const staff = express.Router();
const canManage = req => req.userIsFondateur || req.userPermissions?.has('manage_settings');
staff.get('/settings', async (req, res, next) => { try { res.json(await S.settings(req.guildDb)); } catch (err) { next(err); } });
staff.put('/settings', async (req, res, next) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
    const r = await S.saveSettings(req.guildDb, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'survey_settings', details: { mode: req.body?.mode, delay: req.body?.delayMinutes } });
    res.json(await S.settings(req.guildDb));
  } catch (err) { next(err); }
});
staff.get('/stats', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    res.json(await S.stats(req.guildDb, { days, vis: await visibilityFilter(req, 't.visibility_grade_id') }));
  } catch (err) { next(err); }
});

module.exports = { pub, staff };

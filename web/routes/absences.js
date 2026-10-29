// Planned absences of the staff (utils/absences.js). Everyone manages their own; founders and
// `manage_users` manage everyone's and see the whole team's.
const express = require('express');
const router = express.Router();
const { applyAbsences } = require('../../utils/absences');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const SNOWFLAKE_RE = /^\d{17,20}$/;
const MAX_DAYS = 366;
const canManage = req => req.userIsFondateur || req.userPermissions?.has('manage_users');

// GET /api/absences — upcoming and current absences (own, or the team's for managers), plus the last 10 ended
router.get('/', async (req, res) => {
  try {
    const all = canManage(req);
    const who = all ? '' : 'AND a.user_id = ?';
    const params = all ? [] : [req.session.user.id];
    const [current, past] = await Promise.all([
      req.guildDb(`SELECT a.*, COALESCE(u.username, a.user_id) AS username FROM staff_absences a LEFT JOIN dashboard_users u ON u.user_id = a.user_id
                   WHERE a.state <> 'done' ${who} ORDER BY a.starts_at`, params),
      req.guildDb(`SELECT a.*, COALESCE(u.username, a.user_id) AS username FROM staff_absences a LEFT JOIN dashboard_users u ON u.user_id = a.user_id
                   WHERE a.state = 'done' ${who} ORDER BY a.ends_at DESC LIMIT 10`, params),
    ]);
    res.json({ current, past, canManage: all });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/absences { userId?, startsAt, endsAt, reason? } — ISO dates (the browser sends its local time as ISO)
router.post('/', async (req, res) => {
  try {
    const userId = req.body.userId ? String(req.body.userId) : req.session.user.id;
    if (!SNOWFLAKE_RE.test(userId)) return res.status(400).json({ error: 'Membre invalide' });
    if (userId !== req.session.user.id && !canManage(req)) return res.status(403).json({ error: 'Tu ne peux planifier que tes propres absences' });
    const [member] = await req.guildDb("SELECT user_id, username FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [userId]);
    if (!member) return res.status(404).json({ error: 'Membre du staff introuvable' });
    const startsAt = new Date(req.body.startsAt), endsAt = new Date(req.body.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return res.status(400).json({ error: 'Dates invalides' });
    if (endsAt <= startsAt) return res.status(400).json({ error: 'La fin doit être après le début' });
    if (endsAt <= new Date()) return res.status(400).json({ error: 'Cette absence est déjà terminée' });
    if (endsAt - startsAt > MAX_DAYS * 86400000) return res.status(400).json({ error: `Une absence dure au plus ${MAX_DAYS} jours` });
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 160) || null : null;
    const [overlap] = await req.guildDb("SELECT 1 FROM staff_absences WHERE user_id = ? AND state <> 'done' AND starts_at < ? AND ends_at > ? LIMIT 1", [userId, endsAt, startsAt]);
    if (overlap) return res.status(409).json({ error: 'Une autre absence couvre déjà une partie de ces dates' });
    const r = await req.guildDb('INSERT INTO staff_absences (user_id, starts_at, ends_at, reason, created_by_id, created_by_tag) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, startsAt, endsAt, reason, req.session.user.id, req.session.user.username]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'absence_create', targetType: 'user', targetId: userId, details: { user: member.username, from: startsAt, to: endsAt, reason } });
    await applyAbsences(req.guildDb, req.guildId);
    const [row] = await req.guildDb('SELECT * FROM staff_absences WHERE id = ?', [r.insertId]);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/absences/:id — cancels a planned absence, or ends a current one now
router.delete('/:id', async (req, res) => {
  try {
    const [a] = await req.guildDb('SELECT * FROM staff_absences WHERE id = ?', [parseInt(req.params.id) || 0]);
    if (!a || a.state === 'done') return res.status(404).json({ error: 'Absence introuvable' });
    if (a.user_id !== req.session.user.id && !canManage(req)) return res.status(403).json({ error: 'Accès refusé' });
    if (a.state === 'active') await req.guildDb('UPDATE staff_absences SET ends_at = NOW() WHERE id = ?', [a.id]);
    else await req.guildDb('DELETE FROM staff_absences WHERE id = ?', [a.id]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'absence_delete', targetType: 'user', targetId: a.user_id, details: { from: a.starts_at, to: a.ends_at, ended: a.state === 'active' } });
    await applyAbsences(req.guildDb, req.guildId);
    res.json({ ok: true, ended: a.state === 'active' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

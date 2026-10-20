// Automatic rules by subject (utils/subjectRules.js). Read: staff; write: manage_settings.
const express = require('express');
const router = express.Router();
const { recordEvent, dashboardActor } = require('../../utils/audit');

const canManage = req => req.userIsFondateur || req.userPermissions?.has('manage_settings');

async function clean(req) {
  const b = req.body || {};
  const matchType = b.matchType === 'keyword' ? 'keyword' : 'subject';
  const out = { match_type: matchType, subject: null, keywords: null, tag_id: null, priority: null, visibility_grade_id: null };
  if (matchType === 'keyword') {
    // « remboursement, rembourser, carte refusée » : comma-separated words or phrases
    const words = typeof b.keywords === 'string' ? b.keywords.split(',').map(k => k.trim()).filter(Boolean) : [];
    if (!words.length || words.length > 20 || words.some(w => w.length < 3 || w.length > 60)) return { error: 'Mots-clés invalides (1 à 20, de 3 à 60 caractères, séparés par des virgules)' };
    out.keywords = words.join(', ').slice(0, 300);
  } else {
    if (typeof b.subject !== 'string' || !b.subject.trim() || b.subject.length > 100) return { error: 'Sujet invalide (100 caractères max)' };
    out.subject = b.subject.trim();
  }
  if (b.priority) { if (!['low', 'normal', 'urgent'].includes(b.priority)) return { error: 'Priorité invalide' }; out.priority = b.priority; }
  if (b.tagId) {
    const [t] = await req.guildDb('SELECT id FROM ticket_tags WHERE id = ?', [parseInt(b.tagId)]);
    if (!t) return { error: 'Tag introuvable' };
    out.tag_id = t.id;
  }
  if (b.gradeId) {
    const [g] = await req.guildDb('SELECT id FROM grades WHERE id = ?', [parseInt(b.gradeId)]);
    if (!g) return { error: 'Grade introuvable' };
    out.visibility_grade_id = g.id;
  }
  if (!out.priority && !out.tag_id && !out.visibility_grade_id) return { error: 'Choisis au moins une action' };
  return { value: out };
}

router.get('/', async (req, res) => {
  res.json(await req.guildDb(
    `SELECT r.*, t.name AS tag_name, g.name AS grade_name FROM subject_rules r
     LEFT JOIN ticket_tags t ON t.id = r.tag_id LEFT JOIN grades g ON g.id = r.visibility_grade_id ORDER BY r.match_type, r.subject, r.keywords`));
});

router.post('/', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  // Restricting tickets to a grade is a grade-management power
  if (req.body.gradeId && !(req.userIsFondateur || req.userPermissions?.has('manage_grades'))) return res.status(403).json({ error: 'Restreindre à un grade demande la permission manage_grades' });
  const { value, error } = await clean(req);
  if (error) return res.status(400).json({ error });
  const r = await req.guildDb('INSERT INTO subject_rules (match_type, subject, keywords, tag_id, priority, visibility_grade_id) VALUES (?, ?, ?, ?, ?, ?)',
    [value.match_type, value.subject, value.keywords, value.tag_id, value.priority, value.visibility_grade_id]);
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'subject_rule_create', targetType: 'rule', targetId: r.insertId, details: value });
  res.json({ id: r.insertId, ...value, active: 1 });
});

router.delete('/:id', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const [rule] = await req.guildDb('SELECT id, subject, keywords FROM subject_rules WHERE id = ?', [parseInt(req.params.id) || 0]);
  if (!rule) return res.status(404).json({ error: 'Règle introuvable' });
  await req.guildDb('DELETE FROM subject_rules WHERE id = ?', [rule.id]);
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'subject_rule_delete', targetType: 'rule', targetId: rule.id, details: { subject: rule.subject, keywords: rule.keywords } });
  res.json({ ok: true });
});

module.exports = router;

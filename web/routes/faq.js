// FAQ entries and articles of the knowledge base (utils/faq.js, utils/knowledgeBase.js).
// Read: any staff member; write: manage_settings; turning the public page on: founders.
const express = require('express');
const router = express.Router();
const { recordEvent, dashboardActor } = require('../../utils/audit');
const { findFaqMatches } = require('../../utils/faq');
const kb = require('../../utils/knowledgeBase');

const ANSWER_MAX = 5000;
const VISIBILITIES = ['members', 'public'];

const canManage = req => req.userIsFondateur || req.userPermissions?.has('manage_settings');

function clean(body, partial = false) {
  const out = {};
  const str = (k, max, required) => {
    if (body[k] === undefined) return partial ? null : (required ? `${k} requis` : null);
    if (typeof body[k] !== 'string' || (required && !body[k].trim())) return `${k} invalide`;
    if (body[k].length > max) return `${k} trop long (max ${max})`;
    out[k] = body[k].trim();
    return null;
  };
  const err = str('question', 200, true) || str('answer', ANSWER_MAX, true) || str('keywords', 500, false) || str('category', 80, false);
  if (err) return { error: err };
  if (out.category !== undefined) out.category = out.category.replace(/\s+/g, ' ');
  if (body.visibility !== undefined) {
    if (!VISIBILITIES.includes(body.visibility)) return { error: 'visibility invalide' };
    out.visibility = body.visibility;
  }
  if (out.keywords !== undefined) out.keywords = out.keywords.split(',').map(k => k.trim()).filter(Boolean).join(', ');
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return { error: 'active invalide' };
    out.active = body.active ? 1 : 0;
  }
  return { fields: out };
}

router.get('/', async (req, res) => {
  const rows = await req.guildDb('SELECT * FROM faq_entries ORDER BY solved_count DESC, id ASC');
  const [cfg] = await req.guildDb('SELECT faq_enabled, kb_public FROM guild_config WHERE id = 1');
  res.json({
    enabled: !!cfg?.faq_enabled, kbPublic: !!Number(cfg?.kb_public), kbUrl: kb.kbUrl(req.guildId),
    entries: rows.map(r => ({ ...r, active: !!r.active })),
  });
});

// PUT /api/faq/public { enabled } — the public page /aide/<space> (founders: it is visible to anyone)
router.put('/public', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé aux fondateurs' });
  if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled invalide' });
  await req.guildDb('UPDATE guild_config SET kb_public = ? WHERE id = 1', [req.body.enabled ? 1 : 0]);
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'config_update', details: { kbPublic: req.body.enabled } });
  res.json({ ok: true, kbPublic: req.body.enabled });
});

// POST /api/faq/preview { message } — which entries a member's message would get
router.post('/preview', async (req, res) => {
  const message = typeof req.body.message === 'string' ? req.body.message.slice(0, 2000) : '';
  const matches = await findFaqMatches(req.guildDb, message);
  res.json(matches.map(m => ({ id: m.id, question: m.question, score: m.score })));
});

router.put('/enabled', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled invalide' });
  await req.guildDb('UPDATE guild_config SET faq_enabled = ? WHERE id = 1', [req.body.enabled ? 1 : 0]);
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'config_update', details: { faqEnabled: req.body.enabled } });
  res.json({ ok: true, enabled: req.body.enabled });
});

router.post('/', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const { fields, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const r = await req.guildDb(
    'INSERT INTO faq_entries (question, answer, keywords, category, visibility, active, created_by_tag) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [fields.question, fields.answer, fields.keywords || '', fields.category || '', fields.visibility || 'members', fields.active ?? 1, req.session.user.username]
  );
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'faq_create', targetType: 'faq', targetId: r.insertId, details: { question: fields.question, visibility: fields.visibility || 'members' } });
  const [row] = await req.guildDb('SELECT * FROM faq_entries WHERE id = ?', [r.insertId]);
  res.json({ ...row, active: !!row.active });
});

router.patch('/:id', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const [entry] = await req.guildDb('SELECT id FROM faq_entries WHERE id = ?', [parseInt(req.params.id)]);
  if (!entry) return res.status(404).json({ error: 'Entrée introuvable' });
  const { fields, error } = clean(req.body, true);
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(fields);
  if (keys.length) {
    await req.guildDb(`UPDATE faq_entries SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = NOW() WHERE id = ?`, [...keys.map(k => fields[k]), entry.id]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'faq_update', targetType: 'faq', targetId: entry.id, details: { fields: keys, ...(fields.visibility ? { visibility: fields.visibility } : {}) } });
  }
  const [row] = await req.guildDb('SELECT * FROM faq_entries WHERE id = ?', [entry.id]);
  res.json({ ...row, active: !!row.active });
});

router.delete('/:id', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const [entry] = await req.guildDb('SELECT id, question FROM faq_entries WHERE id = ?', [parseInt(req.params.id)]);
  if (!entry) return res.status(404).json({ error: 'Entrée introuvable' });
  await req.guildDb('DELETE FROM faq_entries WHERE id = ?', [entry.id]);
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'faq_delete', targetType: 'faq', targetId: entry.id, details: { question: entry.question } });
  res.json({ ok: true });
});

module.exports = router;

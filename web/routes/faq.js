// FAQ entries and articles of the knowledge base (utils/faq.js, utils/knowledgeBase.js).
// Read: any staff member; write: manage_settings; turning the public page on: founders.
const express = require('express');
const router = express.Router();
const { recordEvent, dashboardActor } = require('../../utils/audit');
const { findFaqMatches } = require('../../utils/faq');
const kb = require('../../utils/knowledgeBase');

const ANSWER_MAX = 5000;
const VISIBILITIES = ['members', 'public', 'staff', 'organization', 'team'];
const LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt'];

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
  const err = str('question', 200, true) || str('answer', ANSWER_MAX, true) || str('keywords', 500, false) || str('category', 255, false);
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
  // v5.6: draft or published, the organisation or team of the visibility, review and expiry
  // dates, the language and the article it translates
  if (body.status !== undefined) {
    if (!['draft', 'published'].includes(body.status)) return { error: 'status invalide' };
    out.status = body.status;
  }
  for (const k of ['organization_id', 'team_id', 'translation_of']) {
    if (body[k] === undefined) continue;
    const v = body[k] === null || body[k] === '' ? null : Number(body[k]);
    if (v !== null && !Number.isInteger(v)) return { error: `${k} invalide` };
    out[k] = v;
  }
  for (const k of ['review_at', 'expires_at']) {
    if (body[k] === undefined) continue;
    if (body[k] && !/^\d{4}-\d{2}-\d{2}$/.test(body[k])) return { error: `${k} invalide (AAAA-MM-JJ)` };
    out[k] = body[k] || null;
  }
  if (body.lang !== undefined) {
    if (body.lang && !LANGS.includes(body.lang)) return { error: 'lang invalide' };
    out.lang = body.lang || null;
  }
  return { fields: out };
}

// The targets exist: an organisation for « organization », a team for « team », an original to translate
async function checkTargets(db, fields, current = {}) {
  const vis = fields.visibility ?? current.visibility;
  const org = fields.organization_id !== undefined ? fields.organization_id : current.organization_id;
  const team = fields.team_id !== undefined ? fields.team_id : current.team_id;
  if (vis === 'organization' && !(org && (await db('SELECT 1 FROM organizations WHERE id = ?', [org]).catch(() => [])).length)) return 'Choisis l\'organisation qui verra l\'article';
  if (vis === 'team' && !(team && (await db('SELECT 1 FROM teams WHERE id = ?', [team])).length)) return 'Choisis l\'équipe qui verra l\'article';
  if (fields.translation_of) {
    if (fields.translation_of === current.id) return 'Un article ne traduit pas lui-même';
    const [o] = await db('SELECT id, translation_of FROM faq_entries WHERE id = ?', [fields.translation_of]);
    if (!o || o.translation_of) return 'L\'article traduit doit être un original';
  }
  return null;
}
// A team's articles: for its members (founders: all)
async function teamFilter(req) {
  if (req.userIsFondateur) return { sql: '1=1', params: [] };
  const mine = await require('../../utils/teams').teamIdsOf(req.guildDb, req.session.user.id);
  return mine.length ? { sql: "(visibility <> 'team' OR team_id IN (?))", params: [mine] } : { sql: "visibility <> 'team'", params: [] };
}

router.get('/', async (req, res) => {
  const tf = await teamFilter(req);
  const rows = await req.guildDb(`SELECT * FROM faq_entries WHERE ${tf.sql} ORDER BY solved_count DESC, id ASC`, tf.params);
  const [cfg] = await req.guildDb('SELECT faq_enabled, kb_public FROM guild_config WHERE id = 1');
  res.json({
    enabled: !!cfg?.faq_enabled, kbPublic: !!Number(cfg?.kb_public), kbUrl: kb.kbUrl(req.guildId),
    entries: rows.map(r => ({ ...r, active: !!r.active })),
  });
});

// ── The tree of categories (utils/kbTree.js, v8): read by the staff, changed with « Paramètres » ──
const T = () => require('../../utils/kbTree');
const treeOut = async (req, res, r) => (r?.error ? res.status(r.status || 400).json({ error: r.error }) : res.json(await T().tree(req.guildDb, await teamFilter(req))));
router.get('/tree', async (req, res, next) => { try { await treeOut(req, res); } catch (err) { next(err); } });
router.post('/categories', async (req, res, next) => {
  try { if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' }); await treeOut(req, res, await T().createCategory(req.guildDb, req.body || {})); } catch (err) { next(err); }
});
router.patch('/categories/:id', async (req, res, next) => {
  try { if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' }); await treeOut(req, res, await T().renameCategory(req.guildDb, parseInt(req.params.id) || 0, req.body?.name)); } catch (err) { next(err); }
});
router.delete('/categories/:id', async (req, res, next) => {
  try { if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' }); await treeOut(req, res, await T().deleteCategory(req.guildDb, parseInt(req.params.id) || 0)); } catch (err) { next(err); }
});
// POST /api/faq/move { kind: category | article, id, parentId, index }
router.post('/move', async (req, res, next) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
    const r = await T().move(req.guildDb, req.body || {});
    if (r.ok) await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'faq_update', targetType: req.body.kind === 'article' ? 'faq' : 'kb_category', targetId: Number(req.body.id) || null, details: { moved: true } });
    await treeOut(req, res, r);
  } catch (err) { next(err); }
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
  const bad = await checkTargets(req.guildDb, fields);
  if (bad) return res.status(400).json({ error: bad });
  const r = await req.guildDb(
    `INSERT INTO faq_entries (question, answer, keywords, category, visibility, active, created_by_tag, status, organization_id, team_id, review_at, expires_at, lang, translation_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fields.question, fields.answer, fields.keywords || '', fields.category || '', fields.visibility || 'members', fields.active ?? 1, req.session.user.username,
      fields.status || 'published', fields.organization_id ?? null, fields.team_id ?? null, fields.review_at ?? null, fields.expires_at ?? null, fields.lang ?? null, fields.translation_of ?? null]
  );
  if (fields.category) await require('../../utils/kbTree').syncArticle(req.guildDb, r.insertId).catch(() => null); // v8: the tree
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'faq_create', targetType: 'faq', targetId: r.insertId, details: { question: fields.question, visibility: fields.visibility || 'members' } });
  const [row] = await req.guildDb('SELECT * FROM faq_entries WHERE id = ?', [r.insertId]);
  res.json({ ...row, active: !!row.active });
});

router.patch('/:id', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const [entry] = await req.guildDb('SELECT * FROM faq_entries WHERE id = ?', [parseInt(req.params.id)]);
  if (!entry) return res.status(404).json({ error: 'Entrée introuvable' });
  const { fields, error } = clean(req.body, true);
  if (error) return res.status(400).json({ error });
  const bad = await checkTargets(req.guildDb, fields, entry);
  if (bad) return res.status(400).json({ error: bad });
  const keys = Object.keys(fields);
  // The text changes: the version before is kept (révisions)
  if (['question', 'answer', 'category'].some(k => fields[k] !== undefined && fields[k] !== entry[k])) {
    await req.guildDb('INSERT INTO faq_revisions (faq_id, question, answer, category, edited_by_tag) VALUES (?, ?, ?, ?, ?)', [entry.id, entry.question, entry.answer, entry.category || '', entry.created_by_tag || null]);
    await req.guildDb('DELETE FROM faq_revisions WHERE faq_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM faq_revisions WHERE faq_id = ? ORDER BY id DESC LIMIT 50) x)', [entry.id, entry.id]);
  }
  if (keys.length) {
    await req.guildDb(`UPDATE faq_entries SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = NOW() WHERE id = ?`, [...keys.map(k => fields[k]), entry.id]);
    if (fields.category !== undefined && fields.category !== entry.category) await require('../../utils/kbTree').syncArticle(req.guildDb, entry.id).catch(() => null); // v8: the tree
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'faq_update', targetType: 'faq', targetId: entry.id, details: { fields: keys, ...(fields.visibility ? { visibility: fields.visibility } : {}) } });
  }
  const [row] = await req.guildDb('SELECT * FROM faq_entries WHERE id = ?', [entry.id]);
  res.json({ ...row, active: !!row.active });
});

// ── v5.6: revisions, readers' feedback, searches without results ──
router.get('/insights', async (req, res) => {
  const feedback = await req.guildDb(`SELECT f.id, f.faq_id, e.question, f.helpful, f.comment, f.created_at FROM faq_feedback f JOIN faq_entries e ON e.id = f.faq_id
    WHERE f.comment IS NOT NULL ORDER BY f.id DESC LIMIT 50`);
  const useful = await req.guildDb(`SELECT id, question, helpful_yes, helpful_no, view_count FROM faq_entries WHERE helpful_yes + helpful_no > 0 ORDER BY helpful_yes DESC, view_count DESC LIMIT 10`);
  const misses = await req.guildDb('SELECT query, misses, last_at FROM kb_searches ORDER BY misses DESC, last_at DESC LIMIT 30');
  const review = await req.guildDb("SELECT id, question, review_at, expires_at FROM faq_entries WHERE (review_at IS NOT NULL AND review_at <= CURDATE()) OR (expires_at IS NOT NULL AND expires_at <= CURDATE() + INTERVAL 14 DAY) ORDER BY COALESCE(review_at, expires_at) LIMIT 30");
  res.json({ feedback, useful, misses, review });
});
router.delete('/insights/searches', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  await req.guildDb('DELETE FROM kb_searches');
  res.json({ ok: true });
});
router.get('/:id/revisions', async (req, res) => {
  res.json(await req.guildDb('SELECT id, question, answer, category, edited_by_tag, created_at FROM faq_revisions WHERE faq_id = ? ORDER BY id DESC LIMIT 50', [parseInt(req.params.id) || 0]));
});
router.post('/:id/revisions/:revId/restore', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const [entry] = await req.guildDb('SELECT * FROM faq_entries WHERE id = ?', [parseInt(req.params.id) || 0]);
  const [rev] = entry ? await req.guildDb('SELECT * FROM faq_revisions WHERE id = ? AND faq_id = ?', [parseInt(req.params.revId) || 0, entry.id]) : [];
  if (!rev) return res.status(404).json({ error: 'Version introuvable' });
  await req.guildDb('INSERT INTO faq_revisions (faq_id, question, answer, category, edited_by_tag) VALUES (?, ?, ?, ?, ?)', [entry.id, entry.question, entry.answer, entry.category || '', req.session.user.username]);
  await req.guildDb('UPDATE faq_entries SET question = ?, answer = ?, category = ?, updated_at = NOW() WHERE id = ?', [rev.question, rev.answer, rev.category, entry.id]);
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'faq_update', targetType: 'faq', targetId: entry.id, details: { restored: rev.id } });
  const [row] = await req.guildDb('SELECT * FROM faq_entries WHERE id = ?', [entry.id]);
  res.json({ ...row, active: !!row.active });
});

// POST /api/faq/:id/images — an image for the article (multipart « file »), v6: { url, markdown }
const imageUpload = (req, res, next) => require('multer')({ storage: require('multer').memoryStorage(), defParamCharset: 'utf8', limits: { fileSize: require('../../utils/kbImages').MAX_BYTES, files: 1, fields: 2 } })
  .single('file')(req, res, err => (err ? res.status(413).json({ error: 'Image trop lourde (5 Mo au plus)' }) : next()));
router.post('/:id/images', (req, res, next) => (canManage(req) ? next() : res.status(403).json({ error: 'Permission insuffisante' })), imageUpload, async (req, res, next) => {
  try {
    const [entry] = await req.guildDb('SELECT id FROM faq_entries WHERE id = ?', [parseInt(req.params.id) || 0]);
    if (!entry) return res.status(404).json({ error: 'Entrée introuvable' });
    const r = await require('../../utils/kbImages').store(req.guildDb, req.guildId, entry.id, req.file);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'faq_image_add', targetType: 'faq', targetId: entry.id });
    res.status(201).json(r);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const [entry] = await req.guildDb('SELECT id, question FROM faq_entries WHERE id = ?', [parseInt(req.params.id)]);
  if (!entry) return res.status(404).json({ error: 'Entrée introuvable' });
  await require('../../utils/kbImages').removeForArticle(req.guildDb, req.guildId, entry.id);
  await req.guildDb('DELETE FROM faq_entries WHERE id = ?', [entry.id]);
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'faq_delete', targetType: 'faq', targetId: entry.id, details: { question: entry.question } });
  res.json({ ok: true });
});

module.exports = router;

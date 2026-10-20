// Member profiles (utils/memberProfiles.js). Reading: view_tickets; posting and labels:
// reply_ticket; editing or deleting a post: its author (founders: any post).
const express = require('express');
const router = express.Router();
const { visibilityFilter } = require('../../utils/gradePermissions');
const { recordEvent, dashboardActor } = require('../../utils/audit');
const mp = require('../../utils/memberProfiles');

const SNOWFLAKE_RE = /^\d{17,20}$/;
const has = (req, p) => req.userIsFondateur || req.userPermissions?.has(p);

router.use((req, res, next) => (has(req, 'view_tickets') ? next() : res.status(403).json({ error: 'Permission insuffisante' })));
router.param('memberId', (req, res, next, id) => (SNOWFLAKE_RE.test(id) ? next() : res.status(400).json({ error: 'ID Discord invalide' })));

async function avatarOf(client, memberId) {
  const u = client?.users?.cache?.get(memberId) || await client?.users?.fetch?.(memberId).catch(() => null);
  return u ? { avatar: u.displayAvatarURL?.({ size: 128 }) || null, username: u.username || null } : { avatar: null, username: null };
}

router.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const page = Math.max(1, Math.min(200, parseInt(req.query.page) || 1));
    res.json(await mp.directory(req.guildDb, { q, page, vis: await visibilityFilter(req, 't.visibility_grade_id') }));
  } catch (err) { next(err); }
});

router.get('/:memberId', async (req, res, next) => {
  try {
    const p = await mp.profile(req.guildDb, req.params.memberId, await visibilityFilter(req, 't.visibility_grade_id'));
    res.json({ ...p, ...(await avatarOf(req.app.locals.client, req.params.memberId)) });
  } catch (err) { next(err); }
});

router.get('/:memberId/summary', async (req, res, next) => {
  try { res.json(await mp.summary(req.guildDb, req.params.memberId)); } catch (err) { next(err); }
});

router.get('/:memberId/posts', async (req, res, next) => {
  try { res.json(await mp.posts(req.guildDb, req.params.memberId)); } catch (err) { next(err); }
});

// POST /api/profiles/:memberId/posts { content, parentId } — new post or reply
router.post('/:memberId/posts', async (req, res, next) => {
  try {
    if (!has(req, 'reply_ticket')) return res.status(403).json({ error: 'Permission insuffisante' });
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length > 2000) return res.status(400).json({ error: 'Message vide ou trop long (2000 caractères max)' });
    let parentId = null;
    if (req.body?.parentId) {
      const [parent] = await req.guildDb('SELECT id, parent_id FROM member_notes WHERE id = ? AND member_id = ?', [parseInt(req.body.parentId) || 0, req.params.memberId]);
      if (!parent) return res.status(404).json({ error: 'Message introuvable' });
      parentId = parent.parent_id || parent.id; // replies stay one level deep
    }
    const { insertId } = await req.guildDb('INSERT INTO member_notes (member_id, parent_id, author_id, author_tag, content) VALUES (?, ?, ?, ?, ?)',
      [req.params.memberId, parentId, req.session.user.id, req.session.user.username, content]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'member_note_add', targetType: 'member', targetId: req.params.memberId, details: { excerpt: content.slice(0, 120), reply: !!parentId } });
    res.json({ id: insertId, posts: await mp.posts(req.guildDb, req.params.memberId) });
  } catch (err) { next(err); }
});

async function ownPost(req, res) {
  const [post] = await req.guildDb('SELECT * FROM member_notes WHERE id = ?', [parseInt(req.params.postId) || 0]);
  if (!post) { res.status(404).json({ error: 'Message introuvable' }); return null; }
  return post;
}

// PATCH /api/profiles/posts/:postId { content, pinned } — author edits; pinning: reply_ticket
router.patch('/posts/:postId', async (req, res, next) => {
  try {
    const post = await ownPost(req, res);
    if (!post) return;
    if (req.body?.content !== undefined) {
      if (post.author_id !== req.session.user.id && !req.userIsFondateur) return res.status(403).json({ error: 'Seul son auteur peut modifier ce message' });
      const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
      if (!content || content.length > 2000) return res.status(400).json({ error: 'Message vide ou trop long (2000 caractères max)' });
      await req.guildDb('UPDATE member_notes SET content = ?, edited_at = NOW() WHERE id = ?', [content, post.id]);
    }
    if (req.body?.pinned !== undefined) {
      if (!has(req, 'reply_ticket')) return res.status(403).json({ error: 'Permission insuffisante' });
      if (post.parent_id) return res.status(400).json({ error: 'Seuls les sujets (pas les réponses) peuvent être épinglés' });
      await req.guildDb('UPDATE member_notes SET pinned = ? WHERE id = ?', [req.body.pinned ? 1 : 0, post.id]);
    }
    res.json({ posts: await mp.posts(req.guildDb, post.member_id) });
  } catch (err) { next(err); }
});

router.delete('/posts/:postId', async (req, res, next) => {
  try {
    const post = await ownPost(req, res);
    if (!post) return;
    if (post.author_id !== req.session.user.id && !req.userIsFondateur) return res.status(403).json({ error: 'Seul son auteur peut supprimer ce message' });
    await req.guildDb('DELETE FROM member_notes WHERE id = ?', [post.id]); // replies go with it
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'member_note_delete', targetType: 'member', targetId: post.member_id, details: { excerpt: post.content.slice(0, 120) } });
    res.json({ posts: await mp.posts(req.guildDb, post.member_id) });
  } catch (err) { next(err); }
});

// PUT /api/profiles/:memberId/labels { labels: [] } — « VIP », « à surveiller »… (10 max)
router.put('/:memberId/labels', async (req, res, next) => {
  try {
    if (!has(req, 'reply_ticket')) return res.status(403).json({ error: 'Permission insuffisante' });
    const labels = mp.cleanLabels(req.body?.labels);
    if (!labels) return res.status(400).json({ error: `${mp.MAX_LABELS} étiquettes au maximum, 30 caractères chacune` });
    await req.guildDb('INSERT INTO member_profiles (member_id, labels) VALUES (?, ?) ON DUPLICATE KEY UPDATE labels = VALUES(labels)', [req.params.memberId, JSON.stringify(labels)]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'member_labels', targetType: 'member', targetId: req.params.memberId, details: { labels } });
    res.json({ labels });
  } catch (err) { next(err); }
});

module.exports = router;

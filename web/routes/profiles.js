// Contact cards (utils/contacts.js, utils/memberProfiles.js), at /api/profiles/:memberId where
// memberId is any identity of the contact (Discord ID, mail:…, web:…). Reading: view_tickets;
// posting, labels, editing the card, merging and detaching: reply_ticket; editing or deleting a
// post: its author (founders: any post). Every ticket figure goes through the visibility filter.
const express = require('express');
const router = express.Router();
const { visibilityFilter } = require('../../utils/gradePermissions');
const { recordEvent, dashboardActor } = require('../../utils/audit');
const mp = require('../../utils/memberProfiles');
const contacts = require('../../utils/contacts');

const SNOWFLAKE_RE = /^\d{17,20}$/;
const has = (req, p) => req.userIsFondateur || req.userPermissions?.has(p);

router.use((req, res, next) => (has(req, 'view_tickets') ? next() : res.status(403).json({ error: 'Permission insuffisante' })));
// The card behind the identity: req.card = { contact, identities, primary }
router.param('memberId', async (req, res, next, id) => {
  if (!contacts.VALUE_RE.test(id)) return res.status(400).json({ error: 'Identifiant de contact invalide' });
  try { req.card = await contacts.resolve(req.guildDb, id); next(); } catch (err) { next(err); }
});

async function avatarOf(client, memberId) {
  if (!SNOWFLAKE_RE.test(memberId)) return { avatar: null, username: null };
  const u = client?.users?.cache?.get(memberId) || await client?.users?.fetch?.(memberId).catch(() => null);
  return u ? { avatar: u.displayAvatarURL?.({ size: 128 }) || null, username: u.username || null } : { avatar: null, username: null };
}

router.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const page = Math.max(1, Math.min(200, parseInt(req.query.page) || 1));
    res.json(await contacts.directory(req.guildDb, { q, page, key: req.guildId, vis: await visibilityFilter(req, 't.visibility_grade_id') }));
  } catch (err) { next(err); }
});

router.get('/:memberId', async (req, res, next) => {
  try {
    const { card } = req;
    const p = await mp.profile(req.guildDb, card.identities.map(i => i.value), await visibilityFilter(req, 't.visibility_grade_id'), card.primary);
    const discordId = card.identities.find(i => i.kind === 'discord')?.value;
    res.json({
      ...p, ...(await avatarOf(req.app.locals.client, discordId)),
      contact: card.contact && { id: card.contact.id, displayName: card.contact.display_name, email: card.contact.email, notes: card.contact.notes, createdAt: card.contact.created_at },
      // Organisation of the contact (utils/organizations.js): by domain, or placed by hand
      organization: card.contact ? await orgOfContact(req.guildDb, card.contact.id) : null,
      identities: card.identities.map(({ value, kind, label, primary }) => ({ value, kind, label, primary: !!primary })),
      tag: card.contact?.display_name || p.tag,
    });
  } catch (err) { next(err); }
});

async function orgOfContact(db, contactId) {
  const [r] = await db('SELECT c.org_manual, c.org_portal_manager, o.id, o.name, o.portal_visibility FROM contacts c LEFT JOIN organizations o ON o.id = c.organization_id WHERE c.id = ?', [contactId]).catch(() => []);
  return r ? { id: r.id || null, name: r.name || null, manual: !!Number(r.org_manual), portalManager: !!Number(r.org_portal_manager), portalVisibility: r.portal_visibility || 'none' } : null;
}
// PUT /api/profiles/:memberId/organization { organizationId } (null = none) | { auto: true } (by the e-mail domain)
router.put('/:memberId/organization', async (req, res, next) => {
  try {
    if (!has(req, 'reply_ticket')) return res.status(403).json({ error: 'Permission insuffisante' });
    if (!req.card.contact) return res.status(404).json({ error: 'Contact introuvable' });
    const orgs = require('../../utils/organizations');
    // { portalManager } alone: sees the tickets of their organisation in the member space (v5.3)
    if (req.body && 'portalManager' in req.body && !('organizationId' in req.body) && !req.body.auto) {
      // It opens the tickets of other people to this contact: those who manage the organisations decide
      if (!(req.userIsFondateur || req.userPermissions?.has('manage_settings'))) return res.status(403).json({ error: 'Réservé aux fondateurs et à la permission « Paramètres »' });
      await orgs.setPortalManager(req.guildDb, req.card.contact.id, !!req.body.portalManager);
      await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'contact_portal_manager', targetType: 'contact', targetId: req.card.contact.id, details: { on: !!req.body.portalManager } });
      return res.json({ organization: await orgOfContact(req.guildDb, req.card.contact.id) });
    }
    const r = await orgs.setContactOrg(req.guildDb, req.card.contact.id, req.body?.organizationId ? Number(req.body.organizationId) : null, { auto: !!req.body?.auto });
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'contact_organization', targetType: 'contact', targetId: req.card.contact.id, details: { organizationId: req.body?.organizationId || null, auto: !!req.body?.auto } });
    res.json({ organization: await orgOfContact(req.guildDb, req.card.contact.id) });
  } catch (err) { next(err); }
});

router.get('/:memberId/summary', async (req, res, next) => {
  try { res.json(await mp.summary(req.guildDb, req.card.primary)); } catch (err) { next(err); }
});

router.get('/:memberId/posts', async (req, res, next) => {
  try { res.json(await mp.posts(req.guildDb, req.card.primary)); } catch (err) { next(err); }
});

// POST /api/profiles/:memberId/posts { content, parentId } — new post or reply
router.post('/:memberId/posts', async (req, res, next) => {
  try {
    if (!has(req, 'reply_ticket')) return res.status(403).json({ error: 'Permission insuffisante' });
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length > 2000) return res.status(400).json({ error: 'Message vide ou trop long (2000 caractères max)' });
    let parentId = null;
    if (req.body?.parentId) {
      const [parent] = await req.guildDb('SELECT id, parent_id FROM member_notes WHERE id = ? AND member_id = ?', [parseInt(req.body.parentId) || 0, req.card.primary]);
      if (!parent) return res.status(404).json({ error: 'Message introuvable' });
      parentId = parent.parent_id || parent.id; // replies stay one level deep
    }
    const { insertId } = await req.guildDb('INSERT INTO member_notes (member_id, parent_id, author_id, author_tag, content) VALUES (?, ?, ?, ?, ?)',
      [req.card.primary, parentId, req.session.user.id, req.session.user.username, content]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'member_note_add', targetType: 'member', targetId: req.card.primary, details: { excerpt: content.slice(0, 120), reply: !!parentId } });
    res.json({ id: insertId, posts: await mp.posts(req.guildDb, req.card.primary) });
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
    await req.guildDb('INSERT INTO member_profiles (member_id, labels) VALUES (?, ?) ON DUPLICATE KEY UPDATE labels = VALUES(labels)', [req.card.primary, JSON.stringify(labels)]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'member_labels', targetType: 'member', targetId: req.card.primary, details: { labels } });
    res.json({ labels });
  } catch (err) { next(err); }
});

// PATCH /api/profiles/:memberId/contact { displayName, email, notes } — the card itself
router.patch('/:memberId/contact', async (req, res, next) => {
  try {
    if (!has(req, 'reply_ticket')) return res.status(403).json({ error: 'Permission insuffisante' });
    const { displayName, email, notes } = req.body || {};
    const r = await contacts.update(req.guildDb, req.card, { displayName, email, notes });
    if (r.error) return res.status(r.status).json({ error: r.error });
    if (email !== undefined) { // a new address may belong to an organisation's domain
      const orgs = require('../../utils/organizations');
      await orgs.attachByDomain(req.guildDb);
      await orgs.refreshOpenTickets(req.guildDb, { contactId: r.contact.id });
    }
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'contact_update', targetType: 'contact', targetId: r.contact.id, details: { fields: Object.keys(req.body || {}).filter(k => ['displayName', 'email', 'notes'].includes(k)) } });
    res.json({ contact: { id: r.contact.id, displayName: r.contact.display_name, email: r.contact.email, notes: r.contact.notes } });
  } catch (err) { next(err); }
});

// POST /api/profiles/:memberId/merge { other } — the card of `other` (any of its identities) joins this one
router.post('/:memberId/merge', async (req, res, next) => {
  try {
    if (!has(req, 'reply_ticket')) return res.status(403).json({ error: 'Permission insuffisante' });
    const other = String(req.body?.other || '');
    if (!contacts.VALUE_RE.test(other)) return res.status(400).json({ error: 'Identifiant de contact invalide' });
    const r = await contacts.merge(req.guildDb, req.card, await contacts.resolve(req.guildDb, other));
    if (r.error) return res.status(r.status).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'contact_merge', targetType: 'contact', targetId: req.card.contact.id, details: { identities: r.moved } });
    res.json({ ok: true, memberId: req.card.primary });
  } catch (err) { next(err); }
});

// DELETE /api/profiles/:memberId/identities/:value — that identity gets a card of its own again
router.delete('/:memberId/identities/:value', async (req, res, next) => {
  try {
    if (!has(req, 'reply_ticket')) return res.status(403).json({ error: 'Permission insuffisante' });
    const r = await contacts.detach(req.guildDb, req.card, req.params.value);
    if (r.error) return res.status(r.status).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'contact_detach', targetType: 'contact', targetId: req.card.contact.id, details: { identity: req.params.value } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

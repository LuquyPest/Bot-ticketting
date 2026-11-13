// Staff roles (page Rôles): named groups of staff members attached to tags. A ticket carrying one
// of those tags is seen only by the members of the role (founders see everything).
const express = require('express');
const router = express.Router();
const { logAudit } = require('../../utils/gradePermissions');
const { scheduleTagsResync } = require('../../utils/channelVisibility');

const SNOWFLAKE_RE = /^\d{17,20}$/;

// Founders only: being in a role widens what one sees, so the staff cannot grant it to themselves
function canManage(req) {
  return req.userIsFondateur;
}

const cleanIds = (list) => [...new Set((Array.isArray(list) ? list : []).map(n => parseInt(n)).filter(n => n > 0))];

async function loadRoles(db) {
  const roles = await db('SELECT id, name, color, position, created_at FROM access_roles ORDER BY position ASC, id ASC');
  if (!roles.length) return [];
  const ids = roles.map(r => r.id);
  const [members, tags] = await Promise.all([
    db('SELECT m.role_id, m.user_id, u.username, u.avatar FROM access_role_members m LEFT JOIN dashboard_users u ON u.user_id = m.user_id WHERE m.role_id IN (?)', [ids]),
    db('SELECT rt.role_id, t.id, t.name, t.color FROM access_role_tags rt JOIN ticket_tags t ON t.id = rt.tag_id WHERE rt.role_id IN (?)', [ids]),
  ]);
  return roles.map(r => ({
    ...r,
    members: members.filter(m => m.role_id === r.id).map(({ user_id, username, avatar }) => ({ user_id, username: username || user_id, avatar })),
    tags: tags.filter(t => t.role_id === r.id).map(({ id, name, color }) => ({ id, name, color })),
  }));
}

async function tagIdsOf(db, roleId) {
  return (await db('SELECT tag_id FROM access_role_tags WHERE role_id = ?', [roleId])).map(r => r.tag_id);
}

router.get('/', async (req, res) => {
  try {
    res.json(await loadRoles(req.guildDb));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Réservé aux fondateurs' });
  try {
    const name = String(req.body.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Nom requis' });
    const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : '#6366f1';
    const [{ pos }] = await req.guildDb('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM access_roles');
    const r = await req.guildDb('INSERT INTO access_roles (name, color, position) VALUES (?, ?, ?)', [name, color, pos]);
    await logAudit(req.session.user.id, req.session.user.username, 'access_role_create', 'access_role', r.insertId, { name, color }, req.guildDb);
    res.json({ id: r.insertId, name, color, position: pos, members: [], tags: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Réservé aux fondateurs' });
  try {
    const id = parseInt(req.params.id);
    const [role] = await req.guildDb('SELECT * FROM access_roles WHERE id = ?', [id]);
    if (!role) return res.status(404).json({ error: 'Rôle introuvable' });
    const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 80) : role.name;
    if (!name) return res.status(400).json({ error: 'Nom invalide' });
    const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : role.color;
    await req.guildDb('UPDATE access_roles SET name = ?, color = ? WHERE id = ?', [name, color, id]);
    await logAudit(req.session.user.id, req.session.user.username, 'access_role_update', 'access_role', id, { name, color }, req.guildDb);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Members: dashboard staff accounts only
router.put('/:id/members', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Réservé aux fondateurs' });
  try {
    const id = parseInt(req.params.id);
    const [role] = await req.guildDb('SELECT id, name FROM access_roles WHERE id = ?', [id]);
    if (!role) return res.status(404).json({ error: 'Rôle introuvable' });
    const wanted = [...new Set((Array.isArray(req.body.userIds) ? req.body.userIds : []).map(String).filter(u => SNOWFLAKE_RE.test(u)))];
    const staff = wanted.length
      ? (await req.guildDb("SELECT user_id FROM dashboard_users WHERE user_id IN (?) AND role IN ('support', 'fondateur')", [wanted])).map(u => u.user_id)
      : [];
    await req.guildDb('DELETE FROM access_role_members WHERE role_id = ?', [id]);
    for (const userId of staff) await req.guildDb('INSERT IGNORE INTO access_role_members (role_id, user_id) VALUES (?, ?)', [id, userId]);
    await logAudit(req.session.user.id, req.session.user.username, 'access_role_members', 'access_role', id, { name: role.name, members: staff }, req.guildDb);
    scheduleTagsResync(req.guildDb, req.app.locals.client, req.guildId, await tagIdsOf(req.guildDb, id));
    res.json({ ok: true, userIds: staff });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/:id/tags', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Réservé aux fondateurs' });
  try {
    const id = parseInt(req.params.id);
    const [role] = await req.guildDb('SELECT id, name FROM access_roles WHERE id = ?', [id]);
    if (!role) return res.status(404).json({ error: 'Rôle introuvable' });
    const wanted = cleanIds(req.body.tagIds);
    const tags = wanted.length ? (await req.guildDb('SELECT id FROM ticket_tags WHERE id IN (?)', [wanted])).map(t => t.id) : [];
    const before = await tagIdsOf(req.guildDb, id);
    await req.guildDb('DELETE FROM access_role_tags WHERE role_id = ?', [id]);
    for (const tagId of tags) await req.guildDb('INSERT IGNORE INTO access_role_tags (role_id, tag_id) VALUES (?, ?)', [id, tagId]);
    await logAudit(req.session.user.id, req.session.user.username, 'access_role_tags', 'access_role', id, { name: role.name, tags }, req.guildDb);
    scheduleTagsResync(req.guildDb, req.app.locals.client, req.guildId, [...new Set([...before, ...tags])]);
    res.json({ ok: true, tagIds: tags });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Réservé aux fondateurs' });
  try {
    const id = parseInt(req.params.id);
    const [role] = await req.guildDb('SELECT id, name FROM access_roles WHERE id = ?', [id]);
    if (!role) return res.status(404).json({ error: 'Rôle introuvable' });
    const tagIds = await tagIdsOf(req.guildDb, id);
    await req.guildDb('DELETE FROM access_roles WHERE id = ?', [id]);
    await logAudit(req.session.user.id, req.session.user.username, 'access_role_delete', 'access_role', id, { name: role.name }, req.guildDb);
    scheduleTagsResync(req.guildDb, req.app.locals.client, req.guildId, tagIds);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

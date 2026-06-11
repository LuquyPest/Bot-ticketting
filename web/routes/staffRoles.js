const express = require('express');
const router = express.Router();
const { logAudit } = require('../../utils/gradePermissions');

const VALID_PERMS = [
  'manage_tickets', 'manage_settings', 'view_audit',
  'manage_grades', 'close_others', 'view_all_tickets',
];

function parse(body) {
  const { name, discord_role_ids, level, permissions, is_founder_role = 0, color = '#6366f1' } = body;
  if (typeof name !== 'string' || name.length < 1 || name.length > 80)
    return [null, 'Nom invalide (1–80 caractères)'];
  if (!Array.isArray(discord_role_ids) || discord_role_ids.some(id => typeof id !== 'string'))
    return [null, 'discord_role_ids doit être un tableau de chaînes'];
  if (!Number.isInteger(level) || level < 1 || level > 10)
    return [null, 'Niveau invalide (1–10)'];
  if (!Array.isArray(permissions) || permissions.some(p => !VALID_PERMS.includes(p)))
    return [null, `Permissions invalides. Valeurs acceptées : ${VALID_PERMS.join(', ')}`];
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color))
    return [null, 'Couleur invalide (format #RRGGBB requis)'];
  return [{ name, discord_role_ids, level, permissions, is_founder_role: is_founder_role ? 1 : 0, color }, null];
}

router.get('/', async (req, res) => {
  try {
    const rows = await req.guildDb('SELECT * FROM staff_roles ORDER BY level DESC, name ASC');
    res.json(rows.map(r => ({
      ...r,
      discord_role_ids: typeof r.discord_role_ids === 'string' ? JSON.parse(r.discord_role_ids) : r.discord_role_ids,
      permissions:      typeof r.permissions === 'string'      ? JSON.parse(r.permissions)      : r.permissions,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/', async (req, res) => {
  if (!req.userIsFondateur && !req.userPermissions?.has('manage_settings'))
    return res.status(403).json({ error: 'Permission insuffisante' });

  const [data, err] = parse(req.body);
  if (err) return res.status(400).json({ error: err });

  try {
    const result = await req.guildDb(
      'INSERT INTO staff_roles (name, discord_role_ids, level, permissions, is_founder_role, color) VALUES (?, ?, ?, ?, ?, ?)',
      [data.name, JSON.stringify(data.discord_role_ids), data.level, JSON.stringify(data.permissions), data.is_founder_role, data.color]
    );
    await logAudit(
      req.session.user.id, req.session.user.username,
      'staff_role_create', 'staff_roles', req.guildId,
      { name: data.name }, req.guildDb
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id', async (req, res) => {
  if (!req.userIsFondateur && !req.userPermissions?.has('manage_settings'))
    return res.status(403).json({ error: 'Permission insuffisante' });

  const [data, err] = parse(req.body);
  if (err) return res.status(400).json({ error: err });

  try {
    const [existing] = await req.guildDb('SELECT id FROM staff_roles WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Rôle introuvable' });

    await req.guildDb(
      `UPDATE staff_roles
       SET name=?, discord_role_ids=?, level=?, permissions=?, is_founder_role=?, color=?
       WHERE id=?`,
      [data.name, JSON.stringify(data.discord_role_ids), data.level, JSON.stringify(data.permissions), data.is_founder_role, data.color, req.params.id]
    );
    await logAudit(
      req.session.user.id, req.session.user.username,
      'staff_role_update', 'staff_roles', req.guildId,
      { id: req.params.id, name: data.name }, req.guildDb
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id', async (req, res) => {
  if (!req.userIsFondateur && !req.userPermissions?.has('manage_settings'))
    return res.status(403).json({ error: 'Permission insuffisante' });

  try {
    const [existing] = await req.guildDb('SELECT id, name FROM staff_roles WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Rôle introuvable' });

    await req.guildDb('DELETE FROM staff_roles WHERE id = ?', [req.params.id]);
    await logAudit(
      req.session.user.id, req.session.user.username,
      'staff_role_delete', 'staff_roles', req.guildId,
      { id: req.params.id, name: existing.name }, req.guildDb
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

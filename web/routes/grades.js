const express = require('express');
const router = express.Router();
const { PERMISSIONS, logAudit } = require('../../utils/gradePermissions');

function canManageGrades(req) {
  return req.userIsFondateur || req.userPermissions.has('manage_grades');
}

router.get('/', async (req, res) => {
  try {
    const grades = await req.guildDb(
      'SELECT id, name, color, parent_id, position, is_default, created_at FROM grades ORDER BY position ASC, id ASC'
    );
    if (!grades.length) return res.json([]);

    const gradeIds = grades.map(g => g.id);
    const [perms, userCounts] = await Promise.all([
      req.guildDb('SELECT grade_id, permission FROM grade_permissions WHERE grade_id IN (?)', [gradeIds]),
      req.guildDb('SELECT grade_id, COUNT(*) as cnt FROM user_grades WHERE grade_id IN (?) GROUP BY grade_id', [gradeIds])
    ]);

    const permMap = {};
    for (const p of perms) {
      if (!permMap[p.grade_id]) permMap[p.grade_id] = [];
      permMap[p.grade_id].push(p.permission);
    }
    const countMap = {};
    for (const r of userCounts) countMap[r.grade_id] = Number(r.cnt);

    res.json(grades.map(g => ({
      ...g,
      permissions: permMap[g.id] || [],
      user_count: countMap[g.id] || 0
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/', async (req, res) => {
  if (!canManageGrades(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const { name, color, parent_id, position, permissions: perms = [] } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Nom requis' });
    }
    const cleanName = name.trim().slice(0, 80);
    const cleanColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1';
    const cleanParent = parent_id ? parseInt(parent_id) : null;
    const cleanPos = Number.isInteger(position) ? position : 0;
    const validPerms = (Array.isArray(perms) ? perms : []).filter(p => PERMISSIONS.includes(p));

    const result = await req.guildDb(
      'INSERT INTO grades (name, color, parent_id, position) VALUES (?, ?, ?, ?)',
      [cleanName, cleanColor, cleanParent, cleanPos]
    );
    const gradeId = result.insertId;

    for (const p of validPerms) {
      await req.guildDb('INSERT IGNORE INTO grade_permissions (grade_id, permission) VALUES (?, ?)', [gradeId, p]);
    }

    await logAudit(
      req.session.user.id, req.session.user.username,
      'grade_create', 'grade', gradeId,
      { name: cleanName, color: cleanColor, permissions: validPerms },
      req.guildDb
    );

    res.json({ id: gradeId, name: cleanName, color: cleanColor, parent_id: cleanParent, position: cleanPos, is_default: 0, permissions: validPerms, user_count: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id', async (req, res) => {
  if (!canManageGrades(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const gradeId = parseInt(req.params.id);
    const [grade] = await req.guildDb('SELECT * FROM grades WHERE id = ?', [gradeId]);
    if (!grade) return res.status(404).json({ error: 'Grade introuvable' });

    const { name, color, parent_id, position, is_default } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) {
      const n = String(name).trim().slice(0, 80);
      if (!n) return res.status(400).json({ error: 'Nom invalide' });
      updates.push('name = ?'); params.push(n);
    }
    if (color !== undefined) {
      const c = /^#[0-9a-fA-F]{6}$/.test(color) ? color : grade.color;
      updates.push('color = ?'); params.push(c);
    }
    if (parent_id !== undefined) {
      const p = parent_id ? parseInt(parent_id) : null;
      if (p === gradeId) return res.status(400).json({ error: 'Un grade ne peut pas être son propre parent' });
      updates.push('parent_id = ?'); params.push(p);
    }
    if (position !== undefined) {
      updates.push('position = ?'); params.push(parseInt(position) || 0);
    }
    if (is_default !== undefined) {
      if (is_default) await req.guildDb('UPDATE grades SET is_default = 0 WHERE is_default = 1');
      updates.push('is_default = ?'); params.push(is_default ? 1 : 0);
    }

    if (!updates.length) return res.json({ ok: true });
    params.push(gradeId);
    await req.guildDb(`UPDATE grades SET ${updates.join(', ')} WHERE id = ?`, params);

    await logAudit(
      req.session.user.id, req.session.user.username,
      'grade_update', 'grade', gradeId,
      req.body, req.guildDb
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/:id/permissions', async (req, res) => {
  if (!canManageGrades(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const gradeId = parseInt(req.params.id);
    const [grade] = await req.guildDb('SELECT id FROM grades WHERE id = ?', [gradeId]);
    if (!grade) return res.status(404).json({ error: 'Grade introuvable' });

    const { permissions: perms = [] } = req.body;
    const validPerms = (Array.isArray(perms) ? perms : []).filter(p => PERMISSIONS.includes(p));

    await req.guildDb('DELETE FROM grade_permissions WHERE grade_id = ?', [gradeId]);
    for (const p of validPerms) {
      await req.guildDb('INSERT IGNORE INTO grade_permissions (grade_id, permission) VALUES (?, ?)', [gradeId, p]);
    }

    await logAudit(
      req.session.user.id, req.session.user.username,
      'grade_permissions_update', 'grade', gradeId,
      { permissions: validPerms }, req.guildDb
    );

    res.json({ ok: true, permissions: validPerms });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id', async (req, res) => {
  if (!canManageGrades(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const gradeId = parseInt(req.params.id);
    const [grade] = await req.guildDb('SELECT * FROM grades WHERE id = ?', [gradeId]);
    if (!grade) return res.status(404).json({ error: 'Grade introuvable' });

    await req.guildDb('UPDATE grades SET parent_id = ? WHERE parent_id = ?', [grade.parent_id, gradeId]);
    await req.guildDb('UPDATE tickets SET visibility_grade_id = NULL WHERE visibility_grade_id = ?', [gradeId]);
    await req.guildDb('DELETE FROM grades WHERE id = ?', [gradeId]);

    await logAudit(
      req.session.user.id, req.session.user.username,
      'grade_delete', 'grade', gradeId,
      { name: grade.name }, req.guildDb
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

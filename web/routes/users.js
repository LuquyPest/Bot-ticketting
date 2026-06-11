const express = require('express');
const router = express.Router();
const { logAudit } = require('../../utils/gradePermissions');

function canManageUsers(req) {
  return req.userIsFondateur || req.userPermissions.has('manage_users');
}

router.get('/', async (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const users = await req.guildDb(
      'SELECT user_id, username, avatar, role, discord_has_role, vacation_mode, first_login, last_login FROM dashboard_users ORDER BY last_login DESC'
    );
    if (!users.length) return res.json([]);

    const userIds = users.map(u => u.user_id);
    const gradeRows = await req.guildDb(
      `SELECT ug.user_id, g.id, g.name, g.color
       FROM user_grades ug
       JOIN grades g ON g.id = ug.grade_id
       WHERE ug.user_id IN (?)`,
      [userIds]
    );
    const gradeMap = {};
    for (const r of gradeRows) {
      if (!gradeMap[r.user_id]) gradeMap[r.user_id] = [];
      gradeMap[r.user_id].push({ id: r.id, name: r.name, color: r.color });
    }

    res.json(users.map(u => ({ ...u, grades: gradeMap[u.user_id] || [] })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id/role', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  try {
    const { role } = req.body;
    if (!['nouveau', 'support', 'fondateur'].includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }
    if (req.params.id === req.session.user.id) {
      return res.status(400).json({ error: 'Impossible de modifier son propre rôle' });
    }
    // Protect the guild owner (founder set at approval time)
    if (req.guild?.owner_discord_id && req.params.id === req.guild.owner_discord_id) {
      return res.status(400).json({ error: 'Impossible de modifier le rôle du fondateur du serveur' });
    }
    await req.guildDb('UPDATE dashboard_users SET role = ? WHERE user_id = ?', [role, req.params.id]);

    await logAudit(
      req.session.user.id, req.session.user.username,
      'user_role_change', 'user', req.params.id,
      { role }, req.guildDb
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/:id/grades', async (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const grades = await req.guildDb(
      `SELECT g.id, g.name, g.color, ug.assigned_by_tag, ug.assigned_at
       FROM user_grades ug
       JOIN grades g ON g.id = ug.grade_id
       WHERE ug.user_id = ?`,
      [req.params.id]
    );
    res.json(grades);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/:id/grades', async (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const { grade_id } = req.body;
    if (!grade_id) return res.status(400).json({ error: 'grade_id requis' });

    const [grade] = await req.guildDb('SELECT * FROM grades WHERE id = ?', [parseInt(grade_id)]);
    if (!grade) return res.status(404).json({ error: 'Grade introuvable' });

    const [targetUser] = await req.guildDb('SELECT user_id, role FROM dashboard_users WHERE user_id = ?', [req.params.id]);
    if (!targetUser) return res.status(404).json({ error: 'Utilisateur introuvable' });

    await req.guildDb(
      'INSERT IGNORE INTO user_grades (user_id, grade_id, assigned_by_id, assigned_by_tag) VALUES (?, ?, ?, ?)',
      [req.params.id, grade.id, req.session.user.id, req.session.user.username]
    );

    if (targetUser.role === 'nouveau') {
      await req.guildDb('UPDATE dashboard_users SET role = "support" WHERE user_id = ?', [req.params.id]);
    }

    await logAudit(
      req.session.user.id, req.session.user.username,
      'grade_assign', 'user', req.params.id,
      { grade_id: grade.id, grade_name: grade.name }, req.guildDb
    );

    res.json({ ok: true, grade: { id: grade.id, name: grade.name, color: grade.color } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id/grades/:gradeId', async (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const [grade] = await req.guildDb('SELECT name FROM grades WHERE id = ?', [parseInt(req.params.gradeId)]);
    await req.guildDb(
      'DELETE FROM user_grades WHERE user_id = ? AND grade_id = ?',
      [req.params.id, req.params.gradeId]
    );

    await logAudit(
      req.session.user.id, req.session.user.username,
      'grade_remove', 'user', req.params.id,
      { grade_id: parseInt(req.params.gradeId), grade_name: grade?.name }, req.guildDb
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id/vacation', async (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const mode = req.body.vacation_mode ? 1 : 0;
    await req.guildDb('UPDATE dashboard_users SET vacation_mode = ? WHERE user_id = ?', [mode, req.params.id]);
    res.json({ ok: true, vacation_mode: mode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { query } = require('../../utils/db');

router.get('/', async (req, res) => {
  if (!req.userIsFondateur && !req.userPermissions.has('view_audit')) {
    return res.status(403).json({ error: 'Permission insuffisante' });
  }
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const { action, actor } = req.query;
    const where = [];
    const params = [];

    if (action) { where.push('action = ?'); params.push(action); }
    if (actor)  { where.push('actor_tag LIKE ?'); params.push(`%${actor}%`); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows, [{ total }]] = await Promise.all([
      query(
        `SELECT id, actor_id, actor_tag, action, target_type, target_id, details, created_at
         FROM audit_log ${whereClause}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      query(`SELECT COUNT(*) as total FROM audit_log ${whereClause}`, params)
    ]);

    res.json({ rows, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

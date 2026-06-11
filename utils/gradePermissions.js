// All functions accept an optional `db` parameter (per-guild query function).
// Falls back to the global query for backward compatibility.
const { globalQuery } = require('./globalDb');

const PERMISSIONS = [
  'view_tickets',
  'claim_ticket',
  'reply_ticket',
  'close_ticket',
  'manage_participants',
  'view_transcripts',
  'manage_users',
  'manage_grades',
  'manage_settings',
  'view_audit'
];

async function getUserGradeIds(userId, db) {
  const q = db || globalQuery;
  const rows = await q('SELECT grade_id FROM user_grades WHERE user_id = ?', [userId]);
  return rows.map(r => r.grade_id);
}

async function getUserPermissions(userId, db) {
  const gradeIds = await getUserGradeIds(userId, db);
  if (!gradeIds.length) return new Set();
  const q = db || globalQuery;
  const perms = await q(
    'SELECT DISTINCT permission FROM grade_permissions WHERE grade_id IN (?)',
    [gradeIds]
  );
  return new Set(perms.map(p => p.permission));
}

async function hasPermission(userId, permission, db) {
  const perms = await getUserPermissions(userId, db);
  return perms.has(permission);
}

async function getDescendantIds(gradeIds, db) {
  if (!gradeIds.length) return [];
  const q = db || globalQuery;
  const visible = new Set(gradeIds);
  let queue = [...gradeIds];
  while (queue.length > 0) {
    const children = await q('SELECT id FROM grades WHERE parent_id IN (?)', [queue]);
    const newIds = children.map(c => c.id).filter(id => !visible.has(id));
    newIds.forEach(id => visible.add(id));
    queue = newIds;
  }
  return [...visible];
}

async function getVisibleGradeIds(userId, db) {
  const gradeIds = await getUserGradeIds(userId, db);
  return getDescendantIds(gradeIds, db);
}

async function logAudit(actorId, actorTag, action, targetType, targetId, details, db) {
  const q = db || globalQuery;
  try {
    await q(
      'INSERT INTO audit_log (actor_id, actor_tag, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [
        actorId, actorTag, action,
        targetType || null,
        targetId != null ? String(targetId) : null,
        details ? JSON.stringify(details) : null
      ]
    );
  } catch (e) {
    console.error('logAudit error:', e);
  }
}

module.exports = {
  PERMISSIONS,
  getUserGradeIds,
  getUserPermissions,
  hasPermission,
  getDescendantIds,
  getVisibleGradeIds,
  logAudit
};

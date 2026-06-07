const { query } = require('./db');

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

async function getUserGradeIds(userId) {
  const rows = await query('SELECT grade_id FROM user_grades WHERE user_id = ?', [userId]);
  return rows.map(r => r.grade_id);
}

async function getUserPermissions(userId) {
  const gradeIds = await getUserGradeIds(userId);
  if (!gradeIds.length) return new Set();
  const perms = await query(
    'SELECT DISTINCT permission FROM grade_permissions WHERE grade_id IN (?)',
    [gradeIds]
  );
  return new Set(perms.map(p => p.permission));
}

async function hasPermission(userId, permission) {
  const perms = await getUserPermissions(userId);
  return perms.has(permission);
}

// Returns gradeIds and all their descendants (they can see tickets tagged with these IDs)
async function getDescendantIds(gradeIds) {
  if (!gradeIds.length) return [];
  const visible = new Set(gradeIds);
  let queue = [...gradeIds];
  while (queue.length > 0) {
    const children = await query('SELECT id FROM grades WHERE parent_id IN (?)', [queue]);
    const newIds = children.map(c => c.id).filter(id => !visible.has(id));
    newIds.forEach(id => visible.add(id));
    queue = newIds;
  }
  return [...visible];
}

// Returns the set of visibility_grade_id values this user can see
async function getVisibleGradeIds(userId) {
  const gradeIds = await getUserGradeIds(userId);
  return getDescendantIds(gradeIds);
}

async function logAudit(actorId, actorTag, action, targetType, targetId, details) {
  try {
    await query(
      'INSERT INTO audit_log (actor_id, actor_tag, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [
        actorId,
        actorTag,
        action,
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

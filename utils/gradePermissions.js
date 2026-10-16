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

// Whether a dashboard user may see a ticket restricted to `gradeId` (null = unrestricted).
// Used for out-of-request delivery (SSE, push) where req.userPermissions is not available.
async function canUserSeeTicket(db, userId, gradeId) {
  const [u] = await db('SELECT role FROM dashboard_users WHERE user_id = ?', [userId]);
  if (u?.role === 'fondateur') return true;
  if (u?.role !== 'support') return false;
  const perms = await getUserPermissions(userId, db);
  if (!perms.has('view_tickets')) return false;
  if (!gradeId) return true;
  return (await getVisibleGradeIds(userId, db)).includes(gradeId);
}

// SQL fragment restricting a ticket query to what req's user may see.
// `col` is the visibility_grade_id column (e.g. 't.visibility_grade_id').
// Discord-side staff (support role, maybe no dashboard account): unrestricted tickets are fine,
// restricted ones follow the dashboard grade rules.
async function discordStaffCanSee(db, userId, gradeId) {
  return !gradeId || canUserSeeTicket(db, userId, gradeId);
}

async function visibilityFilter(req, col = 'visibility_grade_id') {
  if (req.userIsFondateur) return { sql: '1=1', params: [] };
  const ids = await getVisibleGradeIds(req.session.user.id, req.guildDb);
  return { sql: `(${col} IS NULL OR ${col} IN (?))`, params: [ids.length ? ids : [0]] };
}

// Kept for existing callers; see utils/audit.js (recordEvent) for the full journal API.
async function logAudit(actorId, actorTag, action, targetType, targetId, details, db, { ticketId = null } = {}) {
  const { recordEvent } = require('./audit');
  const source = String(actorId).startsWith('sa:') ? 'sa' : 'dashboard';
  await recordEvent(db || globalQuery, {
    actor: { id: actorId, tag: actorTag, source }, action, targetType, targetId, details,
    ticketId: ticketId || (targetType === 'ticket' ? parseInt(targetId) || null : null),
  });
}

module.exports = {
  PERMISSIONS,
  getUserPermissions,
  getVisibleGradeIds,
  canUserSeeTicket,
  discordStaffCanSee,
  visibilityFilter,
  logAudit
};

// All functions accept an optional `db` parameter (per-guild query function).
// Falls back to the global query for backward compatibility.
const { globalQuery } = require('./globalDb');

const PERMISSIONS = [
  'view_tickets',
  'claim_ticket',
  'reply_ticket',
  'create_ticket',
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

// Confidential ticket (harassment, report about a staff member…): stored as this visibility
// "grade", which no real grade can have, so every visibility check already limits it to founders
const CONFIDENTIAL = -1;

// Staff roles (page Rôles) attached to tags: a ticket carrying such a tag is seen only by the
// holders of one of those roles (founders still see everything), on top of the grade rules.
async function ticketRoleIds(db, ticketId) {
  if (!ticketId) return [];
  const rows = await db(
    'SELECT DISTINCT srt.role_id FROM ticket_tag_assignments ta JOIN access_role_tags srt ON srt.tag_id = ta.tag_id WHERE ta.ticket_id = ?',
    [ticketId]
  );
  return rows.map(r => r.role_id);
}

async function holdsOneOfRoles(db, userId, roleIds) {
  if (!roleIds.length) return true;
  const [row] = await db('SELECT 1 FROM access_role_members WHERE user_id = ? AND role_id IN (?) LIMIT 1', [userId, roleIds]);
  return !!row;
}

async function holdsTicketRole(db, userId, ticketId) {
  return holdsOneOfRoles(db, userId, await ticketRoleIds(db, ticketId));
}

// Whether a dashboard user may see a ticket. Used for out-of-request delivery (SSE, push) where
// req.userPermissions is not available. `ticket`: { id, visibility_grade_id }, or just the grade id (tag roles are then not checked)
async function canUserSeeTicket(db, userId, ticket) {
  const t = ticket && typeof ticket === 'object' ? ticket : { visibility_grade_id: ticket ?? null };
  const gradeId = t.visibility_grade_id || null;
  const [u] = await db('SELECT role FROM dashboard_users WHERE user_id = ?', [userId]);
  if (u?.role === 'fondateur') return true;
  if (u?.role !== 'support') return false;
  const perms = await getUserPermissions(userId, db);
  if (!perms.has('view_tickets')) return false;
  if (gradeId && !(await getVisibleGradeIds(userId, db)).includes(gradeId)) return false;
  return holdsOneOfRoles(db, userId, await ticketRoleIds(db, t.id));
}

// Discord-side staff (support role, maybe no dashboard account): unrestricted tickets are fine,
// restricted ones (grade or tag role) follow the dashboard rules.
async function discordStaffCanSee(db, userId, ticket) {
  if (!ticket.visibility_grade_id && !(await ticketRoleIds(db, ticket.id)).length) return true;
  return canUserSeeTicket(db, userId, ticket);
}

// SQL fragment restricting a ticket query to what req's user may see.
// `col` is the visibility_grade_id column (e.g. 't.visibility_grade_id'); the ticket id is the
// `id` column of the same table (`tickets.id` when not aliased).
async function visibilityFilter(req, col = 'visibility_grade_id') {
  if (req.userIsFondateur) return { sql: '1=1', params: [] };
  const userId = req.session.user.id;
  const ids = await getVisibleGradeIds(userId, req.guildDb);
  const idCol = col.includes('.') ? col.replace(/visibility_grade_id$/, 'id') : 'tickets.id';
  const sql = `(${col} IS NULL OR ${col} IN (?))`
    + ` AND (NOT EXISTS (SELECT 1 FROM ticket_tag_assignments vta JOIN access_role_tags vrt ON vrt.tag_id = vta.tag_id WHERE vta.ticket_id = ${idCol})`
    + ` OR EXISTS (SELECT 1 FROM ticket_tag_assignments vta JOIN access_role_tags vrt ON vrt.tag_id = vta.tag_id`
    + ` JOIN access_role_members vrm ON vrm.role_id = vrt.role_id WHERE vta.ticket_id = ${idCol} AND vrm.user_id = ?))`;
  return { sql, params: [ids.length ? ids : [0], userId] };
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
  CONFIDENTIAL,
  PERMISSIONS,
  getUserPermissions,
  getVisibleGradeIds,
  canUserSeeTicket,
  ticketRoleIds,
  holdsTicketRole,
  discordStaffCanSee,
  visibilityFilter,
  logAudit
};

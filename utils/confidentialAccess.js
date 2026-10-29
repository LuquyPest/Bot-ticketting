// Who opened a confidential ticket, and when (table ticket_access_log): the ticket view, its
// messages, transcript and PDF from the dashboard, and the guest links. One entry per person,
// ticket and kind every 10 minutes (Redis), so leaving the page open does not flood the log.
// Shown to founders in the ticket and in Journal → Consultations confidentielles.
const { CONFIDENTIAL } = require('./gradePermissions');
const { getRedis } = require('./redis');
const logger = require('./logger');

const THROTTLE_S = 600;

// actor: { id, tag } — ticket: row with visibility_grade_id
async function logConfidentialAccess(db, guildId, ticket, actor, kind = 'view', ip = null) {
  if (ticket?.visibility_grade_id !== CONFIDENTIAL) return false;
  try {
    const fresh = await getRedis().set(`cfaccess:${guildId}:${ticket.id}:${actor.id}:${kind}`, '1', 'EX', THROTTLE_S, 'NX').catch(() => 'OK');
    if (!fresh) return false;
    await db('INSERT INTO ticket_access_log (ticket_id, user_id, user_tag, kind, ip) VALUES (?, ?, ?, ?, ?)',
      [ticket.id, String(actor.id).slice(0, 64), String(actor.tag || actor.username || actor.id).slice(0, 100), kind, ip ? String(ip).slice(0, 45) : null]);
    return true;
  } catch (err) {
    logger.error('Journal des consultations confidentielles', { guildId, ticketId: ticket?.id, err: err.message });
    return false;
  }
}

module.exports = { logConfidentialAccess };

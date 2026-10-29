// Following a ticket: a staff member is told about its new messages without being assigned to it
// (dashboard notification + browser push). Followers who can no longer see the ticket are skipped.
const { sendToUser } = require('./sse');
const { canUserSeeTicket } = require('./gradePermissions');
const logger = require('./logger');

async function setFollowing(db, ticketId, userId, follow) {
  if (follow) await db('INSERT IGNORE INTO ticket_followers (ticket_id, user_id) VALUES (?, ?)', [ticketId, userId]);
  else await db('DELETE FROM ticket_followers WHERE ticket_id = ? AND user_id = ?', [ticketId, userId]);
}

async function isFollowing(db, ticketId, userId) {
  return (await db('SELECT 1 FROM ticket_followers WHERE ticket_id = ? AND user_id = ?', [ticketId, userId])).length > 0;
}

const TITLES = {
  member: (t, by) => `Message de ${by} · #${t.id}`,
  reply: (t, by) => `${by} a répondu · #${t.id}`,
  note: (t, by) => `Note de ${by} · #${t.id}`,
  closed: (t, by) => `Ticket #${t.id} fermé par ${by}`,
};

// kind: member | reply | note | closed. byId: the author (never notified about their own action)
async function notifyFollowers(db, guildId, ticket, { kind, by, byId = null, excerpt = '' }) {
  try {
    if (!ticket?.id) return [];
    const rows = await db('SELECT user_id FROM ticket_followers WHERE ticket_id = ?', [ticket.id]);
    const notified = [];
    for (const { user_id: uid } of rows) {
      if (uid === byId) continue;
      if (!(await canUserSeeTicket(db, uid, ticket.visibility_grade_id ?? null).catch(() => false))) continue;
      const title = TITLES[kind](ticket, by || '?');
      const body = String(excerpt || '').slice(0, 160);
      sendToUser(guildId, uid, 'followed', { ticketId: ticket.id, subject: ticket.subject || null, kind, title, body });
      require('../web/routes/push').sendPushToUser(guildId, uid, { type: 'follow', title, body, ticketId: ticket.id }).catch(() => null);
      notified.push(uid);
    }
    return notified;
  } catch (err) {
    logger.error('Notification des abonnés du ticket', { guildId, ticketId: ticket?.id, err: err.message });
    return [];
  }
}

module.exports = { setFollowing, isFollowing, notifyFollowers };

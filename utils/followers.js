// Following a ticket: a staff member is told about its new messages without being assigned to it
// (dashboard notification + browser push). Followers who can no longer see the ticket are skipped.

async function setFollowing(db, ticketId, userId, follow) {
  if (follow) await db('INSERT IGNORE INTO ticket_followers (ticket_id, user_id) VALUES (?, ?)', [ticketId, userId]);
  else await db('DELETE FROM ticket_followers WHERE ticket_id = ? AND user_id = ?', [ticketId, userId]);
}

async function isFollowing(db, ticketId, userId) {
  return (await db('SELECT 1 FROM ticket_followers WHERE ticket_id = ? AND user_id = ?', [ticketId, userId])).length > 0;
}

// kind: member | reply | note | closed — now events of the notifications (utils/notifications.js),
// whose rules by default tell the followers in the dashboard, as before. byId: never told of their own action
const EVENT_OF = { member: 'member_reply', reply: 'staff_reply', note: 'note', closed: 'closed' };
async function notifyFollowers(db, guildId, ticket, { kind, by, byId = null, excerpt = '', client = null }) {
  if (!EVENT_OF[kind]) return [];
  return require('./notifications').notify(db, guildId, EVENT_OF[kind], ticket, { by, byId, excerpt, client });
}

module.exports = { setFollowing, isFollowing, notifyFollowers };

// "A ticket was assigned to you": live dashboard notification, browser push and a Discord DM
// (DM can be turned off from the profile). Nothing is sent when people assign themselves.

async function notifyAssignee(db, client, guildId, ticketId, assignee, byUser) {
  if (!assignee?.id || !byUser?.id || assignee.id === byUser.id) return;
  const [ticket] = await db('SELECT * FROM tickets WHERE id = ?', [ticketId]);
  if (!ticket) return;
  const by = byUser.username || byUser.tag || 'Un membre du staff';
  await require('./notifications').notify(db, guildId, 'assigned', ticket, { by, byId: byUser.id, assigneeId: assignee.id, excerpt: `${by} t'a attribué « ${ticket.subject || 'Sans sujet'} »`, client });
}

module.exports = { notifyAssignee };

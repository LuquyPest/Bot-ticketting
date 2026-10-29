// Ticket opened by the staff from Discord (/contact, « Créer un ticket » on a message): checks
// shared by both entry points, then the ticket is opened and the staff's first message sent.
const { canOpenTicket } = require('./limits');
const { sendDiscordReply } = require('./discordReply');

// Returns { error } or { channel, ticket }.
async function openFromDiscord({ client, db, tm, guildId, member, staff, subject = null, message = '', quote = null }) {
  if (member.bot) return { error: 'Impossible d\'ouvrir un ticket pour un bot.' };
  if (member.id === staff.id) return { error: 'Tu ne peux pas ouvrir un ticket pour toi-même.' };
  const limit = await canOpenTicket(db, guildId);
  if (!limit.ok) return { error: `Limite de ${limit.max} tickets ouverts atteinte sur ce serveur.` };
  const { channel, ticket } = await tm.openTicketForMember(member, { subject, byUser: staff, quote });
  if (message) {
    await sendDiscordReply({ client, db, tm, guildId, ticket, author: staff, channel, content: message });
  }
  return { channel, ticket };
}

module.exports = { openFromDiscord };

// "My tickets" for a member (DM command /mestickets and button): open tickets on every server,
// with their stage worded for the member.
const { EmbedBuilder } = require('discord.js');
const { findAllOpenTickets } = require('./guildScan');

function memberStatus(ticket, assigned) {
  if (ticket.stage === 'waiting') return '⏳ En attente de ta réponse';
  if (ticket.stage === 'in_progress') return '🛠️ En cours de traitement';
  return assigned ? '👤 Pris en charge par le staff' : '📨 Reçu, bientôt pris en charge';
}

async function myTicketsEmbed(user, client) {
  const tickets = await findAllOpenTickets(user.id, client);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('📋 Mes tickets ouverts').setTimestamp();
  if (!tickets.length) return embed.setDescription('Tu n\'as aucun ticket ouvert. Écris-moi pour en ouvrir un.');
  for (const t of tickets.slice(0, 25)) {
    const [{ n }] = await t.db('SELECT COUNT(*) AS n FROM ticket_assignees WHERE ticket_id = ?', [t.ticket.id]);
    const last = t.ticket.last_message_at ? `<t:${Math.floor(new Date(t.ticket.last_message_at).getTime() / 1000)}:R>` : '—';
    embed.addFields({
      name: `${t.guildName} · #${t.ticket.id} — ${t.ticket.subject || 'Sans sujet'}`.slice(0, 256),
      value: `${memberStatus(t.ticket, Number(n) > 0)}\nDernier message ${last}${t.ticket.owner_id === user.id ? '' : ' · tu es participant'}`,
    });
  }
  return embed.setFooter({ text: 'Écris-moi pour ajouter un message à l\'un de ces tickets' });
}

module.exports = { myTicketsEmbed, memberStatus };

// "My tickets" for a member (DM command /mestickets and button): open tickets on every server,
// with their stage worded for the member.
const { EmbedBuilder } = require('discord.js');
const { findAllOpenTickets } = require('./guildScan');
const { t } = require('./i18n');

function memberStatus(ticket, assigned) {
  if (ticket.stage === 'waiting') return t('status.waiting');
  if (ticket.stage === 'in_progress') return t('status.inProgress');
  return assigned ? t('status.assigned') : t('status.received');
}

async function myTicketsEmbed(user, client) {
  const tickets = await findAllOpenTickets(user.id, client);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(t('myTickets.title')).setTimestamp();
  if (!tickets.length) return embed.setDescription(t('myTickets.none'));
  for (const tk of tickets.slice(0, 25)) {
    const [{ n }] = await tk.db('SELECT COUNT(*) AS n FROM ticket_assignees WHERE ticket_id = ?', [tk.ticket.id]);
    const last = tk.ticket.last_message_at ? `<t:${Math.floor(new Date(tk.ticket.last_message_at).getTime() / 1000)}:R>` : '—';
    embed.addFields({
      name: `${tk.guildName} · #${tk.ticket.id} — ${tk.ticket.subject || t('route.noSubject')}`.slice(0, 256),
      value: `${memberStatus(tk.ticket, Number(n) > 0)}\n${t('myTickets.last', { when: last })}${tk.ticket.owner_id === user.id ? '' : t('route.participant')}`,
    });
  }
  return embed.setFooter({ text: t('myTickets.footer') });
}

module.exports = { myTicketsEmbed, memberStatus };

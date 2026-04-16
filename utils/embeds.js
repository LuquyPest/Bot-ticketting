const { EmbedBuilder } = require('discord.js');

function buildOldTicketsPageEmbed(userId, tickets, page = 0, pageSize = 5) {
  const totalPages = Math.max(1, Math.ceil(tickets.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);

  const start = safePage * pageSize;
  const pageTickets = tickets.slice(start, start + pageSize);

  const embed = new EmbedBuilder()
    .setTitle(`Historique des tickets`)
    .setDescription(`Utilisateur : ${userId}`)
    .setFooter({ text: `Page ${safePage + 1}/${totalPages}` })
    .setTimestamp();

  if (!pageTickets.length) {
    embed.addFields({
      name: 'Aucun resultat',
      value: 'Aucun ticket trouve pour cet utilisateur.'
    });
    return { embed, totalPages, safePage };
  }

  for (const ticket of pageTickets) {
    const createdAt = new Date(ticket.created_at).toLocaleString('fr-FR');
    const closedAt = ticket.closed_at
      ? new Date(ticket.closed_at).toLocaleString('fr-FR')
      : 'Non';

    embed.addFields({
      name: `Ticket #${ticket.id}`,
      value: [
        `Statut : ${ticket.status}`,
        `Cree : ${createdAt}`,
        `Ferme : ${closedAt}`,
        `Ferme par : ${ticket.closed_by_tag || '-'}`,
        `Nombre de transcripts : ${ticket.transcript_count}`,
        `IDs des transcripts : ${ticket.transcript_ids || 'Aucun'}`
      ].join('\n'),
      inline: false
    });
  }

  return { embed, totalPages, safePage };
}

function closeConfirmationEmbed() {
  return new EmbedBuilder()
    .setTitle('Confirmation')
    .setDescription('Veux-tu vraiment fermer ce ticket et enregistrer le transcript ?')
    .setTimestamp();
}

module.exports = {
  buildOldTicketsPageEmbed,
  closeConfirmationEmbed
};
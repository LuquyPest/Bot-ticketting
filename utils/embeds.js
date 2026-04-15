const { EmbedBuilder } = require('discord.js');

function ticketCreatedEmbed(user, firstMessage) {
  return new EmbedBuilder()
    .setTitle('📨 Nouveau ticket')
    .addFields(
      { name: 'Utilisateur', value: user.tag, inline: true },
      { name: 'ID', value: user.id, inline: true },
      { name: 'Premier message', value: firstMessage || '[pièce jointe uniquement]' }
    )
    .setTimestamp();
}

function userMessageEmbed(user, content, attachments = []) {
  const embed = new EmbedBuilder()
    .setTitle('📩 Message utilisateur')
    .addFields(
      { name: 'Utilisateur', value: user.tag, inline: true },
      { name: 'ID', value: user.id, inline: true },
      { name: 'Message', value: content || '[aucun texte]' }
    )
    .setTimestamp();

  if (attachments.length > 0) {
    const attachmentList = attachments.map(file => file.url).join('\n');
    embed.addFields({
      name: 'Pièces jointes',
      value: attachmentList.length > 1024 ? `${attachmentList.slice(0, 1021)}...` : attachmentList
    });

    const firstImage = attachments.find(file => file.contentType?.startsWith('image/'));
    if (firstImage) {
      embed.setImage(firstImage.url);
    }
  }

  return embed;
}

function staffReplyEmbed(authorName, content, anonymous = false) {
  return new EmbedBuilder()
    .setTitle('💬 Réponse du support')
    .setDescription(content || '[pièce jointe]')
    .addFields({
      name: 'Envoyé par',
      value: anonymous ? 'Staff' : authorName
    })
    .setTimestamp();
}

function closeConfirmationEmbed() {
  return new EmbedBuilder()
    .setTitle('⚠️ Confirmation')
    .setDescription('Veux-tu vraiment fermer ce ticket et enregistrer le transcript ?')
    .setTimestamp();
}

function buildOldTicketsPageEmbed(userId, tickets, page = 0, pageSize = 5) {
  const totalPages = Math.max(1, Math.ceil(tickets.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * pageSize;
  const pageTickets = tickets.slice(start, start + pageSize);

  const embed = new EmbedBuilder()
    .setTitle('📚 Historique des tickets')
    .setDescription(`Utilisateur : **${userId}**`)
    .setFooter({ text: `Page ${safePage + 1}/${totalPages}` })
    .setTimestamp();

  if (!pageTickets.length) {
    embed.addFields({
      name: 'Aucun résultat',
      value: 'Aucun ticket trouvé pour cet utilisateur.'
    });
    return { embed, totalPages, safePage };
  }

  for (const ticket of pageTickets) {
    const createdAt = new Date(ticket.created_at).toLocaleString('fr-FR');
    const closedAt = ticket.closed_at ? new Date(ticket.closed_at).toLocaleString('fr-FR') : 'Non';

    embed.addFields({
      name: `🎫 Ticket #${ticket.id}`,
      value: [
        `**Statut :** ${ticket.status}`,
        `**Créé :** ${createdAt}`,
        `**Fermé :** ${closedAt}`,
        `**Fermé par :** ${ticket.closed_by_tag || '—'}`,
        `**Transcripts :** ${ticket.transcript_count}`
      ].join('\n'),
      inline: false
    });
  }

  return { embed, totalPages, safePage };
}

module.exports = {
  ticketCreatedEmbed,
  userMessageEmbed,
  staffReplyEmbed,
  closeConfirmationEmbed,
  buildOldTicketsPageEmbed
};

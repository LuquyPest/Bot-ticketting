const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const {
  getOpenTicketByChannelId,
  getAllLinkedUserIds
} = require('../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Repond au membre')
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Message a envoyer')
        .setRequired(false)
    )
    .addAttachmentOption(option =>
      option
        .setName('fichier')
        .setDescription('Fichier a envoyer')
        .setRequired(false)
    ),

  async execute(client, interaction) {
    if (!(await ensureSupport(interaction, client))) return;

    const ticket = await getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({
        content: 'Pas un ticket',
        ephemeral: true
      });
    }

    const content = interaction.options.getString('message') || '';
    const file = interaction.options.getAttachment('fichier');

    if (!content && !file) {
      return interaction.reply({
        content: 'Tu dois fournir un message, un fichier ou les deux.',
        ephemeral: true
      });
    }

    const linkedUserIds = await getAllLinkedUserIds(ticket.id);

    let msg = `--- ${interaction.user.username} : ${content || ''}`.trim();

    if (file) {
      msg += `\nFichier : ${file.url}`;
    }

    for (const userId of linkedUserIds) {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) {
        await user.send(msg).catch(() => null);
      }
    }

    await interaction.reply({
      content: 'Envoye',
      ephemeral: true
    });

    await interaction.channel.send(msg);
  }
};
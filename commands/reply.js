const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const { getOpenTicketByChannelId, getAllLinkedUserIds, recordStaffResponse, updateLastMessage } = require('../utils/ticketManager');
const { checkRateLimit } = require('../utils/rateLimit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Repond au membre')
    .addStringOption(option =>
      option.setName('message').setDescription('Message a envoyer').setRequired(false)
    )
    .addAttachmentOption(option =>
      option.setName('fichier').setDescription('Fichier a envoyer').setRequired(false)
    ),

  async execute(client, interaction) {
    if (!(await ensureSupport(interaction, client))) return;

    const cooldown = (client.config.replyRateLimitSeconds ?? 3) * 1000;
    const remaining = checkRateLimit(`reply:${interaction.user.id}`, cooldown);
    if (remaining > 0) {
      return interaction.reply({ content: `Attends encore ${remaining}s avant de renvoyer une réponse.`, ephemeral: true });
    }

    const ticket = await getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) return interaction.reply({ content: 'Pas un ticket', ephemeral: true });

    const content = interaction.options.getString('message') || '';
    const file = interaction.options.getAttachment('fichier');
    if (!content && !file) return interaction.reply({ content: 'Tu dois fournir un message, un fichier ou les deux.', ephemeral: true });

    const linkedUserIds = await getAllLinkedUserIds(ticket.id);
    let msg = `--- ${interaction.user.username} : ${content || ''}`.trim();
    if (file) msg += `\nFichier : ${file.url}`;

    for (const userId of linkedUserIds) {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) await user.send(msg).catch(() => null);
    }

    await recordStaffResponse(ticket.id, interaction.user);
    await updateLastMessage(ticket.id);
    await interaction.reply({ content: 'Envoye', ephemeral: true });
    await interaction.channel.send(msg);
  }
};

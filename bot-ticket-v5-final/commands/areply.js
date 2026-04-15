const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const { getOpenTicketByChannelId } = require('../utils/ticketManager');
const { staffReplyEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('areply')
    .setDescription('Répond anonymement au membre')
    .addStringOption(option =>
      option.setName('message').setDescription('Message à envoyer').setRequired(false)
    )
    .addAttachmentOption(option =>
      option.setName('fichier').setDescription('Fichier à envoyer').setRequired(false)
    ),

  async execute(client, interaction) {
    const allowed = await ensureSupport(interaction, client);
    if (!allowed) return;

    const ticket = await getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: '❌ Pas un salon ticket.', ephemeral: true });
      return;
    }

    const content = interaction.options.getString('message') || '';
    const file = interaction.options.getAttachment('fichier');

    if (!content && !file) {
      await interaction.reply({
        content: '❌ Tu dois envoyer un message, un fichier, ou les deux.',
        ephemeral: true
      });
      return;
    }

    const owner = await client.users.fetch(ticket.owner_id).catch(() => null);
    if (!owner) {
      await interaction.reply({ content: '❌ Impossible de trouver le membre.', ephemeral: true });
      return;
    }

    const payload = {
      embeds: [staffReplyEmbed(interaction.user.username, content, true)]
    };

    if (file) {
      payload.files = [file.url];
    }

    await owner.send(payload);

    await interaction.reply({
      content: '✅ Réponse anonyme envoyée.',
      ephemeral: true
    });

    await interaction.channel.send(
      `🕶️ Une réponse anonyme a été envoyée au membre.${file ? `\n📎 ${file.name}` : ''}${content ? `\n${content}` : ''}`
    );
  }
};

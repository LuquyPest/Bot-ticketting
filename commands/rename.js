const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const { getOpenTicketByChannelId } = require('../utils/ticketManager');
const { sanitizeChannelName } = require('../utils/sanitize');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rename')
    .setDescription('Renomme le ticket')
    .addStringOption(option =>
      option.setName('name').setDescription('Nouveau nom').setRequired(true)
    ),

  async execute(client, interaction) {
    const allowed = await ensureSupport(interaction, client);
    if (!allowed) return;

    const ticket = await getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: '❌ Pas un salon ticket.', ephemeral: true });
      return;
    }

    const newName = sanitizeChannelName(interaction.options.getString('name', true));
    if (!newName) {
      await interaction.reply({ content: '❌ Nom invalide.', ephemeral: true });
      return;
    }

    await interaction.channel.setName(newName);
    await interaction.reply(`✅ Salon renommé en **${newName}**.`);
  }
};

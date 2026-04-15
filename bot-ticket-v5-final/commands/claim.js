const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const { getOpenTicketByChannelId, setClaim } = require('../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Prend en charge le ticket'),

  async execute(client, interaction) {
    const allowed = await ensureSupport(interaction, client);
    if (!allowed) return;

    const ticket = await getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: '❌ Pas un salon ticket.', ephemeral: true });
      return;
    }

    await setClaim(client, ticket.id, interaction.user);
    await interaction.reply(`✅ Ticket pris en charge par **${interaction.user.username}**.`);
  }
};

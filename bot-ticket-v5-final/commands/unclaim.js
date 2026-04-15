const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const { getOpenTicketByChannelId, setClaim } = require('../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unclaim')
    .setDescription('Retire la prise en charge du ticket'),

  async execute(client, interaction) {
    const allowed = await ensureSupport(interaction, client);
    if (!allowed) return;

    const ticket = await getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: '❌ Pas un salon ticket.', ephemeral: true });
      return;
    }

    await setClaim(client, ticket.id, null);
    await interaction.reply('✅ Ticket désattribué.');
  }
};

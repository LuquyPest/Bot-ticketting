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

    if (ticket.claimed_by && ticket.claimed_by !== interaction.user.id) {
      const previousClaimer = await interaction.guild.members.fetch(ticket.claimed_by).catch(() => null);
      const name = previousClaimer?.user?.username ?? ticket.claimed_by;
      await interaction.reply({
        content: `Ce ticket est deja pris en charge par **${name}**. Utilise /unclaim d'abord si tu veux le reprendre.`,
        ephemeral: true
      });
      return;
    }

    await setClaim(client, ticket.id, interaction.user);
    await interaction.reply(`✅ Ticket pris en charge par **${interaction.user.username}**.`);
  }
};

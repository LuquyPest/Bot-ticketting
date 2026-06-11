const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Prend en charge le ticket'),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: '❌ Pas un salon ticket.', ephemeral: true });
    }

    if (ticket.claimed_by && ticket.claimed_by !== interaction.user.id) {
      const previousClaimer = await interaction.guild.members.fetch(ticket.claimed_by).catch(() => null);
      const name = previousClaimer?.user?.username ?? ticket.claimed_by;
      return interaction.reply({
        content: `Ce ticket est déjà pris en charge par **${name}**. Utilise /unclaim d'abord si tu veux le reprendre.`,
        ephemeral: true
      });
    }

    await tm.setClaim(ticket.id, interaction.user);
    await tm.updateChannelTopic(ticket.id).catch(() => null);
    const claimEmbed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle('✋ Ticket pris en charge')
      .addFields(
        { name: 'Staff', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Heure', value: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), inline: true }
      );
    await interaction.reply({ embeds: [claimEmbed] });
  }
};

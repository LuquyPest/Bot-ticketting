const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claim')
    .setDescription('S\'ajoute aux personnes assignées au ticket'),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'claim_ticket'))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: '❌ Pas un salon ticket.', flags: MessageFlags.Ephemeral });
    }

    // Several staff members can be assigned to the same ticket
    const added = await tm.addAssignee(ticket.id, interaction.user, interaction.user);
    if (!added) {
      return interaction.reply({ content: 'Tu es déjà assigné à ce ticket.', flags: MessageFlags.Ephemeral });
    }
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

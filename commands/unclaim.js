const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unclaim')
    .setDescription('Retire la prise en charge du ticket'),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: '❌ Pas un salon ticket.', ephemeral: true });
    }

    await tm.setClaim(ticket.id, null);
    await tm.updateChannelTopic(ticket.id).catch(() => null);
    const unclaimEmbed = new EmbedBuilder()
      .setColor(0x4e5058)
      .setTitle('↩️ Ticket désattribué')
      .addFields(
        { name: 'Staff', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Heure', value: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), inline: true }
      );
    await interaction.reply({ embeds: [unclaimEmbed] });
  }
};

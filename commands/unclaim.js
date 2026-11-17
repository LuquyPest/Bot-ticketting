const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unclaim')
    .setDescription('Se retire des personnes assignées au ticket'),

  async execute(client, interaction) {
    const L = await require('../utils/staffI18n').forInteraction(interaction);
    const Ls = await require('../utils/staffI18n').forInteraction(interaction, { shared: true });
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'claim_ticket'))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: L('notTicket'), flags: MessageFlags.Ephemeral });
    }

    const removed = await tm.removeAssignee(ticket.id, interaction.user.id, interaction.user);
    if (!removed) {
      return interaction.reply({ content: L('unclaim.not'), flags: MessageFlags.Ephemeral });
    }
    await tm.updateChannelTopic(ticket.id).catch(() => null);
    const unclaimEmbed = new EmbedBuilder()
      .setColor(0x4e5058)
      .setTitle(Ls('unclaim.title'))
      .addFields(
        { name: Ls('field.staff'), value: `<@${interaction.user.id}>`, inline: true },
        { name: Ls('field.time'), value: Ls.time(), inline: true }
      );
    await interaction.reply({ embeds: [unclaimEmbed] });
  }
};

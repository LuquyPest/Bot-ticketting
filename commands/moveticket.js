const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moveticket')
    .setDescription('Change l\'étape du ticket (déplace le salon dans la catégorie associée)')
    .addStringOption(option =>
      option
        .setName('etape')
        .setDescription('Nouvelle étape')
        .setRequired(true)
        .addChoices(
          { name: 'Ouvert', value: 'open' },
          { name: 'En attente', value: 'waiting' },
          { name: 'En cours', value: 'in_progress' },
        )
    ),

  async execute(client, interaction) {
    const L = await require('../utils/staffI18n').forInteraction(interaction);
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'reply_ticket'))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: L('notTicket'), flags: MessageFlags.Ephemeral });
    }

    const result = await tm.moveToStage(ticket.id, interaction.options.getString('etape', true), interaction.user)
      .catch(() => ({ ok: false, error: L('move.failed') }));
    if (!result.ok) return interaction.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
    await tm.updateChannelTopic(ticket.id).catch(() => null);
    return interaction.reply({ content: L('move.done', { stage: L(`stage.${interaction.options.getString('etape', true)}`) }), flags: MessageFlags.Ephemeral });
  }
};

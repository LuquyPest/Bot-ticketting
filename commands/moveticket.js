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
        // The statuses of the space, custom ones included (utils/stages.js)
        .setAutocomplete(true)
    ),

  async autocomplete(client, interaction) {
    const L = await require('../utils/staffI18n').forInteraction(interaction);
    const typed = String(interaction.options.getFocused() || '').toLowerCase();
    const stages = await require('../utils/stages').listStages(getTenantDb(interaction.guildId));
    const choices = stages.map(s => ({ name: (s.builtin ? L(`stage.${s.key}`) : s.label).slice(0, 100), value: s.key }))
      .filter(c => !typed || c.name.toLowerCase().includes(typed) || c.value.includes(typed));
    await interaction.respond(choices.slice(0, 25));
  },

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
    return interaction.reply({ content: L('move.done', { stage: result.label && !require('../utils/stages').BUILTIN.includes(interaction.options.getString('etape', true)) ? result.label : L(`stage.${interaction.options.getString('etape', true)}`) }), flags: MessageFlags.Ephemeral });
  }
};

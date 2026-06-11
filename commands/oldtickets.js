const { SlashCommandBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');
const { buildOldTicketsPageEmbed } = require('../utils/embeds');
const { oldTicketsPaginationButtons } = require('../utils/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('oldtickets')
    .setDescription('Affiche les anciens tickets d'un utilisateur')
    .addStringOption(option =>
      option.setName('userid').setDescription('ID Discord').setRequired(true)
    ),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db))) return;

    const userId = interaction.options.getString('userid', true);
    const tickets = await tm.getOldTicketsByUserId(userId);

    if (!tickets.length) {
      return interaction.reply({ content: '❌ Aucun ticket trouvé pour cet utilisateur.', ephemeral: true });
    }

    const { embed, totalPages, safePage } = buildOldTicketsPageEmbed(userId, tickets, 0, 5);

    await interaction.reply({
      embeds: [embed],
      components: [oldTicketsPaginationButtons(userId, safePage, totalPages)],
      ephemeral: true
    });
  }
};

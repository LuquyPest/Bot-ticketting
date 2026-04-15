const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const { getOldTicketsByUserId } = require('../utils/ticketManager');
const { buildOldTicketsPageEmbed } = require('../utils/embeds');
const { oldTicketsPaginationButtons } = require('../utils/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('oldtickets')
    .setDescription('Affiche les anciens tickets d’un utilisateur')
    .addStringOption(option =>
      option.setName('userid').setDescription('ID Discord').setRequired(true)
    ),

  async execute(client, interaction) {
    const allowed = await ensureSupport(interaction, client);
    if (!allowed) return;

    const userId = interaction.options.getString('userid', true);
    const tickets = await getOldTicketsByUserId(userId);

    if (!tickets.length) {
      await interaction.reply({ content: '❌ Aucun ticket trouvé pour cet utilisateur.', ephemeral: true });
      return;
    }

    const { embed, totalPages, safePage } = buildOldTicketsPageEmbed(userId, tickets, 0, 5);

    await interaction.reply({
      embeds: [embed],
      components: [oldTicketsPaginationButtons(userId, safePage, totalPages)],
      ephemeral: true
    });
  }
};

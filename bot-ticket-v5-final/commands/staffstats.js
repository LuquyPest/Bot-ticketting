const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ensureChiefSupport } = require('../utils/permissions');
const { getAdminStats } = require('../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staffstats')
    .setDescription('Affiche les statistiques des admins sur les tickets'),

  async execute(client, interaction) {
    const allowed = await ensureChiefSupport(interaction, client);
    if (!allowed) return;

    const stats = await getAdminStats();

    if (!stats.length) {
      await interaction.reply({ content: '❌ Aucune statistique disponible.', ephemeral: true });
      return;
    }

    const description = stats.slice(0, 25).map((row, index) => [
      `**${index + 1}. ${row.admin_tag}**`,
      `Claims : **${row.tickets_claimed}**`,
      `Fermetures : **${row.tickets_closed}**`
    ].join('\n')).join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle('📊 Statistiques staff')
      .setDescription(description)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

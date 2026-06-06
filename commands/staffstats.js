const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ensureChiefSupport } = require('../utils/permissions');
const { getAdminStats } = require('../utils/ticketManager');

function formatDuration(seconds) {
  if (!seconds) return '-';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

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

    const description = stats.slice(0, 20).map((row, index) => {
      const avgRating = row.total_ratings > 0
        ? (row.total_rating_score / row.total_ratings).toFixed(1)
        : null;
      const avgResponse = row.total_response_count > 0
        ? Math.floor(row.total_response_seconds / row.total_response_count)
        : null;

      const lines = [
        `**${index + 1}. ${row.admin_tag}**`,
        `Claims : **${row.tickets_claimed}** | Fermetures : **${row.tickets_closed}**`,
        avgResponse !== null ? `Temps de réponse moyen : **${formatDuration(avgResponse)}**` : null,
        avgRating !== null ? `Note moyenne : **${avgRating}/5** ⭐ (${row.total_ratings} avis)` : null
      ].filter(Boolean);

      return lines.join('\n');
    }).join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle('📊 Statistiques staff')
      .setDescription(description)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

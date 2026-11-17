const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureChiefSupport } = require('../utils/permissions');

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
    const L = await require('../utils/staffI18n').forInteraction(interaction);
    const Ls = await require('../utils/staffI18n').forInteraction(interaction, { shared: true });
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureChiefSupport(interaction, client, db))) return;

    const stats = await tm.getAdminStats();

    if (!stats.length) {
      return interaction.reply({ content: L('stats.none'), flags: MessageFlags.Ephemeral });
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
        Ls('stats.line', { claims: row.tickets_claimed, closes: row.tickets_closed }),
        avgResponse !== null ? Ls('stats.response', { d: formatDuration(avgResponse) }) : null,
        avgRating !== null ? Ls('stats.rating', { avg: avgRating, n: row.total_ratings }) : null
      ].filter(Boolean);

      return lines.join('\n');
    }).join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle(Ls('stats.title'))
      .setDescription(description)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};

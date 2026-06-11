const { EmbedBuilder } = require('discord.js');
const { getActiveGuilds } = require('./guildScan');
const { getTenantDb } = require('./tenantDb');
const { getGuildConfig } = require('./ticketManager');

function fmt(seconds) {
  if (!seconds) return 'N/A';
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function sendWeeklyReportForGuild(client, guildId) {
  const db = getTenantDb(guildId);
  const cfg = await getGuildConfig(db);
  if (!cfg.weekly_report_channel_id) return;

  const channel = await client.channels.fetch(cfg.weekly_report_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  const [[opened], [closed], [unclaimed], [avgResp], [avgRes], leaderboard] = await Promise.all([
    db("SELECT COUNT(*) as c FROM tickets WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"),
    db("SELECT COUNT(*) as c FROM tickets WHERE closed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'closed'"),
    db("SELECT COUNT(*) as c FROM tickets WHERE status = 'open' AND claimed_by IS NULL"),
    db("SELECT AVG(TIMESTAMPDIFF(SECOND, created_at, first_response_at)) as v FROM tickets WHERE first_response_at IS NOT NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"),
    db("SELECT AVG(TIMESTAMPDIFF(SECOND, created_at, closed_at)) as v FROM tickets WHERE status = 'closed' AND closed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"),
    db(`SELECT admin_id, admin_tag, tickets_closed, tickets_claimed,
          CASE WHEN total_response_count > 0 THEN FLOOR(total_response_seconds / total_response_count) ELSE NULL END as avg_resp,
          CASE WHEN total_ratings > 0 THEN ROUND(total_rating_score / total_ratings, 1) ELSE NULL END as avg_rating
        FROM admin_stats WHERE updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        ORDER BY tickets_closed DESC LIMIT 10`)
  ]);

  const MEDALS = ['🥇', '🥈', '🥉'];
  const leaderboardStr = leaderboard.length > 0
    ? leaderboard.map((s, i) => {
        const medal = MEDALS[i] || `**${i + 1}.**`;
        const rating = s.avg_rating ? ` · ⭐ ${s.avg_rating}` : '';
        const resp = s.avg_resp ? ` · ⏱ ${fmt(s.avg_resp)}` : '';
        return `${medal} **${s.admin_tag}** — ${s.tickets_closed} fermés · ${s.tickets_claimed} claims${resp}${rating}`;
      }).join('\n')
    : '_Aucune activité cette semaine_';

  const now = new Date();
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const statsEmbed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle('📊 Rapport hebdomadaire — Support')
    .setDescription(`Semaine du ${weekAgo.toLocaleDateString('fr-FR')} au ${now.toLocaleDateString('fr-FR')}`)
    .addFields(
      { name: '🎫 Ouverts',            value: String(opened.c),   inline: true },
      { name: '✅ Fermés',             value: String(closed.c),   inline: true },
      { name: '⏳ Non claim',          value: String(unclaimed.c), inline: true },
      { name: '⚡ Tps réponse moy.',   value: fmt(avgResp.v),     inline: true },
      { name: '🏁 Tps résolution moy.', value: fmt(avgRes.v),     inline: true },
      { name: '​',                value: '​',            inline: true }
    )
    .setTimestamp();

  const leaderboardEmbed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('🏆 Classement staff — 7 derniers jours')
    .setDescription(leaderboardStr)
    .setFooter({ text: 'Classement basé sur les tickets fermés' })
    .setTimestamp();

  await channel.send({ embeds: [statsEmbed, leaderboardEmbed] }).catch(console.error);
}

async function sendWeeklyReport(client) {
  const guilds = await getActiveGuilds();
  for (const { guild_id } of guilds) {
    try {
      await sendWeeklyReportForGuild(client, guild_id);
    } catch (err) {
      console.error(`weeklyReport error [${guild_id}]:`, err);
    }
  }
}

function startWeeklyReport(client) {
  function scheduleNext() {
    const now = new Date();
    const next = new Date();
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
    next.setDate(now.getDate() + daysUntilMonday);
    next.setHours(9, 0, 0, 0);
    setTimeout(() => {
      sendWeeklyReport(client).catch(console.error);
      setInterval(() => sendWeeklyReport(client).catch(console.error), 7 * 24 * 60 * 60 * 1000);
    }, next - now);
  }
  scheduleNext();
}

module.exports = { startWeeklyReport };

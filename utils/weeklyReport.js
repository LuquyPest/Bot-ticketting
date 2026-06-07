const { EmbedBuilder } = require('discord.js');
const { query } = require('./db');

async function sendWeeklyReport(client) {
  const channelId = client.config.weeklyReportChannelId;
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const [[opened], [closed], [unclaimed], [avgResp], [avgRes], [topStaff]] = await Promise.all([
    query("SELECT COUNT(*) as c FROM tickets WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"),
    query("SELECT COUNT(*) as c FROM tickets WHERE closed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'closed'"),
    query("SELECT COUNT(*) as c FROM tickets WHERE status = 'open' AND claimed_by IS NULL"),
    query("SELECT AVG(TIMESTAMPDIFF(SECOND, created_at, first_response_at)) as v FROM tickets WHERE first_response_at IS NOT NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"),
    query("SELECT AVG(TIMESTAMPDIFF(SECOND, created_at, closed_at)) as v FROM tickets WHERE status = 'closed' AND closed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"),
    query("SELECT admin_tag, tickets_closed FROM admin_stats WHERE updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) ORDER BY tickets_closed DESC LIMIT 3")
  ]);

  function fmt(seconds) {
    if (!seconds) return 'N/A';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  const topStr = topStaff.map((s, i) => `${['🥇','🥈','🥉'][i]} **${s.admin_tag}** — ${s.tickets_closed} fermés`).join('\n') || 'Aucune donnée';

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle('📊 Rapport hebdomadaire — Support')
    .setDescription(`Semaine du ${new Date(Date.now() - 7 * 86400000).toLocaleDateString('fr-FR')} au ${new Date().toLocaleDateString('fr-FR')}`)
    .addFields(
      { name: 'Tickets ouverts', value: String(opened.c), inline: true },
      { name: 'Tickets fermés', value: String(closed.c), inline: true },
      { name: 'En attente (non claim)', value: String(unclaimed.c), inline: true },
      { name: 'Temps de réponse moyen', value: fmt(avgResp.v), inline: true },
      { name: 'Temps de résolution moyen', value: fmt(avgRes.v), inline: true },
      { name: '​', value: '​', inline: true },
      { name: 'Top Staff cette semaine', value: topStr }
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(console.error);
}

function startWeeklyReport(client) {
  function scheduleNext() {
    const now = new Date();
    const next = new Date();
    // Next Monday 09:00
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
    next.setDate(now.getDate() + daysUntilMonday);
    next.setHours(9, 0, 0, 0);
    const delay = next - now;
    setTimeout(() => {
      sendWeeklyReport(client).catch(console.error);
      setInterval(() => sendWeeklyReport(client).catch(console.error), 7 * 24 * 60 * 60 * 1000);
    }, delay);
  }
  scheduleNext();
}

module.exports = { startWeeklyReport };

// Public statistics of the support, posted in a channel chosen by the founders (Paramètres → Salons)
// and refreshed every hour (BullMQ job 'public-stats'): tickets resolved, median first response,
// share answered within the target, median resolution time and satisfaction, over 30 days.
// Only aggregates: no name, subject or content. In the server's bot language.
const { EmbedBuilder } = require('discord.js');
const { getTenantDb } = require('./tenantDb');
const { fetchGuildChannel } = require('./discordGuard');
const { median } = require('./stageStats');
const i18n = require('./i18n');
const logger = require('./logger');

const DAYS = 30;

async function computePublicStats(db, { days = DAYS, targetHours = 2 } = {}) {
  const since = new Date(Date.now() - days * 86400000);
  const [[resolved], firsts, resolutions, [ratings]] = await Promise.all([
    db("SELECT COUNT(*) AS n FROM tickets WHERE status = 'closed' AND closed_at >= ?", [since]),
    db('SELECT TIMESTAMPDIFF(MINUTE, created_at, first_response_at) AS m FROM tickets WHERE created_at >= ? AND first_response_at IS NOT NULL', [since]),
    db("SELECT TIMESTAMPDIFF(MINUTE, created_at, closed_at) AS m FROM tickets WHERE status = 'closed' AND closed_at >= ?", [since]),
    db('SELECT COUNT(*) AS n, AVG(rating) AS avg FROM ticket_ratings WHERE rated_at >= ?', [since]),
  ]);
  const fr = firsts.map(r => Math.max(0, Number(r.m)));
  const res = resolutions.map(r => Math.max(0, Number(r.m)));
  const n = Number(ratings?.n || 0);
  return {
    days, targetHours,
    resolved: Number(resolved?.n || 0),
    firstResponseMedianMin: fr.length ? median(fr) : null,
    withinTargetPct: fr.length ? Math.round((fr.filter(m => m <= targetHours * 60).length / fr.length) * 100) : null,
    resolutionMedianMin: res.length ? median(res) : null,
    satisfaction: n ? { average: Math.round(Number(ratings.avg) * 10) / 10, count: n } : null,
  };
}

// Duration in the current language (keys stats.min / stats.hours / stats.days)
function fmtDuration(min) {
  if (min == null) return '—';
  const m = Math.round(min);
  if (m < 60) return i18n.t('stats.min', { m });
  const h = Math.floor(m / 60);
  if (h < 24) return i18n.t('stats.hours', { h, m: String(m % 60).padStart(2, '0') });
  return i18n.t('stats.days', { d: Math.floor(h / 24), h: h % 24 });
}

// Embed in the current language (call inside withLang)
function buildEmbed(stats, guildName) {
  const { t } = i18n;
  const embed = new EmbedBuilder()
    .setColor(0x2f6feb)
    .setTitle(t('stats.title', { guild: guildName }))
    .setDescription(t('stats.period', { days: stats.days }))
    .setFooter({ text: t('stats.footer') })
    .setTimestamp(new Date());
  const fields = [{ name: t('stats.resolved'), value: String(stats.resolved), inline: true }];
  if (stats.firstResponseMedianMin != null) fields.push({ name: t('stats.firstResponse'), value: fmtDuration(stats.firstResponseMedianMin), inline: true });
  if (stats.withinTargetPct != null) fields.push({ name: t('stats.withinTarget', { hours: stats.targetHours }), value: `${stats.withinTargetPct} %`, inline: true });
  if (stats.resolutionMedianMin != null) fields.push({ name: t('stats.resolution'), value: fmtDuration(stats.resolutionMedianMin), inline: true });
  if (stats.satisfaction) fields.push({ name: t('stats.satisfaction'), value: t('stats.satisfactionValue', { avg: stats.satisfaction.average, n: stats.satisfaction.count }), inline: true });
  if (fields.length === 1 && stats.resolved === 0) embed.setDescription(`${t('stats.period', { days: stats.days })}\n\n${t('stats.none')}`);
  return embed.addFields(fields);
}

// Language of a public channel: the server's setting; « auto » → the server's Discord language
async function channelLang(client, guildId) {
  const [row] = await getTenantDb(guildId)('SELECT bot_language FROM guild_config WHERE id = 1').catch(() => []);
  const setting = row?.bot_language || 'fr';
  if (setting !== 'auto') return setting;
  return i18n.fromLocale(client?.guilds?.cache?.get(guildId)?.preferredLocale || 'fr');
}

// Posts the message, or edits the one already posted. Returns { ok, channelId, messageId, url } or { error }.
async function publishPublicStats(client, guildId) {
  const db = getTenantDb(guildId);
  const [cfg] = await db('SELECT public_stats_channel_id, public_stats_message_id, public_stats_target_hours FROM guild_config WHERE id = 1');
  if (!cfg?.public_stats_channel_id) return { error: 'Aucun salon choisi pour les statistiques publiques' };
  const channel = await fetchGuildChannel(client, guildId, cfg.public_stats_channel_id);
  if (!channel?.isTextBased?.()) return { error: 'Salon des statistiques introuvable ou inaccessible au bot' };
  const stats = await computePublicStats(db, { targetHours: cfg.public_stats_target_hours || 2 });
  const guildName = client.guilds?.cache?.get(guildId)?.name || channel.guild?.name || '';
  const embed = i18n.withLang(await channelLang(client, guildId), () => buildEmbed(stats, guildName));
  let message = cfg.public_stats_message_id ? await channel.messages.fetch(cfg.public_stats_message_id).catch(() => null) : null;
  if (message) await message.edit({ embeds: [embed] });
  else {
    message = await channel.send({ embeds: [embed] });
    await db('UPDATE guild_config SET public_stats_message_id = ? WHERE id = 1', [message.id]);
  }
  return { ok: true, channelId: channel.id, messageId: message.id, url: `https://discord.com/channels/${guildId}/${channel.id}/${message.id}`, stats };
}

// BullMQ job 'public-stats': every server that chose a channel
async function refreshAllPublicStats(client) {
  const { getActiveGuilds } = require('./guildScan');
  let updated = 0;
  for (const { guild_id } of await getActiveGuilds()) {
    try {
      const [cfg] = await getTenantDb(guild_id)('SELECT public_stats_channel_id FROM guild_config WHERE id = 1');
      if (!cfg?.public_stats_channel_id) continue;
      const r = await publishPublicStats(client, guild_id);
      if (r.ok) updated++;
    } catch (err) { logger.warn('Statistiques publiques non mises à jour', { guildId: guild_id, err: err.message }); }
  }
  return { updated };
}

module.exports = { computePublicStats, buildEmbed, publishPublicStats, refreshAllPublicStats, fmtDuration };

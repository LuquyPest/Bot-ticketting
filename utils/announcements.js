// Announcements from the super-admin: Discord DM to the founders of every active server
// (each person once) and/or a banner on the dashboard until the end date.
const { EmbedBuilder } = require('discord.js');
const { globalQuery } = require('./globalDb');
const { getTenantDb } = require('./tenantDb');
const logger = require('./logger');

async function founderIds() {
  const ids = new Set();
  for (const { guild_id } of await globalQuery("SELECT guild_id FROM guilds WHERE status = 'active'")) {
    const rows = await getTenantDb(guild_id)("SELECT user_id FROM dashboard_users WHERE role = 'fondateur'").catch(() => []);
    rows.forEach(r => ids.add(r.user_id));
  }
  return [...ids];
}

async function sendAnnouncementDms(client, a) {
  const embed = new EmbedBuilder()
    .setColor(a.level === 'warning' ? 0xf59e0b : 0x5865f2)
    .setAuthor({ name: 'Annonce de l\'administrateur du bot' })
    .setTitle(a.title.slice(0, 256))
    .setDescription(a.body.slice(0, 4000))
    .setFooter({ text: 'Tu reçois ce message en tant que fondateur d\'un serveur utilisant le bot' })
    .setTimestamp();
  let sent = 0;
  for (const id of await founderIds()) {
    const user = await client?.users.fetch(id).catch(() => null);
    if (user && await user.send({ embeds: [embed] }).catch(() => null)) sent++;
  }
  await globalQuery('UPDATE announcements SET dm_sent = ? WHERE id = ?', [sent, a.id]);
  logger.info('Annonce envoyée', { id: a.id, sent });
  return sent;
}

const activeBanners = () => globalQuery(
  'SELECT id, title, body, level, created_at FROM announcements WHERE show_banner = 1 AND (ends_at IS NULL OR ends_at > NOW()) ORDER BY id DESC LIMIT 3'
);

module.exports = { sendAnnouncementDms, activeBanners, founderIds };

const crypto = require('crypto');
const { Events } = require('discord.js');
const { globalQuery } = require('../utils/globalDb');
const { getDbName } = require('../utils/tenantDb');
const logger = require('../utils/logger');

async function syncGuild(client, guild) {
  try {
    const owner = await guild.fetchOwner().catch(() => null);
    const ownerDiscordId  = owner?.id  || guild.ownerId;
    const ownerDiscordTag = owner?.user?.username || guild.ownerId;

    const [existing] = await globalQuery('SELECT guild_id FROM guilds WHERE guild_id = ?', [guild.id]);

    if (existing) {
      await globalQuery(
        'UPDATE guilds SET guild_name = ?, guild_icon = ?, member_count = ?, owner_discord_id = ?, owner_discord_tag = ? WHERE guild_id = ?',
        [guild.name, guild.iconURL() || null, guild.memberCount, ownerDiscordId, ownerDiscordTag, guild.id]
      );
    } else {
      const activationToken = crypto.randomBytes(48).toString('hex');
      const tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await globalQuery(
        `INSERT INTO guilds (guild_id, guild_name, guild_icon, owner_discord_id, owner_discord_tag, status, db_name, activation_token, token_expires_at, member_count)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        [guild.id, guild.name, guild.iconURL() || null, ownerDiscordId, ownerDiscordTag, getDbName(guild.id), activationToken, tokenExpires, guild.memberCount]
      );
      logger.info('Nouveau serveur enregistré au démarrage', { guildId: guild.id, guildName: guild.name });
    }
  } catch (err) {
    logger.error('Erreur sync guild au démarrage', { guildId: guild.id, err: err.message });
  }
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`Connecté en tant que ${client.user.tag}`);

    const guilds = client.guilds.cache;
    logger.info('Synchronisation des serveurs existants', { count: guilds.size });
    await Promise.all(guilds.map(g => syncGuild(client, g)));
    logger.info('Synchronisation terminée');
  }
};

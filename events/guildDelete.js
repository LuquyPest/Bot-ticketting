const { Events } = require('discord.js');
const { globalQuery } = require('../utils/globalDb');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildDelete,
  async execute(client, guild) {
    try {
      logger.info('Bot retiré d\'un serveur', { guildId: guild.id, guildName: guild.name });
      await globalQuery(
        'UPDATE guilds SET status = "suspended" WHERE guild_id = ? AND status = "active"',
        [guild.id]
      );
    } catch (err) {
      logger.error('guildDelete error', { guildId: guild.id, err: err.message });
    }
  }
};

const { Events } = require('discord.js');
const { globalQuery } = require('../utils/globalDb');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildDelete,
  async execute(client, guild) {
    try {
      logger.info('Bot retiré d\'un serveur', { guildId: guild.id, guildName: guild.name });
      await globalQuery(
        // A space unlinked from Discord (discord = 0) stays active: the bot left on purpose
        'UPDATE guilds SET status = "suspended", suspension_reason = "bot_removed" WHERE guild_id = ? AND status = "active" AND discord = 1',
        [guild.id]
      );
    } catch (err) {
      logger.error('guildDelete error', { guildId: guild.id, err: err.message });
    }
  }
};

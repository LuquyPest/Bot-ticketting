const { Events, AuditLogEvent } = require('discord.js');
const { registerGuild } = require('../utils/guildActivation');
const logger = require('../utils/logger');

// Who added the bot (audit log); the owner otherwise
async function fetchInviter(guild, client) {
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
    const entry = logs.entries.find(e => e.target?.id === client.user.id);
    if (entry?.executor) return { id: entry.executor.id, tag: entry.executor.username };
  } catch {}
  return null;
}

module.exports = {
  name: Events.GuildCreate,
  async execute(client, guild) {
    try {
      logger.info('Bot ajouté à un serveur', { guildId: guild.id, guildName: guild.name });
      const result = await registerGuild(client, guild, { inviter: await fetchInviter(guild, client) });
      logger.info('Serveur enregistré', { guildId: guild.id, result });
    } catch (err) {
      logger.error('guildCreate error', { guildId: guild.id, err: err.message });
    }
  }
};

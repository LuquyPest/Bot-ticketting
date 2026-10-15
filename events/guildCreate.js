const crypto = require('crypto');
const { Events, AuditLogEvent } = require('discord.js');
const { globalQuery } = require('../utils/globalDb');
const { getDbName } = require('../utils/tenantDb');
const logger = require('../utils/logger');

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

      // Fetch owner info
      const owner = await guild.fetchOwner().catch(() => null);
      const ownerDiscordId  = owner?.id  || guild.ownerId;
      const ownerDiscordTag = owner?.user?.username || guild.ownerId;

      const inviter = await fetchInviter(guild, client);
      const inviterDiscordId  = inviter?.id  || ownerDiscordId;
      const inviterDiscordTag = inviter?.tag  || ownerDiscordTag;

      // Check if already registered
      const [existing] = await globalQuery('SELECT * FROM guilds WHERE guild_id = ?', [guild.id]);

      if (existing) {
        // Bot kicked then re-invited: restore the previous activation (an admin suspension stays)
        if (existing.status === 'suspended' && existing.suspension_reason === 'bot_removed') {
          await globalQuery('UPDATE guilds SET status = "active", suspension_reason = NULL WHERE guild_id = ?', [guild.id]);
          logger.info('Serveur réactivé après ré-invitation du bot', { guildId: guild.id });
        }
        await globalQuery(
          'UPDATE guilds SET guild_name = ?, guild_icon = ?, member_count = ?, owner_discord_id = ?, owner_discord_tag = ?, inviter_discord_id = ?, inviter_discord_tag = ? WHERE guild_id = ?',
          [guild.name, guild.iconURL() || null, guild.memberCount, ownerDiscordId, ownerDiscordTag, inviterDiscordId, inviterDiscordTag, guild.id]
        );
      } else {
        // New guild — register as pending
        const activationToken = crypto.randomBytes(48).toString('hex');
        const tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        await globalQuery(
          `INSERT INTO guilds (guild_id, guild_name, guild_icon, owner_discord_id, owner_discord_tag, inviter_discord_id, inviter_discord_tag, status, db_name, activation_token, token_expires_at, member_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
          [guild.id, guild.name, guild.iconURL() || null, ownerDiscordId, ownerDiscordTag, inviterDiscordId, inviterDiscordTag, getDbName(guild.id), activationToken, tokenExpires, guild.memberCount]
        );
      }

      // DM the inviter
      const baseUrl = client.config?.webServerBaseUrl || '';
      try {
        const inviterUser = await client.users.fetch(inviterDiscordId);
        await inviterUser.send([
          `**Ticket Bot** a bien rejoint le serveur **${guild.name}**.`,
          '',
          'Ta demande est en cours d\'examen. Un administrateur va valider l\'activation prochainement.',
          baseUrl ? `\nUne fois activé, tu pourras accéder au dashboard : **${baseUrl}**` : ''
        ].join('\n')).catch(() => null);
      } catch {}
    } catch (err) {
      logger.error('guildCreate error', { guildId: guild.id, err: err.message });
    }
  }
};

const crypto = require('crypto');
const { Events } = require('discord.js');
const { globalQuery } = require('../utils/globalDb');
const { getDbName } = require('../utils/tenantDb');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildCreate,
  async execute(client, guild) {
    try {
      logger.info('Bot ajouté à un serveur', { guildId: guild.id, guildName: guild.name });

      // Fetch owner info
      const owner = await guild.fetchOwner().catch(() => null);
      const ownerDiscordId  = owner?.id  || guild.ownerId;
      const ownerDiscordTag = owner?.user?.username || guild.ownerId;

      // Check if already registered
      const [existing] = await globalQuery('SELECT * FROM guilds WHERE guild_id = ?', [guild.id]);

      if (existing) {
        // Reactivate if suspended, or just update metadata
        if (existing.status === 'suspended') {
          await globalQuery(
            'UPDATE guilds SET guild_name = ?, guild_icon = ?, member_count = ? WHERE guild_id = ?',
            [guild.name, guild.iconURL() || null, guild.memberCount, guild.id]
          );
        }
        // Already pending or active — just update info
        await globalQuery(
          'UPDATE guilds SET guild_name = ?, guild_icon = ?, member_count = ?, owner_discord_id = ?, owner_discord_tag = ? WHERE guild_id = ?',
          [guild.name, guild.iconURL() || null, guild.memberCount, ownerDiscordId, ownerDiscordTag, guild.id]
        );
      } else {
        // New guild — register as pending
        const activationToken = crypto.randomBytes(48).toString('hex');
        const tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        await globalQuery(
          `INSERT INTO guilds (guild_id, guild_name, guild_icon, owner_discord_id, owner_discord_tag, status, db_name, activation_token, token_expires_at, member_count)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
          [guild.id, guild.name, guild.iconURL() || null, ownerDiscordId, ownerDiscordTag, getDbName(guild.id), activationToken, tokenExpires, guild.memberCount]
        );
      }

      // DM the owner
      if (owner) {
        const baseUrl = client.config?.dashboard?.webServerBaseUrl || client.config?.webServerBaseUrl || '';
        const dmLines = [
          `**Ticket Bot** a rejoint ton serveur **${guild.name}**.`,
          '',
          'Ta demande est en cours d\'examen. Un administrateur va valider l\'activation prochainement.',
          '',
          baseUrl
            ? `Une fois activé, tu pourras accéder au dashboard : **${baseUrl}**`
            : 'Un lien de dashboard te sera communiqué une fois activé.'
        ];
        await owner.send(dmLines.join('\n')).catch(() => null);
      }
    } catch (err) {
      logger.error('guildCreate error', { guildId: guild.id, err: err.message });
    }
  }
};

// Activation of a registered Discord server: tenant database created and migrated, the inviter
// (or the owner) made founder, status « active », founder told by DM. Used by the super-admin
// approval and, with AUTO_APPROVE_GUILDS, as soon as the bot joins a server.
const { globalQuery } = require('./globalDb');
const { getTenantDb } = require('./tenantDb');
const { ensureTenantSchema } = require('./tenantSchema');
const logger = require('./logger');

async function activateGuild(client, guild, { approvedBy = null } = {}) {
  await ensureTenantSchema(guild.guild_id);

  const founderId  = guild.inviter_discord_id  || guild.owner_discord_id;
  const founderTag = guild.inviter_discord_tag || guild.owner_discord_tag;
  await getTenantDb(guild.guild_id)(
    `INSERT INTO dashboard_users (user_id, username, role) VALUES (?, ?, 'fondateur')
     ON DUPLICATE KEY UPDATE role = 'fondateur'`,
    [founderId, founderTag]
  );

  await globalQuery(
    'UPDATE guilds SET status = "active", approved_by = ?, approved_at = NOW(), activation_token = NULL WHERE guild_id = ?',
    [approvedBy, guild.guild_id]
  );
  logger.info('Serveur activé', { guildId: guild.guild_id, approvedBy: approvedBy ?? 'auto' });

  try {
    const baseUrl = require('./config').config.webServerBaseUrl || '';
    const founder = await client.users.fetch(founderId);
    await founder.send([
      `✅ Ton serveur **${guild.guild_name}** a été activé !`,
      '',
      `Tu peux maintenant accéder au dashboard : **${baseUrl}**`,
      'Connecte-toi avec Discord et sélectionne ton serveur.'
    ].join('\n')).catch(() => null);
  } catch {}
}

module.exports = { activateGuild };

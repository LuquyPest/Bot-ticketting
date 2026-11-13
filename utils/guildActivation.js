// A Discord server joins the instance as soon as the bot is added to it: the server is recorded,
// its database created and migrated, and the person who invited the bot (or the owner) becomes
// founder and gets a DM with the dashboard link. With ALLOWED_GUILDS set, the bot leaves any
// other server.
const { globalQuery } = require('./globalDb');
const { getTenantDb, getDbName } = require('./tenantDb');
const { ensureTenantSchema } = require('./tenantSchema');
const { instanceName } = require('./instance');
const logger = require('./logger');

function allowedHere(guildId) {
  const { config } = require('./config');
  const list = config.allowedGuilds;
  return !Array.isArray(list) || !list.length || list.includes(guildId);
}

// Database, founder, status: for a row of ticketbot_global.guilds
async function activateGuild(client, guild, { notify = true } = {}) {
  await ensureTenantSchema(guild.guild_id);

  const founderId  = guild.inviter_discord_id  || guild.owner_discord_id;
  const founderTag = guild.inviter_discord_tag || guild.owner_discord_tag;
  await getTenantDb(guild.guild_id)(
    `INSERT INTO dashboard_users (user_id, username, role) VALUES (?, ?, 'fondateur')
     ON DUPLICATE KEY UPDATE role = 'fondateur'`,
    [founderId, founderTag]
  );
  await globalQuery('UPDATE guilds SET status = "active", suspension_reason = NULL WHERE guild_id = ?', [guild.guild_id]);
  logger.info('Serveur activé', { guildId: guild.guild_id });

  if (!notify) return;
  try {
    const baseUrl = require('./config').config.webServerBaseUrl || '';
    const founder = await client.users.fetch(founderId);
    await founder.send([
      `✅ **${instanceName(client)}** est prêt sur **${guild.guild_name}**.`,
      '',
      baseUrl ? `Dashboard : **${baseUrl}** — connecte-toi avec Discord et choisis le serveur.` : '',
      'Commence par **Paramètres** : rôles du staff et catégorie des tickets.',
    ].filter(Boolean).join('\n')).catch(() => null);
  } catch {}
}

// Records a Discord server that has the bot (arrival or startup) and activates it if new.
// Returns 'left' (not allowed), 'created', 'reactivated' or 'updated'.
async function registerGuild(client, guild, { inviter = null, notify = true } = {}) {
  if (!allowedHere(guild.id)) {
    logger.warn('Serveur hors de ALLOWED_GUILDS : le bot le quitte', { guildId: guild.id, guildName: guild.name });
    await guild.leave().catch(err => logger.error('Impossible de quitter le serveur', { guildId: guild.id, err: err.message }));
    return 'left';
  }
  const owner = await guild.fetchOwner().catch(() => null);
  const ownerId  = owner?.id || guild.ownerId;
  const ownerTag = owner?.user?.username || guild.ownerId;
  const [existing] = await globalQuery('SELECT * FROM guilds WHERE guild_id = ?', [guild.id]);

  if (!existing) {
    await globalQuery(
      `INSERT INTO guilds (guild_id, guild_name, guild_icon, owner_discord_id, owner_discord_tag, inviter_discord_id, inviter_discord_tag, status, db_name, member_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [guild.id, guild.name, guild.iconURL() || null, ownerId, ownerTag, inviter?.id || ownerId, inviter?.tag || ownerTag, getDbName(guild.id), guild.memberCount]
    );
    const [row] = await globalQuery('SELECT * FROM guilds WHERE guild_id = ?', [guild.id]);
    await activateGuild(client, row, { notify });
    return 'created';
  }

  await globalQuery(
    'UPDATE guilds SET guild_name = ?, guild_icon = ?, member_count = ?, owner_discord_id = ?, owner_discord_tag = ? WHERE guild_id = ?',
    [guild.name, guild.iconURL() || null, guild.memberCount, ownerId, ownerTag, guild.id]
  );
  if (inviter) await globalQuery('UPDATE guilds SET inviter_discord_id = ?, inviter_discord_tag = ? WHERE guild_id = ?', [inviter.id, inviter.tag, guild.id]);
  // Bot kicked then invited again: back to active (a suspension decided by the owner stays).
  // Servers left « pending » by a version before v3.0 are activated too.
  if (existing.status === 'pending' || (existing.status === 'suspended' && existing.suspension_reason === 'bot_removed')) {
    const [row] = await globalQuery('SELECT * FROM guilds WHERE guild_id = ?', [guild.id]);
    await activateGuild(client, row, { notify: notify && existing.status === 'pending' });
    return 'reactivated';
  }
  return 'updated';
}

module.exports = { activateGuild, registerGuild, allowedHere };

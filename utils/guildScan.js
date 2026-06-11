const { globalQuery } = require('./globalDb');
const { getTenantDb } = require('./tenantDb');
const { createManager } = require('./ticketManager');

async function getActiveGuilds() {
  return globalQuery('SELECT guild_id FROM guilds WHERE status = "active" AND maintenance_mode = 0');
}

// Scan all active guilds to find the user's first open ticket.
// Returns { ticket, guildId, db, tm } or null.
async function findUserOpenTicket(userId, client) {
  const guilds = await getActiveGuilds();
  for (const { guild_id } of guilds) {
    try {
      const db = getTenantDb(guild_id);
      const tm = createManager(db, client, guild_id);
      const ticket = await tm.getAnyOpenTicketForUser(userId);
      if (ticket) return { ticket, guildId: guild_id, db, tm };
    } catch { }
  }
  return null;
}

// Returns { blacklisted, guildId } — true if blacklisted in ANY active guild
async function isUserBlacklisted(userId) {
  const guilds = await getActiveGuilds();
  for (const { guild_id } of guilds) {
    try {
      const db = getTenantDb(guild_id);
      const rows = await db(
        'SELECT 1 FROM blacklist WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1',
        [userId]
      );
      if (rows.length) return { blacklisted: true, guildId: guild_id };
    } catch { }
  }
  return { blacklisted: false };
}

// Find all active guilds where the bot is active AND the user is a member.
// Returns array of { guildId, discordGuild, db, tm, config }
async function findGuildsForUser(userId, client) {
  const guilds = await getActiveGuilds();
  const matches = [];
  for (const { guild_id } of guilds) {
    try {
      const discordGuild = await client.guilds.fetch(guild_id).catch(() => null);
      if (!discordGuild) continue;
      const member = await discordGuild.members.fetch(userId).catch(() => null);
      if (!member) continue;
      const db = getTenantDb(guild_id);
      const [cfg] = await db('SELECT * FROM guild_config LIMIT 1');
      const tm = createManager(db, client, guild_id);
      matches.push({ guildId: guild_id, discordGuild, db, tm, config: cfg || {} });
    } catch { }
  }
  return matches;
}

module.exports = { getActiveGuilds, findUserOpenTicket, isUserBlacklisted, findGuildsForUser };

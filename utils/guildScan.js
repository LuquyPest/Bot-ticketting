const { globalQuery } = require('./globalDb');
const { getTenantDb } = require('./tenantDb');
const { createManager } = require('./ticketManager');

async function getActiveGuilds() {
  return globalQuery('SELECT guild_id, guild_name FROM guilds WHERE status = "active" AND maintenance_mode = 0');
}

// Returns array of all open tickets for a user across every active guild.
// Callers must handle 0 (no ticket), 1 (relay directly) and 2+ (ask user to pick).
async function findAllOpenTickets(userId, client) {
  const guilds = await getActiveGuilds();
  const found = [];
  for (const { guild_id, guild_name } of guilds) {
    try {
      const db = getTenantDb(guild_id);
      const tm = createManager(db, client, guild_id);
      const ticket = await tm.getAnyOpenTicketForUser(userId);
      if (ticket) found.push({ ticket, guildId: guild_id, guildName: guild_name || guild_id, db, tm });
    } catch {}
  }
  return found;
}

// Blacklists are per guild: being blocked on one server never affects another.
async function isBlacklistedIn(db, userId) {
  const rows = await db(
    'SELECT 1 FROM blacklist WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1',
    [userId]
  );
  return rows.length > 0;
}

// Active + not in maintenance, cached briefly: called on every guild message/interaction.
const STATUS_TTL_MS = 30 * 1000;
let _operational = { at: 0, ids: new Set() };
async function isGuildOperational(guildId) {
  if (!guildId) return false;
  if (Date.now() - _operational.at > STATUS_TTL_MS) {
    const rows = await getActiveGuilds();
    _operational = { at: Date.now(), ids: new Set(rows.map(r => r.guild_id)) };
  }
  return _operational.ids.has(guildId);
}

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

module.exports = { getActiveGuilds, findAllOpenTickets, isBlacklistedIn, isGuildOperational, findGuildsForUser };

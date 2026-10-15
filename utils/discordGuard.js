// Guards against a tenant pointing the bot at channels/roles of another guild.

// Returns the channel only if it belongs to `guildId`, otherwise null.
async function fetchGuildChannel(client, guildId, channelId) {
  if (!channelId || !client) return null;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  return ch && ch.guildId === guildId ? ch : null;
}

// Returns the subset of `ids` that are not channels of `guildId` (empty = all valid).
async function foreignChannels(client, guildId, ids) {
  const bad = [];
  for (const id of ids) if (id && !(await fetchGuildChannel(client, guildId, id))) bad.push(id);
  return bad;
}

async function foreignRoles(client, guildId, ids) {
  if (!ids.length) return [];
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return ids;
  const roles = await guild.roles.fetch().catch(() => null);
  return ids.filter(id => !roles?.has(id));
}

module.exports = { fetchGuildChannel, foreignChannels, foreignRoles };

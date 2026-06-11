async function getMember(guild, userId) {
  return guild.members.fetch(userId).catch(() => null);
}

// Parse a JSON field from guild_config that may already be an array or a JSON string
function parseJsonField(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return []; }
}

async function isSupportMember(client, guild, userId, db) {
  const member = await getMember(guild, userId);
  if (!member) return false;

  let supportRoleIds = [];
  let chiefRoleIds = [];

  if (db) {
    try {
      const [cfg] = await db('SELECT support_role_ids, chief_role_ids FROM guild_config LIMIT 1');
      if (cfg) {
        supportRoleIds = parseJsonField(cfg.support_role_ids);
        chiefRoleIds   = parseJsonField(cfg.chief_role_ids);
      }
    } catch { }
  }

  // Fallback to legacy config.json fields for first-run / development
  if (!supportRoleIds.length && !chiefRoleIds.length) {
    if (client.config?.supportRoleId)      supportRoleIds.push(client.config.supportRoleId);
    if (client.config?.chiefSupportRoleId) chiefRoleIds.push(client.config.chiefSupportRoleId);
  }

  const allRoleIds = [...new Set([...supportRoleIds, ...chiefRoleIds])];
  return allRoleIds.some(id => member.roles.cache.has(id));
}

async function isChiefSupportMember(client, guild, userId, db) {
  const member = await getMember(guild, userId);
  if (!member) return false;

  let chiefRoleIds = [];

  if (db) {
    try {
      const [cfg] = await db('SELECT chief_role_ids FROM guild_config LIMIT 1');
      if (cfg) chiefRoleIds = parseJsonField(cfg.chief_role_ids);
    } catch { }
  }

  if (!chiefRoleIds.length && client.config?.chiefSupportRoleId) {
    chiefRoleIds.push(client.config.chiefSupportRoleId);
  }

  return chiefRoleIds.some(id => member.roles.cache.has(id));
}

async function ensureSupport(interaction, client, db) {
  const allowed = await isSupportMember(client, interaction.guild, interaction.user.id, db);
  if (!allowed) {
    await interaction.reply({ content: '❌ Permission refusée.', ephemeral: true }).catch(() => null);
    return false;
  }
  return true;
}

async function ensureChiefSupport(interaction, client, db) {
  const allowed = await isChiefSupportMember(client, interaction.guild, interaction.user.id, db);
  if (!allowed) {
    await interaction.reply({ content: '❌ Cette commande est réservée au chef support.', ephemeral: true }).catch(() => null);
    return false;
  }
  return true;
}

module.exports = { isSupportMember, isChiefSupportMember, ensureSupport, ensureChiefSupport };

async function getMember(guild, userId) {
  return guild.members.fetch(userId).catch(() => null);
}

async function isSupportMember(client, guild, userId) {
  const member = await getMember(guild, userId);
  if (!member) return false;

  return member.roles.cache.has(client.config.supportRoleId)
    || member.roles.cache.has(client.config.chiefSupportRoleId);
}

async function isChiefSupportMember(client, guild, userId) {
  const member = await getMember(guild, userId);
  if (!member) return false;

  return member.roles.cache.has(client.config.chiefSupportRoleId);
}

async function ensureSupport(interaction, client) {
  const allowed = await isSupportMember(client, interaction.guild, interaction.user.id);

  if (!allowed) {
    await interaction.reply({
      content: '❌ Permission refusée.',
      ephemeral: true
    }).catch(() => null);
    return false;
  }

  return true;
}

async function ensureChiefSupport(interaction, client) {
  const allowed = await isChiefSupportMember(client, interaction.guild, interaction.user.id);

  if (!allowed) {
    await interaction.reply({
      content: '❌ Cette commande est réservée au chef support.',
      ephemeral: true
    }).catch(() => null);
    return false;
  }

  return true;
}

module.exports = {
  isSupportMember,
  isChiefSupportMember,
  ensureSupport,
  ensureChiefSupport
};

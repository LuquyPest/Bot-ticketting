const { MessageFlags } = require('discord.js');
async function getMember(guild, userId) {
  return guild.members.fetch(userId).catch(() => null);
}

const { parseJsonField } = require('./jsonField');

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

  return chiefRoleIds.some(id => member.roles.cache.has(id));
}

const PERMISSION_LABELS = {
  view_tickets: 'Voir les tickets',
  reply_ticket: 'Répondre aux tickets',
  claim_ticket: 'Prendre en charge',
  close_ticket: 'Fermer / rouvrir',
  manage_participants: 'Gérer les participants',
  view_transcripts: 'Consulter les transcripts',
};

const deny = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null).then(() => false);

// Staff check for Discord commands and buttons, with the same rules as the dashboard:
// the account (synced from the Discord staff roles) must be support or fondateur, and a support
// needs the grade `permission`. Inside a ticket channel, the ticket's grade restriction applies too.
async function ensureSupport(interaction, client, db, permission = 'view_tickets') {
  const { syncDiscordStaff } = require('./staffSync');
  const { getUserPermissions, discordStaffCanSee } = require('./gradePermissions');
  const role = await syncDiscordStaff(client, db, interaction.guildId, interaction.user).catch(() => null);
  if (role !== 'support' && role !== 'fondateur') return deny(interaction, '❌ Permission refusée.');

  if (role === 'support') {
    const perms = await getUserPermissions(interaction.user.id, db);
    if (!perms.has(permission)) {
      return deny(interaction, `❌ Ton grade ne donne pas la permission « ${PERMISSION_LABELS[permission] || permission} ».`);
    }
  }
  if (interaction.channelId) {
    const [ticket] = await db("SELECT visibility_grade_id FROM tickets WHERE channel_id = ? AND status = 'open' LIMIT 1", [interaction.channelId]);
    if (ticket && !(await discordStaffCanSee(db, interaction.user.id, ticket.visibility_grade_id))) {
      return deny(interaction, '❌ Ce ticket est réservé à certains grades.');
    }
  }
  return true;
}

async function ensureChiefSupport(interaction, client, db) {
  const allowed = await isChiefSupportMember(client, interaction.guild, interaction.user.id, db);
  if (!allowed) {
    await interaction.reply({ content: '❌ Cette commande est réservée au chef support.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return false;
  }
  return true;
}

module.exports = { ensureSupport, ensureChiefSupport };

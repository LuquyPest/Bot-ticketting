// Discord side of the grade visibility of a ticket: a restricted ticket's channel is hidden from
// the support / chief support roles and opened only to the staff members allowed to see it
// (founders + supports whose grades cover the restriction). Unrestricted: the roles see it again.
// Editing channel overwrites needs the "Manage Roles" (Gérer les permissions) permission.
const { PermissionsBitField, OverwriteType } = require('discord.js');
const { parseJsonField } = require('./jsonField');
const { canUserSeeTicket } = require('./gradePermissions');
const logger = require('./logger');

const F = PermissionsBitField.Flags;
const STAFF_ALLOW = [F.ViewChannel, F.SendMessages, F.ReadMessageHistory, F.AttachFiles];
const MISSING_PERMISSIONS = 50013;

// Applies the ticket's visibility to its channel.
// Returns { ok: true } or { ok: false, reason: 'missing_permissions' | 'no_channel' | 'error' }.
async function syncTicketChannel(db, client, guildId, ticket) {
  if (!client || !ticket?.channel_id) return { ok: false, reason: 'no_channel' };
  const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
  if (!channel?.permissionOverwrites) return { ok: false, reason: 'no_channel' };

  const [cfg] = await db('SELECT support_role_ids, chief_role_ids FROM guild_config LIMIT 1');
  const roleIds = [...new Set([...parseJsonField(cfg?.support_role_ids), ...parseJsonField(cfg?.chief_role_ids)])];
  const staff = await db("SELECT user_id FROM dashboard_users WHERE role IN ('support', 'fondateur')");
  const staffIds = new Set(staff.map(s => s.user_id));
  const restricted = !!ticket.visibility_grade_id;

  // Overwrites managed here are rebuilt; any other one (e.g. added by hand on Discord) is kept
  const managed = new Set([guildId, client.user.id, ...roleIds, ...staffIds]);
  const overwrites = [...channel.permissionOverwrites.cache.values()]
    .filter(o => !managed.has(o.id))
    .map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield }));

  overwrites.push(
    { id: guildId, type: OverwriteType.Role, deny: [F.ViewChannel] },
    { id: client.user.id, type: OverwriteType.Member, allow: [...STAFF_ALLOW, F.ManageChannels, F.ManageRoles] },
  );
  for (const roleId of roleIds) {
    overwrites.push(restricted
      ? { id: roleId, type: OverwriteType.Role, deny: [F.ViewChannel] }
      : { id: roleId, type: OverwriteType.Role, allow: STAFF_ALLOW });
  }
  if (restricted) {
    for (const userId of staffIds) {
      if (await canUserSeeTicket(db, userId, ticket.visibility_grade_id).catch(() => false)) {
        overwrites.push({ id: userId, type: OverwriteType.Member, allow: STAFF_ALLOW });
      }
    }
  }

  try {
    await channel.permissionOverwrites.set(overwrites, `Visibilité du ticket #${ticket.id}`);
    return { ok: true };
  } catch (err) {
    if (err.code === MISSING_PERMISSIONS) {
      logger.warn('Visibilité du salon non appliquée : permission « Gérer les rôles » manquante', { guildId, ticketId: ticket.id });
      return { ok: false, reason: 'missing_permissions' };
    }
    logger.error('Visibilité du salon', { guildId, ticketId: ticket.id, err: err.message });
    return { ok: false, reason: 'error' };
  }
}

// Grades, roles or accounts changed: who may see each restricted ticket may have changed too.
async function resyncRestrictedTickets(db, client, guildId) {
  if (!client) return;
  const tickets = await db("SELECT id, channel_id, visibility_grade_id FROM tickets WHERE status = 'open' AND visibility_grade_id IS NOT NULL");
  for (const t of tickets) await syncTicketChannel(db, client, guildId, t);
}

// Fire-and-forget variant for request handlers.
function scheduleResync(db, client, guildId) {
  resyncRestrictedTickets(db, client, guildId).catch(err => logger.error('Resynchronisation de la visibilité', { guildId, err: err.message }));
}

module.exports = { syncTicketChannel, resyncRestrictedTickets, scheduleResync };

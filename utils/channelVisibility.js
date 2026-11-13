// Discord side of the grade visibility of a ticket: a restricted ticket's channel is hidden from
// the support / chief support roles and opened only to the staff members allowed to see it
// (founders + supports whose grades cover the restriction). Unrestricted: the roles see it again.
// Editing channel overwrites needs the "Manage Roles" (Gérer les permissions) permission.
const { PermissionsBitField, OverwriteType } = require('discord.js');
const { parseJsonField } = require('./jsonField');
const { canUserSeeTicket, ticketRoleIds } = require('./gradePermissions');
const logger = require('./logger');

const F = PermissionsBitField.Flags;
const STAFF_ALLOW = [F.ViewChannel, F.SendMessages, F.ReadMessageHistory, F.AttachFiles];
const MISSING_PERMISSIONS = 50013;

// Staff who may see a ticket on Discord: the support / chief roles when it is unrestricted,
// otherwise only the dashboard staff members whose grades allow it.
// Returns { roleIds, userIds, managedUserIds } (managed = every dashboard staff member).
async function staffAccess(db, ticket) {
  const [cfg] = await db('SELECT support_role_ids, chief_role_ids FROM guild_config LIMIT 1');
  const roleIds = [...new Set([...parseJsonField(cfg?.support_role_ids), ...parseJsonField(cfg?.chief_role_ids)])];
  const staff = await db("SELECT user_id FROM dashboard_users WHERE role IN ('support', 'fondateur')");
  const userIds = [];
  for (const { user_id } of staff) {
    if (await canUserSeeTicket(db, user_id, ticket).catch(() => false)) userIds.push(user_id);
  }
  return { roleIds, userIds, managedUserIds: staff.map(s => s.user_id) };
}

// Members of the roles, from a full member list fetched once per process and guild (the cache
// is then kept up to date by the GuildMembers intent).
const fetchedGuilds = new Set();
async function roleMemberIds(guild, roleIds) {
  if (!roleIds.length) return [];
  if (!fetchedGuilds.has(guild.id)) {
    await guild.members.fetch().then(() => fetchedGuilds.add(guild.id)).catch(() => null);
  }
  const ids = new Set();
  for (const roleId of roleIds) guild.roles.cache.get(roleId)?.members.forEach(m => { if (!m.user.bot) ids.add(m.id); });
  return [...ids];
}

// Private thread: staff members cannot be given access by role, they are added one by one.
// Unrestricted: support / chief role members and dashboard staff; restricted: only the allowed
// dashboard staff. Staff members who may no longer see it are removed; others are left alone.
// Restricted: to a grade, or by a tag attached to a staff role
async function isRestricted(db, ticket) {
  return !!ticket.visibility_grade_id || (await ticketRoleIds(db, ticket.id)).length > 0;
}

async function syncTicketThread(db, client, thread, ticket) {
  const restricted = await isRestricted(db, ticket);
  const { roleIds, userIds, managedUserIds } = await staffAccess(db, ticket);
  const roleMembers = await roleMemberIds(thread.guild, roleIds);
  const allowed = new Set(restricted ? userIds : [...userIds, ...roleMembers]);
  const managed = new Set([...managedUserIds, ...roleMembers]);
  try {
    const current = await thread.members.fetch();
    for (const id of allowed) if (!current.has(id)) await thread.members.add(id).catch(() => null);
    for (const id of current.keys()) {
      if (id !== client.user.id && managed.has(id) && !allowed.has(id)) await thread.members.remove(id).catch(() => null);
    }
    return { ok: true };
  } catch (err) {
    if (err.code === MISSING_PERMISSIONS) return { ok: false, reason: 'missing_permissions' };
    logger.error('Membres du fil de ticket', { guildId: thread.guild.id, ticketId: ticket.id, err: err.message });
    return { ok: false, reason: 'error' };
  }
}

// Applies the ticket's visibility to its channel.
// Returns { ok: true } or { ok: false, reason: 'missing_permissions' | 'no_channel' | 'error' }.
async function syncTicketChannel(db, client, guildId, ticket) {
  if (!client || !ticket?.channel_id) return { ok: false, reason: 'no_channel' };
  const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
  if (channel?.isThread()) return syncTicketThread(db, client, channel, ticket);
  if (!channel?.permissionOverwrites) return { ok: false, reason: 'no_channel' };

  const [cfg] = await db('SELECT support_role_ids, chief_role_ids FROM guild_config LIMIT 1');
  const roleIds = [...new Set([...parseJsonField(cfg?.support_role_ids), ...parseJsonField(cfg?.chief_role_ids)])];
  const staff = await db("SELECT user_id FROM dashboard_users WHERE role IN ('support', 'fondateur')");
  const staffIds = new Set(staff.map(s => s.user_id));
  const restricted = await isRestricted(db, ticket);

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
      if (await canUserSeeTicket(db, userId, ticket).catch(() => false)) {
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
  const [cfg] = await db('SELECT ticket_mode FROM guild_config LIMIT 1');
  // Threads: staff are members of every ticket, so every open ticket is resynced
  const restricted = ` AND (visibility_grade_id IS NOT NULL OR EXISTS (SELECT 1 FROM ticket_tag_assignments ta JOIN access_role_tags srt ON srt.tag_id = ta.tag_id WHERE ta.ticket_id = tickets.id))`;
  const tickets = await db(`SELECT id, channel_id, visibility_grade_id FROM tickets WHERE status = 'open'${cfg?.ticket_mode === 'thread' ? '' : restricted}`);
  for (const t of tickets) await syncTicketChannel(db, client, guildId, t);
}

// Fire-and-forget variant for request handlers.
function scheduleResync(db, client, guildId) {
  resyncRestrictedTickets(db, client, guildId).catch(err => logger.error('Resynchronisation de la visibilité', { guildId, err: err.message }));
}

// A tag was added to or removed from a ticket: its visibility changes when the tag belongs to a staff role
async function syncAfterTagChange(db, client, guildId, ticketId, tagId) {
  if (!client) return;
  const [linked] = await db('SELECT 1 FROM access_role_tags WHERE tag_id = ? LIMIT 1', [tagId]);
  if (!linked) return;
  const [ticket] = await db("SELECT id, channel_id, visibility_grade_id FROM tickets WHERE id = ? AND status = 'open'", [ticketId]);
  if (ticket) await syncTicketChannel(db, client, guildId, ticket);
}

// Open tickets carrying one of the tags: resynced after a role's tags changed (a ticket may become
// unrestricted, which resyncRestrictedTickets would no longer pick up)
function scheduleTagsResync(db, client, guildId, tagIds) {
  if (!client || !tagIds.length) return;
  (async () => {
    const tickets = await db(
      "SELECT DISTINCT t.id, t.channel_id, t.visibility_grade_id FROM tickets t JOIN ticket_tag_assignments ta ON ta.ticket_id = t.id WHERE t.status = 'open' AND ta.tag_id IN (?)",
      [tagIds]
    );
    for (const t of tickets) await syncTicketChannel(db, client, guildId, t);
  })().catch(err => logger.error('Resynchronisation de la visibilité', { guildId, err: err.message }));
}

module.exports = { syncTicketChannel, scheduleResync, scheduleTagsResync, syncAfterTagChange, staffAccess, isRestricted };

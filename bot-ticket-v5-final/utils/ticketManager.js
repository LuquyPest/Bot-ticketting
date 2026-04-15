const { ChannelType, PermissionsBitField } = require('discord.js');
const { query } = require('./db');
const { ticketCreatedEmbed, userMessageEmbed } = require('./embeds');
const { ticketButtons } = require('./components');
const { buildTranscripts } = require('./transcript');

function sanitizeChannelName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'ticket';
}

async function getOpenTicketByChannelId(channelId) {
  const rows = await query(
    `SELECT * FROM tickets WHERE channel_id = ? AND status = 'open' LIMIT 1`,
    [channelId]
  );
  return rows[0] || null;
}

async function getTicketByChannelId(channelId) {
  const rows = await query(
    `SELECT * FROM tickets WHERE channel_id = ? LIMIT 1`,
    [channelId]
  );
  return rows[0] || null;
}

async function getOpenTicketByOwnerId(ownerId) {
  const rows = await query(
    `SELECT * FROM tickets WHERE owner_id = ? AND status = 'open' LIMIT 1`,
    [ownerId]
  );
  return rows[0] || null;
}

async function createTicketDb(channelId, owner) {
  const result = await query(
    `INSERT INTO tickets (channel_id, owner_id, owner_tag, status)
     VALUES (?, ?, ?, 'open')`,
    [channelId, owner.id, owner.tag]
  );

  return {
    id: result.insertId,
    channel_id: channelId,
    owner_id: owner.id,
    owner_tag: owner.tag,
    claimed_by: null,
    status: 'open'
  };
}

async function createTicketChannel(client, user) {
  const guild = await client.guilds.fetch(client.config.guildId);

  return guild.channels.create({
    name: `${client.config.ticketPrefix}-${sanitizeChannelName(user.username)}`,
    type: ChannelType.GuildText,
    parent: client.config.ticketCategoryId,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: client.config.supportRoleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles
        ]
      },
      {
        id: client.config.chiefSupportRoleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles
        ]
      },
      {
        id: client.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.AttachFiles
        ]
      }
    ]
  });
}

async function createTicket(client, user, firstMessage, attachments = []) {
  const existing = await getOpenTicketByOwnerId(user.id);

  if (existing) {
    const existingChannel = await client.channels.fetch(existing.channel_id).catch(() => null);
    if (existingChannel) {
      return { channel: existingChannel, ticket: existing, created: false };
    }
  }

  const channel = await createTicketChannel(client, user);
  const ticket = await createTicketDb(channel.id, user);

  await channel.send({
    embeds: [ticketCreatedEmbed(user, firstMessage)],
    components: [ticketButtons()]
  });

  if (firstMessage || attachments.length > 0) {
    await channel.send({
      embeds: [userMessageEmbed(user, firstMessage, attachments)]
    });
  }

  return { channel, ticket, created: true };
}

async function relayDmToTicket(client, user, content, attachments = []) {
  const existing = await getOpenTicketByOwnerId(user.id);

  if (!existing) {
    return createTicket(client, user, content, attachments);
  }

  let channel = await client.channels.fetch(existing.channel_id).catch(() => null);

  if (!channel) {
    await query(
      `UPDATE tickets
       SET status = 'closed', closed_at = NOW(), closed_by_tag = 'Système'
       WHERE id = ?`,
      [existing.id]
    );

    return createTicket(client, user, content, attachments);
  }

  await channel.send({
    embeds: [userMessageEmbed(user, content, attachments)]
  });

  return { channel, ticket: existing, created: false };
}

async function sendWelcomeDm(client, user, created) {
  const message = created
    ? client.config.dmWelcomeMessage || 'Bonjour, ton ticket a bien été créé.'
    : '📨 Ton message a été transmis au staff.';

  await user.send(message).catch(() => null);
}

async function sendLogMessage(client, channelId, content) {
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  await channel.send(content).catch(() => null);
}

async function incrementAdminClaim(adminId, adminTag) {
  await query(
    `INSERT INTO admin_stats (admin_id, admin_tag, tickets_claimed, tickets_closed)
     VALUES (?, ?, 1, 0)
     ON DUPLICATE KEY UPDATE
       admin_tag = VALUES(admin_tag),
       tickets_claimed = tickets_claimed + 1`,
    [adminId, adminTag]
  );
}

async function incrementAdminClose(adminId, adminTag) {
  await query(
    `INSERT INTO admin_stats (admin_id, admin_tag, tickets_claimed, tickets_closed)
     VALUES (?, ?, 0, 1)
     ON DUPLICATE KEY UPDATE
       admin_tag = VALUES(admin_tag),
       tickets_closed = tickets_closed + 1`,
    [adminId, adminTag]
  );
}

async function getAdminStats() {
  return query(
    `SELECT admin_id, admin_tag, tickets_claimed, tickets_closed, updated_at
     FROM admin_stats
     ORDER BY tickets_closed DESC, tickets_claimed DESC, admin_tag ASC`
  );
}

async function saveTranscriptSnapshot(channel, createdByUser, ticketOverride = null) {
  const ticket = ticketOverride || await getTicketByChannelId(channel.id);
  if (!ticket) return null;

  const ticketInfo = {
    ticketId: ticket.id,
    ownerTag: ticket.owner_tag,
    createdAt: ticket.created_at ? new Date(ticket.created_at).toLocaleString('fr-FR') : '—',
    closedAt: ticket.closed_at ? new Date(ticket.closed_at).toLocaleString('fr-FR') : 'Non fermé',
    closedByTag: ticket.closed_by_tag || 'Pas encore fermé'
  };

  const { html, txt, messageCount } = await buildTranscripts(channel, ticketInfo);

  const result = await query(
    `INSERT INTO transcript_snapshots
      (ticket_id, channel_id, created_by_id, created_by_tag, message_count, html, txt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      ticket.id,
      channel.id,
      createdByUser.id,
      createdByUser.tag,
      messageCount,
      html,
      txt
    ]
  );

  return {
    transcriptId: result.insertId,
    ticketId: ticket.id,
    html,
    txt,
    messageCount
  };
}

async function closeTicketWithTranscript(client, channel, closedByUser) {
  const ticket = await getOpenTicketByChannelId(channel.id);
  if (!ticket) return null;

  await query(
    `UPDATE tickets
     SET status = 'closed',
         closed_at = NOW(),
         closed_by_tag = ?
     WHERE id = ?`,
    [closedByUser.tag, ticket.id]
  );

  await incrementAdminClose(closedByUser.id, closedByUser.tag);

  await sendLogMessage(
    client,
    client.config.closeLogChannelId,
    `🔒 Ticket #${ticket.id} fermé par **${closedByUser.tag}** (${closedByUser.id})`
  );

  const updatedTicket = await getTicketByChannelId(channel.id);
  const transcript = await saveTranscriptSnapshot(channel, closedByUser, updatedTicket);

  const owner = await client.users.fetch(ticket.owner_id).catch(() => null);
  if (owner) {
    await owner.send('🔒 Ton ticket a été fermé par le staff.').catch(() => null);
  }

  await channel.delete('Ticket fermé avec transcript').catch(() => null);
  return transcript;
}

async function getTranscriptById(transcriptId) {
  const rows = await query(
    `SELECT
        ts.*,
        t.owner_id,
        t.owner_tag,
        t.status,
        t.created_at AS ticket_created_at,
        t.closed_at,
        t.closed_by_tag
     FROM transcript_snapshots ts
     INNER JOIN tickets t ON t.id = ts.ticket_id
     WHERE ts.id = ?
     LIMIT 1`,
    [transcriptId]
  );

  return rows[0] || null;
}

async function getOldTicketsByUserId(userId) {
  return query(
    `SELECT
        t.id,
        t.channel_id,
        t.owner_id,
        t.owner_tag,
        t.status,
        t.created_at,
        t.closed_at,
        t.closed_by_tag,
        COUNT(ts.id) AS transcript_count
     FROM tickets t
     LEFT JOIN transcript_snapshots ts ON ts.ticket_id = t.id
     WHERE t.owner_id = ?
     GROUP BY t.id
     ORDER BY t.created_at DESC`,
    [userId]
  );
}

async function addParticipant(ticketId, userId) {
  await query(
    `INSERT IGNORE INTO ticket_participants (ticket_id, user_id)
     VALUES (?, ?)`,
    [ticketId, userId]
  );
}

async function removeParticipant(ticketId, userId) {
  await query(
    `DELETE FROM ticket_participants
     WHERE ticket_id = ? AND user_id = ?`,
    [ticketId, userId]
  );
}

async function setClaim(client, ticketId, adminUser) {
  await query(
    `UPDATE tickets SET claimed_by = ? WHERE id = ?`,
    [adminUser ? adminUser.id : null, ticketId]
  );

  if (adminUser) {
    await incrementAdminClaim(adminUser.id, adminUser.tag);

    await sendLogMessage(
      client,
      client.config.claimLogChannelId,
      `📌 Ticket #${ticketId} claim par **${adminUser.tag}** (${adminUser.id})`
    );
  }
}

async function logMoveTicket(client, ticketId, categoryName, movedByUser) {
  await sendLogMessage(
    client,
    client.config.moveLogChannelId,
    `📂 Ticket #${ticketId} déplacé vers **${categoryName}** par **${movedByUser.tag}** (${movedByUser.id})`
  );
}

async function logAddUser(client, ticketId, targetUserId, addedByUser) {
  await sendLogMessage(
    client,
    client.config.addUserLogChannelId,
    `➕ Utilisateur **${targetUserId}** ajouté au ticket #${ticketId} par **${addedByUser.tag}** (${addedByUser.id})`
  );
}

async function logRemoveUser(client, ticketId, targetUserId, removedByUser) {
  await sendLogMessage(
    client,
    client.config.removeUserLogChannelId,
    `➖ Utilisateur **${targetUserId}** retiré du ticket #${ticketId} par **${removedByUser.tag}** (${removedByUser.id})`
  );
}

module.exports = {
  getOpenTicketByChannelId,
  getTicketByChannelId,
  relayDmToTicket,
  sendWelcomeDm,
  closeTicketWithTranscript,
  saveTranscriptSnapshot,
  getTranscriptById,
  getOldTicketsByUserId,
  addParticipant,
  removeParticipant,
  setClaim,
  getAdminStats,
  logMoveTicket,
  logAddUser,
  logRemoveUser
};

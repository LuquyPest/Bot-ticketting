const { ChannelType, PermissionsBitField } = require('discord.js');
const { query } = require('./db');
const { ticketButtons } = require('./components');
const { buildTranscripts } = require('./transcript');

async function getOpenTicketByOwnerId(userId) {
  const rows = await query(
    'SELECT * FROM tickets WHERE owner_id = ? AND status = "open" LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

async function getOpenTicketByChannelId(channelId) {
  const rows = await query(
    'SELECT * FROM tickets WHERE channel_id = ? AND status = "open" LIMIT 1',
    [channelId]
  );
  return rows[0] || null;
}

async function getTicketByChannelId(channelId) {
  const rows = await query(
    'SELECT * FROM tickets WHERE channel_id = ? LIMIT 1',
    [channelId]
  );
  return rows[0] || null;
}

async function getOpenTicketByParticipantId(userId) {
  const rows = await query(
    `SELECT t.*
     FROM ticket_participants tp
     INNER JOIN tickets t ON t.id = tp.ticket_id
     WHERE tp.user_id = ? AND t.status = "open"
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function getAnyOpenTicketForUser(userId) {
  const ownerTicket = await getOpenTicketByOwnerId(userId);
  if (ownerTicket) return ownerTicket;

  const participantTicket = await getOpenTicketByParticipantId(userId);
  if (participantTicket) return participantTicket;

  return null;
}

async function getAllLinkedUserIds(ticketId) {
  const ticketRows = await query(
    'SELECT owner_id FROM tickets WHERE id = ? LIMIT 1',
    [ticketId]
  );

  if (!ticketRows.length) return [];

  const ownerId = ticketRows[0].owner_id;

  const participantRows = await query(
    'SELECT user_id FROM ticket_participants WHERE ticket_id = ?',
    [ticketId]
  );

  const ids = [ownerId, ...participantRows.map(row => row.user_id)];
  return [...new Set(ids)];
}

async function createTicketDb(channelId, user) {
  const result = await query(
    'INSERT INTO tickets (channel_id, owner_id, owner_tag) VALUES (?, ?, ?)',
    [channelId, user.id, user.tag]
  );

  return {
    id: result.insertId,
    channel_id: channelId,
    owner_id: user.id,
    owner_tag: user.tag
  };
}

function sanitizeChannelName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 25) || 'ticket';
}

async function createTicketChannel(client, user) {
  const guild = await client.guilds.fetch(client.config.guildId);

  return guild.channels.create({
    name: `${client.config.ticketPrefix}-${sanitizeChannelName(user.username)}`,
    type: ChannelType.GuildText,
    parent: client.config.ticketCategoryId,
    permissionOverwrites: [
      {
        id: guild.id,
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
    // Canal supprimé manuellement : fermeture du ticket orphelin avant d'en créer un nouveau
    await query(
      `UPDATE tickets SET status = 'closed', closed_at = NOW(), closed_by_tag = 'system'
       WHERE id = ?`,
      [existing.id]
    );
  }

  const channel = await createTicketChannel(client, user);
  const ticket = await createTicketDb(channel.id, user);

  await channel.send({
    content: `Nouveau ticket\nUtilisateur : ${user.tag}\nID : ${user.id}`,
    components: [ticketButtons()]
  });

  if (firstMessage || attachments.length > 0) {
    let msg = `--- ${user.tag} : ${firstMessage || '[aucun texte]'}`;

    if (attachments.length > 0) {
      msg += '\n\nFichiers :\n' + attachments.map(file => file.url).join('\n');
    }

    await channel.send({ content: msg });
  }

  return { channel, ticket, created: true };
}

async function relayDmToTicket(client, user, content, attachments = []) {
  let ticket = await getOpenTicketByOwnerId(user.id);

  if (!ticket) {
    ticket = await getOpenTicketByParticipantId(user.id);
  }

  if (!ticket) {
    return createTicket(client, user, content, attachments);
  }

  const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);

  if (!channel) {
    return createTicket(client, user, content, attachments);
  }

  let msg = `--- ${user.tag} : ${content || '[aucun texte]'}`;

  if (attachments.length > 0) {
    msg += '\n\nFichiers :\n' + attachments.map(file => file.url).join('\n');
  }

  await channel.send({ content: msg });

  return { channel, ticket, created: false };
}

async function sendWelcomeDm(client, user, created) {
  if (!created) return;
  await user.send('Ton ticket a été crée, le support va te répondre.').catch(() => null);
}

async function getOldTicketsByUserId(userId) {
  return query(
    `SELECT
      t.*,
      COUNT(ts.id) AS transcript_count,
      GROUP_CONCAT(ts.id ORDER BY ts.id ASC SEPARATOR ', ') AS transcript_ids
     FROM tickets t
     LEFT JOIN transcript_snapshots ts ON ts.ticket_id = t.id
     WHERE t.owner_id = ?
     GROUP BY t.id
     ORDER BY t.created_at DESC`,
    [userId]
  );
}

async function getTranscriptById(transcriptId) {
  const rows = await query(
    'SELECT * FROM transcript_snapshots WHERE id = ? LIMIT 1',
    [transcriptId]
  );
  return rows[0] || null;
}

async function addParticipant(ticketId, userId) {
  await query(
    'INSERT IGNORE INTO ticket_participants (ticket_id, user_id) VALUES (?, ?)',
    [ticketId, userId]
  );
}

async function removeParticipant(ticketId, userId) {
  await query(
    'DELETE FROM ticket_participants WHERE ticket_id = ? AND user_id = ?',
    [ticketId, userId]
  );
}

async function setClaim(client, ticketId, adminUser) {
  await query(
    'UPDATE tickets SET claimed_by = ? WHERE id = ?',
    [adminUser ? adminUser.id : null, ticketId]
  );

  if (adminUser) {
    await query(
      `INSERT INTO admin_stats (admin_id, admin_tag, tickets_claimed, tickets_closed)
       VALUES (?, ?, 1, 0)
       ON DUPLICATE KEY UPDATE
         admin_tag = VALUES(admin_tag),
         tickets_claimed = tickets_claimed + 1`,
      [adminUser.id, adminUser.tag]
    );
  }

  if (adminUser && client.config.claimLogChannelId) {
    const logChannel = await client.channels.fetch(client.config.claimLogChannelId).catch(() => null);
    if (logChannel && logChannel.isTextBased()) {
      await logChannel.send(
        `Ticket #${ticketId} claim par ${adminUser.tag} (${adminUser.id})`
      ).catch(() => null);
    }
  }
}

async function saveTranscriptSnapshot(channel, createdByUser, ticketOverride = null) {
  const ticket = ticketOverride || await getTicketByChannelId(channel.id);
  if (!ticket) return null;

  const ticketInfo = {
    ticketId: ticket.id,
    ownerTag: ticket.owner_tag,
    createdAt: ticket.created_at
      ? new Date(ticket.created_at).toLocaleString('fr-FR')
      : '-',
    closedAt: ticket.closed_at
      ? new Date(ticket.closed_at).toLocaleString('fr-FR')
      : 'Non ferme',
    closedByTag: ticket.closed_by_tag || 'Pas encore ferme'
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

  await query(
    `INSERT INTO admin_stats (admin_id, admin_tag, tickets_claimed, tickets_closed)
     VALUES (?, ?, 0, 1)
     ON DUPLICATE KEY UPDATE
       admin_tag = VALUES(admin_tag),
       tickets_closed = tickets_closed + 1`,
    [closedByUser.id, closedByUser.tag]
  );

  const updatedTicket = await getTicketByChannelId(channel.id);
  const transcript = await saveTranscriptSnapshot(channel, closedByUser, updatedTicket);

  const linkedUserIds = await getAllLinkedUserIds(ticket.id);

  for (const userId of linkedUserIds) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
      await user.send('Ton ticket a été fermé par le staff.').catch(() => null);
    }
  }

  if (client.config.closeLogChannelId) {
    const logChannel = await client.channels.fetch(client.config.closeLogChannelId).catch(() => null);
    if (logChannel && logChannel.isTextBased()) {
      await logChannel.send(
        [
          'Ticket ferme',
          `Ticket ID : ${ticket.id}`,
          `Utilisateur : ${ticket.owner_tag}`,
          `Ferme par : ${closedByUser.tag}`,
          `Transcript ID : ${transcript?.transcriptId || 'aucun'}`
        ].join('\n')
      ).catch(() => null);
    }
  }

  await channel.delete('Ticket ferme avec transcript').catch(() => null);

  return transcript;
}

async function getAdminStats() {
  return query(
    `SELECT admin_id, admin_tag, tickets_claimed, tickets_closed, updated_at
     FROM admin_stats
     ORDER BY tickets_closed DESC, tickets_claimed DESC, admin_tag ASC`
  );
}

async function logMoveTicket(client, ticketId, categoryName, movedByUser) {
  if (!client.config.moveLogChannelId) return;

  const logChannel = await client.channels.fetch(client.config.moveLogChannelId).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) return;

  await logChannel.send(
    `Ticket #${ticketId} deplace vers ${categoryName} par ${movedByUser.tag} (${movedByUser.id})`
  ).catch(() => null);
}

async function logAddUser(client, ticketId, targetUserId, addedByUser) {
  if (!client.config.addUserLogChannelId) return;

  const logChannel = await client.channels.fetch(client.config.addUserLogChannelId).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) return;

  await logChannel.send(
    `Utilisateur ${targetUserId} ajoute comme participant DM du ticket #${ticketId} par ${addedByUser.tag} (${addedByUser.id})`
  ).catch(() => null);
}

async function logRemoveUser(client, ticketId, targetUserId, removedByUser) {
  if (!client.config.removeUserLogChannelId) return;

  const logChannel = await client.channels.fetch(client.config.removeUserLogChannelId).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) return;

  await logChannel.send(
    `Utilisateur ${targetUserId} retire comme participant DM du ticket #${ticketId} par ${removedByUser.tag} (${removedByUser.id})`
  ).catch(() => null);
}

module.exports = {
  relayDmToTicket,
  sendWelcomeDm,
  getOpenTicketByChannelId,
  getOpenTicketByOwnerId,
  getOpenTicketByParticipantId,
  getAnyOpenTicketForUser,
  getAllLinkedUserIds,
  getTicketByChannelId,
  getOldTicketsByUserId,
  getTranscriptById,
  createTicket,
  addParticipant,
  removeParticipant,
  setClaim,
  saveTranscriptSnapshot,
  closeTicketWithTranscript,
  getAdminStats,
  logMoveTicket,
  logAddUser,
  logRemoveUser
};
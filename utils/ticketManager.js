const { ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');
const { ticketButtons } = require('./components');
const { buildTranscripts } = require('./transcript');
const { sanitizeChannelName } = require('./sanitize');
const { broadcast } = require('./sse');

// Returns the guild_config row from the per-guild DB (or defaults).
async function getGuildConfig(db) {
  const rows = await db('SELECT * FROM guild_config LIMIT 1');
  return rows[0] || {};
}

// Factory — returns all ticket operations bound to a specific guild's DB.
// guildId is used for guild-scoped SSE broadcasts.
function createManager(db, client, guildId) {
  const gid = guildId || null;

  async function getOpenTicketByOwnerId(userId) {
    const rows = await db(
      'SELECT * FROM tickets WHERE owner_id = ? AND status = "open" LIMIT 1',
      [userId]
    );
    return rows[0] || null;
  }

  async function getOpenTicketByChannelId(channelId) {
    const rows = await db(
      'SELECT * FROM tickets WHERE channel_id = ? AND status = "open" LIMIT 1',
      [channelId]
    );
    return rows[0] || null;
  }

  async function getTicketByChannelId(channelId) {
    const rows = await db(
      'SELECT * FROM tickets WHERE channel_id = ? LIMIT 1',
      [channelId]
    );
    return rows[0] || null;
  }

  async function getOpenTicketByParticipantId(userId) {
    const rows = await db(
      `SELECT t.* FROM ticket_participants tp
       INNER JOIN tickets t ON t.id = tp.ticket_id
       WHERE tp.user_id = ? AND t.status = "open" LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  }

  async function getAnyOpenTicketForUser(userId) {
    return (await getOpenTicketByOwnerId(userId)) || (await getOpenTicketByParticipantId(userId));
  }

  async function getAllLinkedUserIds(ticketId) {
    const [ticket] = await db('SELECT owner_id FROM tickets WHERE id = ? LIMIT 1', [ticketId]);
    if (!ticket) return [];
    const participants = await db('SELECT user_id FROM ticket_participants WHERE ticket_id = ?', [ticketId]);
    const ids = [ticket.owner_id, ...participants.map(r => r.user_id)];
    return [...new Set(ids)];
  }

  async function createTicketDb(channelId, user, subject = null) {
    const result = await db(
      'INSERT INTO tickets (channel_id, owner_id, owner_tag, subject, last_message_at) VALUES (?, ?, ?, ?, NOW())',
      [channelId, user.id, user.tag, subject]
    );
    return { id: result.insertId, channel_id: channelId, owner_id: user.id, owner_tag: user.tag, subject };
  }

  async function createTicketChannel(user) {
    const cfg = await getGuildConfig(db);
    const guild = await client.guilds.fetch(gid).catch(() => null);
    if (!guild) throw new Error('Guild introuvable');

    const supportRoleIds = cfg.support_role_ids ? JSON.parse(cfg.support_role_ids) : [];
    const chiefRoleIds   = cfg.chief_role_ids   ? JSON.parse(cfg.chief_role_ids) : [];
    const allRoleIds     = [...new Set([...supportRoleIds, ...chiefRoleIds])];

    const permOverwrites = [
      { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.AttachFiles] }
    ];
    for (const roleId of allRoleIds) {
      permOverwrites.push({
        id: roleId,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles]
      });
    }

    const prefix = cfg.ticket_prefix || 'ticket';
    return guild.channels.create({
      name: `${prefix}-${sanitizeChannelName(user.username, 25) || 'ticket'}`,
      type: ChannelType.GuildText,
      parent: cfg.ticket_category_id || undefined,
      permissionOverwrites: permOverwrites
    });
  }

  const _creating = new Set();

  async function createTicket(user, firstMessage, attachments = [], subject = null) {
    if (_creating.has(user.id)) {
      const existing = await getOpenTicketByOwnerId(user.id);
      if (existing) {
        const ch = await client.channels.fetch(existing.channel_id).catch(() => null);
        if (ch) return { channel: ch, ticket: existing, created: false };
      }
    }
    _creating.add(user.id);
    try {
      const existing = await getOpenTicketByOwnerId(user.id);
      if (existing) {
        const ch = await client.channels.fetch(existing.channel_id).catch(() => null);
        if (ch) return { channel: ch, ticket: existing, created: false };
        await db(`UPDATE tickets SET status='closed', closed_at=NOW(), closed_by_tag='system' WHERE id=?`, [existing.id]);
      }

      const channel = await createTicketChannel(user);
      const ticket = await createTicketDb(channel.id, user, subject);

      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle(`🎫 Ticket #${ticket.id}`)
        .setDescription('Un ticket a été ouvert. Le staff va vous répondre bientôt.')
        .addFields({ name: 'Utilisateur', value: `<@${user.id}> (${user.tag})`, inline: true }, { name: 'Priorité', value: '🔵 Normal', inline: true })
        .setTimestamp();
      if (ticket.subject) embed.addFields({ name: 'Sujet', value: ticket.subject });

      await channel.send({ embeds: [embed], components: [ticketButtons()] });
      const topicSub = ticket.subject ? ` · ${ticket.subject.slice(0, 40)}` : '';
      await channel.setTopic(`#${ticket.id} · ${user.tag} · 🔵 Normal · Libre${topicSub}`).catch(() => null);

      if (firstMessage || attachments.length) {
        let msg = `--- ${user.tag} : ${firstMessage || '[aucun texte]'}`;
        if (attachments.length) msg += '\n\nFichiers :\n' + attachments.map(f => f.url).join('\n');
        await channel.send({ content: msg });
        const noteContent = [firstMessage, ...attachments.map(a => a.url)].filter(Boolean).join('\n');
        const nr = await db(
          'INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, "user")',
          [ticket.id, user.id, user.tag, noteContent]
        );
        broadcast('note', { ticketId: ticket.id, note: { id: nr.insertId, ticket_id: ticket.id, author_id: user.id, author_tag: user.tag, content: noteContent, source: 'user', created_at: new Date() } }, gid);
      }
      return { channel, ticket, created: true };
    } finally {
      _creating.delete(user.id);
    }
  }

  async function relayDmToTicket(user, content, attachments = [], subject = null) {
    let ticket = await getOpenTicketByOwnerId(user.id) || await getOpenTicketByParticipantId(user.id);
    if (!ticket) return createTicket(user, content, attachments, subject);

    const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
    if (!channel) return createTicket(user, content, attachments, subject);

    let msg = `--- ${user.tag} : ${content || '[aucun texte]'}`;
    if (attachments.length) msg += '\n\nFichiers :\n' + attachments.map(f => f.url).join('\n');
    await channel.send({ content: msg });
    await db('UPDATE tickets SET last_message_at = NOW(), user_warned_inactive = 0 WHERE id = ?', [ticket.id]);

    const noteContent = [content, ...attachments.map(a => a.url)].filter(Boolean).join('\n');
    const nr = await db(
      'INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, "user")',
      [ticket.id, user.id, user.tag, noteContent]
    );
    broadcast('note', { ticketId: ticket.id, note: { id: nr.insertId, ticket_id: ticket.id, author_id: user.id, author_tag: user.tag, content: noteContent, source: 'user', created_at: new Date() } }, gid);
    return { channel, ticket, created: false };
  }

  async function sendWelcomeDm(user, created) {
    if (!created) return;
    const cfg = await getGuildConfig(db);
    const msg = cfg.welcome_message || 'Ton ticket a été créé. Le support va te répondre bientôt.';
    await user.send(msg).catch(() => null);
  }

  async function saveTranscriptSnapshot(channel, createdByUser, ticketOverride = null) {
    const ticket = ticketOverride || await getTicketByChannelId(channel.id);
    if (!ticket) return null;
    const ticketInfo = {
      ticketId: ticket.id,
      ownerTag: ticket.owner_tag,
      createdAt: ticket.created_at ? new Date(ticket.created_at).toLocaleString('fr-FR') : '-',
      closedAt: ticket.closed_at ? new Date(ticket.closed_at).toLocaleString('fr-FR') : 'Non fermé',
      closedByTag: ticket.closed_by_tag || 'Non fermé'
    };
    const { html, txt, messageCount } = await buildTranscripts(channel, ticketInfo);
    const result = await db(
      'INSERT INTO transcript_snapshots (ticket_id, channel_id, created_by_id, created_by_tag, message_count, html, txt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [ticket.id, channel.id, createdByUser.id, createdByUser.tag, messageCount, html, txt]
    );
    return { transcriptId: result.insertId, ticketId: ticket.id, html, txt, messageCount };
  }

  async function closeTicketWithTranscript(channel, closedByUser) {
    const ticket = await getOpenTicketByChannelId(channel.id);
    if (!ticket) return null;

    await db(
      `UPDATE tickets SET status='closed', closed_at=NOW(), closed_by_tag=? WHERE id=?`,
      [closedByUser.tag, ticket.id]
    );
    await db(
      `INSERT INTO admin_stats (admin_id, admin_tag, tickets_claimed, tickets_closed) VALUES (?, ?, 0, 1)
       ON DUPLICATE KEY UPDATE admin_tag=VALUES(admin_tag), tickets_closed=tickets_closed+1`,
      [closedByUser.id, closedByUser.tag]
    );

    const updatedTicket = await getTicketByChannelId(channel.id);
    const transcript = await saveTranscriptSnapshot(channel, closedByUser, updatedTicket);
    const cfg = await getGuildConfig(db);

    const linkedIds = await getAllLinkedUserIds(ticket.id);
    for (const uid of linkedIds) {
      const u = await client.users.fetch(uid).catch(() => null);
      if (u) await u.send('Ton ticket a été fermé par le staff.').catch(() => null);
    }

    const owner = await client.users.fetch(ticket.owner_id).catch(() => null);
    if (owner) {
      const { ratingButtons } = require('./components');
      await owner.send({ content: 'Comment évalues-tu la qualité du support sur ce ticket ?', components: [ratingButtons(ticket.id)] }).catch(() => null);
    }

    if (cfg.close_log_channel_id) {
      const logCh = await client.channels.fetch(cfg.close_log_channel_id).catch(() => null);
      if (logCh?.isTextBased()) {
        await logCh.send([
          'Ticket fermé', `ID : ${ticket.id}`, `Utilisateur : ${ticket.owner_tag}`,
          `Fermé par : ${closedByUser.tag}`, `Transcript : ${transcript?.transcriptId || 'aucun'}`
        ].join('\n')).catch(() => null);
      }
    }
    await channel.delete('Ticket fermé avec transcript').catch(() => null);

    // Check badge unlocks for the staff member who closed the ticket
    if (ticket.claimed_by) {
      try {
        const { checkAndAwardBadges } = require('../web/routes/badges');
        await checkAndAwardBadges(db, ticket.claimed_by, closedByUser.tag);
      } catch {}
    }

    return transcript;
  }

  async function reopenTicket(ticket, reopenedByUser) {
    const channel = await createTicketChannel({ id: ticket.owner_id, username: ticket.owner_tag, tag: ticket.owner_tag });
    await db(
      `UPDATE tickets SET status='open', channel_id=?, closed_at=NULL, closed_by_tag=NULL, warned_inactive=0, last_message_at=NOW() WHERE id=?`,
      [channel.id, ticket.id]
    );
    const embed = new EmbedBuilder()
      .setColor(0x10b981).setTitle(`🔄 Ticket #${ticket.id} — Réouvert`)
      .addFields({ name: 'Utilisateur', value: `<@${ticket.owner_id}> (${ticket.owner_tag})`, inline: true }, { name: 'Priorité', value: '🔵 Normal', inline: true })
      .setTimestamp();
    if (ticket.subject) embed.addFields({ name: 'Sujet', value: ticket.subject });
    await channel.send({ embeds: [embed], components: [ticketButtons()] });
    const topicSub = ticket.subject ? ` · ${ticket.subject.slice(0, 40)}` : '';
    await channel.setTopic(`#${ticket.id} · ${ticket.owner_tag} · 🔵 Normal · Libre${topicSub}`).catch(() => null);
    const owner = await client.users.fetch(ticket.owner_id).catch(() => null);
    if (owner) await owner.send('Ton ticket a été réouvert. Tu peux continuer à répondre en DM.').catch(() => null);
    return channel;
  }

  async function setClaim(ticketId, adminUser) {
    await db('UPDATE tickets SET claimed_by=? WHERE id=?', [adminUser ? adminUser.id : null, ticketId]);
    if (adminUser) {
      await db(
        `INSERT INTO admin_stats (admin_id, admin_tag, tickets_claimed, tickets_closed) VALUES (?, ?, 1, 0)
         ON DUPLICATE KEY UPDATE admin_tag=VALUES(admin_tag), tickets_claimed=tickets_claimed+1`,
        [adminUser.id, adminUser.tag]
      );
    }
    const cfg = await getGuildConfig(db);
    if (adminUser && cfg.claim_log_channel_id) {
      const logCh = await client.channels.fetch(cfg.claim_log_channel_id).catch(() => null);
      if (logCh?.isTextBased()) {
        await logCh.send(`Ticket #${ticketId} claim par ${adminUser.tag} (${adminUser.id})`).catch(() => null);
      }
    }
  }

  async function addParticipant(ticketId, userId) {
    await db('INSERT IGNORE INTO ticket_participants (ticket_id, user_id) VALUES (?, ?)', [ticketId, userId]);
  }

  async function removeParticipant(ticketId, userId) {
    await db('DELETE FROM ticket_participants WHERE ticket_id=? AND user_id=?', [ticketId, userId]);
  }

  async function updateLastMessage(ticketId) {
    await db('UPDATE tickets SET last_message_at=NOW(), warned_inactive=0, staff_reminder_sent_at=NULL WHERE id=?', [ticketId]);
  }

  async function recordStaffResponse(ticketId, staffUser) {
    const [row] = await db('SELECT created_at, first_response_at FROM tickets WHERE id=? LIMIT 1', [ticketId]);
    if (!row || row.first_response_at) return;
    const responseSeconds = Math.floor((Date.now() - new Date(row.created_at).getTime()) / 1000);
    await db('UPDATE tickets SET first_response_at=NOW() WHERE id=?', [ticketId]);
    await db(
      `INSERT INTO admin_stats (admin_id, admin_tag, tickets_claimed, tickets_closed, total_response_count, total_response_seconds)
       VALUES (?, ?, 0, 0, 1, ?)
       ON DUPLICATE KEY UPDATE admin_tag=VALUES(admin_tag), total_response_count=total_response_count+1, total_response_seconds=total_response_seconds+VALUES(total_response_seconds)`,
      [staffUser.id, staffUser.tag, responseSeconds]
    );
  }

  async function saveRating(ticketId, ownerId, closedById, rating, closedByTag) {
    await db('INSERT INTO ticket_ratings (ticket_id, owner_id, closed_by_id, rating) VALUES (?, ?, ?, ?)', [ticketId, ownerId, closedById, rating]);
    await db(
      `INSERT INTO admin_stats (admin_id, admin_tag, tickets_claimed, tickets_closed, total_ratings, total_rating_score)
       VALUES (?, ?, 0, 0, 1, ?)
       ON DUPLICATE KEY UPDATE admin_tag=VALUES(admin_tag), total_ratings=total_ratings+1, total_rating_score=total_rating_score+VALUES(total_rating_score)`,
      [closedById, closedByTag, rating]
    );
  }

  async function isBlacklisted(userId) {
    const rows = await db('SELECT 1 FROM blacklist WHERE user_id=? LIMIT 1', [userId]);
    return rows.length > 0;
  }

  async function getDailyTicketCount(userId) {
    const rows = await db('SELECT COUNT(*) AS cnt FROM tickets WHERE owner_id=? AND created_at >= CURDATE()', [userId]);
    return rows[0]?.cnt || 0;
  }

  async function getInactiveTickets(warningHours, closeHours) {
    const toWarn = await db(
      `SELECT * FROM tickets WHERE status='open' AND last_message_at IS NOT NULL
       AND last_message_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
       AND last_message_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
       AND warned_inactive=0`,
      [warningHours, closeHours]
    );
    const toClose = await db(
      `SELECT * FROM tickets WHERE status='open' AND last_message_at IS NOT NULL
       AND last_message_at < DATE_SUB(NOW(), INTERVAL ? HOUR)`,
      [closeHours]
    );
    return { toWarn, toClose };
  }

  async function markWarnedInactive(ticketId) {
    await db('UPDATE tickets SET warned_inactive=1 WHERE id=?', [ticketId]);
  }

  const PRIO_TOPIC = { low: '🟢 Faible', normal: '🔵 Normal', urgent: '🔴 Urgente' };

  async function updateChannelTopic(ticketId) {
    const [ticket] = await db('SELECT * FROM tickets WHERE id=?', [ticketId]);
    if (!ticket?.channel_id || ticket.status !== 'open') return;
    const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
    if (!channel) return;
    let claimerName = 'Libre';
    if (ticket.claimed_by) {
      const u = await client.users.fetch(ticket.claimed_by).catch(() => null);
      claimerName = u?.username || ticket.claimed_by;
    }
    const prio = PRIO_TOPIC[ticket.priority] || ticket.priority;
    const subjectPart = ticket.subject ? ` · ${ticket.subject.slice(0, 40)}` : '';
    await channel.setTopic(`#${ticket.id} · ${ticket.owner_tag} · ${prio} · ${claimerName}${subjectPart}`).catch(() => null);
  }

  async function logMoveTicket(ticketId, categoryName, movedByUser) {
    const cfg = await getGuildConfig(db);
    if (!cfg.move_log_channel_id) return;
    const ch = await client.channels.fetch(cfg.move_log_channel_id).catch(() => null);
    if (ch?.isTextBased()) await ch.send(`Ticket #${ticketId} déplacé vers ${categoryName} par ${movedByUser.tag} (${movedByUser.id})`).catch(() => null);
  }

  async function logAddUser(ticketId, targetUserId, addedByUser) {
    const cfg = await getGuildConfig(db);
    if (!cfg.add_user_log_channel_id) return;
    const ch = await client.channels.fetch(cfg.add_user_log_channel_id).catch(() => null);
    if (ch?.isTextBased()) await ch.send(`Utilisateur ${targetUserId} ajouté au ticket #${ticketId} par ${addedByUser.tag}`).catch(() => null);
  }

  async function logRemoveUser(ticketId, targetUserId, removedByUser) {
    const cfg = await getGuildConfig(db);
    if (!cfg.remove_user_log_channel_id) return;
    const ch = await client.channels.fetch(cfg.remove_user_log_channel_id).catch(() => null);
    if (ch?.isTextBased()) await ch.send(`Utilisateur ${targetUserId} retiré du ticket #${ticketId} par ${removedByUser.tag}`).catch(() => null);
  }

  async function getLastClosedTicketByOwnerId(userId) {
    const rows = await db(`SELECT * FROM tickets WHERE owner_id=? AND status='closed' ORDER BY closed_at DESC LIMIT 1`, [userId]);
    return rows[0] || null;
  }

  async function getOldTicketsByUserId(userId) {
    return db(
      `SELECT id, channel_id, owner_id, owner_tag, subject, priority, status, created_at, closed_at, closed_by_tag
       FROM tickets WHERE owner_id = ? AND status = 'closed' ORDER BY closed_at DESC LIMIT 50`,
      [userId]
    );
  }

  async function addToBlacklist(userId, userTag, reason, addedByUser) {
    await db(
      `INSERT INTO blacklist (user_id, user_tag, reason, added_by_id, added_by_tag)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason), added_by_id = VALUES(added_by_id),
         added_by_tag = VALUES(added_by_tag), added_at = NOW()`,
      [userId, userTag, reason || null, addedByUser.id, addedByUser.tag || addedByUser.username]
    );
  }

  async function removeFromBlacklist(userId) {
    const rows = await db('SELECT user_id FROM blacklist WHERE user_id = ?', [userId]);
    if (!rows.length) return false;
    await db('DELETE FROM blacklist WHERE user_id = ?', [userId]);
    return true;
  }

  async function getBlacklist() {
    await db('DELETE FROM blacklist WHERE expires_at IS NOT NULL AND expires_at <= NOW()');
    return db('SELECT * FROM blacklist ORDER BY added_at DESC');
  }

  async function getTranscriptById(id) {
    const [row] = await db(
      'SELECT id, ticket_id, created_by_tag, created_at, message_count, html, txt FROM transcript_snapshots WHERE id = ?',
      [id]
    );
    return row || null;
  }

  async function setPriority(ticketId, priority) {
    await db('UPDATE tickets SET priority = ? WHERE id = ?', [priority, ticketId]);
  }

  async function getAdminStats() {
    return db(
      'SELECT admin_id, admin_tag, tickets_claimed, tickets_closed, total_ratings, total_rating_score, total_response_count, total_response_seconds, updated_at FROM admin_stats ORDER BY tickets_closed DESC'
    );
  }

  // Returns open tickets where the last real note is from user and no staff
  // response for at least `hours` hours, with anti-spam (no reminder in last 24h)
  async function getTicketsForStaffReminder(hours) {
    return db(`
      SELECT t.* FROM tickets t
      INNER JOIN (
        SELECT ticket_id, MAX(id) AS last_id
        FROM ticket_notes WHERE source NOT IN ('scheduled')
        GROUP BY ticket_id
      ) latest ON latest.ticket_id = t.id
      INNER JOIN ticket_notes ln ON ln.id = latest.last_id AND ln.source = 'user'
      WHERE t.status = 'open'
        AND t.claimed_by IS NOT NULL
        AND t.last_message_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
        AND (t.staff_reminder_sent_at IS NULL OR t.staff_reminder_sent_at < DATE_SUB(NOW(), INTERVAL 24 HOUR))
    `, [hours]);
  }

  async function markStaffReminderSent(ticketId) {
    await db('UPDATE tickets SET staff_reminder_sent_at = NOW() WHERE id = ?', [ticketId]);
  }

  // Returns open tickets where the last note is from staff and user hasn't responded
  async function getTicketsForUserInactive(warnHours, closeHours) {
    const toWarn = await db(`
      SELECT t.* FROM tickets t
      INNER JOIN (
        SELECT ticket_id, MAX(id) AS last_id
        FROM ticket_notes WHERE source NOT IN ('scheduled')
        GROUP BY ticket_id
      ) latest ON latest.ticket_id = t.id
      INNER JOIN ticket_notes ln ON ln.id = latest.last_id AND ln.source NOT IN ('user', 'scheduled')
      WHERE t.status = 'open'
        AND t.user_warned_inactive = 0
        AND t.last_message_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
        AND t.last_message_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
    `, [warnHours, closeHours]);

    const toClose = await db(`
      SELECT t.* FROM tickets t
      INNER JOIN (
        SELECT ticket_id, MAX(id) AS last_id
        FROM ticket_notes WHERE source NOT IN ('scheduled')
        GROUP BY ticket_id
      ) latest ON latest.ticket_id = t.id
      INNER JOIN ticket_notes ln ON ln.id = latest.last_id AND ln.source NOT IN ('user', 'scheduled')
      WHERE t.status = 'open'
        AND t.user_warned_inactive = 1
        AND t.last_message_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
    `, [closeHours]);

    return { toWarn, toClose };
  }

  async function markUserWarnedInactive(ticketId) {
    await db('UPDATE tickets SET user_warned_inactive = 1 WHERE id = ?', [ticketId]);
  }

  return {
    getGuildConfig,
    getOpenTicketByOwnerId,
    getOpenTicketByChannelId,
    getOpenTicketByParticipantId,
    getAnyOpenTicketForUser,
    getAllLinkedUserIds,
    getTicketByChannelId,
    getLastClosedTicketByOwnerId,
    createTicket,
    relayDmToTicket,
    sendWelcomeDm,
    saveTranscriptSnapshot,
    closeTicketWithTranscript,
    reopenTicket,
    setClaim,
    addParticipant,
    removeParticipant,
    updateLastMessage,
    recordStaffResponse,
    saveRating,
    isBlacklisted,
    getDailyTicketCount,
    getInactiveTickets,
    markWarnedInactive,
    updateChannelTopic,
    logMoveTicket,
    logAddUser,
    logRemoveUser,
    getOldTicketsByUserId,
    addToBlacklist,
    removeFromBlacklist,
    getBlacklist,
    getTranscriptById,
    setPriority,
    getAdminStats,
    getTicketsForStaffReminder,
    markStaffReminderSent,
    getTicketsForUserInactive,
    markUserWarnedInactive,
  };
}

module.exports = { createManager, getGuildConfig };

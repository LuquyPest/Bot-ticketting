const { ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');
const { t, sendToMember } = require('./i18n');
const { parseJsonField } = require('./jsonField');
const { ticketButtons } = require('./components');
const { buildTranscripts } = require('./transcript');
const { sanitizeChannelName } = require('./sanitize');
const { broadcast } = require('./sse');
const { fireTicketWebhook } = require('./webhookEmitter');
const { fetchGuildChannel } = require('./discordGuard');
const { recordEvent } = require('./audit');
const { ticketContextAuthor } = require('./dmEmbeds');

// One ticket creation at a time per guild+user, shared by every createManager() instance
// (a new manager is built per message, so a per-instance lock would protect nothing).
const creating = new Map(); // `${guildId}:${userId}` -> Promise

// Cross-instance creation lock (Redis). Fail-open: without Redis, the local lock still applies.
const { getRedis } = require('./redis');
const CREATION_LOCK_MS = 20000;
async function acquireCreationLock(key) {
  const token = require('crypto').randomBytes(8).toString('hex');
  try {
    const ok = await getRedis().set(`lock:create:${key}`, token, 'PX', CREATION_LOCK_MS, 'NX');
    return { acquired: !!ok, token };
  } catch { return { acquired: true, token: null }; }
}
async function releaseCreationLock(key, token) {
  if (!token) return;
  // Delete only our own lock (it may have expired and been taken by another instance)
  await getRedis().eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, `lock:create:${key}`, token
  ).catch(() => null);
}
// Waits for another instance's creation; returns the ticket id it created, if any.
async function waitCreationLock(key) {
  const deadline = Date.now() + CREATION_LOCK_MS;
  while (Date.now() < deadline) {
    const held = await getRedis().exists(`lock:create:${key}`).catch(() => 0);
    if (!held) break;
    await new Promise(r => setTimeout(r, 100));
  }
  return getRedis().get(`lock:created:${key}`).catch(() => null);
}

// Discord limits: 4096 chars per embed description, 6000 per message.
const EMBED_CHUNK = 4000;
function chunkText(text, size = EMBED_CHUNK) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [''];
}

// Posts a user's message (any length, any number of attachments) as one or more embeds.
async function sendUserContent(channel, user, content, attachments = []) {
  const files = attachments.map(f => f.url).join('\n');
  const body = [content, files && `📎 **Fichiers**\n${files}`].filter(Boolean).join('\n\n') || '*[aucun texte]*';
  const chunks = chunkText(body);
  const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  for (const [i, chunk] of chunks.entries()) {
    const embed = new EmbedBuilder().setColor(0x4e5058).setDescription(chunk);
    if (i === 0) embed.setAuthor({ name: `${user.tag} · utilisateur` });
    if (i === chunks.length - 1) embed.setFooter({ text: chunks.length > 1 ? `${time} · ${chunks.length} parties` : time });
    await channel.send({ embeds: [embed] });
  }
}

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
      'INSERT INTO tickets (channel_id, owner_id, owner_tag, subject, last_message_at, stage_changed_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
      [channelId, user.id, user.tag, subject]
    );
    return { id: result.insertId, channel_id: channelId, owner_id: user.id, owner_tag: user.tag, subject };
  }

  // Discord channel name = the ticket subject (sanitized), else <prefix>-<username>.
  function channelNameFor(subject, user, cfg) {
    const fromSubject = subject ? sanitizeChannelName(subject, 90) : '';
    return fromSubject || `${cfg.ticket_prefix || 'ticket'}-${sanitizeChannelName(user.username || '', 25) || 'ticket'}`;
  }

  async function createTicketChannel(user, subject = null) {
    const cfg = await getGuildConfig(db);
    const guild = await client.guilds.fetch(gid).catch(() => null);
    if (!guild) throw new Error('Guild introuvable');

    const supportRoleIds = parseJsonField(cfg.support_role_ids);
    const chiefRoleIds   = parseJsonField(cfg.chief_role_ids);
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

    return guild.channels.create({
      name: channelNameFor(subject, user, cfg),
      type: ChannelType.GuildText,
      parent: cfg.ticket_category_id || undefined,
      permissionOverwrites: permOverwrites
    });
  }

  // forceNew: open a new ticket even if the user already has one (several tickets per member are allowed)
  async function createTicket(user, firstMessage, attachments = [], subject = null, { forceNew = false } = {}) {
    const lockKey = `${gid}:${user.id}`;
    // A creation is already running for this user: wait for it and reuse its ticket
    while (creating.has(lockKey)) {
      const result = await creating.get(lockKey).catch(() => null);
      if (result?.ticket) {
        // Burst of DMs: the first one created the ticket, the following ones must still be delivered
        if (firstMessage || attachments.length) return relayDmToTicket(user, firstMessage, attachments, subject);
        return { ...result, created: false };
      }
    }
    // Same check across bot instances: another process may be creating this member's ticket
    const shared = await acquireCreationLock(lockKey);
    if (!shared.acquired) {
      const ticketId = await waitCreationLock(lockKey);
      const [ticket] = ticketId ? await db("SELECT * FROM tickets WHERE id = ? AND status = 'open'", [ticketId]) : [];
      if (ticket) {
        if (firstMessage || attachments.length) return relayDmToTicket(user, firstMessage, attachments, subject);
        return { ticket, created: false };
      }
    }
    const promise = createTicketUnlocked(user, firstMessage, attachments, subject, forceNew);
    creating.set(lockKey, promise);
    try {
      const result = await promise;
      if (result?.ticket?.id) await getRedis().set(`lock:created:${lockKey}`, String(result.ticket.id), 'EX', 15).catch(() => null);
      return result;
    } finally {
      creating.delete(lockKey);
      if (shared.acquired) await releaseCreationLock(lockKey, shared.token);
    }
  }

  async function createTicketUnlocked(user, firstMessage, attachments, subject, forceNew) {
    const existing = forceNew ? null : await getOpenTicketByOwnerId(user.id);
    if (existing) {
      const ch = await client.channels.fetch(existing.channel_id).catch(() => null);
      if (ch) return { channel: ch, ticket: existing, created: false };
      await db(`UPDATE tickets SET status='closed', closed_at=NOW(), closed_by_tag='system' WHERE id=?`, [existing.id]);
    }

    const channel = await createTicketChannel(user, subject);
    const ticket = await createTicketDb(channel.id, user, subject);

    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setAuthor({ name: 'Nouveau ticket' })
      .setTitle(`Ticket #${ticket.id}`)
      .setDescription(`Bienvenue <@${user.id}> ! Notre équipe va traiter ta demande dans les plus brefs délais.`)
      .addFields(
        { name: '👤 Utilisateur', value: `<@${user.id}>`, inline: true },
        { name: '📂 Sujet', value: ticket.subject || 'Non défini', inline: true },
        { name: '🔵 Priorité', value: 'Normale', inline: true }
      )
      .setFooter({ text: 'Ticket ouvert' })
      .setTimestamp();

    await channel.send({ embeds: [embed], components: [ticketButtons()] });
    const topicSub = ticket.subject ? ` · ${ticket.subject.slice(0, 40)}` : '';
    await channel.setTopic(`#${ticket.id} · ${user.tag} · 🔵 Normal · Libre${topicSub}`).catch(() => null);

    fireTicketWebhook(db, 'ticket_open', { ticketId: ticket.id, ownerTag: user.tag, subject: ticket.subject }).catch(() => null);
    await recordEvent(db, { actor: user, action: 'ticket_open', ticketId: ticket.id, details: { subject: ticket.subject || null } });

    if (firstMessage || attachments.length) {
      await sendUserContent(channel, user, firstMessage, attachments);
      const noteContent = [firstMessage, ...attachments.map(a => a.url)].filter(Boolean).join('\n');
      const nr = await db(
        'INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, "user")',
        [ticket.id, user.id, user.tag, noteContent]
      );
      broadcast('note', { ticketId: ticket.id, note: { id: nr.insertId, ticket_id: ticket.id, author_id: user.id, author_tag: user.tag, content: noteContent, source: 'user', created_at: new Date() } }, gid);
      await require('./dmEdits').linkDmNote(db, gid, user.id, nr.insertId, noteContent).catch(() => null);
    }
    await require('./subjectRules').applySubjectRules({ db, client, guildId: gid, ticket }).catch(() => null);
    return { channel, ticket, created: true };
  }

  async function relayDmToTicket(user, content, attachments = [], subject = null) {
    const ticket = await getOpenTicketByOwnerId(user.id) || await getOpenTicketByParticipantId(user.id);
    if (!ticket) return createTicket(user, content, attachments, subject);
    return relayToTicket(ticket, user, content, attachments);
  }

  // Posts a member's DM into a given open ticket (owner or participant). Returns null if unreachable.
  async function relayToTicket(ticket, user, content, attachments = []) {
    const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
    if (!channel) return null;

    await sendUserContent(channel, user, content, attachments);
    await db('UPDATE tickets SET last_message_at = NOW(), user_warned_inactive = 0 WHERE id = ?', [ticket.id]);

    const noteContent = [content, ...attachments.map(a => a.url)].filter(Boolean).join('\n');
    const nr = await db(
      'INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, "user")',
      [ticket.id, user.id, user.tag, noteContent]
    );
    broadcast('note', { ticketId: ticket.id, note: { id: nr.insertId, ticket_id: ticket.id, author_id: user.id, author_tag: user.tag, content: noteContent, source: 'user', created_at: new Date() } }, gid);
    await require('./dmEdits').linkDmNote(db, gid, user.id, nr.insertId, noteContent).catch(() => null);
    return { channel, ticket, created: false };
  }

  async function sendWelcomeDm(user, created, subject = null, ticketId = null) {
    // ticketId is required for the DM header (server + ticket); kept optional for old callers
    if (!created) return;
    const cfg = await getGuildConfig(db);
    let welcomeText = cfg.welcome_message || t('welcome.default');
    if (subject) {
      try {
        const subjectMsgs = parseJsonField(cfg.subject_welcome_messages, {});
        if (subjectMsgs[subject]) welcomeText = subjectMsgs[subject];
      } catch {}
    }
    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle(ticketId ? t('welcome.title', { id: ticketId }) : t('welcome.titleNoId'))
      .setAuthor(ticketContextAuthor(client, gid, { id: ticketId ?? '?', subject }))
      .setDescription(welcomeText)
      .setFooter({ text: t('welcome.footer') });
    if (subject) welcomeEmbed.addFields({ name: t('welcome.subject'), value: subject, inline: true });
    const { ticketDmComponents } = require('./components');
    const components = ticketId ? ticketDmComponents({ id: ticketId, owner_id: user.id }, gid, user.id) : [];
    await user.send({ embeds: [welcomeEmbed], components }).catch(() => null);
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

    if (closedByUser.member) {
      await db(`INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, '🔒 Ticket fermé par le membre.', 'system')`,
        [ticket.id, String(closedByUser.id), closedByUser.tag]).catch(() => null);
    }
    // Closures by the API, the automations or the member themselves do not count in staff stats
    const byStaff = !closedByUser.api && closedByUser.source !== 'system' && !closedByUser.member;
    await db(
      `UPDATE tickets SET status='closed', closed_at=NOW(), closed_by_tag=?, closed_by_id=? WHERE id=?`,
      [closedByUser.tag, byStaff ? closedByUser.id : null, ticket.id]
    );
    if (byStaff) {
      await db(
        `INSERT INTO admin_stats (admin_id, admin_tag, tickets_claimed, tickets_closed) VALUES (?, ?, 0, 1)
         ON DUPLICATE KEY UPDATE admin_tag=VALUES(admin_tag), tickets_closed=tickets_closed+1`,
        [closedByUser.id, closedByUser.tag]
      );
    }

    const updatedTicket = await getTicketByChannelId(channel.id);
    const transcript = await saveTranscriptSnapshot(channel, closedByUser, updatedTicket);
    const cfg = await getGuildConfig(db);

    const linkedIds = await getAllLinkedUserIds(ticket.id);
    const openedAt2 = ticket.created_at ? new Date(ticket.created_at) : null;
    const mins2 = openedAt2 ? Math.round((Date.now() - openedAt2.getTime()) / 60000) : null;
    const duration2 = mins2 !== null ? (mins2 < 60 ? `${mins2} min` : `${Math.floor(mins2 / 60)}h ${mins2 % 60}min`) : '—';
    await recordEvent(db, {
      actor: closedByUser, action: 'ticket_close', ticketId: ticket.id,
      details: { transcriptId: transcript?.transcriptId || null, ...(closedByUser.reason ? { reason: closedByUser.reason } : {}) },
    });
    // Each linked member gets the closing message in their language (custom close message if set)
    const closeDmEmbed = () => new EmbedBuilder()
      .setColor(0x6366f1)
      .setAuthor(ticketContextAuthor(client, gid, ticket))
      .setTitle(t('closed.title', { id: ticket.id }))
      .setDescription(cfg.close_message || t('closed.body'))
      .addFields(
        { name: t('closed.duration'), value: duration2, inline: true },
        closedByUser.member
          ? { name: t('closed.by'), value: t('closed.member', { tag: closedByUser.tag }), inline: true }
          : { name: t('closed.staff'), value: closedByUser.tag, inline: true }
      );
    // The owner can reopen the ticket for a few days (guild setting member_reopen_days)
    const reopenDays = Number(cfg.member_reopen_days ?? 7);
    for (const uid of linkedIds) {
      const canReopen = uid === ticket.owner_id && reopenDays > 0;
      await sendToMember(client, uid, gid, () => {
        const embed = closeDmEmbed();
        if (canReopen) embed.setFooter({ text: t('reopen.hint', { days: reopenDays }) });
        // Member web space: where to find this conversation later
        const portal = Number(cfg.member_portal_enabled ?? 1) === 1 && require('./memberPortal').portalUrl();
        if (portal) embed.addFields({ name: t('portal.title'), value: t('portal.body', { url: portal }) });
        const { memberReopenButton } = require('./components');
        return { embeds: [embed], components: canReopen ? [memberReopenButton(ticket.id, gid)] : [] };
      });
    }

    const { ratingButtons } = require('./components');
    await sendToMember(client, ticket.owner_id, gid, () => ({
      embeds: [new EmbedBuilder().setColor(0x6366f1).setDescription(t('rating.ask'))],
      components: [ratingButtons(ticket.id, gid)],
    }));

    if (cfg.close_log_channel_id) {
      const logCh = await fetchGuildChannel(client, gid, cfg.close_log_channel_id);
      if (logCh?.isTextBased()) {
        const openedAt = ticket.created_at ? new Date(ticket.created_at) : null;
        const mins = openedAt ? Math.round((Date.now() - openedAt.getTime()) / 60000) : null;
        const duration = mins !== null ? (mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}min`) : '—';
        const closeLogEmbed = new EmbedBuilder()
          .setColor(0x6366f1)
          .setTitle(`🔒 Ticket #${ticket.id} fermé`)
          .addFields(
            { name: '👤 Utilisateur', value: `<@${ticket.owner_id}>`, inline: true },
            { name: '🛡️ Fermé par', value: closedByUser.tag, inline: true },
            { name: '⏱️ Durée', value: duration, inline: true }
          );
        if (ticket.subject) closeLogEmbed.addFields({ name: '📂 Sujet', value: ticket.subject, inline: true });
        closeLogEmbed.setFooter({ text: `Transcript #${transcript?.transcriptId || 'aucun'}` }).setTimestamp();
        await logCh.send({ embeds: [closeLogEmbed] }).catch(() => null);
      }
    }
    await channel.delete('Ticket fermé avec transcript').catch(() => null);

    fireTicketWebhook(db, 'ticket_close', { ticketId: ticket.id, ownerTag: ticket.owner_tag, closedBy: closedByUser.tag }).catch(() => null);

    return transcript;
  }

  async function reopenTicket(ticket, reopenedByUser) {
    const channel = await createTicketChannel({ id: ticket.owner_id, username: ticket.owner_tag, tag: ticket.owner_tag }, ticket.subject);
    await db(
      `UPDATE tickets SET status='open', channel_id=?, closed_at=NULL, closed_by_tag=NULL, closed_by_id=NULL, stage='open', stage_changed_at=NOW(), warned_inactive=0, last_message_at=NOW() WHERE id=?`,
      [channel.id, ticket.id]
    );
    const reopenEmbed = new EmbedBuilder()
      .setColor(0x10b981)
      .setAuthor({ name: 'Ticket réouvert' })
      .setTitle(`Ticket #${ticket.id}`)
      .setDescription(`Bienvenue à nouveau <@${ticket.owner_id}> ! Le ticket a été réouvert.`)
      .addFields(
        { name: '👤 Utilisateur', value: `<@${ticket.owner_id}>`, inline: true },
        { name: '📂 Sujet', value: ticket.subject || 'Non défini', inline: true },
        { name: '🔵 Priorité', value: 'Normale', inline: true }
      )
      .setFooter({ text: 'Ticket réouvert' })
      .setTimestamp();
    await channel.send({ embeds: [reopenEmbed], components: [ticketButtons()] });
    const topicSub = ticket.subject ? ` · ${ticket.subject.slice(0, 40)}` : '';
    await channel.setTopic(`#${ticket.id} · ${ticket.owner_tag} · 🔵 Normal · Libre${topicSub}`).catch(() => null);
    await recordEvent(db, { actor: reopenedByUser, action: 'ticket_reopen', ticketId: ticket.id, details: reopenedByUser?.reason ? { reason: reopenedByUser.reason } : null });
    await sendToMember(client, ticket.owner_id, gid, () => ({ embeds: [new EmbedBuilder()
      .setColor(0x10b981)
      .setAuthor(ticketContextAuthor(client, gid, ticket))
      .setTitle(t('reopened.title', { id: ticket.id }))
      .setDescription(t('reopened.body'))
      .setFooter({ text: t('welcome.footer') })] }));
    return channel;
  }

  // ── Assignees ── a ticket can be assigned to several staff members; tickets.claimed_by is kept
  // in sync with the first one (used by stats, reminders, escalation and ratings).

  // Changes the ticket subject and renames the Discord channel to match.
  // Discord allows 2 renames per 10 min per channel: the rename is not awaited (it may be queued).
  async function setSubject(ticketId, subject, byUser) {
    const [ticket] = await db('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) return null;
    const clean = subject ? String(subject).replace(/\s+/g, ' ').trim().slice(0, 100) || null : null;
    await db('UPDATE tickets SET subject = ? WHERE id = ?', [clean, ticketId]);
    if ((ticket.subject || null) !== clean) {
      await recordEvent(db, { actor: byUser, action: 'ticket_subject', ticketId, details: { from: ticket.subject || null, to: clean } });
    }
    let channelName = null;
    if (ticket.status === 'open' && ticket.channel_id) {
      const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel) {
        const cfg = await getGuildConfig(db);
        channelName = channelNameFor(clean, { username: ticket.owner_tag }, cfg);
        if (channel.name !== channelName) channel.setName(channelName).catch(err => console.error('channel rename:', err.message));
        updateChannelTopic(ticketId).catch(() => null);
      }
    }
    broadcast('ticket', { id: ticketId, subject: clean }, gid);
    return { subject: clean, channelName };
  }

  async function getAssignees(ticketId) {
    return db(
      `SELECT a.user_id, COALESCE(u.username, a.user_id) AS username, u.avatar, a.assigned_at
       FROM ticket_assignees a LEFT JOIN dashboard_users u ON u.user_id = a.user_id
       WHERE a.ticket_id = ? ORDER BY a.assigned_at ASC`,
      [ticketId]
    );
  }

  // The primary assignee stays the same while still assigned; otherwise the longest-assigned one takes over.
  async function syncPrimaryAssignee(ticketId) {
    await db(
      `UPDATE tickets SET claimed_by = CASE
         WHEN claimed_by IN (SELECT user_id FROM ticket_assignees WHERE ticket_id = ?) THEN claimed_by
         ELSE (SELECT user_id FROM ticket_assignees WHERE ticket_id = ? ORDER BY assigned_at ASC, user_id ASC LIMIT 1)
       END
       WHERE id = ?`,
      [ticketId, ticketId, ticketId]
    );
  }

  // Returns true when the user was not already assigned.
  async function addAssignee(ticketId, user, byUser = user) {
    const r = await db(
      'INSERT IGNORE INTO ticket_assignees (ticket_id, user_id, assigned_by_id) VALUES (?, ?, ?)',
      [ticketId, user.id, byUser?.id || null]
    );
    if (!r.affectedRows) return false;
    await syncPrimaryAssignee(ticketId);
    const tag = user.tag || user.username || user.id;
    await recordEvent(db, { actor: byUser || user, action: 'ticket_assign', ticketId, targetType: 'user', targetId: user.id, details: { assignee: tag } });
    fireTicketWebhook(db, 'ticket_claim', { ticketId, claimedBy: tag }).catch(() => null);
    require('./assignNotify').notifyAssignee(db, client, gid, ticketId, user, byUser).catch(() => null);
    await db(
      `INSERT INTO admin_stats (admin_id, admin_tag, tickets_claimed, tickets_closed) VALUES (?, ?, 1, 0)
       ON DUPLICATE KEY UPDATE admin_tag=VALUES(admin_tag), tickets_claimed=tickets_claimed+1`,
      [user.id, tag]
    );
    const cfg = await getGuildConfig(db);
    if (cfg.claim_log_channel_id) {
      const logCh = await fetchGuildChannel(client, gid, cfg.claim_log_channel_id);
      if (logCh?.isTextBased()) {
        const by = byUser && byUser.id !== user.id ? ` par ${byUser.tag || byUser.username}` : '';
        await logCh.send(`Ticket #${ticketId} attribué à ${tag} (${user.id})${by}`).catch(() => null);
      }
    }
    return true;
  }

  async function removeAssignee(ticketId, userId, byUser = null) {
    const [who] = await db('SELECT COALESCE(u.username, a.user_id) AS username FROM ticket_assignees a LEFT JOIN dashboard_users u ON u.user_id = a.user_id WHERE a.ticket_id = ? AND a.user_id = ?', [ticketId, userId]);
    const r = await db('DELETE FROM ticket_assignees WHERE ticket_id = ? AND user_id = ?', [ticketId, userId]);
    if (r.affectedRows) {
      await syncPrimaryAssignee(ticketId);
      await recordEvent(db, { actor: byUser || { id: userId, tag: who?.username }, action: 'ticket_unassign', ticketId, targetType: 'user', targetId: userId, details: { assignee: who?.username || userId } });
    }
    return r.affectedRows > 0;
  }

  // Kept for callers that "claim" for themselves (null = no-op: use removeAssignee)
  async function setClaim(ticketId, adminUser) {
    if (adminUser) await addAssignee(ticketId, adminUser, adminUser);
  }

  // ── Stages ── Ouvert / En attente / En cours, each mapped to a Discord category in Paramètres.
  const STAGE_CATEGORY = { open: 'ticket_category_id', waiting: 'waiting_category_id', in_progress: 'in_progress_category_id' };
  const STAGE_LABEL = { open: 'Ouvert', waiting: 'En attente', in_progress: 'En cours' };

  // Returns { ok, error?, label }. Moves the Discord channel into the stage's category.
  async function moveToStage(ticketId, stage, byUser) {
    if (!STAGE_CATEGORY[stage]) return { ok: false, error: 'Étape invalide' };
    const [ticket] = await db('SELECT id, channel_id, status FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket || ticket.status !== 'open') return { ok: false, error: 'Ticket fermé ou introuvable' };
    const cfg = await getGuildConfig(db);
    const categoryId = cfg[STAGE_CATEGORY[stage]];
    if (!categoryId) return { ok: false, error: `Aucune catégorie Discord n'est associée à « ${STAGE_LABEL[stage]} » (Paramètres)` };
    const category = await fetchGuildChannel(client, gid, categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) return { ok: false, error: 'Catégorie Discord introuvable' };
    const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
    if (!channel) return { ok: false, error: 'Salon Discord introuvable' };
    await channel.setParent(category.id, { lockPermissions: false });
    const [before] = await db('SELECT stage FROM tickets WHERE id = ?', [ticketId]);
    // The SLA clock restarts only when the stage actually changes (SET runs left to right:
    // stage_changed_at must be computed before stage is overwritten)
    await db('UPDATE tickets SET stage_changed_at = IF(stage = ?, stage_changed_at, NOW()), stage = ? WHERE id = ?', [stage, stage, ticketId]);
    await recordEvent(db, { actor: byUser, action: 'ticket_stage', ticketId, details: { from: before?.stage || 'open', to: stage } });
    await logMoveTicket(ticketId, `${STAGE_LABEL[stage]} (${category.name})`, byUser);
    await channel.send(`📂 Ticket passé en **${STAGE_LABEL[stage]}** par **${byUser.username || byUser.tag}**.`).catch(() => null);
    // Optional: tell the member (guild setting notify_member_stage)
    if (cfg.notify_member_stage && before?.stage !== stage) {
      const [t2] = await db('SELECT id, owner_id, subject FROM tickets WHERE id = ?', [ticketId]);
      const { ticketNoticeDmEmbed } = require('./dmEmbeds');
      await sendToMember(client, t2.owner_id, gid, () => ({ embeds: [ticketNoticeDmEmbed(client, gid, t2, {
        title: t(`stage.${stage}.title`), description: t(`stage.${stage}.body`), footer: t('reply.footer', { id: t2.id }),
        color: stage === 'waiting' ? 'warning' : 'primary',
      })] }));
    }
    return { ok: true, label: STAGE_LABEL[stage] };
  }

  // Merges an open ticket into another open ticket of the same member: history, participants,
  // assignees, tags and pending scheduled messages move to the target; the source channel is
  // archived (transcript) and deleted, and the source is closed with merged_into set.
  async function mergeTickets(sourceId, targetId, byUser) {
    if (sourceId === targetId) return { ok: false, error: 'Impossible de fusionner un ticket avec lui-même' };
    const rows = await db("SELECT * FROM tickets WHERE id IN (?) AND status = 'open'", [[sourceId, targetId]]);
    const source = rows.find(t => t.id === sourceId), target = rows.find(t => t.id === targetId);
    if (!source || !target) return { ok: false, error: 'Les deux tickets doivent être ouverts' };
    if (source.owner_id !== target.owner_id) return { ok: false, error: 'Les deux tickets doivent appartenir au même membre' };
    const actorTag = byUser.username || byUser.tag || byUser.id;

    const channel = source.channel_id ? await client.channels.fetch(source.channel_id).catch(() => null) : null;
    const transcript = channel ? await saveTranscriptSnapshot(channel, byUser, source).catch(() => null) : null;

    const moved = await db('UPDATE ticket_notes SET ticket_id = ? WHERE ticket_id = ?', [targetId, sourceId]);
    await db('INSERT IGNORE INTO ticket_participants (ticket_id, user_id) SELECT ?, user_id FROM ticket_participants WHERE ticket_id = ?', [targetId, sourceId]);
    await db('INSERT IGNORE INTO ticket_assignees (ticket_id, user_id, assigned_by_id) SELECT ?, user_id, assigned_by_id FROM ticket_assignees WHERE ticket_id = ?', [targetId, sourceId]);
    await db('INSERT IGNORE INTO ticket_tag_assignments (ticket_id, tag_id) SELECT ?, tag_id FROM ticket_tag_assignments WHERE ticket_id = ?', [targetId, sourceId]);
    await db('UPDATE scheduled_messages SET ticket_id = ? WHERE ticket_id = ? AND sent = 0', [targetId, sourceId]);
    await syncPrimaryAssignee(targetId);
    await db(
      `UPDATE tickets SET status = 'closed', closed_at = NOW(), closed_by_tag = ?, closed_by_id = NULL, merged_into = ? WHERE id = ?`,
      [`fusion → #${targetId} (${actorTag})`.slice(0, 100), targetId, sourceId]
    );
    await db(
      `INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, 'system')`,
      [targetId, String(byUser.id), actorTag, `🔀 Ticket #${sourceId}${source.subject ? ` « ${source.subject} »` : ''} fusionné dans ce ticket par ${actorTag}${transcript ? ` (transcript #${transcript.transcriptId})` : ''}.`]
    );

    const details = { from: sourceId, into: targetId, notes: moved.affectedRows || 0 };
    await recordEvent(db, { actor: byUser, action: 'ticket_merge', ticketId: targetId, details });
    await recordEvent(db, { actor: byUser, action: 'ticket_merge', ticketId: sourceId, details });

    const targetChannel = target.channel_id ? await client.channels.fetch(target.channel_id).catch(() => null) : null;
    await targetChannel?.send(`🔀 Le ticket #${sourceId}${source.subject ? ` « ${source.subject} »` : ''} a été fusionné ici par **${actorTag}**.`).catch(() => null);
    await channel?.delete(`Fusionné dans le ticket #${targetId}`).catch(() => null);

    // The member (and participants) are told where the conversation continues
    const { ticketNoticeDmEmbed } = require('./dmEmbeds');
    for (const uid of await getAllLinkedUserIds(targetId)) {
      await sendToMember(client, uid, gid, () => ({ embeds: [ticketNoticeDmEmbed(client, gid, target, {
        title: t('merged.title'),
        description: t('merged.body', { from: sourceId, subject: source.subject ? ` « ${source.subject} »` : '' }),
      })] }));
    }
    await updateChannelTopic(targetId).catch(() => null);
    return { ok: true, movedNotes: moved.affectedRows || 0, transcriptId: transcript?.transcriptId || null };
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

  // closedById may be null (ticket closed automatically or via the API): the rating is kept, unattributed
  async function saveRatingComment(ticketId, ownerId, comment) {
    const r = await db('UPDATE ticket_ratings SET comment = ? WHERE ticket_id = ? AND owner_id = ? AND comment IS NULL', [comment, ticketId, ownerId]);
    if (!r.affectedRows) return false;
    await recordEvent(db, { actor: { id: ownerId, tag: ownerId, source: 'discord' }, action: 'ticket_rating_comment', ticketId, details: { comment: comment.slice(0, 300) } });
    return true;
  }

  async function saveRating(ticketId, ownerId, closedById, rating, closedByTag) {
    await db('INSERT INTO ticket_ratings (ticket_id, owner_id, closed_by_id, rating) VALUES (?, ?, ?, ?)', [ticketId, ownerId, closedById, rating]);
    await recordEvent(db, { actor: { id: ownerId, tag: ownerId, source: 'discord' }, action: 'ticket_rating', ticketId, details: { rating, staff: closedByTag || null } });
    require('./lowRating').notifyLowRating(db, client, gid, ticketId, rating).catch(() => null);
    if (!closedById) return;
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
    const assignees = await getAssignees(ticketId);
    const claimerName = assignees.length
      ? assignees.slice(0, 3).map(a => a.username).join(', ') + (assignees.length > 3 ? ` +${assignees.length - 3}` : '')
      : 'Libre';
    const prio = PRIO_TOPIC[ticket.priority] || ticket.priority;
    const subjectPart = ticket.subject ? ` · ${ticket.subject.slice(0, 40)}` : '';
    await channel.setTopic(`#${ticket.id} · ${ticket.owner_tag} · ${prio} · ${claimerName}${subjectPart}`).catch(() => null);
  }

  async function logMoveTicket(ticketId, categoryName, movedByUser) {
    const cfg = await getGuildConfig(db);
    if (!cfg.move_log_channel_id) return;
    const ch = await fetchGuildChannel(client, gid, cfg.move_log_channel_id);
    if (ch?.isTextBased()) await ch.send(`Ticket #${ticketId} déplacé vers ${categoryName} par ${movedByUser.tag} (${movedByUser.id})`).catch(() => null);
  }

  async function logAddUser(ticketId, targetUserId, addedByUser) {
    await recordEvent(db, { actor: addedByUser, action: 'participant_add', ticketId, targetType: 'user', targetId: targetUserId });
    const cfg = await getGuildConfig(db);
    if (!cfg.add_user_log_channel_id) return;
    const ch = await fetchGuildChannel(client, gid, cfg.add_user_log_channel_id);
    if (ch?.isTextBased()) await ch.send(`Utilisateur ${targetUserId} ajouté au ticket #${ticketId} par ${addedByUser.tag}`).catch(() => null);
  }

  async function logRemoveUser(ticketId, targetUserId, removedByUser) {
    await recordEvent(db, { actor: removedByUser, action: 'participant_remove', ticketId, targetType: 'user', targetId: targetUserId });
    const cfg = await getGuildConfig(db);
    if (!cfg.remove_user_log_channel_id) return;
    const ch = await fetchGuildChannel(client, gid, cfg.remove_user_log_channel_id);
    if (ch?.isTextBased()) await ch.send(`Utilisateur ${targetUserId} retiré du ticket #${ticketId} par ${removedByUser.tag}`).catch(() => null);
  }

  async function getLastClosedTicketByOwnerId(userId) {
    const rows = await db(`SELECT * FROM tickets WHERE owner_id=? AND status='closed' ORDER BY closed_at DESC LIMIT 1`, [userId]);
    return rows[0] || null;
  }

  // viewerId: the Discord staff member asking — tickets restricted to a grade they cannot see are hidden
  async function getOldTicketsByUserId(userId, viewerId) {
    const rows = await db(
      `SELECT id, channel_id, owner_id, owner_tag, subject, priority, status, created_at, closed_at, closed_by_tag, visibility_grade_id
       FROM tickets WHERE owner_id = ? AND status = 'closed' ORDER BY closed_at DESC LIMIT 50`,
      [userId]
    );
    const { discordStaffCanSee } = require('./gradePermissions');
    const visible = [];
    for (const t of rows) if (await discordStaffCanSee(db, viewerId, t.visibility_grade_id)) visible.push(t);
    return visible;
  }

  async function addToBlacklist(userId, userTag, reason, addedByUser) {
    await db(
      `INSERT INTO blacklist (user_id, user_tag, reason, added_by_id, added_by_tag)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason), added_by_id = VALUES(added_by_id),
         added_by_tag = VALUES(added_by_tag), added_at = NOW()`,
      [userId, userTag, reason || null, addedByUser.id, addedByUser.tag || addedByUser.username]
    );
    await recordEvent(db, { actor: addedByUser, action: 'blacklist_add', targetType: 'user', targetId: userId, details: { user: userTag, reason: reason || null } });
  }

  async function removeFromBlacklist(userId, byUser = null) {
    const rows = await db('SELECT user_id, user_tag FROM blacklist WHERE user_id = ?', [userId]);
    if (!rows.length) return false;
    await db('DELETE FROM blacklist WHERE user_id = ?', [userId]);
    await recordEvent(db, { actor: byUser, action: 'blacklist_remove', targetType: 'user', targetId: userId, details: { user: rows[0].user_tag } });
    return true;
  }

  async function getBlacklist() {
    await db('DELETE FROM blacklist WHERE expires_at IS NOT NULL AND expires_at <= NOW()');
    return db('SELECT * FROM blacklist ORDER BY added_at DESC');
  }

  async function getTranscriptById(id) {
    const [row] = await db(
      `SELECT ts.id, ts.ticket_id, ts.created_by_tag, ts.created_at, ts.message_count, ts.html, ts.txt, t.visibility_grade_id
       FROM transcript_snapshots ts JOIN tickets t ON t.id = ts.ticket_id WHERE ts.id = ?`,
      [id]
    );
    return row || null;
  }

  async function setPriority(ticketId, priority, byUser = null) {
    const [before] = await db('SELECT priority FROM tickets WHERE id = ?', [ticketId]);
    await db('UPDATE tickets SET priority = ? WHERE id = ?', [priority, ticketId]);
    if (before?.priority !== priority) {
      await recordEvent(db, { actor: byUser, action: 'ticket_priority', ticketId, details: { from: before?.priority, to: priority } });
    }
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
    setSubject,
    relayToTicket,
    getAssignees,
    addAssignee,
    removeAssignee,
    moveToStage,
    mergeTickets,
    addParticipant,
    removeParticipant,
    updateLastMessage,
    recordStaffResponse,
    saveRating,
    saveRatingComment,
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

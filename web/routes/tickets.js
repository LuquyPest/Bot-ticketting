const express = require('express');
const router = express.Router();
const { createManager } = require('../../utils/ticketManager');
const { broadcast } = require('../../utils/sse');
const { getVisibleGradeIds, visibilityFilter, canUserSeeTicket, logAudit } = require('../../utils/gradePermissions');
const { syncTicketChannel } = require('../../utils/channelVisibility');
const { slaStatus, breachedSql } = require('../../utils/sla');
const { sendPushToGuild } = require('./push');

const VALID_STATUS   = new Set(['open', 'closed']);
const VALID_PRIORITY = new Set(['low', 'normal', 'urgent']);
const VALID_STAGE    = new Set(['open', 'waiting', 'in_progress']);
const SNOWFLAKE_RE   = /^\d{17,20}$/;
const DATE_RE        = /^\d{4}-\d{2}-\d{2}$/;

const { csvCell: csvEscape } = require('../../utils/csv');
const { recordEvent, dashboardActor } = require('../../utils/audit');
const { staffReplyDmEmbed, ticketNoticeDmEmbed } = require('../../utils/dmEmbeds');
const { ticketDmComponents } = require('../../utils/components');
const { t, sendToMember } = require('../../utils/i18n');
const { parseJsonField } = require('../../utils/jsonField');
const { escapeHtml } = require('../../utils/transcript');

async function checkAccess(req, ticketId) {
  const [ticket] = await req.guildDb('SELECT * FROM tickets WHERE id = ?', [ticketId]);
  if (!ticket) return { ticket: null, denied: false };
  if (req.userIsFondateur) return { ticket, denied: false };
  if (ticket.visibility_grade_id) {
    const visibleIds = await getVisibleGradeIds(req.session.user.id, req.guildDb);
    if (!visibleIds.includes(ticket.visibility_grade_id)) {
      return { ticket, denied: true };
    }
  }
  return { ticket, denied: false };
}

function hasPerm(req, perm) {
  return req.userIsFondateur || req.userPermissions?.has(perm);
}

// Loads req.params.id, enforcing view_tickets + grade visibility + any extra permission.
// Sends the error response itself and returns null when access is refused.
async function loadTicket(req, res, ...perms) {
  const missing = ['view_tickets', ...perms].find(p => !hasPerm(req, p));
  if (missing) { res.status(403).json({ error: 'Permission insuffisante' }); return null; }
  const { ticket, denied } = await checkAccess(req, req.params.id);
  if (!ticket) { res.status(404).json({ error: 'Ticket introuvable' }); return null; }
  if (denied)  { res.status(403).json({ error: 'Accès refusé' }); return null; }
  return ticket;
}

// Adds `assignees: [{ user_id, username, avatar }]` to each ticket row.
async function attachAssignees(req, tickets) {
  if (!tickets.length) return tickets;
  const rows = await req.guildDb(
    `SELECT a.ticket_id, a.user_id, COALESCE(u.username, a.user_id) AS username, u.avatar
     FROM ticket_assignees a LEFT JOIN dashboard_users u ON u.user_id = a.user_id
     WHERE a.ticket_id IN (?) ORDER BY a.assigned_at ASC`,
    [tickets.map(t => t.id)]
  );
  const byTicket = new Map();
  for (const r of rows) {
    if (!byTicket.has(r.ticket_id)) byTicket.set(r.ticket_id, []);
    byTicket.get(r.ticket_id).push({ user_id: r.user_id, username: r.username, avatar: r.avatar });
  }
  return tickets.map(t => ({ ...t, assignees: byTicket.get(t.id) || [] }));
}

// A staff member who can be assigned to `ticket` (dashboard support/fondateur allowed to see it), or null.
async function findAssignableStaff(req, userId, ticket) {
  if (!SNOWFLAKE_RE.test(String(userId))) return null;
  const [u] = await req.guildDb("SELECT user_id, username FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [String(userId)]);
  if (!u) return null;
  if (ticket && !(await canUserSeeTicket(req.guildDb, u.user_id, ticket.visibility_grade_id))) return null;
  return { id: u.user_id, username: u.username, tag: u.username };
}

function getManager(req) {
  return createManager(req.guildDb, req.app.locals.client, req.guildId);
}

router.get('/', async (req, res) => {
  if (!hasPerm(req, 'view_tickets')) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const str = k => (typeof req.query[k] === 'string' ? req.query[k] : '');
    const status = str('status'), priority = str('priority'), subject = str('subject').slice(0, 100);
    const stage = str('stage'), claimed = str('claimed'), dateFrom = str('dateFrom'), dateTo = str('dateTo');
    const assignee = str('assignee') === 'me' ? req.session.user.id : str('assignee');
    const tag = parseInt(str('tag')) || null;
    const sla = str('sla');
    if (status   && !VALID_STATUS.has(status))    return res.status(400).json({ error: 'Statut invalide' });
    if (priority && !VALID_PRIORITY.has(priority)) return res.status(400).json({ error: 'Priorité invalide' });
    if (stage    && !VALID_STAGE.has(stage))       return res.status(400).json({ error: 'Étape invalide' });
    if (assignee && !SNOWFLAKE_RE.test(assignee))  return res.status(400).json({ error: 'Assigné invalide' });
    if ((dateFrom && !DATE_RE.test(dateFrom)) || (dateTo && !DATE_RE.test(dateTo))) return res.status(400).json({ error: 'Date invalide' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];

    const vis = await visibilityFilter(req);
    where.push(vis.sql);
    params.push(...vis.params);
    if (status)   { where.push('status = ?');     params.push(status); }
    if (priority) { where.push('priority = ?');   params.push(priority); }
    if (subject)  { where.push('subject LIKE ?'); params.push(`%${subject}%`); }
    if (stage)    { where.push('stage = ?');      params.push(stage); }
    if (claimed === 'true')  where.push('EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = tickets.id)');
    if (claimed === 'false') where.push('NOT EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = tickets.id)');
    if (assignee) { where.push('EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = tickets.id AND a.user_id = ?)'); params.push(assignee); }
    if (dateFrom) { where.push('created_at >= ?'); params.push(dateFrom); }
    if (dateTo)   { where.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(dateTo); }
    if (tag)      { where.push('EXISTS (SELECT 1 FROM ticket_tag_assignments ta WHERE ta.ticket_id = tickets.id AND ta.tag_id = ?)'); params.push(tag); }
    const [slaCfg] = await req.guildDb('SELECT sla_open_hours, sla_waiting_hours, sla_in_progress_hours FROM guild_config WHERE id = 1');
    if (sla === 'breached') { const b = breachedSql(slaCfg); where.push(b.sql); params.push(...b.params); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [tickets, [{ total }]] = await Promise.all([
      req.guildDb(
        `SELECT id, owner_id, owner_tag, channel_id, claimed_by, status, stage, stage_changed_at, subject, priority, last_message_at, created_at, closed_at, closed_by_tag FROM tickets ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      req.guildDb(`SELECT COUNT(*) as total FROM tickets ${whereClause}`, params)
    ]);

    const withSla = tickets.map(t => ({ ...t, sla: slaStatus(t, slaCfg) }));
    res.json({ tickets: await attachAssignees(req, withSla), total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/export', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  try {
    const tickets = await req.guildDb(
      'SELECT id, owner_tag, subject, status, priority, claimed_by, created_at, closed_at, closed_by_tag FROM tickets ORDER BY id DESC'
    );
    const header = 'ID,Utilisateur,Sujet,Statut,Priorité,Pris en charge,Créé le,Fermé le,Fermé par\n';
    const rows = tickets.map(t => [
      t.id,
      csvEscape(t.owner_tag),
      csvEscape(t.subject),
      t.status,
      t.priority,
      csvEscape(t.claimed_by),
      t.created_at ? new Date(t.created_at).toISOString() : '',
      t.closed_at  ? new Date(t.closed_at).toISOString()  : '',
      csvEscape(t.closed_by_tag),
    ].join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tickets.csv"');
    res.send('﻿' + header + rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tickets/staff — staff members tickets can be assigned to
router.get('/staff', async (req, res) => {
  if (!hasPerm(req, 'view_tickets')) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const staff = await req.guildDb(
      "SELECT user_id, username, avatar, role FROM dashboard_users WHERE role IN ('support', 'fondateur') ORDER BY username ASC"
    );
    res.json(staff);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res);
    if (!ticket) return;

    const [participantRows, transcript, rating] = await Promise.all([
      req.guildDb('SELECT user_id FROM ticket_participants WHERE ticket_id = ?', [ticket.id]),
      req.guildDb('SELECT id, created_by_tag, created_at, message_count FROM transcript_snapshots WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1', [ticket.id]),
      req.guildDb('SELECT rating, comment, rated_at FROM ticket_ratings WHERE ticket_id = ? LIMIT 1', [ticket.id])
    ]);

    const client = req.app.locals.client;
    const participants = await Promise.all(
      participantRows.map(async p => {
        const u = await client?.users.fetch(p.user_id).catch(() => null);
        return { id: p.user_id, tag: u?.username || p.user_id };
      })
    );

    const [cfg] = await req.guildDb('SELECT ticket_category_id, waiting_category_id, in_progress_category_id, sla_open_hours, sla_waiting_hours, sla_in_progress_hours FROM guild_config WHERE id = 1');
    res.json({
      ...ticket,
      participants,
      assignees: await getManager(req).getAssignees(ticket.id),
      // Stages whose Discord category is configured (Paramètres)
      stages: { open: !!cfg?.ticket_category_id, waiting: !!cfg?.waiting_category_id, in_progress: !!cfg?.in_progress_category_id },
      sla: slaStatus(ticket, cfg),
      transcript: transcript[0] || null,
      rating: rating[0] || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tickets/:id/merge-candidates — other open tickets of the same member
router.get('/:id/merge-candidates', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'close_ticket');
    if (!ticket) return;
    const vis = await visibilityFilter(req);
    const rows = await req.guildDb(
      `SELECT id, subject, stage, created_at, last_message_at FROM tickets
       WHERE owner_id = ? AND status = 'open' AND id <> ? AND ${vis.sql} ORDER BY created_at DESC`,
      [ticket.owner_id, ticket.id, ...vis.params]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tickets/:id/merge { into } — merges this ticket into another one of the same member
router.post('/:id/merge', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'close_ticket', 'reply_ticket');
    if (!ticket) return;
    const intoId = parseInt(req.body.into);
    if (!intoId) return res.status(400).json({ error: 'Ticket cible requis' });
    const { ticket: target, denied } = await checkAccess(req, intoId);
    if (!target || denied) return res.status(404).json({ error: 'Ticket cible introuvable' });
    const result = await getManager(req).mergeTickets(ticket.id, target.id, dashboardActor(req));
    if (!result.ok) return res.status(400).json({ error: result.error });
    broadcast('ticket', { id: ticket.id, status: 'closed', merged_into: target.id }, req.guildId);
    broadcast('ticket', { id: target.id }, req.guildId);
    res.json({ ok: true, into: target.id, movedNotes: result.movedNotes, transcriptId: result.transcriptId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id/priority', async (req, res) => {
  try {
    const { priority } = req.body;
    if (!VALID_PRIORITY.has(priority)) return res.status(400).json({ error: 'Priorité invalide' });
    // Same permission as the other ticket edits (and as /priority on Discord, open to support)
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    const ticketId = ticket.id;

    await getManager(req).setPriority(ticketId, priority, dashboardActor(req));
    await getManager(req).updateChannelTopic(ticketId).catch(() => null);
    broadcast('ticket', { id: ticketId, priority }, req.guildId);

    // Mention support roles when escalated to urgent
    if (priority === 'urgent') {
      const client = req.app.locals.client;
      if (client && ticket.channel_id) {
        const [cfg] = await req.guildDb('SELECT support_role_ids FROM guild_config WHERE id = 1');
        const roleIds = parseJsonField(cfg?.support_role_ids);
        if (roleIds.length) {
          const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
          if (channel) {
            const mentions = roleIds.map(id => `<@&${id}>`).join(' ');
            await channel.send({ content: `🚨 **Ticket passé en priorité Urgente** — ${mentions}`, allowedMentions: { roles: roleIds } }).catch(() => null);
          }
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUS.has(status)) return res.status(400).json({ error: 'Statut invalide' });

  try {
    const ticket = await loadTicket(req, res, 'close_ticket');
    if (!ticket) return;
    if (ticket.status === status) return res.json({ ok: true });

    const staffUser = dashboardActor(req);
    const tm = getManager(req);
    const client = req.app.locals.client;

    if (status === 'closed') {
      const channel = client ? await client.channels.fetch(ticket.channel_id).catch(() => null) : null;
      if (channel) {
        await tm.closeTicketWithTranscript(channel, staffUser);
      } else {
        await req.guildDb(
          'UPDATE tickets SET status = "closed", closed_at = NOW(), closed_by_tag = ?, closed_by_id = ? WHERE id = ?',
          [staffUser.tag, staffUser.id, ticket.id]
        );
      }
    } else {
      await tm.reopenTicket(ticket, staffUser);
    }
    broadcast('ticket', { id: ticket.id, status }, req.guildId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/:id/notes', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res);
    if (!ticket) return;

    const notes = await req.guildDb(
      'SELECT id, author_id, author_tag, content, source, created_at FROM ticket_notes WHERE ticket_id = ? ORDER BY created_at ASC',
      [ticket.id]
    );
    res.json(notes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/:id/notes', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;

    const { content } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Contenu requis' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ error: 'Contenu trop long (max 2000 caractères)' });
    }

    const trimmed = content.trim();
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'ticket_note', ticketId: ticket.id, details: { excerpt: trimmed.slice(0, 120) } });
    const result = await req.guildDb(
      'INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, "web")',
      [ticket.id, req.session.user.id, req.session.user.username, trimmed]
    );

    const client = req.app.locals.client;
    if (client && ticket.channel_id && ticket.status === 'open') {
      const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel) {
        await channel.send(`📌 **Note dashboard** · ${req.session.user.username}\n${trimmed}`).catch(() => null);
      }
    }

    const note = {
      id: result.insertId,
      author_id: req.session.user.id,
      author_tag: req.session.user.username,
      content: trimmed,
      source: 'web',
      created_at: new Date()
    };
    broadcast('note', { ticketId: ticket.id, note }, req.guildId);
    const mentioned = await require('../../utils/mentions').notifyMentions(req.guildDb, client, req.guildId, ticket, trimmed, req.session.user);
    res.json({ ...note, mentioned });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Sends a staff reply to the ticket owner/participants and the Discord channel, records it and notifies.
// upload: { buffer, name } — a real file sent from the dashboard (attached to the channel
// message and to the member's DM; the history keeps the channel attachment URL).
async function sendStaffReply(req, ticket, { content, file_url, anonymous, upload = null }) {
  const sender = anonymous ? 'Support' : req.session.user.username;
  let msg = `--- ${sender} : ${content || ''}`.trim();
  if (file_url) msg += `\nFichier : ${file_url}`;

  const tm = getManager(req);
  const client = req.app.locals.client;
  const linkedUserIds = await tm.getAllLinkedUserIds(ticket.id);

  const channel = client && ticket.channel_id ? await client.channels.fetch(ticket.channel_id).catch(() => null) : null;
  if (upload) {
    const sent = await channel?.send({ content: msg.slice(0, 2000), files: [{ attachment: upload.buffer, name: upload.name }] }).catch(() => null);
    file_url = sent?.attachments?.first?.()?.url || null;
  } else if (channel) {
    await channel.send(msg).catch(() => null);
  }

  // DM: embed naming the server and the ticket (a member can have tickets on several servers)
  // Each member receives the reply in their language
  for (const userId of linkedUserIds) {
    await sendToMember(client, userId, req.guildId, () => {
      const dmEmbed = staffReplyDmEmbed(client, req.guildId, ticket, { sender, content, fileUrl: upload ? null : file_url });
      if (upload) dmEmbed.addFields({ name: t('reply.fileAttached'), value: upload.name.slice(0, 1024) });
      return {
        embeds: [dmEmbed], components: ticketDmComponents(ticket, req.guildId, userId),
        ...(upload ? { files: [{ attachment: upload.buffer, name: upload.name }] } : {}),
      };
    });
  }

  const staffUser = dashboardActor(req);
  await tm.recordStaffResponse(ticket.id, staffUser);
  await tm.updateLastMessage(ticket.id);

  await recordEvent(req.guildDb, {
    actor: dashboardActor(req), action: 'ticket_reply', ticketId: ticket.id,
    details: { anonymous: !!anonymous, excerpt: (content || upload?.name || file_url || '').slice(0, 120), ...(upload ? { file: upload.name } : {}) },
  });
  const noteAuthorTag = anonymous ? `${req.session.user.username} (anonyme)` : req.session.user.username;
  const noteContent = [content, upload ? `📎 ${upload.name}${file_url ? ` : ${file_url}` : ''}` : file_url].filter(Boolean).join('\n');
  const result = await req.guildDb(
    'INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, "reply")',
    [ticket.id, req.session.user.id, noteAuthorTag, noteContent]
  );

  const replyNote = {
    id: result.insertId,
    author_id: req.session.user.id,
    author_tag: noteAuthorTag,
    content: noteContent,
    source: 'reply',
    created_at: new Date()
  };
  broadcast('note', { ticketId: ticket.id, note: replyNote }, req.guildId);
  // Push notification to all subscribers of this guild when staff replies
  sendPushToGuild(req.guildId, {
    type: 'reply',
    title: `Réponse #${ticket.id}`,
    body: `${anonymous ? 'Support' : req.session.user.username} : ${(content || 'Fichier joint').slice(0, 100)}`,
    ticketId: ticket.id,
  }).catch(() => null);
  return replyNote;
}

// POST /api/tickets/:id/reply-file — multipart: file (8 Mo max) + optional content / anonymous
const multer = require('multer');
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const uploadOne = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 4 } }).single('file');
const cleanFileName = n => (String(n || 'fichier').normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'fichier').slice(0, 100);

router.post('/:id/reply-file', (req, res, next) => uploadOne(req, res, err => {
  if (!err) return next();
  res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (8 Mo max)' : 'Envoi du fichier invalide' });
}), async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket fermé' });
    if (!req.file?.buffer?.length) return res.status(400).json({ error: 'Fichier requis' });
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    if (content.length > 2000) return res.status(400).json({ error: 'Contenu trop long (max 2000)' });
    if (!req.app.locals.client) return res.status(503).json({ error: 'Bot Discord non disponible' });
    const note = await sendStaffReply(req, ticket, {
      content, anonymous: req.body.anonymous === 'true',
      upload: { buffer: req.file.buffer, name: cleanFileName(req.file.originalname) },
    });
    res.json({ ok: true, note });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tickets/:id/apply-template { templateId, content, anonymous } — macro: sends the
// (possibly edited) reply, then applies the template's actions. Each action needs its own
// permission; refused or impossible actions are reported, not fatal.
router.post('/:id/apply-template', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket fermé' });
    const tpl = await require('./templates').visibleTemplate(req, parseInt(req.body.templateId));
    if (!tpl) return res.status(404).json({ error: 'Modèle introuvable' });
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    if (!content) return res.status(400).json({ error: 'Contenu requis' });
    if (content.length > 2000) return res.status(400).json({ error: 'Contenu trop long (max 2000)' });

    await sendStaffReply(req, ticket, { content, anonymous: !!req.body.anonymous });
    await req.guildDb('UPDATE reply_templates SET use_count = use_count + 1 WHERE id = ?', [tpl.id]);

    const tm = getManager(req);
    const { applied, warnings } = await require('../../utils/macroActions').applyMacroActions({
      client: req.app.locals.client, db: req.guildDb, tm, ticket, actions: tpl.actions, actor: dashboardActor(req), can: p => hasPerm(req, p),
    });
    const [fresh] = await req.guildDb('SELECT status, stage, priority FROM tickets WHERE id = ?', [ticket.id]);
    broadcast('ticket', { id: ticket.id, ...fresh, assignees: await tm.getAssignees(ticket.id) }, req.guildId);
    res.json({ ok: true, applied, warnings, ticket: fresh });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tickets/:id/typing { mode: 'reply' | 'note', stop } — "X is writing" signal, sent by
// the dashboard every few seconds while composing; relayed live to the others seeing the ticket.
router.post('/:id/typing', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    const mode = req.body.mode === 'note' ? 'note' : 'reply';
    broadcast('typing', {
      ticketId: ticket.id, userId: req.session.user.id, username: req.session.user.username,
      mode, stop: !!req.body.stop,
    }, req.guildId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/:id/reply', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket fermé' });

    const { content, file_url, anonymous } = req.body;
    if (!content && !file_url) return res.status(400).json({ error: 'Contenu requis' });
    if (content && typeof content !== 'string') return res.status(400).json({ error: 'Contenu invalide' });
    if (content && content.length > 2000) return res.status(400).json({ error: 'Contenu trop long (max 2000)' });
    if (file_url !== undefined && file_url !== null) {
      if (typeof file_url !== 'string') return res.status(400).json({ error: 'file_url invalide' });
      let parsedUrl;
      try { parsedUrl = new URL(file_url); } catch { return res.status(400).json({ error: 'file_url invalide' }); }
      if (parsedUrl.protocol !== 'https:') return res.status(400).json({ error: 'file_url doit être HTTPS' });
      const ALLOWED_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net', 'images-ext-1.discordapp.net', 'images-ext-2.discordapp.net'];
      if (!ALLOWED_HOSTS.includes(parsedUrl.hostname)) {
        return res.status(400).json({ error: 'file_url : hôte non autorisé (Discord CDN uniquement)' });
      }
    }

    const replyNote = await sendStaffReply(req, ticket, { content, file_url, anonymous });
    res.json(replyNote);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Channel message + topic refresh + live update after the assignee list changed.
async function notifyAssignment(req, ticket, message) {
  const tm = getManager(req);
  const client = req.app.locals.client;
  if (client && ticket.channel_id) {
    const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
    if (channel) await channel.send(message).catch(() => null);
  }
  await tm.updateChannelTopic(ticket.id).catch(() => null);
  const assignees = await tm.getAssignees(ticket.id);
  const [t] = await req.guildDb('SELECT claimed_by FROM tickets WHERE id = ?', [ticket.id]);
  broadcast('ticket', { id: ticket.id, claimed_by: t?.claimed_by || null, assignees }, req.guildId);
}

// POST /api/tickets/:id/assignees — { user_id } : assign another staff member
router.post('/:id/assignees', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'claim_ticket');
    if (!ticket) return;
    if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket fermé' });
    const target = await findAssignableStaff(req, req.body.user_id, ticket);
    if (!target) return res.status(400).json({ error: 'Membre du staff introuvable ou sans accès à ce ticket' });

    const me = dashboardActor(req);
    const added = await getManager(req).addAssignee(ticket.id, target, me);
    if (added) {
      await notifyAssignment(req, ticket, target.id === me.id
        ? `✅ **${me.username}** s'est assigné au ticket (dashboard).`
        : `👥 <@${target.id}> a été assigné au ticket par **${me.username}** (dashboard).`);
    }
    res.json({ ok: true, assignees: await getManager(req).getAssignees(ticket.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/tickets/:id/assignees/:userId
router.delete('/:id/assignees/:userId', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'claim_ticket');
    if (!ticket) return;
    if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket fermé' });
    const removed = await getManager(req).removeAssignee(ticket.id, String(req.params.userId), dashboardActor(req));
    if (removed) {
      const [u] = await req.guildDb('SELECT username FROM dashboard_users WHERE user_id = ?', [String(req.params.userId)]);
      const name = u?.username || req.params.userId;
      await notifyAssignment(req, ticket, String(req.params.userId) === req.session.user.id
        ? `🔓 **${name}** s'est retiré du ticket (dashboard).`
        : `🔓 **${name}** a été retiré du ticket par **${req.session.user.username}** (dashboard).`);
    }
    res.json({ ok: true, assignees: await getManager(req).getAssignees(ticket.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/:id/participants', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'manage_participants');
    if (!ticket) return;
    if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket fermé' });

    const { discord_id } = req.body;
    if (!discord_id || !/^\d{17,20}$/.test(String(discord_id))) {
      return res.status(400).json({ error: 'Discord ID invalide (17-20 chiffres)' });
    }
    if (discord_id === ticket.owner_id) {
      return res.status(400).json({ error: 'Cet utilisateur est déjà le propriétaire du ticket' });
    }

    const client = req.app.locals.client;
    const discordUser = await client?.users.fetch(discord_id).catch(() => null);
    if (!discordUser) return res.status(400).json({ error: 'Utilisateur Discord introuvable' });
    if (discordUser.bot) return res.status(400).json({ error: 'Impossible d\'ajouter un bot' });

    const tm = getManager(req);
    const existingTicket = await tm.getAnyOpenTicketForUser(discord_id);
    if (existingTicket && existingTicket.id !== ticket.id) {
      return res.status(400).json({ error: `Cet utilisateur a déjà un ticket ouvert (#${existingTicket.id})` });
    }

    await tm.addParticipant(ticket.id, discord_id);

    const staffUser = dashboardActor(req);
    await tm.logAddUser(ticket.id, discord_id, staffUser);
    broadcast('participant_add', { ticketId: ticket.id, userId: discord_id, tag: discordUser.username }, req.guildId);

    await sendToMember(client, discordUser, req.guildId, () => ({ embeds: [ticketNoticeDmEmbed(client, req.guildId, ticket, {
      title: t('added.title'), description: t('added.body'), footer: t('reply.footer', { id: ticket.id }),
    })] }));

    if (client && ticket.channel_id) {
      const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel) await channel.send(
        `--- ${req.session.user.username} : a ajouté ${discordUser.username} comme participant DM lié au ticket`
      ).catch(() => null);
    }

    res.json({ id: discord_id, tag: discordUser.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id/participants/:userId', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'manage_participants');
    if (!ticket) return;
    if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket fermé' });

    const { userId } = req.params;
    if (userId === ticket.owner_id) {
      return res.status(400).json({ error: 'Impossible de retirer le propriétaire principal' });
    }

    const tm = getManager(req);
    await tm.removeParticipant(ticket.id, userId);

    const staffUser = dashboardActor(req);
    await tm.logRemoveUser(ticket.id, userId, staffUser);
    broadcast('participant_remove', { ticketId: ticket.id, userId }, req.guildId);

    const client = req.app.locals.client;
    if (client && ticket.channel_id) {
      const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel) await channel.send(
        `--- ${req.session.user.username} : a retiré l'utilisateur ${userId} des participants DM liés au ticket`
      ).catch(() => null);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id/move', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket fermé' });

    const { stage } = req.body;
    if (!VALID_STAGE.has(stage)) return res.status(400).json({ error: 'Étape invalide (open | waiting | in_progress)' });
    if (!req.app.locals.client) return res.status(503).json({ error: 'Bot Discord non disponible' });

    const tm = getManager(req);
    const result = await tm.moveToStage(ticket.id, stage, dashboardActor(req));
    if (!result.ok) return res.status(400).json({ error: result.error });
    await tm.updateChannelTopic(ticket.id).catch(() => null);
    broadcast('ticket', { id: ticket.id, stage }, req.guildId);
    res.json({ ok: true, stage, label: result.label });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/tickets/:id/subject — the title: also the Discord channel name (kept identical)
router.patch('/:id/subject', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;

    const { subject } = req.body;
    if (subject !== undefined && subject !== null && typeof subject !== 'string') {
      return res.status(400).json({ error: 'Titre invalide' });
    }
    const result = await getManager(req).setSubject(ticket.id, subject, dashboardActor(req));
    res.json({ ok: true, subject: result.subject, channelName: result.channelName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id/visibility', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'manage_grades');
    if (!ticket) return;

    const { visibility_grade_id } = req.body;
    const gradeId = visibility_grade_id ? parseInt(visibility_grade_id) : null;

    if (gradeId) {
      const [grade] = await req.guildDb('SELECT id FROM grades WHERE id = ?', [gradeId]);
      if (!grade) return res.status(400).json({ error: 'Grade introuvable' });
    }

    await req.guildDb('UPDATE tickets SET visibility_grade_id = ? WHERE id = ?', [gradeId, ticket.id]);
    await logAudit(
      req.session.user.id, req.session.user.username,
      'ticket_visibility_change', 'ticket', ticket.id,
      { visibility_grade_id: gradeId }, req.guildDb
    );
    broadcast('ticket', { id: ticket.id, visibility_grade_id: gradeId }, req.guildId);
    // Hide / show the Discord channel accordingly
    const channelSync = await syncTicketChannel(req.guildDb, req.app.locals.client, req.guildId, { ...ticket, visibility_grade_id: gradeId });
    res.json({ ok: true, visibility_grade_id: gradeId, channelSync: channelSync.ok ? 'ok' : channelSync.reason });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/:id/history', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res);
    if (!ticket) return;

    const history = await req.guildDb(
      `SELECT id, status, subject, priority, claimed_by, created_at, closed_at, closed_by_tag
       FROM tickets WHERE owner_id = ? ORDER BY created_at DESC`,
      [ticket.owner_id]
    );
    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id/notes/:noteId', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res);
    if (!ticket) return;
    const [note] = await req.guildDb('SELECT * FROM ticket_notes WHERE id = ?', [req.params.noteId]);
    if (!note) return res.status(404).json({ error: 'Note introuvable' });
    if (note.ticket_id !== ticket.id) {
      return res.status(400).json({ error: 'Note invalide' });
    }
    if (!req.userIsFondateur && note.author_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    await req.guildDb('DELETE FROM ticket_notes WHERE id = ?', [note.id]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'note_delete', ticketId: ticket.id, details: { author: note.author_tag, excerpt: String(note.content || '').slice(0, 120) } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/bulk', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  const { ids, action, value } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'IDs requis' });
  if (ids.length > 100) return res.status(400).json({ error: 'Maximum 100 tickets' });
  const cleanIds = ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!cleanIds.length) return res.status(400).json({ error: 'IDs invalides' });

  try {
    if (action === 'priority') {
      if (!VALID_PRIORITY.has(value)) return res.status(400).json({ error: 'Priorité invalide' });
      const tm = getManager(req);
      for (const id of cleanIds) await tm.setPriority(id, value, dashboardActor(req)); // one journal entry per ticket
      cleanIds.forEach(id => broadcast('ticket', { id, priority: value }, req.guildId));
      return res.json({ ok: true, affected: cleanIds.length });
    }
    if (action === 'close') {
      const tickets = await req.guildDb("SELECT id, channel_id, status FROM tickets WHERE id IN (?) AND status = 'open'", [cleanIds]);
      if (!tickets.length) return res.json({ ok: true, affected: 0 });
      const tm = getManager(req);
      const client = req.app.locals.client;
      const staffUser = dashboardActor(req);
      for (const ticket of tickets) {
        const channel = client ? await client.channels.fetch(ticket.channel_id).catch(() => null) : null;
        if (channel) {
          await channel.send(`🔒 Ticket fermé en masse par ${staffUser.tag}.`).catch(() => null);
          await tm.closeTicketWithTranscript(channel, staffUser).catch(() => null);
        } else {
          await req.guildDb("UPDATE tickets SET status='closed', closed_at=NOW(), closed_by_tag=?, closed_by_id=? WHERE id=?", [staffUser.tag, staffUser.id, ticket.id]);
          broadcast('ticket', { id: ticket.id, status: 'closed' }, req.guildId);
        }
      }
      return res.json({ ok: true, affected: tickets.length });
    }
    if (action === 'assign') {
      const tickets = await req.guildDb("SELECT * FROM tickets WHERE id IN (?) AND status = 'open'", [cleanIds]);
      const tm = getManager(req);
      const me = dashboardActor(req);
      let affected = 0;
      for (const ticket of tickets) {
        const target = await findAssignableStaff(req, value, ticket);
        if (!target) continue;
        if (await tm.addAssignee(ticket.id, target, me)) {
          affected++;
          await notifyAssignment(req, ticket, `👥 <@${target.id}> a été assigné au ticket par **${me.username}** (dashboard).`);
        }
      }
      return res.json({ ok: true, affected });
    }
    if (action === 'add_tag') {
      const [tag] = await req.guildDb('SELECT id, name FROM ticket_tags WHERE id = ?', [parseInt(value)]);
      if (!tag) return res.status(400).json({ error: 'Tag introuvable' });
      for (const id of cleanIds) {
        const r = await req.guildDb('INSERT IGNORE INTO ticket_tag_assignments (ticket_id, tag_id) VALUES (?, ?)', [id, tag.id]);
        if (r.affectedRows) await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'ticket_tag_add', ticketId: id, targetType: 'tag', targetId: tag.id, details: { tag: tag.name } });
      }
      return res.json({ ok: true, affected: cleanIds.length });
    }
    if (action === 'reopen') {
      const tickets = await req.guildDb("SELECT * FROM tickets WHERE id IN (?) AND status = 'closed'", [cleanIds]);
      const tm = getManager(req);
      const staffUser = dashboardActor(req);
      let affected = 0;
      for (const ticket of tickets) {
        try { await tm.reopenTicket(ticket, staffUser); affected++; broadcast('ticket', { id: ticket.id, status: 'open' }, req.guildId); } catch { /* channel creation failed */ }
      }
      return res.json({ ok: true, affected });
    }
    if (action === 'send_template') {
      // Shared templates, or the user's own personal ones
      const tpl = await require('./templates').visibleTemplate(req, parseInt(value));
      if (!tpl) return res.status(400).json({ error: 'Template introuvable' });
      const tickets = await req.guildDb("SELECT * FROM tickets WHERE id IN (?) AND status = 'open'", [cleanIds]);
      for (const ticket of tickets) await sendStaffReply(req, ticket, { content: tpl.content, anonymous: false });
      return res.json({ ok: true, affected: tickets.length });
    }
    return res.status(400).json({ error: 'Action invalide' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res);
    if (!ticket) return;

    const notes = await req.guildDb(
      'SELECT author_tag, content, source, created_at FROM ticket_notes WHERE ticket_id = ? ORDER BY created_at ASC',
      [ticket.id]
    );

    const nonce = require('crypto').randomBytes(16).toString('base64');
    const SOURCE_LABEL = { reply: 'Réponse Staff', user: 'Utilisateur', discord: 'Discord', web: 'Note interne' };
    const SOURCE_COLOR = { reply: '#4f46e5', user: '#7c3aed', discord: '#1e3a5f', web: '#374151' };

    const esc = s => escapeHtml(s || '');

    const notesHtml = notes.map(n => `
      <div class="message" style="border-left:3px solid ${SOURCE_COLOR[n.source] || '#374151'};padding:10px 14px;margin:10px 0;background:#f9fafb;border-radius:4px">
        <div class="meta" style="font-size:11px;color:#6b7280;margin-bottom:4px">
          <strong>${esc(n.author_tag)}</strong> · ${esc(SOURCE_LABEL[n.source] || n.source)} · ${new Date(n.created_at).toLocaleString('fr-FR')}
        </div>
        <div style="font-size:13px;white-space:pre-wrap;word-break:break-word">${esc(n.content)}</div>
      </div>`).join('');
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Ticket #${ticket.id} — ${esc(ticket.subject || 'Sans sujet')}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;color:#111827;background:#fff;max-width:800px;margin:0 auto;padding:24px}
  h1{font-size:20px;margin:0 0 4px}
  .meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;background:#f3f4f6;padding:14px;border-radius:8px;margin:16px 0}
  .meta-cell{font-size:12px;color:#6b7280}.meta-cell strong{display:block;font-size:13px;color:#111827;margin-top:2px}
  hr{border:0;border-top:1px solid #e5e7eb;margin:20px 0}
  @media print{body{padding:0}button{display:none}}
</style></head><body>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
  <h1>Ticket #${ticket.id} — ${esc(ticket.subject || 'Sans sujet')}</h1>
  <button id="print" style="padding:8px 14px;background:#4f46e5;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:13px">Imprimer / PDF</button>
</div>
<div class="meta-grid">
  <div class="meta-cell">Utilisateur<strong>${esc(ticket.owner_tag) || '—'}</strong></div>
  <div class="meta-cell">Statut<strong>${ticket.status === 'open' ? 'Ouvert' : 'Fermé'}</strong></div>
  <div class="meta-cell">Priorité<strong>${ticket.priority}</strong></div>
  <div class="meta-cell">Pris en charge<strong>${esc(ticket.claimed_by) || '—'}</strong></div>
  <div class="meta-cell">Créé le<strong>${ticket.created_at ? new Date(ticket.created_at).toLocaleString('fr-FR') : '—'}</strong></div>
  <div class="meta-cell">Fermé le<strong>${ticket.closed_at ? new Date(ticket.closed_at).toLocaleString('fr-FR') : '—'}</strong></div>
</div>
<hr>
<h2 style="font-size:14px;color:#374151;margin:0 0 12px">Historique des messages (${notes.length})</h2>
${notesHtml || '<p style="color:#6b7280;font-size:13px;text-align:center;padding:20px">Aucun message</p>'}
<div style="margin-top:24px;font-size:11px;color:#9ca3af;text-align:center">
  Exporté le ${new Date().toLocaleString('fr-FR')} — Ticket Bot Dashboard
</div>
<script nonce="${nonce}">document.getElementById('print').addEventListener('click', () => window.print());</script>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`);
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

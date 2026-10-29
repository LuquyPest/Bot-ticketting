const express = require('express');
const router = express.Router();
const { createManager } = require('../../utils/ticketManager');
const { broadcast } = require('../../utils/sse');
const { getVisibleGradeIds, visibilityFilter, canUserSeeTicket, logAudit } = require('../../utils/gradePermissions');
const { syncTicketChannel } = require('../../utils/channelVisibility');
const { slaStatus, breachedSql } = require('../../utils/sla');
const { fieldsForTicket, saveFieldValues } = require('../../utils/ticketFields');
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
const { searchMessages, SOURCES } = require('../../utils/messageSearch');
const presence = require('../../utils/ticketPresence');

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
    // Operators in the search box (tag:VIP de:pseudo avant:2026-10-01 étape:attente…): utils/searchQuery.js
    const search = require('../../utils/searchQuery').parseSearch(str('subject'));
    if (search.error) return res.status(400).json({ error: search.error });
    const op = search.filters;
    const status = op.status || str('status'), priority = op.priority || str('priority'), subject = search.text.slice(0, 100);
    const stage = op.stage || str('stage'), claimed = str('claimed');
    const dateFrom = op.after || str('dateFrom'), dateTo = str('dateTo');
    let assignee = str('assignee') === 'me' ? req.session.user.id : str('assignee');
    let unassigned = false;
    if (op.assignee) {
      const a = op.assignee.toLowerCase();
      if (['moi', 'me'].includes(a)) assignee = req.session.user.id;
      else if (['personne', 'aucun', 'none'].includes(a)) unassigned = true;
      else {
        const [u] = await req.guildDb("SELECT user_id FROM dashboard_users WHERE username = ? AND role IN ('support', 'fondateur')", [op.assignee]);
        if (!u) return res.status(400).json({ error: `Membre du staff inconnu : ${op.assignee}` });
        assignee = u.user_id;
      }
    }
    const following = str('following') === 'me';
    const tag = parseInt(str('tag')) || null;
    const sla = str('sla');
    const fieldId = parseInt(str('field')) || null, fieldValue = str('fieldValue').slice(0, 100);
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
    if (claimed === 'false' || unassigned) where.push('NOT EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = tickets.id)');
    if (following) { where.push('EXISTS (SELECT 1 FROM ticket_followers tf WHERE tf.ticket_id = tickets.id AND tf.user_id = ?)'); params.push(req.session.user.id); }
    const like = v => `%${v.replace(/[%_\\]/g, '\\$&')}%`;
    for (const name of op.tag) {
      where.push('EXISTS (SELECT 1 FROM ticket_tag_assignments ta JOIN ticket_tags tg ON tg.id = ta.tag_id WHERE ta.ticket_id = tickets.id AND tg.name = ?)');
      params.push(name);
    }
    for (const who of op.from) {
      if (SNOWFLAKE_RE.test(who)) { where.push('owner_id = ?'); params.push(who); }
      else { where.push('owner_tag LIKE ?'); params.push(like(who)); }
    }
    for (const words of op.subject) { where.push('subject LIKE ?'); params.push(like(words)); }
    if (op.before) { where.push('created_at < ?'); params.push(op.before); }
    if (assignee) { where.push('EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = tickets.id AND a.user_id = ?)'); params.push(assignee); }
    if (dateFrom) { where.push('created_at >= ?'); params.push(dateFrom); }
    if (dateTo)   { where.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(dateTo); }
    if (tag)      { where.push('EXISTS (SELECT 1 FROM ticket_tag_assignments ta WHERE ta.ticket_id = tickets.id AND ta.tag_id = ?)'); params.push(tag); }
    const [slaCfg] = await req.guildDb('SELECT sla_open_hours, sla_waiting_hours, sla_in_progress_hours FROM guild_config WHERE id = 1');
    if (sla === 'breached') { const b = breachedSql(slaCfg); where.push(b.sql); params.push(...b.params); }
    if (fieldId && fieldValue) {
      where.push('EXISTS (SELECT 1 FROM ticket_field_values fv WHERE fv.ticket_id = tickets.id AND fv.field_id = ? AND fv.value LIKE ?)');
      params.push(fieldId, `%${fieldValue.replace(/[%_\\]/g, '\\$&')}%`);
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [tickets, [{ total }]] = await Promise.all([
      req.guildDb(
        `SELECT id, owner_id, owner_tag, channel_id, claimed_by, status, stage, stage_changed_at, subject, priority, visibility_grade_id, last_message_at, created_at, closed_at, closed_by_tag FROM tickets ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
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

// GET /api/tickets/search?q=…&source=member|staff|notes&status=&page= — full-text search in
// conversations and subjects, limited to the tickets the user can see
router.get('/search', async (req, res) => {
  if (!hasPerm(req, 'view_tickets')) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (q.length < 2) return res.status(400).json({ error: 'Saisis au moins 2 caractères' });
    const source = typeof req.query.source === 'string' && SOURCES[req.query.source] ? req.query.source : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status && !VALID_STATUS.has(status)) return res.status(400).json({ error: 'Statut invalide' });
    const page = Math.max(1, Math.min(500, parseInt(req.query.page) || 1));
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    res.json(await searchMessages(req.guildDb, { q, source, status, vis, page }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tickets/presence — { ticketId: [viewers] } for the visible tickets open in a dashboard
router.get('/presence', async (req, res) => {
  if (!hasPerm(req, 'view_tickets')) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const all = await presence.allViewers(req.guildId);
    const ids = Object.keys(all).map(Number);
    if (!ids.length) return res.json({});
    const vis = await visibilityFilter(req);
    const visible = await req.guildDb(`SELECT id FROM tickets WHERE id IN (?) AND ${vis.sql}`, [ids, ...vis.params]);
    res.json(Object.fromEntries(visible.map(t => [t.id, all[t.id]])));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tickets/queue?scope=mine|unassigned — personal work queue sorted by urgency:
// SLA breached (most overdue first), SLA close to expiry, member waiting for an answer
// (oldest first), then priority. Each ticket carries the reasons shown in the dashboard.
const PRIORITY_RANK = { urgent: 2, normal: 1, low: 0 };
router.get('/queue', async (req, res) => {
  if (!hasPerm(req, 'view_tickets')) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const scope = req.query.scope === 'unassigned' ? 'unassigned' : 'mine';
    const vis = await visibilityFilter(req);
    const where = scope === 'mine'
      ? 'EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = tickets.id AND a.user_id = ?)'
      : 'NOT EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = tickets.id)';
    const rows = await req.guildDb(
      `SELECT id, owner_id, owner_tag, channel_id, status, stage, stage_changed_at, subject, priority, created_at, last_message_at,
              (SELECT MAX(created_at) FROM ticket_notes n WHERE n.ticket_id = tickets.id AND n.source = 'user') AS last_member_at,
              (SELECT MAX(created_at) FROM ticket_notes n WHERE n.ticket_id = tickets.id AND n.source IN ('reply', 'scheduled')) AS last_staff_at
       FROM tickets WHERE status = 'open' AND ${where} AND ${vis.sql} LIMIT 300`,
      [...(scope === 'mine' ? [req.session.user.id] : []), ...vis.params]
    );
    const [slaCfg] = await req.guildDb('SELECT sla_open_hours, sla_waiting_hours, sla_in_progress_hours FROM guild_config WHERE id = 1');
    const now = Date.now();
    const queue = rows.map(t => {
      const sla = slaStatus(t, slaCfg, now);
      const waitingSince = t.last_member_at && (!t.last_staff_at || new Date(t.last_member_at) > new Date(t.last_staff_at)) ? new Date(t.last_member_at) : null;
      const reasons = [];
      if (sla?.state === 'breached') reasons.push({ type: 'breached', minutes: sla.elapsedMinutes - sla.hours * 60 });
      else if (sla?.state === 'warning') reasons.push({ type: 'warning', minutes: sla.hours * 60 - sla.elapsedMinutes });
      if (waitingSince) reasons.push({ type: 'member_waiting', minutes: Math.floor((now - waitingSince.getTime()) / 60000) });
      if (t.priority === 'urgent') reasons.push({ type: 'urgent' });
      const overdue = sla?.state === 'breached' ? sla.elapsedMinutes - sla.hours * 60 : 0;
      return {
        ...t, sla, waitingSince, reasons,
        _rank: [sla?.state === 'breached' ? 3 : sla?.state === 'warning' ? 2 : waitingSince ? 1 : 0, overdue, waitingSince ? now - waitingSince.getTime() : 0, PRIORITY_RANK[t.priority] ?? 1],
      };
    });
    queue.sort((a, b) => {
      for (let i = 0; i < a._rank.length; i++) if (a._rank[i] !== b._rank[i]) return b._rank[i] - a._rank[i];
      return new Date(a.created_at) - new Date(b.created_at);
    });
    res.json({ scope, tickets: await attachAssignees(req, queue.map(({ _rank, ...t }) => t)) });
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
      "SELECT user_id, username, avatar, role, availability, vacation_mode FROM dashboard_users WHERE role IN ('support', 'fondateur') ORDER BY username ASC"
    );
    res.json(staff);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tickets/member-search?q= — server members matching a name or an ID (staff opening a ticket)
router.get('/member-search', async (req, res) => {
  if (!hasPerm(req, 'reply_ticket')) return res.status(403).json({ error: 'Permission insuffisante' });
  const q = String(req.query.q || '').trim().slice(0, 32);
  if (q.length < 2) return res.json([]);
  try {
    const guild = await req.app.locals.client?.guilds.fetch(req.guildId).catch(() => null);
    if (!guild) return res.json([]);
    const found = SNOWFLAKE_RE.test(q)
      ? [await guild.members.fetch(q).catch(() => null)].filter(Boolean)
      : [...(await guild.members.search({ query: q, limit: 10 }).catch(() => new Map())).values()];
    res.json(found.filter(m => !m.user.bot).map(m => ({ id: m.id, username: m.user.username, displayName: m.displayName, avatar: m.user.displayAvatarURL({ size: 64 }) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tickets/open { userId, subject?, message } — the staff opens a ticket to contact a
// member (sanction, follow-up, refund…); the message is sent to them as the first reply.
router.post('/open', async (req, res) => {
  if (!hasPerm(req, 'view_tickets') || !hasPerm(req, 'reply_ticket')) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const userId = String(req.body.userId || '');
    const subject = typeof req.body.subject === 'string' ? req.body.subject.replace(/\s+/g, ' ').trim().slice(0, 100) || null : null;
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (!SNOWFLAKE_RE.test(userId)) return res.status(400).json({ error: 'Membre invalide' });
    if (!message) return res.status(400).json({ error: 'Message requis' });
    if (message.length > 2000) return res.status(400).json({ error: 'Message trop long (max 2000 caractères)' });
    if (userId === req.session.user.id) return res.status(400).json({ error: 'Tu ne peux pas ouvrir un ticket pour toi-même' });
    const client = req.app.locals.client;
    if (!client) return res.status(503).json({ error: 'Bot Discord non disponible' });
    const guild = await client.guilds.fetch(req.guildId).catch(() => null);
    const member = await guild?.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot) return res.status(404).json({ error: 'Membre introuvable sur le serveur' });
    const limit = await require('../../utils/limits').canOpenTicket(req.guildDb, req.guildId);
    if (!limit.ok) return res.status(409).json({ error: `Limite de ${limit.max} tickets ouverts atteinte sur ce serveur` });

    const { ticket } = await getManager(req).openTicketForMember(member.user, { subject, byUser: dashboardActor(req) });
    const [fresh] = await req.guildDb('SELECT * FROM tickets WHERE id = ?', [ticket.id]);
    await sendStaffReply(req, fresh, { content: message, anonymous: false });
    res.json({ ok: true, id: ticket.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message?.includes('fils') ? err.message : 'Ouverture du ticket impossible' });
  }
});

const traceConfidential = (req, ticket, kind) => require('../../utils/confidentialAccess')
  .logConfidentialAccess(req.guildDb, req.guildId, ticket, { id: req.session.user.id, tag: req.session.user.username }, kind, req.ip);

router.get('/:id', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res);
    if (!ticket) return;
    await traceConfidential(req, ticket, 'view');

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

    const [cfg] = await req.guildDb('SELECT ticket_category_id, waiting_category_id, in_progress_category_id, sla_open_hours, sla_waiting_hours, sla_in_progress_hours, low_rating_threshold, ticket_mode FROM guild_config WHERE id = 1');
    const thread = cfg?.ticket_mode === 'thread';
    res.json({
      ...ticket,
      participants,
      assignees: await getManager(req).getAssignees(ticket.id),
      // Stages whose Discord category is configured (Paramètres)
      // Threads: every stage is available (no category involved)
      stages: { open: thread || !!cfg?.ticket_category_id, waiting: thread || !!cfg?.waiting_category_id, in_progress: thread || !!cfg?.in_progress_category_id },
      voiceUrl: ticket.voice_channel_id ? `https://discord.com/channels/${req.guildId}/${ticket.voice_channel_id}` : null,
      following: await require('../../utils/followers').isFollowing(req.guildDb, ticket.id, req.session.user.id),
      sla: slaStatus(ticket, cfg),
      lowRatingThreshold: Number(cfg?.low_rating_threshold ?? 2),
      links: await linkedTickets(req, ticket.id),
      fields: await fieldsForTicket(req.guildDb, ticket.id),
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
    await traceConfidential(req, ticket, 'notes');

    const notes = await req.guildDb(
      `SELECT id, author_id, author_tag, content, source, created_at, pinned_at, pinned_by_tag, edited_at, edit_history, deleted_at,
              reply_refs IS NOT NULL AS has_refs, JSON_UNQUOTE(JSON_EXTRACT(reply_refs, '$.fileLine')) AS file_line
       FROM ticket_notes WHERE ticket_id = ? ORDER BY created_at ASC`,
      [ticket.id]
    );
    const { editable } = require('../../utils/replyEdits');
    res.json(notes.map(({ has_refs, file_line, ...n }) => {
      const canEdit = editable({ ...n, has_refs });
      // Text to correct: the reply without its file line (the file itself cannot be changed)
      const fileLine = file_line && file_line !== 'null' ? `\n${file_line}` : null;
      return { ...n, edit_history: parseJsonField(n.edit_history, null), editable: canEdit,
        ...(canEdit ? { edit_text: fileLine && n.content.endsWith(fileLine) ? n.content.slice(0, -fileLine.length) : n.content } : {}) };
    }));
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
    require('../../utils/followers').notifyFollowers(req.guildDb, req.guildId, ticket, { kind: 'note', by: req.session.user.username, byId: req.session.user.id, excerpt: trimmed }).catch(() => null);
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
  // Where each copy goes, so the reply can be corrected or withdrawn later (utils/replyEdits.js)
  const refs = require('../../utils/replyEdits').refsBuilder({ sender, format: 'text' });
  if (upload) {
    const sent = await channel?.send({ content: msg.slice(0, 2000), files: [{ attachment: upload.buffer, name: upload.name }] }).catch(() => null);
    file_url = sent?.attachments?.first?.()?.url || null;
    refs.channel(sent);
  } else if (channel) {
    refs.channel(await channel.send(msg).catch(() => null), file_url);
  }

  // DM: embed naming the server and the ticket (a member can have tickets on several servers)
  // Each member receives the reply in their language
  for (const userId of linkedUserIds) {
    const dm = await sendToMember(client, userId, req.guildId, async () => {
      const dmEmbed = staffReplyDmEmbed(client, req.guildId, ticket, { sender, content, fileUrl: upload ? null : file_url });
      if (upload) dmEmbed.addFields({ name: t('reply.fileAttached'), value: upload.name.slice(0, 1024) });
      return {
        embeds: [dmEmbed], components: await ticketDmComponents(ticket, req.guildId, userId),
        ...(upload ? { files: [{ attachment: upload.buffer, name: upload.name }] } : {}),
      };
    });
    refs.dm(userId, dm);
  }

  const staffUser = dashboardActor(req);
  await tm.recordStaffResponse(ticket.id, staffUser);
  await tm.updateLastMessage(ticket.id);

  await recordEvent(req.guildDb, {
    actor: dashboardActor(req), action: 'ticket_reply', ticketId: ticket.id,
    details: { anonymous: !!anonymous, excerpt: (content || upload?.name || file_url || '').slice(0, 120), ...(upload ? { file: upload.name } : {}) },
  });
  const noteAuthorTag = anonymous ? `${req.session.user.username} (anonyme)` : req.session.user.username;
  const fileLine = upload ? `📎 ${upload.name}${file_url ? ` : ${file_url}` : ''}` : (file_url || null);
  const noteContent = [content, fileLine].filter(Boolean).join('\n');
  refs.file(fileLine);
  const result = await req.guildDb(
    'INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source, reply_refs) VALUES (?, ?, ?, ?, "reply", ?)',
    [ticket.id, req.session.user.id, noteAuthorTag, noteContent, refs.json()]
  );

  const replyNote = {
    id: result.insertId,
    author_id: req.session.user.id,
    author_tag: noteAuthorTag,
    content: noteContent,
    source: 'reply',
    editable: true,
    created_at: new Date()
  };
  broadcast('note', { ticketId: ticket.id, note: replyNote }, req.guildId);
  require('../../utils/followers').notifyFollowers(req.guildDb, req.guildId, ticket, { kind: 'reply', by: noteAuthorTag, byId: req.session.user.id, excerpt: noteContent }).catch(() => null);
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

// POST /api/tickets/:id/presence { leave } — heartbeat of an open ticket page (every 20 s) and
// departure signal; returns who else has the ticket open
router.post('/:id/presence', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res);
    if (!ticket) return;
    const me = req.session.user;
    if (req.body?.leave) { await presence.leave(req.guildId, ticket.id, me.id); return res.json({ viewers: [] }); }
    const viewers = await presence.touch(req.guildId, ticket.id, { id: me.id, username: me.username, avatar: me.avatar });
    res.json({ viewers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tickets/:id/followup { content } — get back to the member of a closed ticket (after a
// low rating): DM with the reopen button when still allowed, history note, follow-up recorded.
router.post('/:id/followup', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    if (ticket.status !== 'closed') return res.status(400).json({ error: 'Le ticket est encore ouvert : réponds-y normalement' });
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length > 2000) return res.status(400).json({ error: 'Message requis (2000 caractères max)' });
    const client = req.app.locals.client;
    const [cfg] = await req.guildDb('SELECT member_reopen_days FROM guild_config WHERE id = 1');
    const days = Number(cfg?.member_reopen_days ?? 7);
    const canReopen = days > 0 && !ticket.merged_into && ticket.closed_at && (Date.now() - new Date(ticket.closed_at).getTime()) < days * 864e5;
    const { memberReopenButton } = require('../../utils/components');
    const sent = await sendToMember(client, ticket.owner_id, req.guildId, () => ({
      embeds: [staffReplyDmEmbed(client, req.guildId, ticket, { sender: req.session.user.username, content })],
      components: canReopen ? [memberReopenButton(ticket.id, req.guildId)] : [],
    }));
    if (!sent) return res.status(502).json({ error: 'Impossible d\'envoyer le MP au membre (MP fermés ?)' });
    await req.guildDb('UPDATE tickets SET followup_at = NOW(), followup_by_tag = ? WHERE id = ?', [req.session.user.username, ticket.id]);
    const r = await req.guildDb('INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, "reply")',
      [ticket.id, req.session.user.id, req.session.user.username, content]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'ticket_followup', ticketId: ticket.id, details: { excerpt: content.slice(0, 120) } });
    broadcast('note', { ticketId: ticket.id, note: { id: r.insertId, ticket_id: ticket.id, author_id: req.session.user.id, author_tag: req.session.user.username, content, source: 'reply', created_at: new Date() } }, req.guildId);
    broadcast('ticket', { id: ticket.id, followup_at: new Date(), followup_by_tag: req.session.user.username }, req.guildId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Personal reminders: GET/POST /api/tickets/:id/reminders, DELETE /api/tickets/reminders/:rid
const REMINDER_DELAYS = { '1h': 60, '4h': 240, '1d': 1440, '2d': 2880, '1w': 10080 };
router.get('/:id/reminders', async (req, res) => {
  const ticket = await loadTicket(req, res);
  if (!ticket) return;
  res.json(await req.guildDb('SELECT id, remind_at, note, sent_at FROM ticket_reminders WHERE ticket_id = ? AND user_id = ? ORDER BY remind_at DESC LIMIT 20', [ticket.id, req.session.user.id]));
});

router.post('/:id/reminders', async (req, res) => {
  const ticket = await loadTicket(req, res);
  if (!ticket) return;
  let remindAt = null;
  if (REMINDER_DELAYS[req.body.in]) remindAt = new Date(Date.now() + REMINDER_DELAYS[req.body.in] * 60000);
  else if (typeof req.body.at === 'string') remindAt = new Date(req.body.at);
  if (!remindAt || isNaN(remindAt) || remindAt < Date.now() - 60000 || remindAt > Date.now() + 365 * 864e5) {
    return res.status(400).json({ error: 'Date de rappel invalide (dans l\'année à venir)' });
  }
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 200) || null : null;
  const [{ n }] = await req.guildDb('SELECT COUNT(*) AS n FROM ticket_reminders WHERE user_id = ? AND sent_at IS NULL', [req.session.user.id]);
  if (Number(n) >= 100) return res.status(400).json({ error: 'Trop de rappels en attente (100 max)' });
  const r = await req.guildDb('INSERT INTO ticket_reminders (ticket_id, user_id, remind_at, note) VALUES (?, ?, ?, ?)', [ticket.id, req.session.user.id, remindAt, note]);
  res.json({ id: r.insertId, remind_at: remindAt, note, sent_at: null });
});

router.delete('/reminders/:rid', async (req, res) => {
  const r = await req.guildDb('DELETE FROM ticket_reminders WHERE id = ? AND user_id = ?', [parseInt(req.params.rid), req.session.user.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Rappel introuvable' });
  res.json({ ok: true });
});

// Linked tickets (same problem, other members): stored once per pair (smallest id first)
async function linkedTickets(req, ticketId) {
  const vis = await visibilityFilter(req, 't.visibility_grade_id');
  return req.guildDb(
    `SELECT t.id, t.subject, t.status, t.owner_tag FROM ticket_links l
     JOIN tickets t ON t.id = IF(l.ticket_a = ?, l.ticket_b, l.ticket_a)
     WHERE (l.ticket_a = ? OR l.ticket_b = ?) AND ${vis.sql} ORDER BY t.id DESC`,
    [ticketId, ticketId, ticketId, ...vis.params]
  );
}

router.post('/:id/links', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    const otherId = parseInt(req.body.ticketId);
    if (!otherId || otherId === ticket.id) return res.status(400).json({ error: 'Numéro de ticket invalide' });
    const { ticket: other, denied } = await checkAccess(req, otherId);
    if (!other || denied) return res.status(404).json({ error: 'Ticket introuvable' });
    const [a, b] = [Math.min(ticket.id, other.id), Math.max(ticket.id, other.id)];
    const r = await req.guildDb('INSERT IGNORE INTO ticket_links (ticket_a, ticket_b, created_by_tag) VALUES (?, ?, ?)', [a, b, req.session.user.username]);
    if (r.affectedRows) {
      for (const id of [ticket.id, other.id]) {
        await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'ticket_link', ticketId: id, details: { with: id === ticket.id ? other.id : ticket.id } });
        broadcast('ticket', { id }, req.guildId);
      }
    }
    res.json({ links: await linkedTickets(req, ticket.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id/links/:otherId', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    const otherId = parseInt(req.params.otherId);
    const [a, b] = [Math.min(ticket.id, otherId), Math.max(ticket.id, otherId)];
    const r = await req.guildDb('DELETE FROM ticket_links WHERE ticket_a = ? AND ticket_b = ?', [a, b]);
    if (r.affectedRows) {
      for (const id of [ticket.id, otherId]) {
        await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'ticket_unlink', ticketId: id, details: { with: id === ticket.id ? otherId : ticket.id } });
        broadcast('ticket', { id }, req.guildId);
      }
    }
    res.json({ links: await linkedTickets(req, ticket.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tickets/:id/fields { values: { fieldId: value } } — staff edit of the custom fields
router.put('/:id/fields', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    const values = req.body.values && typeof req.body.values === 'object' ? req.body.values : null;
    if (!values) return res.status(400).json({ error: 'values requis' });
    const known = new Map((await req.guildDb('SELECT id, type FROM ticket_fields')).map(f => [String(f.id), f]));
    for (const [id, v] of Object.entries(values)) {
      const f = known.get(String(id));
      if (!f) return res.status(400).json({ error: `Champ ${id} inconnu` });
      if (v !== '' && v !== null && (typeof v !== 'string' || v.length > 200)) return res.status(400).json({ error: 'Valeur invalide (200 caractères max)' });
      if (v && f.type === 'number' && !Number.isFinite(Number(String(v).replace(',', '.')))) return res.status(400).json({ error: 'Ce champ attend un nombre' });
      if (v === '' || v === null) await req.guildDb('DELETE FROM ticket_field_values WHERE ticket_id = ? AND field_id = ?', [ticket.id, f.id]);
    }
    await saveFieldValues(req.guildDb, ticket.id, Object.fromEntries(Object.entries(values).filter(([, v]) => v)));
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'ticket_fields_update', ticketId: ticket.id, details: { fields: Object.keys(values) } });
    res.json({ fields: await fieldsForTicket(req.guildDb, ticket.id) });
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
    const { CONFIDENTIAL } = require('../../utils/gradePermissions');

    // Confidential (founders only): set or lifted by a founder only
    if ((gradeId === CONFIDENTIAL || ticket.visibility_grade_id === CONFIDENTIAL) && !req.userIsFondateur) {
      return res.status(403).json({ error: 'Seul un fondateur peut changer la confidentialité d\'un ticket' });
    }
    if (gradeId && gradeId !== CONFIDENTIAL) {
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

// ── Time spent (utils/ticketTime.js) ──
// GET /api/tickets/time/running — my running stopwatch, on any ticket I can still see
router.get('/time/running', async (req, res) => {
  try {
    const vis = await require('../../utils/gradePermissions').visibilityFilter(req, 't.visibility_grade_id');
    const run = await require('../../utils/ticketTime').runningTimer(req.guildDb, req.session.user.id, vis);
    res.json(run);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.get('/:id/time', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res);
    if (!ticket) return;
    res.json(await require('../../utils/ticketTime').ticketTime(req.guildDb, ticket.id, req.session.user.id));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/tickets/:id/time/start | stop — stopwatch (starting one stops my other one)
const timerAction = action => async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    const tt = require('../../utils/ticketTime');
    if (action === 'start') {
      if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket fermé' });
      await tt.startTimer(req.guildDb, ticket.id, req.session.user);
    } else {
      await req.guildDb(`UPDATE ticket_time SET ended_at = NOW(), seconds = LEAST(TIMESTAMPDIFF(SECOND, started_at, NOW()), ?) WHERE ticket_id = ? AND user_id = ? AND ended_at IS NULL`,
        [tt.MAX_SESSION_S, ticket.id, req.session.user.id]);
    }
    res.json(await tt.ticketTime(req.guildDb, ticket.id, req.session.user.id));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur' }); }
};
router.post('/:id/time/start', timerAction('start'));
router.post('/:id/time/stop', timerAction('stop'));

// POST /api/tickets/:id/time { minutes, note } — time added by hand (1 to 600 minutes)
router.post('/:id/time', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    const minutes = parseInt(req.body?.minutes);
    if (!(minutes >= 1 && minutes <= 600)) return res.status(400).json({ error: 'Durée entre 1 et 600 minutes' });
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 200) || null : null;
    await req.guildDb(`INSERT INTO ticket_time (ticket_id, user_id, user_tag, source, started_at, ended_at, seconds, note)
                       VALUES (?, ?, ?, 'manual', NOW() - INTERVAL ? MINUTE, NOW(), ?, ?)`,
      [ticket.id, req.session.user.id, req.session.user.username, minutes, minutes * 60, note]);
    res.json(await require('../../utils/ticketTime').ticketTime(req.guildDb, ticket.id, req.session.user.id));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/tickets/time/:entryId — remove one of my entries (founders: any)
router.delete('/time/:entryId', async (req, res) => {
  try {
    if (!hasPerm(req, 'view_tickets')) return res.status(403).json({ error: 'Permission insuffisante' });
    const [e] = await req.guildDb('SELECT id, ticket_id, user_id FROM ticket_time WHERE id = ?', [parseInt(req.params.entryId) || 0]);
    if (!e) return res.status(404).json({ error: 'Entrée introuvable' });
    if (e.user_id !== req.session.user.id && !req.userIsFondateur) return res.status(403).json({ error: 'Seul son auteur peut la retirer' });
    await req.guildDb('DELETE FROM ticket_time WHERE id = ?', [e.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/tickets/:id/procedures — checklists of the ticket's subject with their progress
router.get('/:id/procedures', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res);
    if (!ticket) return;
    res.json(await require('../../utils/procedures').ticketProcedures(req.guildDb, ticket));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tickets/:id/procedures/:procId/steps/:stepId { checked } — check or uncheck a step
router.put('/:id/procedures/:procId/steps/:stepId', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    const { applicableProcedures, ticketProcedures } = require('../../utils/procedures');
    const proc = (await applicableProcedures(req.guildDb, ticket)).find(p => p.id === parseInt(req.params.procId));
    if (!proc || !proc.steps.some(s => s.id === req.params.stepId)) return res.status(404).json({ error: 'Étape introuvable' });
    if (req.body?.checked) {
      await req.guildDb(`INSERT INTO ticket_procedure_checks (ticket_id, procedure_id, step_id, checked_by_id, checked_by_tag) VALUES (?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE checked_by_id = VALUES(checked_by_id), checked_by_tag = VALUES(checked_by_tag), checked_at = NOW()`,
        [ticket.id, proc.id, req.params.stepId, req.session.user.id, req.session.user.username]);
    } else {
      await req.guildDb('DELETE FROM ticket_procedure_checks WHERE ticket_id = ? AND procedure_id = ? AND step_id = ?', [ticket.id, proc.id, req.params.stepId]);
    }
    const procedures = await ticketProcedures(req.guildDb, ticket);
    broadcast('procedure', { ticketId: ticket.id, procedures }, req.guildId);
    res.json(procedures);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tickets/:id/similar — closed tickets about the same problem, with the reply that closed them
router.get('/:id/similar', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res);
    if (!ticket) return;
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    res.json(await require('../../utils/similarTickets').findSimilarTickets(req.guildDb, ticket, vis));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tickets/:id/notes/:noteId/pin { pinned } — pin an internal note at the top of the ticket
const MAX_PINNED = 5;
router.post('/:id/notes/:noteId/pin', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    const [note] = await req.guildDb('SELECT id, source, pinned_at FROM ticket_notes WHERE id = ? AND ticket_id = ?', [parseInt(req.params.noteId) || 0, ticket.id]);
    if (!note) return res.status(404).json({ error: 'Note introuvable' });
    if (note.source !== 'web') return res.status(400).json({ error: 'Seules les notes internes peuvent être épinglées' });
    const pinned = !!req.body?.pinned;
    if (pinned && !note.pinned_at) {
      const [{ n }] = await req.guildDb('SELECT COUNT(*) AS n FROM ticket_notes WHERE ticket_id = ? AND pinned_at IS NOT NULL', [ticket.id]);
      if (Number(n) >= MAX_PINNED) return res.status(400).json({ error: `${MAX_PINNED} notes épinglées au maximum` });
    }
    await req.guildDb('UPDATE ticket_notes SET pinned_at = ?, pinned_by_tag = ? WHERE id = ?',
      [pinned ? new Date() : null, pinned ? req.session.user.username : null, note.id]);
    const [updated] = await req.guildDb('SELECT id, author_id, author_tag, content, source, created_at, pinned_at, pinned_by_tag FROM ticket_notes WHERE id = ?', [note.id]);
    broadcast('note_update', { ticketId: ticket.id, note: updated }, req.guildId);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: pinned ? 'note_pin' : 'note_unpin', ticketId: ticket.id, details: { excerpt: updated.content.slice(0, 120) } });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/tickets/:id/notes/:noteId { content } — corrects a staff reply already sent (the
// member's DMs and the channel copy are edited too) or an internal note. Author or founder only.
router.patch('/:id/notes/:noteId', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    const [note] = await req.guildDb('SELECT * FROM ticket_notes WHERE id = ? AND ticket_id = ?', [parseInt(req.params.noteId) || 0, ticket.id]);
    if (!note) return res.status(404).json({ error: 'Message introuvable' });
    if (!req.userIsFondateur && note.author_id !== req.session.user.id) return res.status(403).json({ error: 'Seul l\'auteur peut modifier ce message' });
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    if (!content) return res.status(400).json({ error: 'Contenu requis' });
    if (content.length > 2000) return res.status(400).json({ error: 'Contenu trop long (max 2000 caractères)' });
    if (note.source === 'reply') {
      const r = await require('../../utils/replyEdits').editReply({
        client: req.app.locals.client, db: req.guildDb, guildId: req.guildId, ticket, note, content, actor: dashboardActor(req),
      });
      if (r.error) return res.status(400).json({ error: r.error });
      return res.json(r);
    }
    if (note.source !== 'web') return res.status(400).json({ error: 'Seules tes réponses et tes notes internes peuvent être modifiées' });
    const history = [...(parseJsonField(note.edit_history, []) || []), { content: note.content, at: new Date().toISOString() }].slice(-10);
    await req.guildDb('UPDATE ticket_notes SET content = ?, edit_history = ?, edited_at = NOW() WHERE id = ?', [content, JSON.stringify(history), note.id]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'note_edit', ticketId: ticket.id, details: { before: String(note.content).slice(0, 120), after: content.slice(0, 120) } });
    const [updated] = await req.guildDb('SELECT id, author_id, author_tag, content, source, created_at, pinned_at, pinned_by_tag, edited_at, edit_history, deleted_at FROM ticket_notes WHERE id = ?', [note.id]);
    broadcast('note_update', { ticketId: ticket.id, note: { ...updated, edit_history: parseJsonField(updated.edit_history, null) } }, req.guildId);
    res.json({ ok: true });
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
    // A reply sent with its refs is withdrawn (DMs deleted), not erased from the history
    if (note.source === 'reply' && note.reply_refs) {
      if (!hasPerm(req, 'reply_ticket')) return res.status(403).json({ error: 'Permission insuffisante' });
      const r = await require('../../utils/replyEdits').retractReply({
        client: req.app.locals.client, db: req.guildDb, guildId: req.guildId, ticket, note, actor: dashboardActor(req),
      });
      if (r.error) return res.status(400).json({ error: r.error });
      return res.json({ ...r, retracted: true });
    }
    await req.guildDb('DELETE FROM ticket_notes WHERE id = ?', [note.id]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'note_delete', ticketId: ticket.id, details: { author: note.author_tag, excerpt: String(note.content || '').slice(0, 120) } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tickets/:id/access-log — who opened this confidential ticket, and when (founders only)
router.get('/:id/access-log', async (req, res) => {
  try {
    if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé aux fondateurs' });
    const ticket = await loadTicket(req, res);
    if (!ticket) return;
    const rows = await req.guildDb('SELECT user_id, user_tag, kind, ip, created_at FROM ticket_access_log WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 200', [ticket.id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tickets/:id/follow { follow } — be told about the ticket's new messages without being assigned
router.post('/:id/follow', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res);
    if (!ticket) return;
    const follow = req.body.follow !== false;
    await require('../../utils/followers').setFollowing(req.guildDb, ticket.id, req.session.user.id, follow);
    res.json({ ok: true, following: follow });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST / DELETE /api/tickets/:id/voice — temporary voice channel of the ticket
router.post('/:id/voice', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    if (!req.app.locals.client) return res.status(503).json({ error: 'Bot Discord non disponible' });
    const r = await getManager(req).openVoiceChannel(ticket.id, dashboardActor(req));
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, channelId: r.channel.id, url: `https://discord.com/channels/${req.guildId}/${r.channel.id}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
router.delete('/:id/voice', async (req, res) => {
  try {
    const ticket = await loadTicket(req, res, 'reply_ticket');
    if (!ticket) return;
    res.json({ ok: true, closed: await getManager(req).closeVoiceChannel(ticket.id, dashboardActor(req)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Permission needed by each bulk action (on top of view_tickets); tickets the user cannot see are ignored
const BULK_PERMS = {
  priority: 'reply_ticket', stage: 'reply_ticket', add_tag: 'reply_ticket', remove_tag: 'reply_ticket', send_template: 'reply_ticket',
  assign: 'claim_ticket', close: 'close_ticket', reopen: 'close_ticket',
};

router.post('/bulk', async (req, res) => {
  const { ids, action, value } = req.body;
  if (!BULK_PERMS[action]) return res.status(400).json({ error: 'Action invalide' });
  if (!hasPerm(req, 'view_tickets') || !hasPerm(req, BULK_PERMS[action])) return res.status(403).json({ error: 'Permission insuffisante' });
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'IDs requis' });
  if (ids.length > 100) return res.status(400).json({ error: 'Maximum 100 tickets' });
  let cleanIds = ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!cleanIds.length) return res.status(400).json({ error: 'IDs invalides' });

  try {
    const vis = await visibilityFilter(req);
    cleanIds = (await req.guildDb(`SELECT id FROM tickets WHERE id IN (?) AND ${vis.sql}`, [cleanIds, ...vis.params])).map(t => t.id);
    if (!cleanIds.length) return res.json({ ok: true, affected: 0 });
    if (action === 'stage') {
      if (!VALID_STAGE.has(value)) return res.status(400).json({ error: 'Étape invalide' });
      const tm = getManager(req);
      let affected = 0;
      const errors = new Set();
      for (const id of cleanIds) {
        const r = await tm.moveToStage(id, value, dashboardActor(req)).catch(err => ({ ok: false, error: err.message }));
        if (r.ok) { affected++; broadcast('ticket', { id, stage: value }, req.guildId); } else errors.add(r.error);
      }
      return res.json({ ok: true, affected, ...(errors.size ? { errors: [...errors] } : {}) });
    }
    if (action === 'remove_tag') {
      const [tag] = await req.guildDb('SELECT id, name FROM ticket_tags WHERE id = ?', [parseInt(value) || 0]);
      if (!tag) return res.status(400).json({ error: 'Tag introuvable' });
      let affected = 0;
      for (const id of cleanIds) {
        const r = await req.guildDb('DELETE FROM ticket_tag_assignments WHERE ticket_id = ? AND tag_id = ?', [id, tag.id]);
        if (r.affectedRows) { affected++; await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'ticket_tag_remove', ticketId: id, targetType: 'tag', targetId: tag.id, details: { tag: tag.name } }); }
      }
      return res.json({ ok: true, affected });
    }
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
      const [tag] = await req.guildDb('SELECT id, name FROM ticket_tags WHERE id = ?', [parseInt(value) || 0]);
      if (!tag) return res.status(400).json({ error: 'Tag introuvable' });
      let affected = 0;
      for (const id of cleanIds) {
        const r = await req.guildDb('INSERT IGNORE INTO ticket_tag_assignments (ticket_id, tag_id) VALUES (?, ?)', [id, tag.id]);
        if (r.affectedRows) { affected++; await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'ticket_tag_add', ticketId: id, targetType: 'tag', targetId: tag.id, details: { tag: tag.name } }); }
      }
      return res.json({ ok: true, affected });
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
    await traceConfidential(req, ticket, 'pdf');

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

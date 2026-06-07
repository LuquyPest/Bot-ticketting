const express = require('express');
const router = express.Router();
const { query } = require('../../utils/db');
const {
  closeTicketWithTranscript, reopenTicket,
  setClaim, getAllLinkedUserIds, recordStaffResponse, updateLastMessage
} = require('../../utils/ticketManager');

const VALID_STATUS   = new Set(['open', 'closed']);
const VALID_PRIORITY = new Set(['low', 'normal', 'urgent']);

function csvEscape(val) {
  if (val == null) return '';
  const str = String(val);
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? '"' + str.replace(/"/g, '""') + '"'
    : str;
}

async function checkAccess(req, ticketId) {
  const [ticket] = await query('SELECT * FROM tickets WHERE id = ?', [ticketId]);
  if (!ticket) return { ticket: null, denied: false };
  if (req.session.user.role === 'support' && ticket.claimed_by !== req.session.user.id) {
    return { ticket, denied: true };
  }
  return { ticket, denied: false };
}

router.get('/', async (req, res) => {
  try {
    const { status, priority, subject } = req.query;
    if (status   && !VALID_STATUS.has(status))   return res.status(400).json({ error: 'Statut invalide' });
    if (priority && !VALID_PRIORITY.has(priority)) return res.status(400).json({ error: 'Priorité invalide' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const isSupport = req.session.user.role === 'support';

    const where = [];
    const params = [];

    if (isSupport) {
      where.push('claimed_by = ?');
      params.push(req.session.user.id);
    }
    if (status)   { where.push('status = ?');    params.push(status); }
    if (priority) { where.push('priority = ?');  params.push(priority); }
    if (subject)  { where.push('subject LIKE ?'); params.push(`%${subject}%`); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [tickets, [{ total }]] = await Promise.all([
      query(
        `SELECT id, owner_id, owner_tag, channel_id, claimed_by, status, subject, priority, created_at, closed_at, closed_by_tag FROM tickets ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      query(`SELECT COUNT(*) as total FROM tickets ${whereClause}`, params)
    ]);

    res.json({ tickets, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/export', async (req, res) => {
  if (req.session.user.role !== 'fondateur') {
    return res.status(403).json({ error: 'Réservé au fondateur' });
  }
  try {
    const tickets = await query(
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

router.get('/:id', async (req, res) => {
  try {
    const { ticket, denied } = await checkAccess(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (denied)  return res.status(403).json({ error: 'Accès refusé' });

    const [participants, transcript, rating] = await Promise.all([
      query('SELECT user_id FROM ticket_participants WHERE ticket_id = ?', [ticket.id]),
      query('SELECT id, created_by_tag, created_at, message_count FROM transcript_snapshots WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1', [ticket.id]),
      query('SELECT rating, rated_at FROM ticket_ratings WHERE ticket_id = ? LIMIT 1', [ticket.id])
    ]);

    res.json({
      ...ticket,
      participants: participants.map(p => p.user_id),
      transcript: transcript[0] || null,
      rating: rating[0] || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id/priority', async (req, res) => {
  if (req.session.user.role !== 'fondateur') {
    return res.status(403).json({ error: 'Réservé au fondateur' });
  }
  try {
    const { priority } = req.body;
    if (!VALID_PRIORITY.has(priority)) return res.status(400).json({ error: 'Priorité invalide' });
    await query('UPDATE tickets SET priority = ? WHERE id = ?', [priority, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id/status', async (req, res) => {
  if (req.session.user.role !== 'fondateur') {
    return res.status(403).json({ error: 'Réservé au fondateur' });
  }
  const { status } = req.body;
  if (!VALID_STATUS.has(status)) return res.status(400).json({ error: 'Statut invalide' });

  try {
    const [ticket] = await query('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (ticket.status === status) return res.json({ ok: true });

    const staffUser = {
      id: req.session.user.id,
      tag: req.session.user.username,
      username: req.session.user.username,
    };
    const client = req.app.locals.client;

    if (status === 'closed') {
      const channel = client ? await client.channels.fetch(ticket.channel_id).catch(() => null) : null;
      if (channel) {
        await closeTicketWithTranscript(client, channel, staffUser);
      } else {
        await query(
          'UPDATE tickets SET status = "closed", closed_at = NOW(), closed_by_tag = ? WHERE id = ?',
          [staffUser.tag, ticket.id]
        );
      }
    } else {
      await reopenTicket(client, ticket, staffUser);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/:id/notes', async (req, res) => {
  try {
    const { ticket, denied } = await checkAccess(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (denied)  return res.status(403).json({ error: 'Accès refusé' });

    const notes = await query(
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
    const { ticket, denied } = await checkAccess(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (denied)  return res.status(403).json({ error: 'Accès refusé' });

    const { content } = req.body;
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Contenu requis' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ error: 'Contenu trop long (max 2000 caractères)' });
    }

    const trimmed = content.trim();
    const result = await query(
      'INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, "web")',
      [ticket.id, req.session.user.id, req.session.user.username, trimmed]
    );

    // Relayer la note dans le salon Discord du ticket
    const client = req.app.locals.client;
    if (client && ticket.channel_id && ticket.status === 'open') {
      const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel) {
        await channel.send(
          `📌 **Note dashboard** · ${req.session.user.username}\n${trimmed}`
        ).catch(() => null);
      }
    }

    res.json({
      id: result.insertId,
      author_id: req.session.user.id,
      author_tag: req.session.user.username,
      content: trimmed,
      source: 'web',
      created_at: new Date()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/:id/reply', async (req, res) => {
  try {
    const [ticket] = await query('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket fermé' });

    const { content, file_url } = req.body;
    if (!content && !file_url) return res.status(400).json({ error: 'Contenu requis' });
    if (content && typeof content !== 'string') return res.status(400).json({ error: 'Contenu invalide' });
    if (content && content.length > 2000) return res.status(400).json({ error: 'Contenu trop long (max 2000)' });

    const sender = req.session.user.username;
    let msg = `--- ${sender} : ${content || ''}`.trim();
    if (file_url) msg += `\nFichier : ${file_url}`;

    const client = req.app.locals.client;
    const linkedUserIds = await getAllLinkedUserIds(ticket.id);

    for (const userId of linkedUserIds) {
      const user = await client?.users.fetch(userId).catch(() => null);
      if (user) await user.send(msg).catch(() => null);
    }

    if (client && ticket.channel_id) {
      const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel) await channel.send(msg).catch(() => null);
    }

    const staffUser = { id: req.session.user.id, tag: sender, username: sender };
    await recordStaffResponse(ticket.id, staffUser);
    await updateLastMessage(ticket.id);

    const noteContent = [content, file_url].filter(Boolean).join('\n');
    const result = await query(
      'INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, "reply")',
      [ticket.id, req.session.user.id, sender, noteContent]
    );

    res.json({
      id: result.insertId,
      author_id: req.session.user.id,
      author_tag: sender,
      content: noteContent,
      source: 'reply',
      created_at: new Date()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id/claim', async (req, res) => {
  try {
    const [ticket] = await query('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket fermé' });

    const { action } = req.body;
    if (action !== 'claim' && action !== 'unclaim') {
      return res.status(400).json({ error: 'Action invalide (claim | unclaim)' });
    }

    const { id: userId, username, role } = req.session.user;
    const isFondateur = role === 'fondateur';

    if (action === 'claim') {
      if (ticket.claimed_by && ticket.claimed_by !== userId && !isFondateur) {
        return res.status(403).json({ error: 'Déjà pris en charge par quelqu\'un d\'autre' });
      }
    } else {
      if (ticket.claimed_by !== userId && !isFondateur) {
        return res.status(403).json({ error: 'Tu ne peux pas unclaim le ticket d\'un autre' });
      }
    }

    const client = req.app.locals.client;
    const staffUser = { id: userId, tag: username, username };

    if (action === 'claim') {
      await setClaim(client, ticket.id, staffUser);
    } else {
      await query('UPDATE tickets SET claimed_by = NULL WHERE id = ?', [ticket.id]);
    }

    if (client && ticket.channel_id) {
      const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel) {
        const msg = action === 'claim'
          ? `✅ Ticket pris en charge par **${username}** (dashboard).`
          : `🔓 Ticket libéré par **${username}** (dashboard).`;
        await channel.send(msg).catch(() => null);
      }
    }

    res.json({ ok: true, claimed_by: action === 'claim' ? userId : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id/notes/:noteId', async (req, res) => {
  try {
    const [note] = await query('SELECT * FROM ticket_notes WHERE id = ?', [req.params.noteId]);
    if (!note) return res.status(404).json({ error: 'Note introuvable' });
    if (note.ticket_id !== parseInt(req.params.id)) {
      return res.status(400).json({ error: 'Note invalide' });
    }
    if (req.session.user.role !== 'fondateur' && note.author_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    await query('DELETE FROM ticket_notes WHERE id = ?', [note.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

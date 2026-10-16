const express = require('express');
const router = express.Router();
const { recordEvent, dashboardActor } = require('../../utils/audit');
const { visibilityFilter } = require('../../utils/gradePermissions');

const hasPerm = (req, perm) => req.userIsFondateur || req.userPermissions.has(perm);

router.get('/', async (req, res) => {
  if (!hasPerm(req, 'view_tickets')) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const { ticket_id } = req.query;
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    const where = ['WHERE ' + vis.sql];
    const params = [...vis.params];
    if (ticket_id) { where.push('sm.ticket_id = ?'); params.push(String(ticket_id)); }
    const rows = await req.guildDb(
      `SELECT sm.*, t.owner_tag FROM scheduled_messages sm
       JOIN tickets t ON t.id = sm.ticket_id
       ${where.join(' AND ')}
       ORDER BY sm.send_at ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/', async (req, res) => {
  if (!hasPerm(req, 'view_tickets') || !hasPerm(req, 'reply_ticket')) {
    return res.status(403).json({ error: 'Permission insuffisante' });
  }
  try {
    const { ticket_id, content, send_at } = req.body;
    if (!ticket_id || typeof content !== 'string' || !content.trim() || !send_at) {
      return res.status(400).json({ error: 'ticket_id, content et send_at requis' });
    }
    const sendDate = new Date(send_at);
    if (isNaN(sendDate) || sendDate <= new Date()) {
      return res.status(400).json({ error: 'send_at doit être dans le futur' });
    }
    const vis = await visibilityFilter(req);
    const [ticket] = await req.guildDb(
      `SELECT id, status FROM tickets WHERE id = ? AND ${vis.sql}`,
      [parseInt(ticket_id), ...vis.params]
    );
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket fermé' });

    const result = await req.guildDb(
      'INSERT INTO scheduled_messages (ticket_id, sender_id, sender_tag, content, send_at) VALUES (?, ?, ?, ?, ?)',
      [ticket.id, req.session.user.id, req.session.user.username, content.trim().slice(0, 2000), sendDate]
    );
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'scheduled_create', ticketId: ticket.id, targetType: 'scheduled_message', targetId: result.insertId,
      details: { send_at: sendDate.toISOString(), excerpt: content.trim().slice(0, 120) } });
    res.json({ id: result.insertId, ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [msg] = await req.guildDb('SELECT * FROM scheduled_messages WHERE id = ?', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message introuvable' });
    if (msg.sent) return res.status(400).json({ error: 'Message déjà envoyé' });
    if (!req.userIsFondateur && msg.sender_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    await req.guildDb('DELETE FROM scheduled_messages WHERE id = ?', [req.params.id]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'scheduled_delete', ticketId: msg.ticket_id, targetType: 'scheduled_message', targetId: msg.id, details: { excerpt: String(msg.content).slice(0, 120) } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

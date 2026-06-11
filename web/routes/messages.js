const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { ticket_id } = req.query;
    const where = ticket_id ? 'WHERE sm.ticket_id = ?' : '';
    const params = ticket_id ? [ticket_id] : [];
    const rows = await req.guildDb(
      `SELECT sm.*, t.owner_tag FROM scheduled_messages sm
       JOIN tickets t ON t.id = sm.ticket_id
       ${where}
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
  try {
    const { ticket_id, content, send_at } = req.body;
    if (!ticket_id || !content || !send_at) {
      return res.status(400).json({ error: 'ticket_id, content et send_at requis' });
    }
    const sendDate = new Date(send_at);
    if (isNaN(sendDate) || sendDate <= new Date()) {
      return res.status(400).json({ error: 'send_at doit être dans le futur' });
    }
    const [ticket] = await req.guildDb('SELECT id, status FROM tickets WHERE id = ?', [ticket_id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    if (ticket.status !== 'open') return res.status(400).json({ error: 'Ticket fermé' });

    const result = await req.guildDb(
      'INSERT INTO scheduled_messages (ticket_id, sender_id, sender_tag, content, send_at) VALUES (?, ?, ?, ?, ?)',
      [ticket_id, req.session.user.id, req.session.user.username, content.trim().slice(0, 2000), sendDate]
    );
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
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

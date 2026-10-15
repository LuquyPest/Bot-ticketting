const express = require('express');
const router = express.Router();
const { visibilityFilter } = require('../../utils/gradePermissions');

const hasPerm = (req, perm) => req.userIsFondateur || req.userPermissions.has(perm);

// Tag definitions are guild settings; assigning tags edits the ticket.
function requireSettings(req, res, next) {
  if (!hasPerm(req, 'manage_settings')) return res.status(403).json({ error: 'Permission insuffisante' });
  next();
}

async function requireTicketAccess(req, res, next) {
  const perms = req.method === 'GET' ? ['view_tickets'] : ['view_tickets', 'reply_ticket'];
  if (!perms.every(p => hasPerm(req, p))) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const vis = await visibilityFilter(req);
    const [t] = await req.guildDb(`SELECT id FROM tickets WHERE id = ? AND ${vis.sql}`, [parseInt(req.params.ticketId), ...vis.params]);
    if (!t) return res.status(404).json({ error: 'Ticket introuvable' });
    req.ticketId = t.id;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

router.get('/', async (req, res) => {
  try {
    const tags = await req.guildDb('SELECT * FROM ticket_tags ORDER BY name ASC');
    res.json(tags);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/', requireSettings, async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Nom requis' });
    }
    const cleanName = name.trim().slice(0, 50);
    const cleanColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1';
    const result = await req.guildDb(
      'INSERT INTO ticket_tags (name, color) VALUES (?, ?)',
      [cleanName, cleanColor]
    );
    res.json({ id: result.insertId, name: cleanName, color: cleanColor });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Ce tag existe déjà' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id', requireSettings, async (req, res) => {
  try {
    const { name, color } = req.body;
    const updates = [];
    const params = [];
    if (typeof name === 'string' && name.trim()) { updates.push('name = ?'); params.push(name.trim().slice(0, 50)); }
    if (color && /^#[0-9a-fA-F]{6}$/.test(color)) { updates.push('color = ?'); params.push(color); }
    if (!updates.length) return res.json({ ok: true });
    params.push(req.params.id);
    await req.guildDb(`UPDATE ticket_tags SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id', requireSettings, async (req, res) => {
  try {
    await req.guildDb('DELETE FROM ticket_tags WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/ticket/:ticketId', requireTicketAccess, async (req, res) => {
  try {
    const tags = await req.guildDb(
      `SELECT t.id, t.name, t.color FROM ticket_tag_assignments a
       JOIN ticket_tags t ON t.id = a.tag_id
       WHERE a.ticket_id = ?`,
      [req.ticketId]
    );
    res.json(tags);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/ticket/:ticketId', requireTicketAccess, async (req, res) => {
  try {
    const { tag_id } = req.body;
    if (!tag_id) return res.status(400).json({ error: 'tag_id requis' });
    await req.guildDb(
      'INSERT IGNORE INTO ticket_tag_assignments (ticket_id, tag_id) VALUES (?, ?)',
      [req.ticketId, parseInt(tag_id)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/ticket/:ticketId/:tagId', requireTicketAccess, async (req, res) => {
  try {
    await req.guildDb(
      'DELETE FROM ticket_tag_assignments WHERE ticket_id = ? AND tag_id = ?',
      [req.ticketId, req.params.tagId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

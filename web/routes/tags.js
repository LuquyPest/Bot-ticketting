const express = require('express');
const router = express.Router();
const { query } = require('../../utils/db');

// List all tags
router.get('/', async (req, res) => {
  try {
    const tags = await query('SELECT * FROM ticket_tags ORDER BY name ASC');
    res.json(tags);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Create tag
router.post('/', async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Nom requis' });
    }
    const cleanName = name.trim().slice(0, 50);
    const cleanColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1';
    const result = await query(
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

// Update tag
router.patch('/:id', async (req, res) => {
  try {
    const { name, color } = req.body;
    const updates = [];
    const params = [];
    if (name) { updates.push('name = ?'); params.push(name.trim().slice(0, 50)); }
    if (color && /^#[0-9a-fA-F]{6}$/.test(color)) { updates.push('color = ?'); params.push(color); }
    if (!updates.length) return res.json({ ok: true });
    params.push(req.params.id);
    await query(`UPDATE ticket_tags SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Delete tag
router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM ticket_tags WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Get tags for a ticket
router.get('/ticket/:ticketId', async (req, res) => {
  try {
    const tags = await query(
      `SELECT t.id, t.name, t.color FROM ticket_tag_assignments a
       JOIN ticket_tags t ON t.id = a.tag_id
       WHERE a.ticket_id = ?`,
      [req.params.ticketId]
    );
    res.json(tags);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Assign tag to ticket
router.post('/ticket/:ticketId', async (req, res) => {
  try {
    const { tag_id } = req.body;
    if (!tag_id) return res.status(400).json({ error: 'tag_id requis' });
    await query(
      'INSERT IGNORE INTO ticket_tag_assignments (ticket_id, tag_id) VALUES (?, ?)',
      [req.params.ticketId, tag_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Remove tag from ticket
router.delete('/ticket/:ticketId/:tagId', async (req, res) => {
  try {
    await query(
      'DELETE FROM ticket_tag_assignments WHERE ticket_id = ? AND tag_id = ?',
      [req.params.ticketId, req.params.tagId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

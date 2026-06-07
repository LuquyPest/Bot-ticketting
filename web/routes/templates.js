const express = require('express');
const router = express.Router();
const { query } = require('../../utils/db');

router.get('/', async (req, res) => {
  try {
    const templates = await query(
      'SELECT id, name, content, created_by_id, created_by_tag, created_at FROM reply_templates ORDER BY name ASC'
    );
    res.json(templates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, content } = req.body;
    if (!name || typeof name !== 'string' || !name.trim())
      return res.status(400).json({ error: 'Nom requis' });
    if (!content || typeof content !== 'string' || !content.trim())
      return res.status(400).json({ error: 'Contenu requis' });
    if (name.length > 100)
      return res.status(400).json({ error: 'Nom trop long (max 100)' });
    if (content.length > 2000)
      return res.status(400).json({ error: 'Contenu trop long (max 2000)' });

    const result = await query(
      'INSERT INTO reply_templates (name, content, created_by_id, created_by_tag) VALUES (?, ?, ?, ?)',
      [name.trim(), content.trim(), req.session.user.id, req.session.user.username]
    );

    res.json({
      id: result.insertId,
      name: name.trim(),
      content: content.trim(),
      created_by_id: req.session.user.id,
      created_by_tag: req.session.user.username,
      created_at: new Date()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [template] = await query('SELECT * FROM reply_templates WHERE id = ?', [req.params.id]);
    if (!template) return res.status(404).json({ error: 'Template introuvable' });
    if (req.session.user.role !== 'fondateur' && template.created_by_id !== req.session.user.id)
      return res.status(403).json({ error: 'Accès refusé' });

    await query('DELETE FROM reply_templates WHERE id = ?', [template.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

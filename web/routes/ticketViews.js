// Saved ticket list views, per dashboard user (filters of the Tickets page).
const express = require('express');
const router = express.Router();

const FILTER_KEYS = ['status', 'priority', 'stage', 'subject', 'claimed', 'assignee', 'dateFrom', 'dateTo', 'tag', 'sla', 'field', 'fieldValue'];
const MAX_VIEWS = 20;

// Keeps only known filter keys with short string values.
function cleanFilters(filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return null;
  const out = {};
  for (const k of FILTER_KEYS) {
    const v = filters[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || v.length > 100) return null;
    out[k] = v;
  }
  return out;
}

const validName = n => typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= 60;
const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);

router.get('/', async (req, res) => {
  try {
    const rows = await req.guildDb(
      'SELECT id, name, filters, is_default FROM ticket_views WHERE user_id = ? ORDER BY name ASC',
      [req.session.user.id]
    );
    res.json(rows.map(r => ({ ...r, filters: parse(r.filters), is_default: !!r.is_default })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/', async (req, res) => {
  const { name, filters, is_default } = req.body;
  const clean = cleanFilters(filters);
  if (!validName(name)) return res.status(400).json({ error: 'Nom requis (60 caractères max)' });
  if (!clean) return res.status(400).json({ error: 'Filtres invalides' });
  try {
    const [{ n }] = await req.guildDb('SELECT COUNT(*) AS n FROM ticket_views WHERE user_id = ?', [req.session.user.id]);
    if (n >= MAX_VIEWS) return res.status(400).json({ error: `Maximum ${MAX_VIEWS} vues` });
    if (is_default) await req.guildDb('UPDATE ticket_views SET is_default = 0 WHERE user_id = ?', [req.session.user.id]);
    const r = await req.guildDb(
      'INSERT INTO ticket_views (user_id, name, filters, is_default) VALUES (?, ?, ?, ?)',
      [req.session.user.id, name.trim(), JSON.stringify(clean), is_default ? 1 : 0]
    );
    res.status(201).json({ id: r.insertId, name: name.trim(), filters: clean, is_default: !!is_default });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, filters, is_default } = req.body;
  try {
    const [view] = await req.guildDb('SELECT id FROM ticket_views WHERE id = ? AND user_id = ?', [id, req.session.user.id]);
    if (!view) return res.status(404).json({ error: 'Vue introuvable' });
    const sets = [];
    const params = [];
    if (name !== undefined) {
      if (!validName(name)) return res.status(400).json({ error: 'Nom invalide' });
      sets.push('name = ?'); params.push(name.trim());
    }
    if (filters !== undefined) {
      const clean = cleanFilters(filters);
      if (!clean) return res.status(400).json({ error: 'Filtres invalides' });
      sets.push('filters = ?'); params.push(JSON.stringify(clean));
    }
    if (is_default !== undefined) {
      if (is_default) await req.guildDb('UPDATE ticket_views SET is_default = 0 WHERE user_id = ?', [req.session.user.id]);
      sets.push('is_default = ?'); params.push(is_default ? 1 : 0);
    }
    if (sets.length) await req.guildDb(`UPDATE ticket_views SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await req.guildDb('DELETE FROM ticket_views WHERE id = ? AND user_id = ?', [parseInt(req.params.id), req.session.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

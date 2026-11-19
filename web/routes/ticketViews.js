// Saved ticket list views, per dashboard user (filters of the Tickets page). A view can be shared
// with a team (v5.4): its members see it (read only); only its author changes or removes it.
const express = require('express');
const router = express.Router();

const FILTER_KEYS = ['status', 'priority', 'stage', 'subject', 'claimed', 'assignee', 'dateFrom', 'dateTo', 'tag', 'sla', 'field', 'fieldValue', 'following', 'team', 'type', 'organization'];
const MAX_VIEWS = 20;

// Keeps only known filter keys with short string values.
function cleanFilters(filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return null;
  const out = {};
  for (const k of FILTER_KEYS) {
    const v = filters[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || v.length > 300) return null;
    out[k] = v;
  }
  return out;
}

const validName = n => typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= 60;
const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);
// The team a view is shared with: one the author belongs to (founders: any)
async function cleanTeam(req, teamId) {
  if (teamId === undefined) return { value: undefined };
  if (teamId === null || teamId === '' || teamId === 0) return { value: null };
  const id = parseInt(teamId);
  if (!id || !(await req.guildDb('SELECT 1 FROM teams WHERE id = ?', [id])).length) return { error: 'Équipe introuvable' };
  if (!req.userIsFondateur && !(await req.guildDb('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?', [id, req.session.user.id])).length) return { error: 'On ne partage qu\'avec une équipe dont on fait partie' };
  return { value: id };
}

router.get('/', async (req, res) => {
  try {
    const rows = await req.guildDb(
      'SELECT id, name, filters, is_default, team_id FROM ticket_views WHERE user_id = ? ORDER BY name ASC',
      [req.session.user.id]
    );
    // Views of colleagues shared with my teams
    const shared = await req.guildDb(
      `SELECT v.id, v.name, v.filters, v.team_id, t.name AS team_name, COALESCE(u.username, v.user_id) AS author FROM ticket_views v
       JOIN team_members m ON m.team_id = v.team_id AND m.user_id = ? JOIN teams t ON t.id = v.team_id LEFT JOIN dashboard_users u ON u.user_id = v.user_id
       WHERE v.user_id <> ? ORDER BY v.name ASC`, [req.session.user.id, req.session.user.id]);
    res.json([...rows.map(r => ({ ...r, filters: parse(r.filters), is_default: !!r.is_default, team_id: r.team_id || null })),
      ...shared.map(r => ({ id: r.id, name: r.name, filters: parse(r.filters), is_default: false, team_id: r.team_id, shared: true, team_name: r.team_name, author: r.author }))]);
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
    const team = await cleanTeam(req, req.body.team_id);
    if (team.error) return res.status(400).json({ error: team.error });
    const [{ n }] = await req.guildDb('SELECT COUNT(*) AS n FROM ticket_views WHERE user_id = ?', [req.session.user.id]);
    if (n >= MAX_VIEWS) return res.status(400).json({ error: `Maximum ${MAX_VIEWS} vues` });
    if (is_default) await req.guildDb('UPDATE ticket_views SET is_default = 0 WHERE user_id = ?', [req.session.user.id]);
    const r = await req.guildDb(
      'INSERT INTO ticket_views (user_id, name, filters, is_default, team_id) VALUES (?, ?, ?, ?, ?)',
      [req.session.user.id, name.trim(), JSON.stringify(clean), is_default ? 1 : 0, team.value || null]
    );
    res.status(201).json({ id: r.insertId, name: name.trim(), filters: clean, is_default: !!is_default, team_id: team.value || null });
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
    const team = await cleanTeam(req, req.body.team_id);
    if (team.error) return res.status(400).json({ error: team.error });
    if (team.value !== undefined) { sets.push('team_id = ?'); params.push(team.value); }
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

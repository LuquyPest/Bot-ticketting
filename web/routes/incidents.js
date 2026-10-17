// Incident announcements (see utils/incidents.js). Reading: whole staff (banner in the ticket
// list); creating, editing and resolving: manage_settings.
const express = require('express');
const router = express.Router();
const { listIncidents, resolveIncident } = require('../../utils/incidents');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const canView = req => req.userIsFondateur || req.userPermissions?.has('view_tickets');
const canManage = req => req.userIsFondateur || req.userPermissions?.has('manage_settings');

function parseBody(body, partial = false) {
  const out = {};
  if (!partial || body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 120) return { error: 'Titre requis (120 caractères max)' };
    out.title = title;
  }
  if (!partial || body.message !== undefined) {
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 1500) return { error: 'Message requis (1500 caractères max)' };
    out.message = message;
  }
  if (body.subjects !== undefined) {
    if (body.subjects !== null && (!Array.isArray(body.subjects) || body.subjects.length > 25 || !body.subjects.every(s => typeof s === 'string' && s.length <= 100))) {
      return { error: 'Sujets invalides' };
    }
    out.subjects = body.subjects?.length ? JSON.stringify(body.subjects) : null;
  }
  if (body.notifyOnResolve !== undefined) out.notify_on_resolve = body.notifyOnResolve ? 1 : 0;
  return out;
}

router.get('/', async (req, res) => {
  if (!canView(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const all = await listIncidents(req.guildDb);
    res.json(req.query.active ? all.filter(i => !i.resolved_at) : all);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const b = parseBody(req.body || {});
    if (b.error) return res.status(400).json({ error: b.error });
    const [{ n }] = await req.guildDb('SELECT COUNT(*) AS n FROM incidents WHERE resolved_at IS NULL');
    if (Number(n) >= 10) return res.status(400).json({ error: '10 incidents ouverts au maximum' });
    const { insertId } = await req.guildDb(
      'INSERT INTO incidents (title, message, subjects, notify_on_resolve, created_by_id, created_by_tag) VALUES (?, ?, ?, ?, ?, ?)',
      [b.title, b.message, b.subjects ?? null, b.notify_on_resolve ?? 1, req.session.user.id, req.session.user.username]
    );
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'incident_open', targetType: 'incident', targetId: insertId, details: { title: b.title } });
    res.json((await listIncidents(req.guildDb)).find(i => i.id === insertId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const [inc] = await req.guildDb('SELECT * FROM incidents WHERE id = ?', [parseInt(req.params.id) || 0]);
    if (!inc) return res.status(404).json({ error: 'Incident introuvable' });
    if (inc.resolved_at) return res.status(400).json({ error: 'Incident déjà résolu' });
    const b = parseBody(req.body || {}, true);
    if (b.error) return res.status(400).json({ error: b.error });
    const cols = Object.keys(b);
    if (cols.length) await req.guildDb(`UPDATE incidents SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => b[c]), inc.id]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'incident_update', targetType: 'incident', targetId: inc.id, details: { fields: cols } });
    res.json((await listIncidents(req.guildDb)).find(i => i.id === inc.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/incidents/:id/resolve { message } — closes the incident and tells the affected members
router.post('/:id/resolve', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const [inc] = await req.guildDb('SELECT * FROM incidents WHERE id = ?', [parseInt(req.params.id) || 0]);
    if (!inc) return res.status(404).json({ error: 'Incident introuvable' });
    if (inc.resolved_at) return res.status(400).json({ error: 'Incident déjà résolu' });
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1500) : '';
    const notified = await resolveIncident({ db: req.guildDb, client: req.app.locals.client, guildId: req.guildId, incident: inc, message, actor: req.session.user });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'incident_resolve', targetType: 'incident', targetId: inc.id, details: { title: inc.title, notified } });
    res.json({ ok: true, notified });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

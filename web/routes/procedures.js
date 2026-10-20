// Procedures by subject (utils/procedures.js). Read: staff; write: manage_settings.
const express = require('express');
const router = express.Router();
const { recordEvent, dashboardActor } = require('../../utils/audit');
const { cleanSteps, parse } = require('../../utils/procedures');

const canManage = req => req.userIsFondateur || req.userPermissions?.has('manage_settings');

function clean(body, partial = false) {
  const out = {};
  if (!partial || body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 100) return { error: 'Titre requis (100 caractères max)' };
    out.title = title;
  }
  if (body.subject !== undefined) {
    if (body.subject !== null && (typeof body.subject !== 'string' || body.subject.length > 100)) return { error: 'Sujet invalide' };
    out.subject = body.subject?.trim() || null;
  }
  if (!partial || body.steps !== undefined) {
    const steps = cleanSteps(body.steps);
    if (!steps) return { error: 'De 1 à 30 étapes, chacune avec un texte (200 caractères max)' };
    out.steps = JSON.stringify(steps);
  }
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  if (body.position !== undefined) out.position = Math.max(0, Math.min(1000, parseInt(body.position) || 0));
  return { value: out };
}

router.get('/', async (req, res) => {
  res.json((await req.guildDb('SELECT * FROM procedures ORDER BY position, id')).map(parse));
});

router.post('/', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const { value, error } = clean(req.body || {});
  if (error) return res.status(400).json({ error });
  const [{ n }] = await req.guildDb('SELECT COUNT(*) AS n FROM procedures');
  if (Number(n) >= 50) return res.status(400).json({ error: '50 procédures au maximum' });
  const keys = Object.keys(value);
  const r = await req.guildDb(`INSERT INTO procedures (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => value[k]));
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'procedure_create', targetType: 'procedure', targetId: r.insertId, details: { title: value.title } });
  const [row] = await req.guildDb('SELECT * FROM procedures WHERE id = ?', [r.insertId]);
  res.json(parse(row));
});

router.patch('/:id', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const { value, error } = clean(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(value);
  if (!keys.length) return res.status(400).json({ error: 'Aucune modification' });
  const r = await req.guildDb(`UPDATE procedures SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => value[k]), parseInt(req.params.id) || 0]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Procédure introuvable' });
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'procedure_update', targetType: 'procedure', targetId: req.params.id, details: { fields: keys } });
  const [row] = await req.guildDb('SELECT * FROM procedures WHERE id = ?', [parseInt(req.params.id)]);
  res.json(parse(row));
});

router.delete('/:id', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const [p] = await req.guildDb('SELECT id, title FROM procedures WHERE id = ?', [parseInt(req.params.id) || 0]);
  if (!p) return res.status(404).json({ error: 'Procédure introuvable' });
  await req.guildDb('DELETE FROM procedures WHERE id = ?', [p.id]);
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'procedure_delete', targetType: 'procedure', targetId: p.id, details: { title: p.title } });
  res.json({ ok: true });
});

module.exports = router;

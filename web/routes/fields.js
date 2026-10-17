// Custom ticket fields (utils/ticketFields.js). Read: staff; write: manage_settings.
const express = require('express');
const router = express.Router();
const { recordEvent, dashboardActor } = require('../../utils/audit');
const { TYPES } = require('../../utils/ticketFields');

const canManage = req => req.userIsFondateur || req.userPermissions?.has('manage_settings');

function clean(body, partial = false) {
  const out = {};
  if (!partial || body.label !== undefined) {
    if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 80) return { error: 'Libellé invalide (80 caractères max)' };
    out.label = body.label.trim();
  }
  if (!partial || body.type !== undefined) {
    const type = body.type ?? 'text';
    if (!TYPES.includes(type)) return { error: 'Type invalide' };
    out.type = type;
  }
  if (body.required !== undefined) out.required = body.required ? 1 : 0;
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  if (body.subject !== undefined) {
    if (body.subject !== null && (typeof body.subject !== 'string' || body.subject.length > 100)) return { error: 'Sujet invalide' };
    out.subject = body.subject?.trim() || null;
  }
  if (body.position !== undefined) {
    if (!Number.isInteger(body.position) || body.position < 0 || body.position > 1000) return { error: 'Position invalide' };
    out.position = body.position;
  }
  return { fields: out };
}

router.get('/', async (req, res) => {
  const rows = await req.guildDb('SELECT * FROM ticket_fields ORDER BY position ASC, id ASC');
  res.json(rows.map(f => ({ ...f, required: !!f.required, active: !!f.active })));
});

router.post('/', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const { fields, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const [{ n }] = await req.guildDb('SELECT COUNT(*) AS n FROM ticket_fields');
  if (Number(n) >= 20) return res.status(400).json({ error: '20 champs au maximum' });
  const keys = Object.keys(fields);
  const r = await req.guildDb(`INSERT INTO ticket_fields (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => fields[k]));
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'field_create', targetType: 'field', targetId: r.insertId, details: { label: fields.label } });
  const [row] = await req.guildDb('SELECT * FROM ticket_fields WHERE id = ?', [r.insertId]);
  res.json({ ...row, required: !!row.required, active: !!row.active });
});

router.patch('/:id', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const { fields, error } = clean(req.body, true);
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(fields);
  if (!keys.length) return res.status(400).json({ error: 'Aucune modification' });
  const r = await req.guildDb(`UPDATE ticket_fields SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => fields[k]), parseInt(req.params.id)]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Champ introuvable' });
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'field_update', targetType: 'field', targetId: req.params.id, details: { fields: keys } });
  const [row] = await req.guildDb('SELECT * FROM ticket_fields WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ ...row, required: !!row.required, active: !!row.active });
});

router.delete('/:id', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  const [f] = await req.guildDb('SELECT id, label FROM ticket_fields WHERE id = ?', [parseInt(req.params.id)]);
  if (!f) return res.status(404).json({ error: 'Champ introuvable' });
  await req.guildDb('DELETE FROM ticket_fields WHERE id = ?', [f.id]);
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'field_delete', targetType: 'field', targetId: f.id, details: { label: f.label } });
  res.json({ ok: true });
});

module.exports = router;

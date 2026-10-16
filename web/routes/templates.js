const express = require('express');
const router = express.Router();
const { recordEvent, dashboardActor } = require('../../utils/audit');

// Reply templates: personal (only their author sees them) or shared with the whole staff.
// A template may be linked to a subject: it is then suggested on matching tickets.

const SCOPES = ['personal', 'shared'];
const COLUMNS = 'id, name, content, subject, scope, use_count, created_by_id, created_by_tag, created_at';

const canWrite = req => req.userIsFondateur || req.userPermissions?.has('reply_ticket');
const canEdit = (req, tpl) => req.userIsFondateur || tpl.created_by_id === req.session.user.id;

// Accent/case-insensitive comparison: "Problème de paiement" matches the subject "paiement".
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[-_]+/g, ' ').trim();
function matchesSubject(tplSubject, ticketSubject) {
  const a = norm(tplSubject), b = norm(ticketSubject);
  return !!a && !!b && (a.includes(b) || b.includes(a));
}

// Templates the current user may see and use.
async function visibleTemplate(req, id) {
  const [tpl] = await req.guildDb(
    `SELECT ${COLUMNS} FROM reply_templates WHERE id = ? AND (scope = 'shared' OR created_by_id = ?)`,
    [id, req.session.user.id]
  );
  return tpl || null;
}

function cleanFields(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'Nom requis' };
    if (body.name.trim().length > 100) return { error: 'Nom trop long (max 100)' };
    out.name = body.name.trim();
  }
  if (!partial || body.content !== undefined) {
    if (typeof body.content !== 'string' || !body.content.trim()) return { error: 'Contenu requis' };
    if (body.content.length > 2000) return { error: 'Contenu trop long (max 2000)' };
    out.content = body.content.trim();
  }
  if (!partial || body.subject !== undefined) {
    out.subject = body.subject && typeof body.subject === 'string' ? body.subject.trim().slice(0, 100) || null : null;
  }
  if (!partial || body.scope !== undefined) {
    const scope = body.scope === undefined ? 'personal' : body.scope;
    if (!SCOPES.includes(scope)) return { error: 'Portée invalide' };
    out.scope = scope;
  }
  return { fields: out };
}

// GET /api/templates?subject=… — visible templates; those matching the subject come first (suggested)
router.get('/', async (req, res) => {
  try {
    const subject = typeof req.query.subject === 'string' ? req.query.subject : null;
    const rows = await req.guildDb(
      `SELECT ${COLUMNS} FROM reply_templates WHERE scope = 'shared' OR created_by_id = ? ORDER BY name ASC`,
      [req.session.user.id]
    );
    const templates = rows.map(t => ({
      ...t,
      mine: t.created_by_id === req.session.user.id,
      suggested: subject ? matchesSubject(t.subject, subject) : false,
    }));
    templates.sort((a, b) => (b.suggested - a.suggested) || (b.use_count - a.use_count) || a.name.localeCompare(b.name));
    res.json(templates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/', async (req, res) => {
  if (!canWrite(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const { fields, error } = cleanFields(req.body);
    if (error) return res.status(400).json({ error });
    const result = await req.guildDb(
      'INSERT INTO reply_templates (name, content, subject, scope, created_by_id, created_by_tag) VALUES (?, ?, ?, ?, ?, ?)',
      [fields.name, fields.content, fields.subject, fields.scope, req.session.user.id, req.session.user.username]
    );
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'template_create', targetType: 'template', targetId: result.insertId, details: { name: fields.name, scope: fields.scope } });
    res.json({
      id: result.insertId, ...fields, use_count: 0, mine: true, suggested: false,
      created_by_id: req.session.user.id, created_by_tag: req.session.user.username, created_at: new Date(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const tpl = await visibleTemplate(req, parseInt(req.params.id));
    if (!tpl) return res.status(404).json({ error: 'Modèle introuvable' });
    if (!canEdit(req, tpl)) return res.status(403).json({ error: 'Accès refusé' });
    const { fields, error } = cleanFields(req.body, true);
    if (error) return res.status(400).json({ error });
    const keys = Object.keys(fields);
    if (!keys.length) return res.json(tpl);
    await req.guildDb(`UPDATE reply_templates SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => fields[k]), tpl.id]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'template_update', targetType: 'template', targetId: tpl.id, details: { name: fields.name || tpl.name, fields: keys } });
    res.json({ ...tpl, ...fields, mine: tpl.created_by_id === req.session.user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/templates/:id/use — usage counter (most used templates are listed first)
router.post('/:id/use', async (req, res) => {
  const tpl = await visibleTemplate(req, parseInt(req.params.id));
  if (!tpl) return res.status(404).json({ error: 'Modèle introuvable' });
  await req.guildDb('UPDATE reply_templates SET use_count = use_count + 1 WHERE id = ?', [tpl.id]);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  try {
    const tpl = await visibleTemplate(req, parseInt(req.params.id));
    if (!tpl) return res.status(404).json({ error: 'Modèle introuvable' });
    if (!canEdit(req, tpl)) return res.status(403).json({ error: 'Accès refusé' });
    await req.guildDb('DELETE FROM reply_templates WHERE id = ?', [tpl.id]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'template_delete', targetType: 'template', targetId: tpl.id, details: { name: tpl.name } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
module.exports.visibleTemplate = visibleTemplate;
module.exports.matchesSubject = matchesSubject;

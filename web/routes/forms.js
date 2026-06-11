const express = require('express');
const router = express.Router();
const { logAudit } = require('../../utils/gradePermissions');

const VALID_STYLES = ['short', 'paragraph'];
const MAX_FIELDS = 5; // Discord modal limit

function validateField(f) {
  if (!f.label || typeof f.label !== 'string' || f.label.length > 45) return 'label invalide (max 45 chars)';
  if (f.style && !VALID_STYLES.includes(f.style)) return 'style invalide';
  if (f.min_length !== undefined && f.min_length !== null && (typeof f.min_length !== 'number' || f.min_length < 0)) return 'min_length invalide';
  if (f.max_length !== undefined && f.max_length !== null && (typeof f.max_length !== 'number' || f.max_length > 4000)) return 'max_length invalide';
  return null;
}

// GET /api/forms
router.get('/', async (req, res) => {
  try {
    const forms = await req.guildDb('SELECT * FROM intake_forms ORDER BY id DESC');
    for (const f of forms) {
      f.fields = await req.guildDb('SELECT * FROM intake_form_fields WHERE form_id = ? ORDER BY position ASC', [f.id]);
    }
    res.json(forms);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/forms
router.post('/', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  const { name, subject, fields = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });
  if (fields.length > MAX_FIELDS) return res.status(400).json({ error: `Maximum ${MAX_FIELDS} champs (limite Discord)` });
  for (const f of fields) {
    const err = validateField(f);
    if (err) return res.status(400).json({ error: err });
  }
  try {
    const r = await req.guildDb(
      'INSERT INTO intake_forms (name, subject, active) VALUES (?, ?, 1)',
      [name.trim(), subject || null]
    );
    const formId = r.insertId;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      await req.guildDb(
        'INSERT INTO intake_form_fields (form_id, label, placeholder, style, required, min_length, max_length, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [formId, f.label.trim(), f.placeholder || null, f.style || 'short', f.required !== false ? 1 : 0, f.min_length ?? null, f.max_length ?? null, i]
      );
    }
    await logAudit(req.session.user.id, req.session.user.username, 'form_create', 'form', formId, { name }, req.guildDb);
    const [form] = await req.guildDb('SELECT * FROM intake_forms WHERE id = ?', [formId]);
    form.fields = await req.guildDb('SELECT * FROM intake_form_fields WHERE form_id = ? ORDER BY position ASC', [formId]);
    res.status(201).json(form);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/forms/:id
router.patch('/:id', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  const { name, subject, active, fields } = req.body;
  try {
    const [form] = await req.guildDb('SELECT * FROM intake_forms WHERE id = ?', [req.params.id]);
    if (!form) return res.status(404).json({ error: 'Formulaire introuvable' });

    await req.guildDb(
      'UPDATE intake_forms SET name=?, subject=?, active=? WHERE id=?',
      [name ?? form.name, subject !== undefined ? (subject || null) : form.subject, active !== undefined ? (active ? 1 : 0) : form.active, form.id]
    );

    if (Array.isArray(fields)) {
      if (fields.length > MAX_FIELDS) return res.status(400).json({ error: `Maximum ${MAX_FIELDS} champs` });
      for (const f of fields) {
        const err = validateField(f);
        if (err) return res.status(400).json({ error: err });
      }
      await req.guildDb('DELETE FROM intake_form_fields WHERE form_id = ?', [form.id]);
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        await req.guildDb(
          'INSERT INTO intake_form_fields (form_id, label, placeholder, style, required, min_length, max_length, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [form.id, f.label.trim(), f.placeholder || null, f.style || 'short', f.required !== false ? 1 : 0, f.min_length ?? null, f.max_length ?? null, i]
        );
      }
    }

    await logAudit(req.session.user.id, req.session.user.username, 'form_update', 'form', form.id, { name }, req.guildDb);
    const [updated] = await req.guildDb('SELECT * FROM intake_forms WHERE id = ?', [form.id]);
    updated.fields = await req.guildDb('SELECT * FROM intake_form_fields WHERE form_id = ? ORDER BY position ASC', [form.id]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/forms/:id
router.delete('/:id', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  try {
    const [form] = await req.guildDb('SELECT * FROM intake_forms WHERE id = ?', [req.params.id]);
    if (!form) return res.status(404).json({ error: 'Formulaire introuvable' });
    await req.guildDb('DELETE FROM intake_forms WHERE id = ?', [form.id]);
    await logAudit(req.session.user.id, req.session.user.username, 'form_delete', 'form', form.id, { name: form.name }, req.guildDb);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

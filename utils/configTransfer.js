// Export / import of a server's configuration (settings, grades, tags, forms, panels, custom
// fields, FAQ, shared reply templates, subject rules) as JSON — to duplicate a server or restore
// a saved setup. Import merges by name and never deletes anything. Secrets are never exported;
// Discord channel / role IDs are only imported on request (they differ between servers).
const { parseJsonField } = require('./jsonField');

const FORMAT = 'ticketbot-config';
const VERSION = 1;

// require_2fa is a security choice of each server: importing it could lock its founders out
const SKIP_CONFIG = new Set(['id', 'updated_at', 'webhook_secret', 'support_grade_id', 'chief_grade_id', 'require_2fa']);
const isDiscordIdColumn = c => /_channel_id$|_category_id$|_role_ids$/.test(c);
const JSON_COLUMNS = new Set(['ticket_subjects', 'support_role_ids', 'chief_role_ids', 'webhook_events', 'subject_welcome_messages', 'ip_allowlist']);

async function exportConfig(db) {
  const [cfgRow] = await db('SELECT * FROM guild_config WHERE id = 1');
  const config = {};
  for (const [k, v] of Object.entries(cfgRow || {})) {
    if (SKIP_CONFIG.has(k)) continue;
    config[k] = JSON_COLUMNS.has(k) ? parseJsonField(v, k === 'subject_welcome_messages' ? {} : []) : v;
  }
  const grades = await db('SELECT id, name, color, parent_id, position FROM grades ORDER BY id');
  const gradeName = new Map(grades.map(g => [g.id, g.name]));
  const perms = await db('SELECT grade_id, permission FROM grade_permissions');
  const tags = await db('SELECT id, name, color FROM ticket_tags ORDER BY id');
  const tagName = new Map(tags.map(t => [t.id, t.name]));
  const forms = await db('SELECT id, name, subject, active FROM intake_forms ORDER BY id');
  const formName = new Map(forms.map(f => [f.id, f.name]));
  const formFields = await db('SELECT form_id, label, field_type, choices, required, position, placeholder, style, min_length, max_length FROM intake_form_fields ORDER BY position');
  const panels = await db('SELECT id, name, title, description, color, footer_text, image_url FROM ticket_panels ORDER BY id');
  const buttons = await db('SELECT panel_id, label, emoji, style, subject, form_id, position FROM panel_buttons ORDER BY position');

  return {
    format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(),
    config: { ...config, support_grade: gradeName.get(cfgRow?.support_grade_id) || null, chief_grade: gradeName.get(cfgRow?.chief_grade_id) || null },
    grades: grades.map(g => ({ name: g.name, color: g.color, position: g.position, parent: gradeName.get(g.parent_id) || null, permissions: perms.filter(p => p.grade_id === g.id).map(p => p.permission) })),
    tags: tags.map(({ name, color }) => ({ name, color })),
    forms: forms.map(f => ({ name: f.name, subject: f.subject, active: !!f.active, fields: formFields.filter(x => x.form_id === f.id).map(({ form_id, choices, ...x }) => ({ ...x, choices: parseJsonField(choices, null) })) })),
    panels: panels.map(p => ({ name: p.name, title: p.title, description: p.description, color: p.color, footer_text: p.footer_text, image_url: p.image_url,
      buttons: buttons.filter(b => b.panel_id === p.id).map(({ panel_id, form_id, ...b }) => ({ ...b, form: formName.get(form_id) || null })) })),
    fields: await db('SELECT label, type, required, subject, position, active, var_name FROM ticket_fields ORDER BY position, id'),
    faq: await db('SELECT question, answer, keywords, active FROM faq_entries ORDER BY id'),
    templates: (await db("SELECT name, content, subject, actions FROM reply_templates WHERE scope = 'shared' ORDER BY id"))
      .map(t => {
        const actions = parseJsonField(t.actions, null);
        if (actions?.tagId) { actions.tag = tagName.get(actions.tagId) || null; delete actions.tagId; }
        return { ...t, actions };
      }),
    subjectRules: (await db('SELECT match_type, subject, keywords, tag_id, priority, visibility_grade_id, active FROM subject_rules ORDER BY id'))
      .map(r => ({ matchType: r.match_type || 'subject', subject: r.subject, keywords: r.keywords, tag: tagName.get(r.tag_id) || null, priority: r.priority, grade: gradeName.get(r.visibility_grade_id) || null, active: !!r.active })),
  };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const bool = v => (v ? 1 : 0);
const int = (v, d = 0) => (Number.isInteger(v) ? v : d);

// Returns { created, updated, skipped } counters per section. Throws on an invalid file.
async function importConfig(db, data, { includeDiscordIds = false, actor = null } = {}) {
  if (!data || data.format !== FORMAT || data.version !== VERSION) throw Object.assign(new Error('Fichier de configuration invalide ou d\'une autre version'), { status: 400 });
  const report = {};
  const count = (section, kind) => { report[section] = report[section] || { created: 0, updated: 0 }; report[section][kind]++; };
  const { PERMISSIONS } = require('./gradePermissions');

  // Grades (by name), then parents and permissions
  const gradeId = new Map((await db('SELECT id, name FROM grades')).map(g => [g.name, g.id]));
  for (const g of Array.isArray(data.grades) ? data.grades.slice(0, 100) : []) {
    const name = str(g.name, 80); if (!name) continue;
    const color = /^#[0-9a-fA-F]{6}$/.test(g.color) ? g.color : '#6366f1';
    if (gradeId.has(name)) { await db('UPDATE grades SET color = ?, position = ? WHERE id = ?', [color, int(g.position), gradeId.get(name)]); count('grades', 'updated'); }
    else { gradeId.set(name, (await db('INSERT INTO grades (name, color, position) VALUES (?, ?, ?)', [name, color, int(g.position)])).insertId); count('grades', 'created'); }
  }
  for (const g of Array.isArray(data.grades) ? data.grades.slice(0, 100) : []) {
    const id = gradeId.get(str(g.name, 80)); if (!id) continue;
    const parent = g.parent ? gradeId.get(g.parent) : null;
    if (parent !== id) await db('UPDATE grades SET parent_id = ? WHERE id = ?', [parent || null, id]);
    for (const p of Array.isArray(g.permissions) ? g.permissions : []) {
      if (PERMISSIONS.includes(p)) await db('INSERT IGNORE INTO grade_permissions (grade_id, permission) VALUES (?, ?)', [id, p]);
    }
  }

  // Tags (by name)
  const tagId = new Map((await db('SELECT id, name FROM ticket_tags')).map(t => [t.name, t.id]));
  for (const t of Array.isArray(data.tags) ? data.tags.slice(0, 200) : []) {
    const name = str(t.name, 50); if (!name) continue;
    const color = /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : '#6366f1';
    if (tagId.has(name)) { await db('UPDATE ticket_tags SET color = ? WHERE id = ?', [color, tagId.get(name)]); count('tags', 'updated'); }
    else { tagId.set(name, (await db('INSERT INTO ticket_tags (name, color) VALUES (?, ?)', [name, color])).insertId); count('tags', 'created'); }
  }

  // Intake forms (by name): fields replaced by those of the file
  const formId = new Map((await db('SELECT id, name FROM intake_forms')).map(f => [f.name, f.id]));
  for (const f of Array.isArray(data.forms) ? data.forms.slice(0, 50) : []) {
    const name = str(f.name, 100); if (!name) continue;
    let id = formId.get(name);
    if (id) { await db('UPDATE intake_forms SET subject = ?, active = ? WHERE id = ?', [str(f.subject, 100), bool(f.active), id]); count('forms', 'updated'); }
    else { id = (await db('INSERT INTO intake_forms (name, subject, active) VALUES (?, ?, ?)', [name, str(f.subject, 100), bool(f.active)])).insertId; formId.set(name, id); count('forms', 'created'); }
    await db('DELETE FROM intake_form_fields WHERE form_id = ?', [id]);
    for (const x of Array.isArray(f.fields) ? f.fields.slice(0, 25) : []) {
      if (!str(x.label, 100)) continue;
      await db(
        'INSERT INTO intake_form_fields (form_id, label, field_type, choices, required, position, placeholder, style, min_length, max_length) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, str(x.label, 100), ['text', 'number', 'choice'].includes(x.field_type) ? x.field_type : 'text', x.choices ? JSON.stringify(x.choices) : null,
          bool(x.required), int(x.position), str(x.placeholder, 100), x.style === 'paragraph' ? 'paragraph' : 'short',
          Number.isInteger(x.min_length) ? x.min_length : null, Number.isInteger(x.max_length) ? x.max_length : null]
      );
    }
  }

  // Panels (by name): buttons replaced; they must be published again on Discord
  const panelId = new Map((await db('SELECT id, name FROM ticket_panels')).map(p => [p.name, p.id]));
  for (const p of Array.isArray(data.panels) ? data.panels.slice(0, 50) : []) {
    const name = str(p.name, 100); if (!name) continue;
    const values = [str(p.title, 256) || 'Support', str(p.description, 4000), /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#6366f1', str(p.footer_text, 256), str(p.image_url, 512)];
    let id = panelId.get(name);
    if (id) { await db('UPDATE ticket_panels SET title = ?, description = ?, color = ?, footer_text = ?, image_url = ? WHERE id = ?', [...values, id]); count('panels', 'updated'); }
    else { id = (await db('INSERT INTO ticket_panels (name, title, description, color, footer_text, image_url) VALUES (?, ?, ?, ?, ?, ?)', [name, ...values])).insertId; count('panels', 'created'); }
    await db('DELETE FROM panel_buttons WHERE panel_id = ?', [id]);
    for (const b of Array.isArray(p.buttons) ? p.buttons.slice(0, 25) : []) {
      if (!str(b.label, 80)) continue;
      await db('INSERT INTO panel_buttons (panel_id, label, emoji, style, subject, form_id, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, str(b.label, 80), str(b.emoji, 50), ['primary', 'secondary', 'success', 'danger'].includes(b.style) ? b.style : 'primary', str(b.subject, 100), formId.get(b.form) || null, int(b.position)]);
    }
  }

  // Custom fields (by label), FAQ (by question), shared templates (by name), subject rules (by subject)
  const upsertBy = async (section, table, keyCol, key, cols, values) => {
    const [row] = await db(`SELECT id FROM ${table} WHERE ${keyCol} = ?`, [key]);
    if (row) { await db(`UPDATE ${table} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...values, row.id]); count(section, 'updated'); }
    else { await db(`INSERT INTO ${table} (${keyCol}, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`, [key, ...values]); count(section, 'created'); }
  };
  for (const f of Array.isArray(data.fields) ? data.fields.slice(0, 20) : []) {
    if (!str(f.label, 80)) continue;
    const varName = /^[a-z][a-z0-9_]{0,39}$/.test(f.var_name || '') ? f.var_name : null;
    await upsertBy('fields', 'ticket_fields', 'label', str(f.label, 80), ['type', 'required', 'subject', 'position', 'active', 'var_name'],
      [f.type === 'number' ? 'number' : 'text', bool(f.required), str(f.subject, 100), int(f.position), bool(f.active ?? 1), varName]);
  }
  for (const q of Array.isArray(data.faq) ? data.faq.slice(0, 200) : []) {
    if (!str(q.question, 200) || !str(q.answer, 2000)) continue;
    await upsertBy('faq', 'faq_entries', 'question', str(q.question, 200), ['answer', 'keywords', 'active'], [str(q.answer, 2000), str(q.keywords, 500) || '', bool(q.active ?? 1)]);
  }
  for (const t of Array.isArray(data.templates) ? data.templates.slice(0, 200) : []) {
    if (!str(t.name, 100) || !str(t.content, 2000)) continue;
    const actions = t.actions && typeof t.actions === 'object' ? { ...t.actions } : null;
    if (actions?.tag) { actions.tagId = tagId.get(actions.tag) || undefined; delete actions.tag; }
    const [row] = await db("SELECT id FROM reply_templates WHERE name = ? AND scope = 'shared'", [str(t.name, 100)]);
    const vals = [str(t.content, 2000), str(t.subject, 100), actions ? JSON.stringify(actions) : null];
    if (row) { await db('UPDATE reply_templates SET content = ?, subject = ?, actions = ? WHERE id = ?', [...vals, row.id]); count('templates', 'updated'); }
    else {
      await db("INSERT INTO reply_templates (name, content, subject, actions, scope, created_by_id, created_by_tag) VALUES (?, ?, ?, ?, 'shared', ?, ?)",
        [str(t.name, 100), ...vals, String(actor?.id || 'import'), String(actor?.username || 'Import')]);
      count('templates', 'created');
    }
  }
  for (const r of Array.isArray(data.subjectRules) ? data.subjectRules.slice(0, 100) : []) {
    const vals = [r.tag ? tagId.get(r.tag) || null : null, ['low', 'normal', 'urgent'].includes(r.priority) ? r.priority : null, r.grade ? gradeId.get(r.grade) || null : null];
    if (!vals.some(Boolean)) continue;
    if (r.matchType === 'keyword') {
      const keywords = str(r.keywords, 300); if (!keywords) continue;
      await upsertBy('subjectRules', 'subject_rules', 'keywords', keywords, ['match_type', 'tag_id', 'priority', 'visibility_grade_id', 'active'], ['keyword', ...vals, bool(r.active ?? 1)]);
    } else {
      const subject = str(r.subject, 100); if (!subject) continue;
      await upsertBy('subjectRules', 'subject_rules', 'subject', subject, ['tag_id', 'priority', 'visibility_grade_id', 'active'], [...vals, bool(r.active ?? 1)]);
    }
  }

  // Settings: only known columns; Discord IDs only on request
  const cols = new Set((await db('SHOW COLUMNS FROM guild_config')).map(c => c.Field));
  const sets = [], params = [];
  for (const [k, v] of Object.entries(data.config || {})) {
    if (!cols.has(k) || SKIP_CONFIG.has(k)) continue;
    if (isDiscordIdColumn(k) && !includeDiscordIds) continue;
    sets.push(`${k} = ?`);
    params.push(JSON_COLUMNS.has(k) ? JSON.stringify(v ?? (k === 'subject_welcome_messages' ? {} : [])) : v);
  }
  if (data.config?.support_grade && gradeId.has(data.config.support_grade)) { sets.push('support_grade_id = ?'); params.push(gradeId.get(data.config.support_grade)); }
  if (data.config?.chief_grade && gradeId.has(data.config.chief_grade)) { sets.push('chief_grade_id = ?'); params.push(gradeId.get(data.config.chief_grade)); }
  if (sets.length) { await db(`UPDATE guild_config SET ${sets.join(', ')} WHERE id = 1`, params); report.config = { updated: sets.length }; }
  return report;
}

module.exports = { exportConfig, importConfig, FORMAT, VERSION };

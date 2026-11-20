// Export / import of a server's configuration (settings, grades, tags, forms, panels, custom
// fields, FAQ, shared reply templates, subject rules, custom statuses, teams) as JSON — to duplicate a server or restore
// a saved setup. Import merges by name and never deletes anything. Secrets are never exported;
// Discord channel / role IDs are only imported on request (they differ between servers).
const { parseJsonField } = require('./jsonField');

const FORMAT = 'ticketbot-config';
const VERSION = 1;

// require_2fa is a security choice of each server: importing it could lock its founders out
// widget_token: the public code of this space's web widget, never carried to another space
const SKIP_CONFIG = new Set(['id', 'updated_at', 'webhook_secret', 'support_grade_id', 'chief_grade_id', 'require_2fa', 'public_stats_message_id', 'widget_token']);
const isDiscordIdColumn = c => /_channel_id$|_category_id$|_role_ids$/.test(c);
const JSON_COLUMNS = new Set(['ticket_subjects', 'support_role_ids', 'chief_role_ids', 'webhook_events', 'subject_welcome_messages', 'ip_allowlist', 'subject_sla', 'ticket_type_labels', 'subject_types', 'priority_matrix']);

async function exportConfig(db) {
  const [cfgRow] = await db('SELECT * FROM guild_config WHERE id = 1');
  const config = {};
  for (const [k, v] of Object.entries(cfgRow || {})) {
    if (SKIP_CONFIG.has(k)) continue;
    config[k] = JSON_COLUMNS.has(k) ? parseJsonField(v, ['subject_welcome_messages', 'subject_sla', 'ticket_type_labels', 'subject_types'].includes(k) ? {} : k === 'priority_matrix' ? null : []) : v;
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
  const stages = await db('SELECT id, label, color, kind, category_id, sla_hours FROM ticket_stages ORDER BY position, id').catch(() => []);
  const stageLabel = new Map(stages.map(x => [`s_${x.id}`, x.label]));
  const teams = await db('SELECT name, color, assign_mode, max_open, subjects, tag_ids FROM teams ORDER BY name').catch(() => []);

  return {
    format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(),
    config: { ...config, support_grade: gradeName.get(cfgRow?.support_grade_id) || null, chief_grade: gradeName.get(cfgRow?.chief_grade_id) || null },
    grades: grades.map(g => ({ name: g.name, color: g.color, position: g.position, parent: gradeName.get(g.parent_id) || null, permissions: perms.filter(p => p.grade_id === g.id).map(p => p.permission) })),
    tags: tags.map(({ name, color }) => ({ name, color })),
    forms: forms.map(f => ({ name: f.name, subject: f.subject, active: !!f.active, fields: formFields.filter(x => x.form_id === f.id).map(({ form_id, choices, ...x }) => ({ ...x, choices: parseJsonField(choices, null) })) })),
    panels: panels.map(p => ({ name: p.name, title: p.title, description: p.description, color: p.color, footer_text: p.footer_text, image_url: p.image_url,
      buttons: buttons.filter(b => b.panel_id === p.id).map(({ panel_id, form_id, ...b }) => ({ ...b, form: formName.get(form_id) || null })) })),
    fields: await db('SELECT label, type, required, subject, position, active, var_name FROM ticket_fields ORDER BY position, id'),
    faq: await db('SELECT question, answer, keywords, category, visibility, active FROM faq_entries ORDER BY id'),
    templates: (await db("SELECT name, content, subject, actions FROM reply_templates WHERE scope = 'shared' ORDER BY id"))
      .map(t => {
        const actions = parseJsonField(t.actions, null);
        if (actions?.tagId) { actions.tag = tagName.get(actions.tagId) || null; delete actions.tagId; }
        // A custom status is known by its name: its « s_<id> » differs from one space to another
        if (actions?.stage && stageLabel.has(actions.stage)) { actions.stageLabel = stageLabel.get(actions.stage); delete actions.stage; }
        return { ...t, actions };
      }),
    procedures: (await db('SELECT title, subject, steps, active FROM procedures ORDER BY position, id').catch(() => []))
      .map(p => ({ title: p.title, subject: p.subject, active: !!p.active, steps: parseJsonField(p.steps, []).map(s => s.text) })),
    subjectRules: (await require('./subjectRules').listLegacy(db))
      .map(r => ({ matchType: r.match_type || 'subject', subject: r.subject, keywords: r.keywords, tag: tagName.get(r.tag_id) || null, priority: r.priority, grade: gradeName.get(r.visibility_grade_id) || null, active: !!r.active })),
    // Discord category: a Discord ID, imported only on request like the other channels
    stages: stages.map(x => ({ label: x.label, color: x.color, kind: x.kind, category_id: x.category_id, slaHours: x.sla_hours })),
    // Members are not carried: they are accounts of this space
    // Business rules (v5.2): tags, teams, grades and statuses by name; the people chosen in a rule
    // are accounts of this space, left out
    rules: await exportRules(db, { tagName, gradeName, stageLabel }),
    // v7: skills (by name) and those of the subjects; who has which skill stays local
    skills: (await require('./skills').listSkills(db)).map(x => x.name),
    subjectSkills: await (async () => {
      const names = new Map((await require('./skills').listSkills(db)).map(x => [x.id, x.name]));
      return Object.fromEntries(Object.entries(await require('./skills').subjectMap(db)).map(([k, v]) => [k, v.map(id => names.get(id)).filter(Boolean)]));
    })(),
    // v6: SLA objectives (escalation levels name people of this space: left out), service catalogue
    // and task templates, teams by name
    ...await exportServiceDesk(db),
    teams: teams.map(t => ({ name: t.name, color: t.color, level: t.level ? Number(t.level) : null, assignMode: t.assign_mode, maxOpen: Number(t.max_open) || 0, subjects: parseJsonField(t.subjects, []),
      tags: parseJsonField(t.tag_ids, []).map(id => tagName.get(Number(id))).filter(Boolean) })),
  };
}

async function exportServiceDesk(db) {
  const teamName = new Map((await db('SELECT id, name FROM teams').catch(() => [])).map(t => [t.id, t.name]));
  const sla = await require('./slaPolicies').listPolicies(db).catch(() => []);
  const services = await require('./catalog').listServices(db).catch(() => []);
  const tpls = await require('./tasks').listTemplates(db).catch(() => []);
  return {
    slaPolicies: sla.map(p => ({ name: p.name, ttoMinutes: p.ttoMinutes, ttrMinutes: p.ttrMinutes, businessHours: p.businessHours, active: p.active,
      conditions: { priorities: p.conditions.priorities, types: p.conditions.types, subjects: p.conditions.subjects, channels: p.conditions.channels } })),
    services: services.map(s => ({ name: s.name, description: s.description, icon: s.icon, category: s.category, active: s.active, fields: s.fields,
      template: { subject: s.template.subject, type: s.template.type, priority: s.template.priority, team: teamName.get(s.template.teamId) || null } })),
    taskTemplates: tpls.map(t => ({ name: t.name, tasks: t.tasks.map(({ teamId, ...x }) => ({ ...x, team: teamName.get(teamId) || null })) })),
  };
}
async function importServiceDesk(db, data, count) {
  const teamId = new Map((await db('SELECT id, name FROM teams').catch(() => [])).map(t => [t.name, t.id]));
  const byName = async (table, name) => (await db(`SELECT id FROM ${table} WHERE name = ?`, [name]).catch(() => []))[0]?.id || null;
  for (const p of Array.isArray(data.slaPolicies) ? data.slaPolicies.slice(0, 50) : []) {
    if (!p || typeof p.name !== 'string') continue;
    const id = await byName('sla_policies', p.name.slice(0, 60));
    const r = await require('./slaPolicies').savePolicy(db, id, { ...p, escalations: undefined }); // the levels of this space stay
    if (r && !r.error) count('slaPolicies', id ? 'updated' : 'created');
  }
  for (const s of Array.isArray(data.services) ? data.services.slice(0, 100) : []) {
    if (!s || typeof s.name !== 'string') continue;
    const id = await byName('catalog_services', s.name.slice(0, 80));
    const t = s.template || {};
    const r = await require('./catalog').saveService(db, id, { ...s, template: { subject: t.subject || null, type: t.type || null, priority: t.priority || null, teamId: teamId.get(t.team) || null } });
    if (r && r.error && /Sujet inconnu/.test(r.error)) { // the subject is not one of this space: the service without it
      const r2 = await require('./catalog').saveService(db, id, { ...s, template: { type: t.type || null, priority: t.priority || null, teamId: teamId.get(t.team) || null } });
      if (r2 && !r2.error) count('services', id ? 'updated' : 'created');
    } else if (r && !r.error) count('services', id ? 'updated' : 'created');
  }
  for (const tpl of Array.isArray(data.taskTemplates) ? data.taskTemplates.slice(0, 50) : []) {
    if (!tpl || typeof tpl.name !== 'string') continue;
    const id = await byName('task_templates', tpl.name.slice(0, 80));
    const r = await require('./tasks').saveTemplate(db, id, { name: tpl.name, tasks: (Array.isArray(tpl.tasks) ? tpl.tasks : []).map(({ team, ...x }) => ({ ...x, teamId: teamId.get(team) || null })) });
    if (r && !r.error) count('taskTemplates', id ? 'updated' : 'created');
  }
}

const PERSONAL = ['assign', 'follower', 'notify'];
async function exportRules(db, { tagName, gradeName, stageLabel }) {
  const teamName = new Map((await db('SELECT id, name FROM teams').catch(() => [])).map(t => [t.id, t.name]));
  // v6: organisations, custom fields and SLA objectives by name (ids differ from one space to another)
  const orgName = new Map((await db('SELECT id, name FROM organizations').catch(() => [])).map(o => [o.id, o.name]));
  const fieldLabel = new Map((await db('SELECT id, label FROM ticket_fields').catch(() => [])).map(f => [f.id, f.label]));
  const slaName = new Map((await db('SELECT id, name FROM sla_policies').catch(() => [])).map(p => [p.id, p.name]));
  const skillName = new Map((await db('SELECT id, name FROM skills').catch(() => [])).map(x => [x.id, x.name]));
  const stage = v => stageLabel.get(v) ? { stageLabel: stageLabel.get(v) } : { value: v };
  return (await require('./ruleEngine').listRules(db)).filter(r => r.origin !== 'subject').map(r => ({
    name: r.name, active: r.active, triggers: r.triggers, timer: r.timer, match: r.match, stop: r.stop,
    conditions: r.conditions.map(c => (c.field === 'tag' ? { ...c, values: c.values.map(id => tagName.get(Number(id))).filter(Boolean) }
      : c.field === 'stage' ? { ...c, values: c.values.map(v => stageLabel.get(v) || v) }
        : c.field === 'organization' ? { ...c, values: c.values.map(id => orgName.get(Number(id))).filter(Boolean) }
          : c.field === 'customField' ? { field: c.field, not: c.not, fieldLabel: fieldLabel.get(Number(c.fieldId)) || null, values: c.values } : c)).filter(c => c.field !== 'customField' || c.fieldLabel),
    actions: r.actions.filter(a => !PERSONAL.includes(a.type)).map(a => (['tagAdd', 'tagRemove'].includes(a.type) ? { type: a.type, value: tagName.get(a.value) || null }
      : a.type === 'sla' ? { type: a.type, value: slaName.get(a.value) || null }
      : a.type === 'skill' ? { type: a.type, value: skillName.get(a.value) || null }
      : a.type === 'team' ? { type: a.type, value: teamName.get(a.value) || null } : a.type === 'grade' ? { type: a.type, value: gradeName.get(a.value) || null }
        : a.type === 'stage' ? { type: a.type, ...stage(a.value) } : a)).filter(a => a.value !== null),
  }));
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const bool = v => (v ? 1 : 0);
const int = (v, d = 0) => (Number.isInteger(v) ? v : d);

// Returns { created, updated, skipped } counters per section. Throws on an invalid file.
// applyConfig(updates by column) → { error } | { ok }: writes the settings through the same
// validation as the Settings page (values, channels and roles of this server only, history).
// It runs first, so a refused file changes nothing.
async function importConfig(db, data, { includeDiscordIds = false, actor = null, applyConfig } = {}) {
  if (!data || data.format !== FORMAT || data.version !== VERSION) throw Object.assign(new Error('Fichier de configuration invalide ou d\'une autre version'), { status: 400 });
  if (typeof applyConfig !== 'function') throw new Error('importConfig: applyConfig requis');
  const report = {};

  // Settings: only known columns; Discord IDs only on request
  const cols = new Set((await db('SHOW COLUMNS FROM guild_config')).map(c => c.Field));
  const updates = {};
  for (const [k, v] of Object.entries(data.config || {})) {
    if (!cols.has(k) || SKIP_CONFIG.has(k)) continue;
    if (isDiscordIdColumn(k) && !includeDiscordIds) continue;
    updates[k] = v;
  }
  const applied = await applyConfig(updates);
  if (applied?.error) throw Object.assign(new Error(`Paramètres refusés : ${applied.error}`), { status: 400 });
  if (applied?.count) report.config = { updated: applied.count };
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
    if (!str(q.question, 200) || !str(q.answer, 5000)) continue;
    await upsertBy('faq', 'faq_entries', 'question', str(q.question, 200), ['answer', 'keywords', 'category', 'visibility', 'active'],
      [str(q.answer, 5000), str(q.keywords, 500) || '', str(q.category, 80) || '', q.visibility === 'public' ? 'public' : 'members', bool(q.active ?? 1)]);
  }
  // Custom statuses (by name), through the same checks as Paramètres → Tickets → Statuts
  const stagesLib = require('./stages');
  for (const x of Array.isArray(data.stages) ? data.stages.slice(0, stagesLib.MAX_CUSTOM) : []) {
    const input = { label: x.label, color: x.color, kind: x.kind, slaHours: x.slaHours, categoryId: includeDiscordIds ? x.category_id : null };
    const label = str(x.label, 40)?.trim(); if (!label) continue;
    const [row] = await db('SELECT id, category_id FROM ticket_stages WHERE LOWER(label) = LOWER(?)', [label]);
    if (row && !includeDiscordIds) input.categoryId = row.category_id; // this space's category is kept
    const r = row ? await stagesLib.updateStage(db, row.id, input) : await stagesLib.createStage(db, input);
    if (r.ok) count('stages', row ? 'updated' : 'created');
  }
  const stageKey = new Map((await db('SELECT id, label FROM ticket_stages').catch(() => [])).map(x => [x.label.toLowerCase(), `s_${x.id}`]));

  for (const t of Array.isArray(data.templates) ? data.templates.slice(0, 200) : []) {
    if (!str(t.name, 100) || !str(t.content, 2000)) continue;
    const actions = t.actions && typeof t.actions === 'object' ? { ...t.actions } : null;
    if (actions?.tag) { actions.tagId = tagId.get(actions.tag) || undefined; delete actions.tag; }
    if (actions?.stageLabel !== undefined) { const k = stageKey.get(String(actions.stageLabel).toLowerCase()); if (k) actions.stage = k; delete actions.stageLabel; }
    if (actions?.stage && !/^(open|waiting|in_progress|s_\d{1,9})$/.test(actions.stage)) delete actions.stage;
    const [row] = await db("SELECT id FROM reply_templates WHERE name = ? AND scope = 'shared'", [str(t.name, 100)]);
    const vals = [str(t.content, 2000), str(t.subject, 100), actions ? JSON.stringify(actions) : null];
    if (row) { await db('UPDATE reply_templates SET content = ?, subject = ?, actions = ? WHERE id = ?', [...vals, row.id]); count('templates', 'updated'); }
    else {
      await db("INSERT INTO reply_templates (name, content, subject, actions, scope, created_by_id, created_by_tag) VALUES (?, ?, ?, ?, 'shared', ?, ?)",
        [str(t.name, 100), ...vals, String(actor?.id || 'import'), String(actor?.username || 'Import')]);
      count('templates', 'created');
    }
  }
  for (const p of Array.isArray(data.procedures) ? data.procedures.slice(0, 50) : []) {
    const steps = require('./procedures').cleanSteps((Array.isArray(p.steps) ? p.steps : []).map(text => ({ text: String(text) })));
    if (!str(p.title, 100) || !steps) continue;
    await upsertBy('procedures', 'procedures', 'title', str(p.title, 100), ['subject', 'steps', 'active'], [str(p.subject, 100), JSON.stringify(steps), bool(p.active ?? 1)]);
  }
  // Rules by subject or keywords (rules of the engine, utils/subjectRules.js): the same subject or
  // keywords replace the rule
  const legacyLib = require('./subjectRules');
  for (const r of Array.isArray(data.subjectRules) ? data.subjectRules.slice(0, 100) : []) {
    const keyword = r.matchType === 'keyword';
    const v = { match_type: keyword ? 'keyword' : 'subject', subject: keyword ? null : str(r.subject, 100), keywords: keyword ? str(r.keywords, 300) : null,
      tag_id: r.tag ? tagId.get(r.tag) || null : null, priority: ['low', 'normal', 'urgent'].includes(r.priority) ? r.priority : null, visibility_grade_id: r.grade ? gradeId.get(r.grade) || null : null };
    if (!(keyword ? v.keywords : v.subject) || !(v.tag_id || v.priority || v.visibility_grade_id)) continue;
    const same = (await legacyLib.listLegacy(db)).find(x => (keyword ? x.match_type === 'keyword' && x.keywords === v.keywords : x.match_type !== 'keyword' && x.subject === v.subject));
    if (same) await db('DELETE FROM ticket_rules WHERE id = ?', [same.id]);
    const res = await legacyLib.createLegacy(db, v);
    if (res.ok) {
      if (r.active === false) await db('UPDATE ticket_rules SET active = 0 WHERE id = ?', [res.id]);
      count('subjectRules', same ? 'updated' : 'created');
    }
  }

  // Teams (by name): settings only, the members of an existing team stay; unknown subjects or tags are left out
  const teamsLib = require('./teams');
  const [cfgNow] = await db('SELECT ticket_subjects FROM guild_config WHERE id = 1');
  const known = new Set(parseJsonField(cfgNow?.ticket_subjects, []).map(x => (typeof x === 'string' ? x : x?.label || x?.name)).filter(Boolean));
  for (const t of Array.isArray(data.teams) ? data.teams.slice(0, teamsLib.MAX_TEAMS) : []) {
    const name = str(t.name, 60)?.trim(); if (!name) continue;
    const [row] = await db('SELECT id FROM teams WHERE name = ?', [name]);
    const members = row ? (await db('SELECT user_id FROM team_members WHERE team_id = ?', [row.id])).map(m => m.user_id) : [];
    const input = { name, color: t.color, level: Number.isInteger(t.level) ? t.level : null, assignMode: t.assignMode, maxOpen: Number.isInteger(t.maxOpen) ? t.maxOpen : 0, members,
      subjects: (Array.isArray(t.subjects) ? t.subjects : []).map(String).filter(x => known.has(x)),
      tagIds: (Array.isArray(t.tags) ? t.tags : []).map(n => tagId.get(n)).filter(Boolean) };
    const r = row ? await teamsLib.updateTeam(db, row.id, input) : await teamsLib.createTeam(db, input);
    if (r.ok) count('teams', row ? 'updated' : 'created');
  }

  // v6: SLA objectives, catalogue, task templates (after the teams, before the rules that name them)
  await importServiceDesk(db, data, count);

  // Business rules (by name), after the teams they may hand tickets to; what is unknown here is left out
  const engine = require('./ruleEngine');
  const teamIdOf = new Map((await db('SELECT id, name FROM teams').catch(() => [])).map(t => [t.name, t.id]));
  const stageKeyOf = new Map((await db('SELECT id, label FROM ticket_stages').catch(() => [])).map(x => [x.label.toLowerCase(), `s_${x.id}`]));
  const orgIdOf = new Map((await db('SELECT id, name FROM organizations').catch(() => [])).map(o => [o.name, o.id]));
  const fieldIdOf = new Map((await db('SELECT id, label FROM ticket_fields').catch(() => [])).map(f => [f.label, f.id]));
  const slaIdOf = new Map((await db('SELECT id, name FROM sla_policies').catch(() => [])).map(p => [p.name, p.id]));
  // v7: skills by name, and those of the subjects (created when missing)
  const S = require('./skills');
  for (const n of Array.isArray(data.skills) ? data.skills.slice(0, S.MAX_SKILLS) : []) if (typeof n === 'string' && (await S.createSkill(db, n)).ok) count('skills', 'created');
  const skillIdOf = new Map((await db('SELECT id, name FROM skills').catch(() => [])).map(x => [x.name, x.id]));
  if (data.subjectSkills && typeof data.subjectSkills === 'object') {
    const map = Object.fromEntries(Object.entries(data.subjectSkills).map(([subj, names]) => [subj, (Array.isArray(names) ? names : []).map(n => skillIdOf.get(n)).filter(Boolean)]));
    const merged = { ...(await S.subjectMap(db)), ...map };
    if ((await S.saveSubjectMap(db, merged)).ok) count('skills', 'updated');
  }
  for (const r of Array.isArray(data.rules) ? data.rules.slice(0, engine.MAX_RULES || 100) : []) {
    if (!r || typeof r !== 'object' || !str(r.name, 80)) continue;
    const conditions = (Array.isArray(r.conditions) ? r.conditions : []).map(c => (c?.field === 'tag' ? { ...c, values: (c.values || []).map(n => tagId.get(n)).filter(Boolean) }
      : c?.field === 'stage' ? { ...c, values: (c.values || []).map(v => stageKeyOf.get(String(v).toLowerCase()) || v) }
        : c?.field === 'organization' ? { ...c, values: (c.values || []).map(n => orgIdOf.get(n)).filter(Boolean) }
          : c?.field === 'customField' ? (fieldIdOf.has(c.fieldLabel) ? { field: c.field, not: !!c.not, fieldId: fieldIdOf.get(c.fieldLabel), values: c.values || [] } : null) : c))
      .filter(c => c && (!Array.isArray(c.values) || c.values.length));
    const actions = (Array.isArray(r.actions) ? r.actions : []).filter(a => a && !PERSONAL.includes(a.type)).map(a => (['tagAdd', 'tagRemove'].includes(a.type) ? { type: a.type, value: tagId.get(a.value) }
      : a.type === 'team' ? { type: a.type, value: teamIdOf.get(a.value) } : a.type === 'grade' ? { type: a.type, value: gradeId.get(a.value) }
        : a.type === 'sla' ? { type: a.type, value: slaIdOf.get(a.value) }
        : a.type === 'skill' ? { type: a.type, value: skillIdOf.get(a.value) }
        : a.type === 'stage' ? { type: a.type, value: a.stageLabel ? stageKeyOf.get(String(a.stageLabel).toLowerCase()) : a.value } : a)).filter(a => a.value !== undefined && a.value !== null);
    const [row] = await db("SELECT id FROM ticket_rules WHERE name = ? AND (origin IS NULL OR origin <> 'subject')", [str(r.name, 80)]);
    const res = await engine.saveRule(db, row?.id || null, { ...r, conditions, actions }, { canGrade: true });
    if (res.ok) count('rules', row ? 'updated' : 'created');
  }

  // Grades of the support roles, by name (local ids)
  const sets = [], params = [];
  if (data.config?.support_grade && gradeId.has(data.config.support_grade)) { sets.push('support_grade_id = ?'); params.push(gradeId.get(data.config.support_grade)); }
  if (data.config?.chief_grade && gradeId.has(data.config.chief_grade)) { sets.push('chief_grade_id = ?'); params.push(gradeId.get(data.config.chief_grade)); }
  if (sets.length) await db(`UPDATE guild_config SET ${sets.join(', ')} WHERE id = 1`, params);
  return report;
}

module.exports = { exportConfig, importConfig };

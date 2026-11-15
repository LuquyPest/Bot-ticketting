// Reply templates shared by every server of the instance (ticketbot_global.instance_templates):
// written by the owner once, offered to the staff of each server next to its own templates.
// Their IDs carry an « i » prefix (« i12 ») so they never collide with a server's templates.
// Their macro actions cannot add a tag (tags belong to each server). Never offered on the demo.
const { globalQuery } = require('./globalDb');

const ID_RE = /^i(\d{1,9})$/;
const COLUMNS = 'id, name, content, subject, actions, use_count, created_by_id, created_by_tag, created_at';
const isInstanceId = id => ID_RE.test(String(id ?? ''));
const shape = row => ({ ...row, id: `i${row.id}`, scope: 'instance' });

async function listInstanceTemplates(guildId) {
  if (guildId === require('./demo').DEMO_GUILD_ID) return [];
  return (await globalQuery(`SELECT ${COLUMNS} FROM instance_templates ORDER BY name ASC`).catch(() => [])).map(shape);
}

async function getInstanceTemplate(guildId, id) {
  const m = ID_RE.exec(String(id ?? ''));
  if (!m || guildId === require('./demo').DEMO_GUILD_ID) return null;
  const [row] = await globalQuery(`SELECT ${COLUMNS} FROM instance_templates WHERE id = ?`, [Number(m[1])]);
  return row ? shape(row) : null;
}

async function createInstanceTemplate(fields, user) {
  const r = await globalQuery(
    'INSERT INTO instance_templates (name, content, subject, actions, created_by_id, created_by_tag) VALUES (?, ?, ?, ?, ?, ?)',
    [fields.name, fields.content, fields.subject, fields.actions, user.id, user.username]
  );
  return `i${r.insertId}`;
}

async function updateInstanceTemplate(id, fields) {
  const keys = Object.keys(fields).filter(k => ['name', 'content', 'subject', 'actions'].includes(k));
  if (!keys.length) return;
  await globalQuery(`UPDATE instance_templates SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => fields[k]), Number(ID_RE.exec(id)[1])]);
}

const deleteInstanceTemplate = id => globalQuery('DELETE FROM instance_templates WHERE id = ?', [Number(ID_RE.exec(id)[1])]);
const countInstanceTemplateUse = id => globalQuery('UPDATE instance_templates SET use_count = use_count + 1 WHERE id = ?', [Number(ID_RE.exec(id)[1])]);

module.exports = { isInstanceId, listInstanceTemplates, getInstanceTemplate, createInstanceTemplate, updateInstanceTemplate, deleteInstanceTemplate, countInstanceTemplateUse };

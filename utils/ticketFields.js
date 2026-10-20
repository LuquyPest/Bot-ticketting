// Custom ticket fields (order number, in-game name…): defined per guild, asked to the member in DM
// after the subject (only those for every subject or for that subject), stored one value per
// field so the ticket list can filter on them.

const TYPES = ['text', 'number'];

// Template variable of a field: {{commande}} for « N° de commande ». Set by hand (var_name) or
// derived from the label without accents and filler words.
const FILLER = new Set(['n', 'no', 'num', 'numero', 'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'ton', 'ta', 'tes', 'votre', 'vos', 'the', 'of', 'your']);
const VAR_RE = /^[a-z][a-z0-9_]{0,39}$/;
const RESERVED_VARS = new Set(['username', 'ticket_id', 'date', 'staff_name', 'subject']);
function slugVar(label, id) {
  const words = String(label || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/n°/g, ' ')
    .split(/[^a-z0-9]+/).filter(w => w && !FILLER.has(w));
  const v = words.join('_').slice(0, 30).replace(/^[^a-z]+/, '');
  return v && !RESERVED_VARS.has(v) ? v : `champ_${id}`;
}
const fieldVar = f => f.var_name || slugVar(f.label, f.id);

// {{variable}} → value of that field on the ticket ('' when not filled)
function resolveFieldVars(text, fields = []) {
  const byVar = new Map(fields.map(f => [fieldVar(f), f.value ?? '']));
  return String(text).replace(/\{\{([a-z][a-z0-9_]*)\}\}/gi, (m, v) => (byVar.has(v.toLowerCase()) ? byVar.get(v.toLowerCase()) : m));
}

async function applicableFields(db, subject) {
  return db(
    `SELECT id, label, type, required FROM ticket_fields
     WHERE active = 1 AND (subject IS NULL OR LOWER(subject) = LOWER(?)) ORDER BY position ASC, id ASC`,
    [subject || '']
  ).catch(() => []);
}

// Value typed by the member: { value } or { error } ('' = skipped optional field)
function parseFieldAnswer(field, raw, skipWords) {
  const text = String(raw || '').trim();
  if (!field.required && skipWords.includes(text.toLowerCase())) return { value: '' };
  if (!text) return { error: 'empty' };
  if (field.type === 'number') {
    const n = Number(text.replace(',', '.').replace(/\s/g, ''));
    if (!Number.isFinite(n)) return { error: 'number' };
    return { value: String(n) };
  }
  return { value: text.slice(0, 200) };
}

async function saveFieldValues(db, ticketId, values) {
  for (const [fieldId, value] of Object.entries(values || {})) {
    if (value === '' || value == null) continue;
    await db(
      'INSERT INTO ticket_field_values (ticket_id, field_id, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [ticketId, parseInt(fieldId), String(value).slice(0, 200)]
    );
  }
}

// Active fields with this ticket's values (null when not filled)
async function fieldsForTicket(db, ticketId) {
  return db(
    `SELECT f.id, f.label, f.type, f.var_name, v.value FROM ticket_fields f
     LEFT JOIN ticket_field_values v ON v.field_id = f.id AND v.ticket_id = ?
     WHERE f.active = 1 OR v.value IS NOT NULL ORDER BY f.position ASC, f.id ASC`,
    [ticketId]
  ).then(rows => rows.map(r => ({ ...r, variable: fieldVar(r) }))).catch(() => []);
}

module.exports = { TYPES, applicableFields, parseFieldAnswer, saveFieldValues, fieldsForTicket, fieldVar, slugVar, resolveFieldVars, VAR_RE, RESERVED_VARS };

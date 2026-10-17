// Custom ticket fields (order number, in-game name…): defined per guild, asked to the member in DM
// after the subject (only those for every subject or for that subject), stored one value per
// field so the ticket list can filter on them.

const TYPES = ['text', 'number'];

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
    `SELECT f.id, f.label, f.type, v.value FROM ticket_fields f
     LEFT JOIN ticket_field_values v ON v.field_id = f.id AND v.ticket_id = ?
     WHERE f.active = 1 OR v.value IS NOT NULL ORDER BY f.position ASC, f.id ASC`,
    [ticketId]
  ).catch(() => []);
}

module.exports = { TYPES, applicableFields, parseFieldAnswer, saveFieldValues, fieldsForTicket };

// Types of tickets (v5.1, conception/v5.md §3.1): Incident (something no longer works) or Request
// (someone asks for something). Renamable per space; turned off, only « request » exists and no
// screen shows the type. A subject can set the type of its new tickets (its sub-categories inherit).
const { parseJsonField } = require('./jsonField');

const TYPES = ['incident', 'request'];
const DEFAULT_LABELS = { incident: 'Incident', request: 'Demande' };
const SEP = ' › ';

async function typeSettings(db) {
  const [cfg] = await db('SELECT ticket_types_enabled, ticket_type_labels, subject_types FROM guild_config WHERE id = 1').catch(() => []);
  const labels = { ...DEFAULT_LABELS, ...(parseJsonField(cfg?.ticket_type_labels, {}) || {}) };
  return { enabled: !!Number(cfg?.ticket_types_enabled), labels, subjectTypes: parseJsonField(cfg?.subject_types, {}) || {} };
}

// The type of a new ticket of this subject: its own, else its category's, else « request »
function typeForSubject(subjectTypes, subject) {
  const s = String(subject || '');
  if (!s) return 'request';
  if (TYPES.includes(subjectTypes[s])) return subjectTypes[s];
  const parent = s.split(SEP)[0];
  return TYPES.includes(subjectTypes[parent]) ? subjectTypes[parent] : 'request';
}

// At the opening (utils/ticketManager.js): the subject's type, when the types are on
async function applyDefaultType(db, ticket) {
  const s = await typeSettings(db);
  if (!s.enabled) return 'request';
  const type = typeForSubject(s.subjectTypes, ticket.subject);
  if (type !== 'request') await db('UPDATE tickets SET ticket_type = ? WHERE id = ?', [type, ticket.id]);
  return type;
}

// Settings → Tickets: { labels: { incident, request } } and { subject: type } checked
function labelsProblem(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Noms des types invalides';
  for (const [k, l] of Object.entries(v)) {
    if (!TYPES.includes(k)) return `Type inconnu : ${k}`;
    if (typeof l !== 'string' || !l.trim() || l.length > 30) return 'Nom d\'un type : 1 à 30 caractères';
  }
  return null;
}
function subjectTypesProblem(v, subjects) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 60) return 'Types par sujet invalides';
  for (const [k, t] of Object.entries(v)) {
    if (!TYPES.includes(t)) return `Type inconnu pour « ${k} »`;
    if (subjects && !subjects.includes(k)) return `Sujet inconnu : ${k}`;
  }
  return null;
}

module.exports = { TYPES, DEFAULT_LABELS, typeSettings, typeForSubject, applyDefaultType, labelsProblem, subjectTypesProblem };

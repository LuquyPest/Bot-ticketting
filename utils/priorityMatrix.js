// Priority from urgency × impact (v5.1, conception/v5.md §3.3). Urgency (for the requester) and
// impact (how many people, how serious) go from 1 to 5; a matrix per space gives the level, from 1
// (very low) to 5 (very high); 6 (major) is set by hand. The 3 priorities of before (low, normal,
// urgent: Discord /priority, macros, rules, API v1/v2, queue) stay and follow the level:
// 1–2 → low, 3 → normal, 4–6 → urgent; set the old way, they move the level (low → 2, normal → 3,
// urgent → 4) unless it is already in that band.
const { parseJsonField } = require('./jsonField');

const LEVELS = [1, 2, 3, 4, 5, 6];
const LEVEL_LABELS = { 1: 'Très basse', 2: 'Basse', 3: 'Moyenne', 4: 'Haute', 5: 'Très haute', 6: 'Majeure' };
const URGENCY_LABELS = { 1: 'Très basse', 2: 'Basse', 3: 'Moyenne', 4: 'Haute', 5: 'Très haute' };
const IMPACT_LABELS = { 1: 'Très faible', 2: 'Faible', 3: 'Moyen', 4: 'Fort', 5: 'Très fort' };
// rows = urgency 1..5, columns = impact 1..5 (the usual ITIL table)
const DEFAULT_MATRIX = [
  [1, 1, 1, 1, 2],
  [1, 1, 2, 2, 3],
  [2, 2, 3, 4, 4],
  [2, 3, 4, 5, 5],
  [3, 4, 5, 5, 5],
];
const bucketOf = level => (level <= 2 ? 'low' : level === 3 ? 'normal' : 'urgent');
const levelOfBucket = p => ({ low: 2, normal: 3, urgent: 4 }[p] || 3);
// SQL: the level when the priority is set the old way (? = the new priority, twice)
const LEVEL_FROM_PRIORITY_SQL = `priority_level = IF((CASE WHEN priority_level <= 2 THEN 'low' WHEN priority_level = 3 THEN 'normal' ELSE 'urgent' END) = ?, priority_level,
  CASE ? WHEN 'low' THEN 2 WHEN 'urgent' THEN 4 ELSE 3 END)`;

const validMatrix = m => Array.isArray(m) && m.length === 5 && m.every(r => Array.isArray(r) && r.length === 5 && r.every(v => Number.isInteger(v) && v >= 1 && v <= 6));
async function matrixSettings(db) {
  const [cfg] = await db('SELECT priority_matrix_enabled, priority_matrix FROM guild_config WHERE id = 1').catch(() => []);
  const m = parseJsonField(cfg?.priority_matrix, null);
  return { enabled: !!Number(cfg?.priority_matrix_enabled), matrix: validMatrix(m) ? m : DEFAULT_MATRIX };
}
const levelFor = (matrix, urgency, impact) => matrix[urgency - 1][impact - 1];

// { urgency, impact, level } — level: a forced level (1–6), or null to compute it again
async function setMatrixPriority({ db, client, guildId, ticket, urgency, impact, level, actor }) {
  const s = await matrixSettings(db);
  const u = urgency === undefined ? ticket.urgency : urgency;
  const i = impact === undefined ? ticket.impact : impact;
  for (const [v, name] of [[u, 'urgence'], [i, 'impact']]) if (v !== null && v !== undefined && !(Number.isInteger(v) && v >= 1 && v <= 5)) throw Object.assign(new Error(`${name} : de 1 à 5`), { status: 400 });
  if (level !== undefined && level !== null && !LEVELS.includes(level)) throw Object.assign(new Error('priorité : de 1 à 6'), { status: 400 });
  const forced = level !== undefined && level !== null;
  const computed = u && i ? levelFor(s.matrix, u, i) : (ticket.priority_level || 3);
  const newLevel = forced ? level : computed;
  const priority = bucketOf(newLevel);
  await db('UPDATE tickets SET urgency = ?, impact = ?, priority_level = ?, priority_forced = ?, priority = ? WHERE id = ?', [u ?? null, i ?? null, newLevel, forced ? 1 : 0, priority, ticket.id]);
  if (newLevel !== ticket.priority_level || u !== ticket.urgency || i !== ticket.impact) {
    await require('./audit').recordEvent(db, { actor, action: 'ticket_priority', ticketId: ticket.id, details: { from: ticket.priority_level, to: newLevel, urgency: u ?? null, impact: i ?? null, forced } });
  }
  await require('./slaPolicies').refreshQuietly(db, ticket.id);
  require('./sse').broadcast('ticket', { id: ticket.id, priority, priority_level: newLevel }, guildId);
  await require('./ticketManager').createManager(db, client, guildId).updateChannelTopic(ticket.id).catch(() => null);
  return { urgency: u ?? null, impact: i ?? null, priority_level: newLevel, priority, forced };
}

module.exports = { LEVELS, LEVEL_LABELS, URGENCY_LABELS, IMPACT_LABELS, DEFAULT_MATRIX, bucketOf, levelOfBucket, LEVEL_FROM_PRIORITY_SQL, validMatrix, matrixSettings, levelFor, setMatrixPriority };

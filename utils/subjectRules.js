// The simple rules by subject or by keywords (Paramètres → Tickets, before v5.2) are now rules of
// the engine (utils/ruleEngine.js) with origin « subject »: at the opening, IF the subject (or the
// keywords of the first message) THEN priority, tag, grade. Their simple form is kept in `legacy`
// for web/routes/subjectRules.js and the configuration export.
const engine = require('./ruleEngine');

function legacyToRule(v) {
  return {
    name: (v.match_type === 'keyword' ? `Mots-clés : ${v.keywords}` : `Sujet : ${v.subject}`).slice(0, 80),
    triggers: ['created'], match: 'all',
    conditions: [v.match_type === 'keyword' ? { field: 'text', values: [v.keywords] } : { field: 'subject', values: [v.subject] }],
    actions: [
      ...(v.priority ? [{ type: 'priority', value: v.priority }] : []),
      ...(v.tag_id ? [{ type: 'tagAdd', value: v.tag_id }] : []),
      ...(v.visibility_grade_id ? [{ type: 'grade', value: v.visibility_grade_id }] : []),
    ],
    active: v.active !== false && v.active !== 0,
  };
}
// v: { match_type, subject, keywords, tag_id, priority, visibility_grade_id } (already checked)
async function createLegacy(db, v) {
  return engine.saveRule(db, null, legacyToRule(v), { canGrade: true, origin: 'subject', legacy: v });
}
async function listLegacy(db) {
  const rows = await db("SELECT id, active, legacy FROM ticket_rules WHERE origin = 'subject' ORDER BY position, id").catch(() => []);
  return rows.map(r => ({ id: r.id, active: Number(r.active), ...(require('./jsonField').parseJsonField(r.legacy, {}) || {}) }));
}

module.exports = { legacyToRule, createLegacy, listLegacy };

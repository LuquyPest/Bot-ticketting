// Automatic rules by subject, applied when a ticket is created: add a tag, set a priority,
// restrict the ticket to a grade (the Discord channel follows). The subject of the rule is
// matched like reply templates (accents and case ignored, one contained in the other).
const { matchesSubject } = require('./subjectMatch');
const { recordEvent } = require('./audit');
const logger = require('./logger');

const RULE_ACTOR = { id: 'system', tag: 'Règle automatique', source: 'system' };

async function applySubjectRules({ db, client, guildId, ticket }) {
  if (!ticket?.subject) return [];
  const rules = (await db('SELECT * FROM subject_rules WHERE active = 1 ORDER BY id').catch(() => []))
    .filter(r => matchesSubject(r.subject, ticket.subject));
  const applied = [];
  for (const r of rules) {
    try {
      if (r.priority) {
        await db('UPDATE tickets SET priority = ? WHERE id = ?', [r.priority, ticket.id]);
        await recordEvent(db, { actor: RULE_ACTOR, action: 'ticket_priority', ticketId: ticket.id, details: { to: r.priority, rule: r.subject } });
        applied.push(`priority:${r.priority}`);
      }
      if (r.tag_id && (await db('INSERT IGNORE INTO ticket_tag_assignments (ticket_id, tag_id) SELECT ?, id FROM ticket_tags WHERE id = ?', [ticket.id, r.tag_id])).affectedRows) {
        await recordEvent(db, { actor: RULE_ACTOR, action: 'ticket_tag_add', ticketId: ticket.id, targetType: 'tag', targetId: r.tag_id, details: { rule: r.subject } });
        applied.push(`tag:${r.tag_id}`);
      }
      if (r.visibility_grade_id) {
        await db('UPDATE tickets SET visibility_grade_id = ? WHERE id = ?', [r.visibility_grade_id, ticket.id]);
        await recordEvent(db, { actor: RULE_ACTOR, action: 'ticket_visibility_change', ticketId: ticket.id, details: { visibility_grade_id: r.visibility_grade_id, rule: r.subject } });
        await require('./channelVisibility').syncTicketChannel(db, client, guildId, { ...ticket, visibility_grade_id: r.visibility_grade_id });
        applied.push(`grade:${r.visibility_grade_id}`);
      }
    } catch (err) {
      logger.error('Règle par sujet', { guildId, ticketId: ticket.id, rule: r.id, err: err.message });
    }
  }
  return applied;
}

module.exports = { applySubjectRules };

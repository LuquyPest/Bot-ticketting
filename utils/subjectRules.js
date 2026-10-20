// Automatic rules by subject, applied when a ticket is created: add a tag, set a priority,
// restrict the ticket to a grade (the Discord channel follows). The subject of the rule is
// matched like reply templates (accents and case ignored, one contained in the other).
const { matchesSubject, norm } = require('./subjectMatch');
const { recordEvent } = require('./audit');
const logger = require('./logger');

const RULE_ACTOR = { id: 'system', tag: 'Règle automatique', source: 'system' };

const ruleLabel = r => (r.match_type === 'keyword' ? `mots-clés : ${r.keywords}` : r.subject);

// Keyword rules: any of the comma-separated words or phrases found in the first message (accents
// and case ignored, from the start of a word: « rembours » matches « remboursement », not « nonrembours »)
const keywordList = s => String(s || '').split(',').map(k => norm(k)).filter(Boolean);
function matchesKeywords(keywords, text) {
  const t = ` ${norm(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return keywordList(keywords).some(k => t.includes(` ${k.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`));
}

async function applySubjectRules({ db, client, guildId, ticket, firstMessage = '' }) {
  const rules = (await db('SELECT * FROM subject_rules WHERE active = 1 ORDER BY id').catch(() => []))
    .filter(r => (r.match_type === 'keyword'
      ? !!firstMessage && matchesKeywords(r.keywords, firstMessage)
      : !!ticket?.subject && matchesSubject(r.subject, ticket.subject)));
  if (!rules.length) return [];
  const applied = [];
  for (const r of rules) {
    try {
      if (r.priority) {
        await db('UPDATE tickets SET priority = ? WHERE id = ?', [r.priority, ticket.id]);
        await recordEvent(db, { actor: RULE_ACTOR, action: 'ticket_priority', ticketId: ticket.id, details: { to: r.priority, rule: ruleLabel(r) } });
        applied.push(`priority:${r.priority}`);
      }
      if (r.tag_id && (await db('INSERT IGNORE INTO ticket_tag_assignments (ticket_id, tag_id) SELECT ?, id FROM ticket_tags WHERE id = ?', [ticket.id, r.tag_id])).affectedRows) {
        await recordEvent(db, { actor: RULE_ACTOR, action: 'ticket_tag_add', ticketId: ticket.id, targetType: 'tag', targetId: r.tag_id, details: { rule: ruleLabel(r) } });
        applied.push(`tag:${r.tag_id}`);
      }
      // A confidential ticket stays confidential (no rule widens or narrows it)
      if (r.visibility_grade_id && ticket.visibility_grade_id !== require('./gradePermissions').CONFIDENTIAL) {
        await db('UPDATE tickets SET visibility_grade_id = ? WHERE id = ?', [r.visibility_grade_id, ticket.id]);
        await recordEvent(db, { actor: RULE_ACTOR, action: 'ticket_visibility_change', ticketId: ticket.id, details: { visibility_grade_id: r.visibility_grade_id, rule: ruleLabel(r) } });
        await require('./channelVisibility').syncTicketChannel(db, client, guildId, { ...ticket, visibility_grade_id: r.visibility_grade_id });
        applied.push(`grade:${r.visibility_grade_id}`);
      }
    } catch (err) {
      logger.error('Règle par sujet', { guildId, ticketId: ticket.id, rule: r.id, err: err.message });
    }
  }
  return applied;
}

module.exports = { applySubjectRules, matchesKeywords };

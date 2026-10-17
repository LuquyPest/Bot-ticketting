// Actions of a macro (reply template with actions), applied after the reply is sent.
// can(permission) tells whether the acting staff member holds a grade permission.
// Refused or impossible actions are returned as warnings, never thrown.
const { recordEvent } = require('./audit');

const STAGE_NAMES = { open: 'Ouvert', waiting: 'En attente', in_progress: 'En cours' };
const PRIORITY_NAMES = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };

async function applyMacroActions({ client, db, tm, ticket, actions, actor, can }) {
  const applied = [], warnings = [];
  if (!actions) return { applied, warnings };
  if (actions.assignSelf) {
    if (!can('claim_ticket')) warnings.push('Attribution : permission claim_ticket manquante');
    else if (await tm.addAssignee(ticket.id, actor, actor)) applied.push('Attribué à toi');
  }
  if (actions.priority && actions.priority !== ticket.priority) {
    await tm.setPriority(ticket.id, actions.priority, actor);
    applied.push(`Priorité ${PRIORITY_NAMES[actions.priority]}`);
  }
  if (actions.tagId) {
    const [tag] = await db('SELECT id, name FROM ticket_tags WHERE id = ?', [actions.tagId]);
    if (!tag) warnings.push('Tag introuvable');
    else if ((await db('INSERT IGNORE INTO ticket_tag_assignments (ticket_id, tag_id) VALUES (?, ?)', [ticket.id, tag.id])).affectedRows) {
      await recordEvent(db, { actor, action: 'ticket_tag_add', ticketId: ticket.id, targetType: 'tag', targetId: tag.id, details: { tag: tag.name } });
      applied.push(`Tag ${tag.name}`);
    }
  }
  if (actions.stage && actions.stage !== (ticket.stage || 'open') && !actions.close) {
    const moved = await tm.moveToStage(ticket.id, actions.stage, actor);
    if (moved.ok) applied.push(`Étape ${STAGE_NAMES[actions.stage]}`); else warnings.push(`Étape : ${moved.error}`);
  }
  if (actions.close) {
    if (!can('close_ticket')) warnings.push('Fermeture : permission close_ticket manquante');
    else {
      const channel = client ? await client.channels.fetch(ticket.channel_id).catch(() => null) : null;
      if (channel) { await tm.closeTicketWithTranscript(channel, actor); applied.push('Ticket fermé'); }
      else warnings.push('Fermeture : salon Discord introuvable');
    }
  }
  if (!actions.close) await tm.updateChannelTopic(ticket.id).catch(() => null);
  return { applied, warnings };
}

module.exports = { applyMacroActions };

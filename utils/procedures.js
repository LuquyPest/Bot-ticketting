// Procedures by subject: checklists the staff follows on a ticket (check the payment, ask for the
// screenshot…), so every agent handles a request the same way. A procedure applies to every ticket
// (no subject) or to the tickets whose subject matches (accents and case ignored).
const crypto = require('crypto');
const { matchesSubject } = require('./subjectMatch');
const { parseJsonField } = require('./jsonField');

const MAX_STEPS = 30;
const newStepId = () => crypto.randomBytes(4).toString('hex');

// [{ id?, text }] from the editor → stored steps (ids kept, new ones generated)
function cleanSteps(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_STEPS) return null;
  const steps = raw.map(s => ({ id: typeof s?.id === 'string' && /^[0-9a-f]{8}$/.test(s.id) ? s.id : newStepId(), text: String(s?.text ?? s ?? '').trim().slice(0, 200) }));
  return steps.every(s => s.text) ? steps : null;
}

const parse = p => ({ ...p, steps: parseJsonField(p.steps, []), active: !!p.active });

async function applicableProcedures(db, ticket) {
  const all = (await db('SELECT * FROM procedures WHERE active = 1 ORDER BY position, id')).map(parse);
  return all.filter(p => !p.subject || (!!ticket.subject && matchesSubject(p.subject, ticket.subject)));
}

// Procedures of a ticket with each step's check (who, when) and the progress
async function ticketProcedures(db, ticket) {
  const procs = await applicableProcedures(db, ticket);
  if (!procs.length) return [];
  const checks = await db('SELECT procedure_id, step_id, checked_by_tag, checked_at FROM ticket_procedure_checks WHERE ticket_id = ?', [ticket.id]);
  return procs.map(p => {
    const steps = p.steps.map(s => {
      const c = checks.find(x => x.procedure_id === p.id && x.step_id === s.id);
      return { ...s, checked: !!c, checked_by_tag: c?.checked_by_tag || null, checked_at: c?.checked_at || null };
    });
    return { id: p.id, title: p.title, subject: p.subject, steps, done: steps.filter(s => s.checked).length, total: steps.length };
  });
}

module.exports = { cleanSteps, applicableProcedures, ticketProcedures, parse };

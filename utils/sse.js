// SSE client registry — guild-aware.
// Each client is registered with a guildId so broadcasts are isolated.
// Ticket-related events are only delivered to users allowed to see that ticket.
const { getTenantDb } = require('./tenantDb');
const { canUserSeeTicket } = require('./gradePermissions');

const clients = new Map(); // guildId -> Set<{res, userId}>

const TICKET_ID_OF = {
  ticket:             d => d.id,
  new_ticket:         d => d.id,
  note:               d => d.ticketId,
  participant_add:    d => d.ticketId,
  participant_remove: d => d.ticketId,
};

const MAX_STREAMS_PER_USER = 5;

// Returns null when the user already holds too many open streams.
function addClient(res, userId, guildId) {
  const key = guildId || '_global';
  if (!clients.has(key)) clients.set(key, new Set());
  if ([...clients.get(key)].filter(e => e.userId === userId).length >= MAX_STREAMS_PER_USER) return null;
  const entry = { res, userId };
  clients.get(key).add(entry);
  return () => {
    const set = clients.get(key);
    if (set) { set.delete(entry); if (set.size === 0) clients.delete(key); }
  };
}

function send(set, entry, line) {
  try { entry.res.write(line); } catch { set.delete(entry); }
}

async function sendToTicketAudience(set, line, guildId, ticketId) {
  const db = getTenantDb(guildId);
  const [ticket] = await db('SELECT visibility_grade_id FROM tickets WHERE id = ?', [ticketId]);
  const allowed = new Map();
  for (const entry of [...set]) {
    if (!allowed.has(entry.userId)) {
      allowed.set(entry.userId, await canUserSeeTicket(db, entry.userId, ticket?.visibility_grade_id ?? null).catch(() => false));
    }
    if (allowed.get(entry.userId)) send(set, entry, line);
  }
}

function broadcast(event, data, guildId) {
  const set = clients.get(guildId || '_global');
  if (!set) return;
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const ticketId = TICKET_ID_OF[event]?.(data);
  if (ticketId && guildId) {
    sendToTicketAudience(set, line, guildId, ticketId).catch(() => null);
    return;
  }
  for (const entry of [...set]) send(set, entry, line);
}

// Event for a single user (e.g. "a ticket was assigned to you").
function sendToUser(guildId, userId, event, data) {
  const set = clients.get(guildId || '_global');
  if (!set) return;
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const entry of [...set]) if (entry.userId === userId) send(set, entry, line);
}

module.exports = { addClient, broadcast, sendToUser };

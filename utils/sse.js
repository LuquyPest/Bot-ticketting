// SSE client registry — guild-aware.
// Each client is registered with a guildId so broadcasts are isolated.
// Ticket-related events are only delivered to users allowed to see that ticket.
// Events go through Redis pub/sub: each instance delivers them to its own open streams, so a
// dashboard connected to instance A sees what happens on instance B. Without Redis, events
// are delivered locally only.
const { getTenantDb } = require('./tenantDb');
const { canUserSeeTicket } = require('./gradePermissions');

const clients = new Map(); // guildId -> Set<{res, userId}>

const TICKET_ID_OF = {
  ticket:             d => d.id,
  new_ticket:         d => d.id,
  note:               d => d.ticketId,
  participant_add:    d => d.ticketId,
  participant_remove: d => d.ticketId,
  typing:             d => d.ticketId,
  presence:           d => d.ticketId,
  note_update:        d => d.ticketId,
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

function deliverBroadcast(event, data, guildId) {
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
function deliverToUser(guildId, userId, event, data) {
  const set = clients.get(guildId || '_global');
  if (!set) return;
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const entry of [...set]) if (entry.userId === userId) send(set, entry, line);
}

// ── Redis bus ──
const CHANNEL = 'sse:events';
let bus = null;          // subscriber connection
let busReady = false;

function deliver(msg) {
  if (msg.userId) deliverToUser(msg.guildId, msg.userId, msg.event, msg.data);
  else deliverBroadcast(msg.event, msg.data, msg.guildId);
}

function startBus() {
  if (bus) return;
  try {
    bus = require('./redis').getRedis().duplicate();
    bus.on('error', () => { busReady = false; });
    bus.on('message', (channel, raw) => {
      if (channel !== CHANNEL) return;
      try { deliver(JSON.parse(raw)); } catch {}
    });
    bus.subscribe(CHANNEL).then(() => { busReady = true; }).catch(() => { busReady = false; });
    bus.on('ready', () => { if (!busReady) bus.subscribe(CHANNEL).then(() => { busReady = true; }).catch(() => {}); });
  } catch { bus = null; }
}

function publish(msg) {
  startBus();
  if (!busReady) return deliver(msg); // not subscribed (yet): local delivery
  require('./redis').getRedis().publish(CHANNEL, JSON.stringify(msg)).catch(() => deliver(msg));
}

const broadcast = (event, data, guildId) => publish({ event, data, guildId: guildId || null });
const sendToUser = (guildId, userId, event, data) => publish({ event, data, guildId: guildId || null, userId });

async function stopBus() {
  if (bus) await bus.quit().catch(() => {});
  bus = null; busReady = false;
}

module.exports = { addClient, broadcast, sendToUser, startBus, stopBus };

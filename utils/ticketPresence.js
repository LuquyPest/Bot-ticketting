// Who has a ticket open in the dashboard right now. Each open ticket page sends a heartbeat
// every 20 s; an entry not refreshed for 45 s is gone (closed tab, lost connection). State lives
// in Redis (one hash per server, field "<ticketId>:<userId>"), so it is shared between instances.
const { getRedis } = require('./redis');
const { broadcast } = require('./sse');

const TTL_MS = 45 * 1000;
const key = guildId => `presence:${guildId}`;

// Live entries; expired ones are deleted and the pages of their tickets told
async function readAll(guildId, { announceStale = true } = {}) {
  const raw = await getRedis().hgetall(key(guildId));
  const now = Date.now();
  const alive = [], stale = [];
  for (const [field, json] of Object.entries(raw || {})) {
    let v; try { v = JSON.parse(json); } catch { v = null; }
    if (!v || now - v.at > TTL_MS) { stale.push(field); continue; }
    const [ticketId, userId] = field.split(':');
    alive.push({ ticketId: parseInt(ticketId), userId, username: v.username, avatar: v.avatar || null, since: v.since });
  }
  if (stale.length) {
    await getRedis().hdel(key(guildId), ...stale);
    if (announceStale) for (const t of new Set(stale.map(f => parseInt(f)))) announce(guildId, t, alive);
  }
  return alive;
}

const viewersOf = (all, ticketId) => all.filter(v => v.ticketId === ticketId).map(({ ticketId: _t, ...v }) => v);

function announce(guildId, ticketId, all) {
  broadcast('presence', { ticketId, viewers: viewersOf(all, ticketId) }, guildId);
}

// Heartbeat: returns the viewers of the ticket; broadcasts only when someone arrived or left
async function touch(guildId, ticketId, user) {
  const field = `${ticketId}:${user.id}`;
  const r = getRedis();
  const before = await readAll(guildId);
  const existing = before.find(v => v.ticketId === ticketId && v.userId === user.id);
  await r.hset(key(guildId), field, JSON.stringify({ username: user.username, avatar: user.avatar || null, at: Date.now(), since: existing?.since || Date.now() }));
  await r.pexpire(key(guildId), 3600 * 1000);
  const all = await readAll(guildId, { announceStale: false });
  if (!existing) announce(guildId, ticketId, all);
  return viewersOf(all, ticketId);
}

async function leave(guildId, ticketId, userId) {
  const removed = await getRedis().hdel(key(guildId), `${ticketId}:${userId}`);
  if (removed) announce(guildId, ticketId, await readAll(guildId));
}

// { ticketId: [viewers] } for every ticket open somewhere
async function allViewers(guildId) {
  const out = {};
  for (const v of await readAll(guildId)) (out[v.ticketId] ||= []).push({ userId: v.userId, username: v.username, avatar: v.avatar, since: v.since });
  return out;
}

module.exports = { touch, leave, allViewers, TTL_MS };

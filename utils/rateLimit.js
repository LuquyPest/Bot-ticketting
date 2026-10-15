// In-memory cooldown map for Discord bot command rate-limiting.
// Intentionally in-memory: bot restarts reset cooldowns, which is acceptable
// for command spam protection. Entries are automatically evicted after expiry
// to prevent unbounded memory growth.
const cooldowns = new Map();

const EVICT_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of cooldowns) {
    if (now - ts > EVICT_INTERVAL_MS) cooldowns.delete(key);
  }
}, EVICT_INTERVAL_MS).unref();

function checkRateLimit(key, cooldownMs) {
  const last = cooldowns.get(key) || 0;
  const elapsed = Date.now() - last;
  if (elapsed < cooldownMs) {
    return Math.ceil((cooldownMs - elapsed) / 1000);
  }
  cooldowns.set(key, Date.now());
  return 0;
}

module.exports = { checkRateLimit };

// Sliding-window limiter: true while `key` stays under `max` hits per `windowMs`.
const bursts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of bursts) if (now - b.start > b.windowMs) bursts.delete(key);
}, EVICT_INTERVAL_MS).unref();

function allowBurst(key, max, windowMs) {
  const now = Date.now();
  let b = bursts.get(key);
  if (!b || now - b.start > windowMs) { b = { start: now, count: 0, windowMs, warned: false }; bursts.set(key, b); }
  b.count++;
  return b.count <= max;
}

// True only the first time a key is over its limit in the current window (to warn once).
function firstOverflow(key) {
  const b = bursts.get(key);
  if (!b || b.warned) return false;
  b.warned = true;
  return true;
}

module.exports.allowBurst = allowBurst;
module.exports.firstOverflow = firstOverflow;

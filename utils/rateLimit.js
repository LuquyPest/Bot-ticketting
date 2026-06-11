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

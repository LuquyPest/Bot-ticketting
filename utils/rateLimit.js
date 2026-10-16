// Bot-side rate limiting (command cooldowns, DM flood protection), stored in Redis so every
// bot instance shares the same counters. If Redis is unreachable the check lets the action
// through (fail-open): an anti-spam outage must never block the support.
const { getRedis } = require('./redis');
const logger = require('./logger');

const PREFIX = 'rl:bot:';

function failOpen(err, fallback) {
  logger.warn('Limiteur indisponible (Redis)', { err: err.message });
  return fallback;
}

// Cooldown: 0 when allowed (and starts the cooldown), else the seconds left.
async function checkRateLimit(key, cooldownMs) {
  try {
    const r = getRedis();
    if (await r.set(`${PREFIX}cd:${key}`, '1', 'PX', cooldownMs, 'NX')) return 0;
    const left = await r.pttl(`${PREFIX}cd:${key}`);
    return left > 0 ? Math.ceil(left / 1000) : 0;
  } catch (err) { return failOpen(err, 0); }
}

// Fixed window: true while `key` stays under `max` hits per `windowMs`.
async function allowBurst(key, max, windowMs) {
  try {
    const r = getRedis();
    const k = `${PREFIX}burst:${key}`;
    const n = await r.incr(k);
    if (n === 1) await r.pexpire(k, windowMs);
    return n <= max;
  } catch (err) { return failOpen(err, true); }
}

// True only the first time a key is over its limit in the current window (to warn once).
async function firstOverflow(key) {
  try {
    const r = getRedis();
    const ttl = await r.pttl(`${PREFIX}burst:${key}`);
    return !!(await r.set(`${PREFIX}warned:${key}`, '1', 'PX', Math.max(ttl, 1000), 'NX'));
  } catch (err) { return failOpen(err, false); }
}

module.exports = { checkRateLimit, allowBurst, firstOverflow };

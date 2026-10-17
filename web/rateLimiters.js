// Rate limiters + registry of the IPs they are currently blocking (listed / unblocked from the SA panel).
// Counters and registry live in Redis: limits hold across restarts and across instances.
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedis } = require('../utils/redis');

// API requests per minute and IP (config.json → rateLimits.apiPerMinute)
const API_PER_MINUTE = parseInt(require('../utils/config').config.rateLimits?.apiPerMinute) || 200;

const BLOCKED_KEY = 'rl:blocked'; // hash `${limiter}:${key}` -> JSON { limiter, key, ip, path, since, resetAt, hits }

function createLimiter(name, { windowMs, limit, error, label }) {
  const limiter = rateLimit({
    windowMs,
    limit,
    store: new RedisStore({ sendCommand: (...args) => getRedis().call(...args), prefix: `rl:${name}:` }),
    // Redis unreachable: let requests through rather than locking everyone out
    passOnStoreError: true,
    standardHeaders: true,
    legacyHeaders: false,
    // Same key as the default (IPv6 grouped by /56), kept explicit so resetKey() can target it
    keyGenerator: req => ipKeyGenerator(req.ip || ''),
    handler: async (req, res, next, options) => {
      const key = ipKeyGenerator(req.ip || '');
      const id = `${name}:${key}`;
      try {
        const r = getRedis();
        const entry = JSON.parse((await r.hget(BLOCKED_KEY, id)) || 'null');
        await r.hset(BLOCKED_KEY, id, JSON.stringify({
          limiter: name, key, ip: req.ip, path: req.originalUrl.split('?')[0],
          since: entry?.since || new Date(),
          resetAt: req.rateLimit?.resetTime || new Date(Date.now() + windowMs),
          hits: (entry?.hits || 0) + 1,
        }));
      } catch { /* registry is informative only */ }
      res.status(options.statusCode).json({ error });
    },
  });
  return { name, limiter, label };
}

const limiters = {
  auth: createLimiter('auth', { windowMs: 15 * 60 * 1000, limit: 20, error: 'Trop de tentatives, réessaye dans 15 minutes', label: 'Connexion (20 / 15 min)' }),
  api:  createLimiter('api',  { windowMs: 60 * 1000, limit: API_PER_MINUTE, error: 'Trop de requêtes', label: `API (${API_PER_MINUTE} / min)` }),
};

// Currently blocked IPs (expired entries are dropped).
async function listBlocked() {
  const now = Date.now();
  const out = [];
  const all = await getRedis().hgetall(BLOCKED_KEY);
  for (const [id, raw] of Object.entries(all || {})) {
    const e = JSON.parse(raw);
    if (new Date(e.resetAt).getTime() <= now) { await getRedis().hdel(BLOCKED_KEY, id); continue; }
    out.push({ ...e, limiterLabel: limiters[e.limiter]?.label || e.limiter });
  }
  return out.sort((a, b) => new Date(b.since) - new Date(a.since));
}

async function unblock(limiterName, key) {
  const l = limiters[limiterName];
  if (!l) return false;
  await l.limiter.resetKey(key);
  return (await getRedis().hdel(BLOCKED_KEY, `${limiterName}:${key}`)) > 0;
}

module.exports = {
  authLimiter: limiters.auth.limiter,
  apiLimiter: limiters.api.limiter,
  listBlocked,
  unblock,
};

// Rate limiters + registry of the IPs they are currently blocking (listed / unblocked from the SA panel).
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const blocked = new Map(); // `${limiter}:${key}` -> { limiter, key, ip, path, since, resetAt, hits }

function createLimiter(name, { windowMs, limit, error, label }) {
  const limiter = rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    // Same key as the default (IPv6 grouped by /56), kept explicit so resetKey() can target it
    keyGenerator: req => ipKeyGenerator(req.ip || ''),
    handler: (req, res, next, options) => {
      const key = ipKeyGenerator(req.ip || '');
      const id = `${name}:${key}`;
      const entry = blocked.get(id);
      blocked.set(id, {
        limiter: name, key, ip: req.ip, path: req.originalUrl.split('?')[0],
        since: entry?.since || new Date(),
        resetAt: req.rateLimit?.resetTime || new Date(Date.now() + windowMs),
        hits: (entry?.hits || 0) + 1,
      });
      res.status(options.statusCode).json({ error });
    },
  });
  return { name, limiter, label };
}

const limiters = {
  auth: createLimiter('auth', { windowMs: 15 * 60 * 1000, limit: 20, error: 'Trop de tentatives, réessaye dans 15 minutes', label: 'Connexion (20 / 15 min)' }),
  api:  createLimiter('api',  { windowMs: 60 * 1000, limit: 200, error: 'Trop de requêtes', label: 'API (200 / min)' }),
};

// Currently blocked IPs (expired entries are dropped).
function listBlocked() {
  const now = Date.now();
  const out = [];
  for (const [id, e] of blocked) {
    if (new Date(e.resetAt).getTime() <= now) { blocked.delete(id); continue; }
    out.push({ ...e, limiterLabel: limiters[e.limiter]?.label || e.limiter });
  }
  return out.sort((a, b) => new Date(b.since) - new Date(a.since));
}

async function unblock(limiterName, key) {
  const l = limiters[limiterName];
  if (!l) return false;
  await l.limiter.resetKey(key);
  return blocked.delete(`${limiterName}:${key}`);
}

module.exports = {
  authLimiter: limiters.auth.limiter,
  apiLimiter: limiters.api.limiter,
  listBlocked,
  unblock,
};

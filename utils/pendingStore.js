// DM conversation states (waiting for a subject, a ticket choice, intake answers…) stored in
// Redis: they survive a restart and are shared between bot instances.
// Values are JSON (no functions/objects): guild data is rebuilt from guildId when used.
// States with a fallback (onExpire) are indexed in a sorted set; the 'pending-expiry' job
// claims each expired one exactly once (see claimExpired).
const { getRedis } = require('./redis');

const PREFIX = 'pending:';
const EXPIRY_INDEX = 'pending:expiry';
const GRACE_MS = 60 * 60 * 1000; // value kept after expiry so the sweeper can still read it

const key = (kind, userId) => `${PREFIX}${kind}:${userId}`;
const member = (kind, userId) => `${kind}:${userId}`;

async function setPending(kind, userId, data, ttlMs, { onExpire = false } = {}) {
  const r = getRedis();
  const expiresAt = Date.now() + ttlMs;
  await r.set(key(kind, userId), JSON.stringify({ ...data, expiresAt }), 'PX', ttlMs + (onExpire ? GRACE_MS : 0));
  if (onExpire) await r.zadd(EXPIRY_INDEX, expiresAt, member(kind, userId));
  else await r.zrem(EXPIRY_INDEX, member(kind, userId));
}

const parseLive = v => {
  if (!v) return null;
  const d = JSON.parse(v);
  return d.expiresAt < Date.now() ? null : d;
};

async function getPending(kind, userId) {
  return parseLive(await getRedis().get(key(kind, userId)));
}

// Reads and removes atomically: two concurrent messages cannot both consume the same state.
async function takePending(kind, userId) {
  const r = getRedis();
  const v = await r.getdel(key(kind, userId));
  await r.zrem(EXPIRY_INDEX, member(kind, userId));
  return parseLive(v);
}

async function hasPending(kind, userId) {
  return !!(await getPending(kind, userId));
}

// Expired states that have a fallback, each returned to exactly one caller.
async function claimExpired(limit = 50) {
  const r = getRedis();
  const due = await r.zrangebyscore(EXPIRY_INDEX, 0, Date.now(), 'LIMIT', 0, limit);
  const claimed = [];
  for (const m of due) {
    if (!(await r.zrem(EXPIRY_INDEX, m))) continue; // another instance took it
    const [kind, userId] = m.split(':');
    const v = await r.getdel(key(kind, userId));
    if (v) claimed.push({ kind, userId, data: JSON.parse(v) });
  }
  return claimed;
}

module.exports = { setPending, getPending, takePending, hasPending, claimExpired };

// One-time tokens sent by e-mail (e-mail check, password reset, later invitations and sign-in
// links): random, only their SHA-256 is kept (Redis, with the expiry), consumed at first use.
const crypto = require('crypto');
const { getRedis } = require('./redis');

const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const KIND = /^[a-z]{3,20}$/;

async function createToken(kind, payload, ttlSeconds) {
  if (!KIND.test(kind)) throw new Error('kind');
  const token = crypto.randomBytes(32).toString('base64url');
  await getRedis().set(`tok:${kind}:${sha(token)}`, JSON.stringify(payload), 'EX', ttlSeconds);
  return token;
}

// The payload, or null (unknown, expired or already used)
async function consumeToken(kind, token) {
  if (!KIND.test(kind) || typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const raw = await getRedis().getdel(`tok:${kind}:${sha(token)}`);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

module.exports = { createToken, consumeToken };

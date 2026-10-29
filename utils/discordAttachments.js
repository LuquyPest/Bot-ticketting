// Discord attachment links are signed and expire (?ex=<hex unix time>). Messages keep the
// original link; when shown, it goes through /api/attachment which asks Discord for a fresh
// signed link if needed (POST /attachments/refresh-urls) and caches it in Redis until expiry.
const crypto = require('crypto');
const { getRedis } = require('./redis');

const HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

function parseAttachment(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname) || !/^\/(ephemeral-)?attachments\/\d+\/\d+\/[^/]+$/.test(u.pathname)) return null;
  return u;
}

// Still valid for at least a minute
function isFresh(u) {
  const ex = parseInt(u.searchParams.get('ex') || '', 16);
  return Number.isFinite(ex) && ex * 1000 > Date.now() + 60 * 1000;
}

const cacheKey = u => `att:${crypto.createHash('sha1').update(u.origin + u.pathname).digest('hex')}`;

// A working link for this attachment, or null when Discord does not know it any more
async function freshAttachmentUrl(client, raw) {
  const u = parseAttachment(raw);
  if (!u) return null;
  if (isFresh(u)) return u.toString();
  const redis = getRedis();
  const cached = await redis.get(cacheKey(u)).catch(() => null);
  if (cached && isFresh(new URL(cached))) return cached;
  if (!client?.rest) return null;
  const res = await client.rest.post('/attachments/refresh-urls', { body: { attachment_urls: [u.toString()] } }).catch(() => null);
  const fresh = res?.refreshed_urls?.[0]?.refreshed;
  const fu = fresh && parseAttachment(fresh);
  if (!fu) return null;
  const ttl = Math.max(60, Math.floor(parseInt(fu.searchParams.get('ex') || '0', 16) - Date.now() / 1000) - 60);
  await redis.set(cacheKey(u), fu.toString(), 'EX', ttl).catch(() => null);
  return fu.toString();
}

module.exports = { parseAttachment, freshAttachmentUrl };

const Redis = require('ioredis');

let _redis = null;

function getRedis() {
  if (!_redis) {
    _redis = new Redis({
      host:              process.env.REDIS_HOST || 'redis',
      port:              parseInt(process.env.REDIS_PORT || '6379', 10),
      password:          process.env.REDIS_PASSWORD || undefined, // set in .env (docker compose)
      maxRetriesPerRequest: null,
      enableReadyCheck:  true,
      lazyConnect:       true,
    });
    _redis.on('error', err => {
      if (!err.message?.includes('ECONNREFUSED')) {
        console.error('[redis] error:', err.message);
      }
    });
  }
  return _redis;
}

const SESSION_PREFIX = 'sess:';

// Session store client: connect-redis 9 only accepts the official `redis` client (node-redis).
// Same server and keys as getRedis(): routes/sessions.js revokes sessions through ioredis.
let _sessionRedis = null;
function getSessionRedis() {
  if (!_sessionRedis) {
    const { createClient } = require('redis');
    _sessionRedis = createClient({
      socket: { host: process.env.REDIS_HOST || 'redis', port: parseInt(process.env.REDIS_PORT || '6379', 10) },
      password: process.env.REDIS_PASSWORD || undefined,
    });
    _sessionRedis.on('error', err => {
      if (!err.message?.includes('ECONNREFUSED')) console.error('[redis sessions] error:', err.message);
    });
    // Commands sent while connecting are queued
    _sessionRedis.connect().catch(() => {});
  }
  return _sessionRedis;
}

async function closeSessionRedis() {
  if (_sessionRedis) await _sessionRedis.quit().catch(() => {});
  _sessionRedis = null;
}

module.exports = { getRedis, getSessionRedis, closeSessionRedis, SESSION_PREFIX };

const Redis = require('ioredis');

let _redis = null;

function getRedis() {
  if (!_redis) {
    _redis = new Redis({
      host:              process.env.REDIS_HOST || 'redis',
      port:              parseInt(process.env.REDIS_PORT || '6379', 10),
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

module.exports = { getRedis };

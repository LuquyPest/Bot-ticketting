// express-session store on the bot's own Redis client (ioredis). Same keys and format as the
// connect-redis store it replaces (`sess:<sid>`, JSON, expiry from the cookie), so open sessions
// survive the switch and routes/sessions.js keeps revoking a session by deleting its key.
const { Store } = require('express-session');
const { getRedis, SESSION_PREFIX } = require('./redis');

const DEFAULT_TTL_S = 86400;
const ttlOf = sess => {
  const expires = sess?.cookie?.expires;
  return expires ? Math.ceil((new Date(expires).getTime() - Date.now()) / 1000) : DEFAULT_TTL_S;
};
const done = (cb, err, data) => (cb ? cb(err, data) : undefined);

class RedisSessionStore extends Store {
  constructor({ prefix = SESSION_PREFIX, client = getRedis() } = {}) {
    super();
    this.prefix = prefix;
    this.client = client;
  }

  async get(sid, cb) {
    try {
      const raw = await this.client.get(this.prefix + sid);
      done(cb, null, raw ? JSON.parse(raw) : null);
    } catch (err) { done(cb, err); }
  }

  async set(sid, sess, cb) {
    try {
      const ttl = ttlOf(sess);
      if (ttl > 0) await this.client.set(this.prefix + sid, JSON.stringify(sess), 'EX', ttl);
      else await this.client.del(this.prefix + sid);
      done(cb, null);
    } catch (err) { done(cb, err); }
  }

  async touch(sid, sess, cb) {
    try {
      await this.client.expire(this.prefix + sid, Math.max(1, ttlOf(sess)));
      done(cb, null);
    } catch (err) { done(cb, err); }
  }

  async destroy(sid, cb) {
    try {
      await this.client.del(this.prefix + sid);
      done(cb, null);
    } catch (err) { done(cb, err); }
  }
}

module.exports = { RedisSessionStore };

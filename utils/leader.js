// High availability, active–passive (v7, conception/v7.md §3.9). Several bot containers can run on
// one database and one Redis: one of them holds the lock « leader » in Redis and is the active one —
// it connects to Discord, runs the scheduled jobs and serves the dashboard; the others wait, their
// web server answering /health (alive) but /health/ready with 503 (standby), so the reverse proxy
// only sends traffic to the active one. The lock lives 20 s and is renewed every 5 s; if the active
// container stops (or loses Redis), another one takes it within about 20 s. A container that loses
// the lock while active exits, and comes back as a standby (Docker restarts it).
const crypto = require('crypto');
const os = require('os');

const KEY = 'leader:main';
const TTL_MS = Number(process.env.HA_LOCK_TTL_MS) || 20000;
const EVERY_MS = Math.max(500, Math.round(TTL_MS / 4));
const ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

let state = { role: 'standby', since: Date.now() };
let timer = null;
const redis = () => require('./redis').getRedis();

// Renew only if still ours (compare-and-expire)
const RENEW = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

async function tryAcquire() {
  return (await redis().set(KEY, ID, 'PX', TTL_MS, 'NX')) === 'OK';
}
async function renew() { return Number(await redis().eval(RENEW, 1, KEY, ID, TTL_MS)) === 1; }
async function release() { await redis().eval(RELEASE, 1, KEY, ID).catch(() => null); }
async function current() { return redis().get(KEY).catch(() => null); }

// Waits to be the active container, then calls onLeader once; onLost when the lock is lost
function start({ onLeader, onLost }) {
  const tick = async () => {
    try {
      if (state.role === 'leader') {
        if (!(await renew())) { state = { role: 'lost', since: Date.now() }; clearInterval(timer); onLost?.(); }
        return;
      }
      if (await tryAcquire()) {
        state = { role: 'leader', since: Date.now() };
        await onLeader?.();
      }
    } catch (err) {
      // Redis unreachable: an active container cannot be sure it still holds the lock
      if (state.role === 'leader') { state = { role: 'lost', since: Date.now() }; clearInterval(timer); onLost?.(err); }
    }
  };
  timer = setInterval(tick, EVERY_MS);
  timer.unref?.();
  return tick();
}
function stop() { clearInterval(timer); timer = null; }

const status = () => ({ id: ID, role: state.role, since: new Date(state.since).toISOString() });
const isLeader = () => state.role === 'leader';

module.exports = { KEY, TTL_MS, ID, start, stop, release, status, isLeader, current, tryAcquire, renew };

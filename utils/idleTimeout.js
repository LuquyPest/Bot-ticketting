// Sign-out after inactivity (guild setting idle_timeout_minutes, 0 = never). Activity = a real
// action of the user: any change request, or the dashboard's activity signal (POST
// /api/profile/activity, sent at most once a minute while the user types, clicks or scrolls).
// Background reads (lists refreshed, live stream, presence heartbeat) never count.
const CACHE_MS = 30000;
const cache = new Map(); // guildId -> { at, minutes }

async function idleMinutes(db, guildId) {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.minutes;
  const [row] = await db('SELECT idle_timeout_minutes FROM guild_config WHERE id = 1').catch(() => []);
  const minutes = Number(row?.idle_timeout_minutes) || 0;
  cache.set(guildId, { at: Date.now(), minutes });
  return minutes;
}
const clearIdleCache = guildId => cache.delete(guildId);

// Requests sent by the dashboard on its own, which must not keep an idle session alive
const BACKGROUND = [/^\/api\/tickets\/\d+\/presence$/];
const isUserAction = req => !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !BACKGROUND.some(re => re.test(req.originalUrl.split('?')[0]));

module.exports = { idleMinutes, clearIdleCache, isUserAction };

// Closes every dashboard session of an account (password reset: whoever knew the old one is out).
// Sessions are tracked in user_sessions and stored in Redis under SESSION_PREFIX + id.
const { globalQuery } = require('./globalDb');
const { getRedis, SESSION_PREFIX } = require('./redis');

async function revokeAllSessions(userId, { except = null } = {}) {
  const rows = await globalQuery('SELECT session_id FROM user_sessions WHERE user_id = ?', [String(userId)]);
  const ids = rows.map(r => r.session_id).filter(id => id !== except);
  for (const id of ids) await getRedis().del(SESSION_PREFIX + id).catch(() => null);
  if (ids.length) await globalQuery('DELETE FROM user_sessions WHERE user_id = ? AND session_id IN (?)', [String(userId), ids]);
  return ids.length;
}

module.exports = { revokeAllSessions };

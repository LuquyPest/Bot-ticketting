// JSON columns may come back from mysql2 either as a string or already decoded,
// depending on the server/driver version — accept both.
function parseJsonField(val, fallback = []) {
  if (val == null || val === '') return fallback;
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

module.exports = { parseJsonField };

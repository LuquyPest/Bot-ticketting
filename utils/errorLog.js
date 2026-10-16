// Error journal (global table error_logs), shown on the super-admin "Erreurs" page.
// Fed by logger.error, console.error (the code base reports caught errors there), HTTP 5xx
// responses, job failures and unhandled rejections. Identical messages are written at most
// once a minute, and the volume is capped, so an error loop cannot flood the database.
const { globalQuery } = require('./globalDb');

// Discord API errors that are expected in normal use and say nothing about the bot's health:
// member with closed DMs, interaction expired or already answered, message already deleted.
const EXPECTED_DISCORD_CODES = new Set([50007, 10062, 40060, 10008]);

const DEDUPE_MS = 60 * 1000;
const MAX_PER_MINUTE = 60;
const recent = new Map(); // context|message → last write
let windowStart = 0;
let windowCount = 0;

function logError(guildId, context, err, extra = null) {
  if (EXPECTED_DISCORD_CODES.has(err?.code)) return;
  const message = String(err?.message || err || 'Erreur inconnue').slice(0, 2000);
  const ctx = String(context || 'unknown').slice(0, 100);
  const now = Date.now();

  const key = `${ctx}|${message.slice(0, 200)}`;
  if (now - (recent.get(key) || 0) < DEDUPE_MS) return;
  if (now - windowStart > 60 * 1000) { windowStart = now; windowCount = 0; }
  if (++windowCount > MAX_PER_MINUTE) return;
  recent.set(key, now);
  if (recent.size > 500) for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);

  let stack = err?.stack || '';
  if (extra) stack = `${JSON.stringify(extra)}\n${stack}`;
  globalQuery(
    'INSERT INTO error_logs (guild_id, context, message, stack) VALUES (?, ?, ?, ?)',
    [guildId || null, ctx, message, stack.slice(0, 5000) || null]
  ).catch(() => null);
}

// console.error('context:', err) → context "context", message from the Error (or the text).
function captureConsoleErrors() {
  if (console.error.__captured) return;
  const original = console.error.bind(console);
  const wrapped = (...args) => {
    original(...args);
    try {
      const err = args.find(a => a instanceof Error);
      const text = args.filter(a => typeof a === 'string').join(' ').trim();
      const context = text ? text.replace(/[:\s]+$/, '').slice(0, 100) : 'console';
      const message = err ? err.message : args.map(a => (typeof a === 'string' ? a : safeJson(a))).join(' ');
      logError(null, context, err ? Object.assign(new Error(message), { stack: err.stack, code: err.code }) : message);
    } catch {}
  };
  wrapped.__captured = true;
  console.error = wrapped;
}

function safeJson(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

// Express: every 5xx answer is recorded with its route and guild.
function httpErrorMiddleware(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode < 500) return;
    const route = `${req.method} ${req.baseUrl || ''}${req.route?.path || req.path}`;
    logError(req.session?.guildId || null, 'http', `${route} → ${res.statusCode}`);
  });
  next();
}

module.exports = { logError, captureConsoleErrors, httpErrorMiddleware, EXPECTED_DISCORD_CODES };

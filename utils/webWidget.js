// Web widget (v4.1, conception/v4.md §4): a ticket form a space pastes on its own site.
// Public token per space « <space id>.<random> » (the space is found without scanning every
// database; the random part is compared in constant time). The requester gives a name, an
// address and a message; the ticket is theirs as « web:<hash of the address> » (utils/webRequesters.js):
// the confirmation and the staff's answers go out through the instance e-mail, with the link to
// follow the ticket in the member space.
// Anti-spam, no third party: a hidden field robots fill in, a signed opening time (at least
// 3 seconds to fill the form, 2 hours at most), limits per address, per IP and per space.
const crypto = require('crypto');
const { getTenantDb } = require('./tenantDb');
const { globalQuery } = require('./globalDb');

const TOKEN_RE = /^(\d{17,20})\.([A-Za-z0-9_-]{24,40})$/;
const MIN_FILL_MS = 3000;
const MAX_FILL_MS = 2 * 3600 * 1000;
const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/;

const secret = () => require('./config').config.dashboard?.sessionSecret || 'datick-widget';
const hmac = text => crypto.createHmac('sha256', secret()).update(text).digest('base64url');

async function settingsOf(db) {
  const [c] = await db('SELECT widget_enabled, widget_token, widget_origins FROM guild_config WHERE id = 1');
  return { enabled: Number(c?.widget_enabled) === 1, token: c?.widget_token || null, origins: parseOrigins(c?.widget_origins) };
}

// One site per line (or comma): « https://example.com » ; invalid entries are refused
function parseOrigins(text) {
  return String(text || '').split(/[\s,]+/).map(o => o.trim().toLowerCase().replace(/\/$/, '')).filter(Boolean);
}
function checkOrigins(list) {
  const bad = list.find(o => !ORIGIN_RE.test(o));
  return bad ? bad : null;
}

const newToken = guildId => `${guildId}.${crypto.randomBytes(18).toString('base64url')}`;

async function saveSettings(db, guildId, { enabled, origins }) {
  const list = parseOrigins(Array.isArray(origins) ? origins.join('\n') : origins).slice(0, 20);
  const bad = checkOrigins(list);
  if (bad) return { error: `Adresse de site invalide : ${bad.slice(0, 80)} (attendu : https://exemple.com)` };
  const cur = await settingsOf(db);
  const token = cur.token || (enabled ? newToken(guildId) : null);
  await db('UPDATE guild_config SET widget_enabled = ?, widget_token = ?, widget_origins = ? WHERE id = 1', [enabled ? 1 : 0, token, list.join('\n') || null]);
  return { ok: true };
}

async function regenerateToken(db, guildId) {
  await db('UPDATE guild_config SET widget_token = ? WHERE id = 1', [newToken(guildId)]);
}

// The space of a public token, if its widget is on: { guildId, db, settings } or null
async function resolveToken(token) {
  const m = TOKEN_RE.exec(String(token || ''));
  if (!m) return null;
  const [g] = await globalQuery("SELECT guild_id FROM guilds WHERE guild_id = ? AND status = 'active'", [m[1]]).catch(() => []);
  if (!g) return null;
  const db = getTenantDb(g.guild_id);
  const settings = await settingsOf(db).catch(() => null);
  if (!settings?.enabled || !settings.token) return null;
  const a = Buffer.from(settings.token), b = Buffer.from(String(token));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { guildId: g.guild_id, db, settings };
}

// Opening time of the form, signed: « <ms>.<hmac> »
const stamp = (guildId, now = Date.now()) => `${now}.${hmac(`${guildId}.${now}`)}`;
function stampProblem(guildId, value, now = Date.now()) {
  const [ts, sig] = String(value || '').split('.');
  if (!/^\d{13}$/.test(ts || '') || !sig) return 'expired';
  const want = hmac(`${guildId}.${ts}`);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return 'expired';
  const age = now - Number(ts);
  if (age < MIN_FILL_MS) return 'tooFast';
  if (age > MAX_FILL_MS) return 'expired';
  return null;
}

// frame-ancestors of the form page: the sites listed, or any site
const frameAncestors = origins => (origins.length ? origins.join(' ') : '*');

// The code to paste on a site
function snippet(base, token) {
  return `<script src="${base}/widget.js" data-datick-widget="${token}" async></script>`;
}

module.exports = {
  TOKEN_RE, settingsOf, saveSettings, regenerateToken, resolveToken, stamp, stampProblem, parseOrigins,
  frameAncestors, snippet, MIN_FILL_MS,
};

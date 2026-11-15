// New versions and one-click update (Instance → Santé).
//   - Once a day, the latest release of the project on GitHub is compared with the running version
//     (UPDATE_CHECK=off disables it: the instance then never calls GitHub). The owner gets a DM once
//     per new version.
//   - The update itself is done by the optional « updater » service (docker-compose.updater.yml):
//     it polls GET /api/updater/poll every 30 s with UPDATER_TOKEN, pulls the image and recreates
//     the bot when the owner asked for it, then reports with POST /api/updater/result. The bot never
//     touches Docker: only that service holds the Docker socket.
const crypto = require('crypto');
const { getSetting, setSetting } = require('./instanceSettings');
const { config } = require('./config');
const logger = require('./logger');

const REPO = 'LuquyPest/Bot-ticketting';
const CHECK_KEY = 'update_check';
const SEEN_KEY = 'updater:seen';        // last poll of the updater { at, tag }
const REQUEST_KEY = 'updater:request';  // the owner asked for an update { at, by, from, to }
const STATUS_KEY = 'updater:status';    // { state: requested|running|done|failed, at, from, to, log }
const UPDATER_ALIVE_MS = 2 * 60 * 1000;
const RUNNING_TIMEOUT_MS = 15 * 60 * 1000;

const currentVersion = () => require('../package.json').version;

// Compares x.y.z versions (« v » prefix allowed): > 0 when a is newer
function compareVersions(a, b) {
  const parse = v => String(v || '').replace(/^v/, '').split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

const checkDisabled = () => String(config.updateCheck || '').toLowerCase() === 'off';

// Latest release on GitHub → instance setting update_check
async function checkLatest({ fetchImpl = globalThis.fetch } = {}) {
  if (checkDisabled()) return null;
  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ticket-bot-update-check' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
  const r = await res.json();
  const tag = String(r.tag_name || '');
  if (!/^v?\d+\.\d+(\.\d+)?$/.test(tag)) throw new Error('Version publiée illisible');
  const info = {
    latest: tag.startsWith('v') ? tag : `v${tag}`,
    url: /^https:\/\/github\.com\//.test(r.html_url || '') ? r.html_url : `https://github.com/${REPO}/releases`,
    notes: String(r.body || '').slice(0, 4000),
    publishedAt: r.published_at || null,
    checkedAt: Date.now(),
  };
  await setSetting(CHECK_KEY, info);
  return info;
}

async function redis() { return require('./redis').getRedis(); }
const readJson = async key => { try { return JSON.parse(await (await redis()).get(key)); } catch { return null; } };

// State shown in Instance → Santé
async function updateState() {
  const check = await getSetting(CHECK_KEY, {});
  const current = currentVersion();
  const seen = await readJson(SEEN_KEY);
  const status = await readJson(STATUS_KEY);
  const connected = !!(seen && Date.now() - seen.at < UPDATER_ALIVE_MS);
  // Pinned: TICKETBOT_VERSION is a precise version, a pull keeps the same image
  const pinned = connected && seen.tag && seen.tag !== 'latest' ? seen.tag : null;
  return {
    current: `v${current}`,
    latest: check.latest || null,
    available: !!(check.latest && compareVersions(check.latest, current) > 0),
    url: check.url || null,
    notes: check.notes || '',
    checkedAt: check.checkedAt || null,
    checkDisabled: checkDisabled(),
    updater: { connected, lastSeen: seen?.at || null, pinned, configured: !!config.updater?.token },
    status,
  };
}

// Owner clicked « Mettre à jour »
async function requestUpdate(owner) {
  const state = await updateState();
  if (!state.updater.connected) throw Object.assign(new Error('Le service de mise à jour n\'est pas en marche'), { status: 409 });
  if (state.updater.pinned) throw Object.assign(new Error(`Version épinglée (TICKETBOT_VERSION=${state.updater.pinned}) : change-la dans .env`), { status: 409 });
  if (state.status && ['requested', 'running'].includes(state.status.state) && Date.now() - state.status.at < RUNNING_TIMEOUT_MS) {
    throw Object.assign(new Error('Une mise à jour est déjà en cours'), { status: 409 });
  }
  const r = await redis();
  const payload = { at: Date.now(), by: owner.username, from: state.current, to: state.latest };
  await r.set(REQUEST_KEY, JSON.stringify(payload), 'EX', 600);
  await r.set(STATUS_KEY, JSON.stringify({ state: 'requested', ...payload }), 'EX', 30 * 86400);
  return payload;
}

// Bearer UPDATER_TOKEN, compared in constant time; never through the public proxy
function updaterAuthorized(req) {
  const token = config.updater?.token;
  if (!token || token.length < 32) return false;
  if (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers['forwarded']) return false;
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(a, b) && given.length > 0;
}

// GET /api/updater/poll — the updater says it is alive and asks whether to update
async function poll(tag) {
  const r = await redis();
  await r.set(SEEN_KEY, JSON.stringify({ at: Date.now(), tag: /^[\w.-]{1,40}$/.test(tag || '') ? tag : 'latest' }), 'EX', 3600);
  const request = await r.getdel(REQUEST_KEY);
  if (!request) return { update: false };
  const req = JSON.parse(request);
  await r.set(STATUS_KEY, JSON.stringify({ ...req, state: 'running', at: Date.now() }), 'EX', 30 * 86400);
  logger.info('Mise à jour demandée transmise au service updater', { from: req.from, to: req.to });
  return { update: true };
}

// POST /api/updater/result — sent by the updater once the new bot is up (or failed)
async function result({ ok, log }) {
  const prev = (await readJson(STATUS_KEY)) || {};
  const status = { ...prev, state: ok ? 'done' : 'failed', at: Date.now(), now: `v${currentVersion()}`, log: String(log || '').slice(-3000) };
  await (await redis()).set(STATUS_KEY, JSON.stringify(status), 'EX', 30 * 86400);
  logger[ok ? 'info' : 'warn']('Résultat de la mise à jour', { ok, version: status.now });
  return status;
}

// BullMQ job 'update-check': daily check, one DM to the owners per new version
async function runUpdateCheck(client) {
  if (checkDisabled()) return { skipped: 'UPDATE_CHECK=off' };
  const info = await checkLatest();
  if (!info || compareVersions(info.latest, currentVersion()) <= 0) return { latest: info?.latest, current: currentVersion() };
  if (!(await (await redis()).set(`alert:update:${info.latest}`, '1', 'EX', 180 * 86400, 'NX'))) return { latest: info.latest, skipped: 'déjà signalé' };
  const { deliver, KEY, DEFAULTS } = require('./errorAlert');
  const settings = await getSetting(KEY, DEFAULTS);
  const link = config.webServerBaseUrl ? `\n\n[Instance → Santé](${config.webServerBaseUrl}/instance/health) · ` : '\n\n';
  await deliver(client, { ...settings, webhookUrl: null }, {
    title: `⬆️ Nouvelle version disponible : ${info.latest}`,
    description: `Ton instance est en v${currentVersion()}.${link}[Notes de version](${info.url})`,
    color: 0x2f6feb, event: 'update_available',
  });
  return { latest: info.latest, notified: true };
}

module.exports = { compareVersions, checkLatest, updateState, requestUpdate, updaterAuthorized, poll, result, runUpdateCheck, currentVersion, REPO };

// Single place that builds the runtime configuration.
//   1. config.json (TICKETBOT_CONFIG overrides the path — test suite / CI), optional since v2.24 ;
//   2. environment variables, which win over the file: a Docker install needs only a .env.
// The resulting object keeps the historical config.json shape, so the rest of the code is unchanged.
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.TICKETBOT_CONFIG
  ? path.resolve(process.env.TICKETBOT_CONFIG)
  : path.join(__dirname, '..', 'config.json');

// Environment variable → path in the config object (nested keys with a dot)
const ENV_MAP = {
  DISCORD_TOKEN:         'token',
  DISCORD_CLIENT_ID:     'clientId',
  DISCORD_CLIENT_SECRET: 'dashboard.discordClientSecret',
  DISCORD_CALLBACK_URL:  'dashboard.discordCallbackUrl',
  PUBLIC_URL:            'webServerBaseUrl',
  WEB_PORT:              'webServerPort',
  SESSION_SECRET:        'dashboard.sessionSecret',
  ENCRYPTION_KEY:        'dashboard.encryptionKey',
  VAPID_PUBLIC_KEY:      'vapid.publicKey',
  VAPID_PRIVATE_KEY:     'vapid.privateKey',
  VAPID_CONTACT:         'vapid.contact',
  DB_HOST:               'database.host',
  DB_PORT:               'database.port',
  DB_USER:               'database.user',
  DB_PASSWORD:           'database.password',
  DB_NAME:               'database.database',
  TRUST_PROXY_HOPS:      'trustProxyHops',
  TRUSTED_PROXY_HOST:    'trustedProxyHost',
  AUTO_APPROVE_GUILDS:   'autoApproveGuilds',
  TRANSCRIPT_RETENTION_DAYS: 'retention.transcriptDays',
};
const NUMBERS  = new Set(['webServerPort', 'database.port', 'trustProxyHops', 'retention.transcriptDays']);
const BOOLEANS = new Set(['autoApproveGuilds']);
// Values an environment variable may carry even when empty (an empty TRUSTED_PROXY_HOST disables the check)
const EMPTY_ALLOWED = new Set(['TRUSTED_PROXY_HOST']);

function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) cur = cur[k] = (cur[k] && typeof cur[k] === 'object') ? cur[k] : {};
  cur[keys[keys.length - 1]] = value;
}

function readFile(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`Impossible de lire ${file} : ${e.message}`); }
}

function loadConfig({ file = CONFIG_PATH, env = process.env } = {}) {
  const fromFile = readFile(file);
  const config = fromFile ? JSON.parse(JSON.stringify(fromFile)) : {};
  for (const [name, target] of Object.entries(ENV_MAP)) {
    const raw = env[name];
    if (raw === undefined || (raw === '' && !EMPTY_ALLOWED.has(name))) continue;
    let value = raw;
    if (NUMBERS.has(target)) { value = Number(raw); if (!Number.isFinite(value)) continue; }
    else if (BOOLEANS.has(target)) value = /^(1|true|yes|oui)$/i.test(raw.trim());
    setPath(config, target, value);
  }
  // Defaults a Docker install never has to spell out
  if (config.webEnabled === undefined) config.webEnabled = true;
  if (!config.webServerPort) config.webServerPort = 3000;
  config.database = { host: 'db', port: 3306, user: 'botuser', database: 'ticketbot_global', ...(config.database || {}) };
  if (config.webServerBaseUrl) {
    config.webServerBaseUrl = String(config.webServerBaseUrl).replace(/\/+$/, '');
    config.dashboard = config.dashboard || {};
    if (!config.dashboard.discordCallbackUrl) config.dashboard.discordCallbackUrl = `${config.webServerBaseUrl}/api/auth/discord/callback`;
  }
  config.hasFile = fromFile !== null;
  return config;
}

module.exports = { config: loadConfig(), loadConfig, CONFIG_PATH, ENV_MAP };

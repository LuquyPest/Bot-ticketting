// Alert when errors spike: more than `threshold` entries in error_logs within `windowMinutes`.
// Sent by Discord DM to the configured users and/or to a webhook (Discord webhooks get an
// embed, other URLs a JSON payload). At most one alert per hour. Settings: SA panel → Erreurs.
const { globalQuery } = require('./globalDb');
const { getSetting } = require('./saSettings');
const { getRedis } = require('./redis');
const logger = require('./logger');

const KEY = 'error_alert';
const DEFAULTS = { enabled: false, threshold: 20, windowMinutes: 15, discordUserIds: [], webhookUrl: null };
const COOLDOWN_KEY = 'alert:errors:cooldown';
const COOLDOWN_S = 3600;

async function errorSummary(windowMinutes) {
  const [[{ n }], top] = await Promise.all([
    globalQuery('SELECT COUNT(*) AS n FROM error_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)', [windowMinutes]),
    globalQuery(`SELECT context, COUNT(*) AS n FROM error_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
                 GROUP BY context ORDER BY n DESC LIMIT 3`, [windowMinutes]),
  ]);
  return { count: Number(n), top };
}

function alertText({ count, top }, settings, test) {
  const lines = top.map(t => `• \`${t.context}\` : ${t.n}`).join('\n') || '—';
  const { config } = require('./config');
  const link = config.webServerBaseUrl ? `${config.webServerBaseUrl.replace(/\/$/, '')}/sa/errors` : null;
  return {
    title: test ? '🧪 Test de l\'alerte d\'erreurs' : '🚨 Pic d\'erreurs sur le bot',
    description: `${count} erreur(s) sur les ${settings.windowMinutes} dernières minutes (seuil : ${settings.threshold}).\n\n**Sources principales**\n${lines}${link ? `\n\n[Ouvrir la page Erreurs](${link})` : ''}`,
  };
}

async function sendAlert(client, settings, summary, test = false) {
  const { title, description } = alertText(summary, settings, test);
  const results = { dm: 0, webhook: null };
  for (const id of settings.discordUserIds || []) {
    const user = await client?.users.fetch(id).catch(() => null);
    if (user && await user.send({ embeds: [{ title, description, color: 0xed4245, timestamp: new Date().toISOString() }] }).catch(() => null)) results.dm++;
  }
  if (settings.webhookUrl) {
    const { safePostJson } = require('./webhookEmitter');
    const isDiscord = /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(settings.webhookUrl);
    const body = isDiscord
      ? { username: 'Ticket Bot — alertes', embeds: [{ title, description, color: 0xed4245, timestamp: new Date().toISOString() }] }
      : { event: 'error_spike', test, count: summary.count, windowMinutes: settings.windowMinutes, threshold: settings.threshold, top: summary.top, timestamp: new Date().toISOString() };
    results.webhook = await safePostJson(settings.webhookUrl, body);
  }
  return results;
}

// BullMQ job 'error-alert'
async function runErrorAlertCheck(client) {
  const settings = await getSetting(KEY, DEFAULTS);
  if (!settings.enabled) return { skipped: 'disabled' };
  const summary = await errorSummary(settings.windowMinutes);
  if (summary.count < settings.threshold) return { count: summary.count };
  // One alert per hour, across instances
  if (!(await getRedis().set(COOLDOWN_KEY, '1', 'EX', COOLDOWN_S, 'NX'))) return { count: summary.count, skipped: 'cooldown' };
  const results = await sendAlert(client, settings, summary);
  logger.warn('Alerte pic d\'erreurs envoyée', { count: summary.count, ...results });
  return { count: summary.count, sent: results };
}

module.exports = { runErrorAlertCheck, sendAlert, errorSummary, DEFAULTS, KEY };

// Alert when the bot loses its Discord connection for more than a few minutes, then when it is
// back. Checked every minute (job 'discord-watch'); recipients are those of the error alert
// (SA panel → Erreurs). While Discord is unreachable, DMs may not go through: the webhook is the
// reliable channel.
const os = require('os');
const { getSetting } = require('./saSettings');
const { getRedis } = require('./redis');
const { DEFAULTS, KEY, deliver } = require('./errorAlert');
const logger = require('./logger');

const host = os.hostname();
const DOWN_KEY = `discord:down_since:${host}`;
const ALERTED_KEY = `discord:down_alerted:${host}`;

const isConnected = client => !!client?.isReady?.() && client.ws?.status === 0;
const minutes = ms => Math.max(1, Math.round(ms / 60000));

async function runDiscordWatch(client, now = Date.now()) {
  const settings = { ...DEFAULTS, ...(await getSetting(KEY, DEFAULTS)) };
  const limit = Number(settings.discordDownMinutes ?? 5);
  const redis = getRedis();
  const since = Number(await redis.get(DOWN_KEY)) || null;

  if (isConnected(client)) {
    if (!since) return { connected: true };
    await redis.del(DOWN_KEY);
    if (await redis.del(ALERTED_KEY)) {
      const res = await deliver(client, settings, {
        title: '✅ Bot reconnecté à Discord', color: 0x57f287,
        description: `La connexion est rétablie après ${minutes(now - since)} min de coupure.`,
        event: 'discord_reconnected', data: { downMinutes: minutes(now - since), host },
      });
      logger.info('Discord : reconnecté', { downMinutes: minutes(now - since), ...res });
      return { connected: true, recovered: true };
    }
    return { connected: true };
  }

  if (!since) {
    await redis.set(DOWN_KEY, String(now), 'EX', 7 * 86400);
    return { connected: false, since: now };
  }
  if (limit <= 0 || now - since < limit * 60000) return { connected: false, since };
  // Once per outage
  if (!(await redis.set(ALERTED_KEY, '1', 'EX', 7 * 86400, 'NX'))) return { connected: false, since, alerted: true };
  const status = client?.ws?.status;
  require('./errorLog').logError(null, 'discord', `Bot déconnecté de Discord depuis ${minutes(now - since)} min (statut ${status ?? 'inconnu'})`);
  const res = await deliver(client, settings, {
    title: '🔌 Bot déconnecté de Discord',
    description: `Le bot n'est plus connecté à Discord depuis ${minutes(now - since)} min (instance \`${host}\`, statut ${status ?? 'inconnu'}). Les tickets ne sont plus reçus ; le dashboard reste accessible. Tu seras prévenu à la reconnexion.`,
    event: 'discord_disconnected', data: { downMinutes: minutes(now - since), host, status: status ?? null },
  });
  logger.warn('Discord : alerte de déconnexion envoyée', { downMinutes: minutes(now - since), ...res });
  return { connected: false, since, alertSent: true };
}

module.exports = { runDiscordWatch, isConnected };

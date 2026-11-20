const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Collection, Events } = require('discord.js');
const { config } = require('./utils/config');
const logger = require('./utils/logger');
require('./utils/errorLog').captureConsoleErrors();
const { startWebServer } = require('./web/server');
const { startWorkers }  = require('./utils/jobQueue');
require('./utils/spaces').refresh().catch(() => null); // spaces without Discord: known before any Discord call

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  // Only user mentions ping by default; role pings must be allowed explicitly per message.
  allowedMentions: { parse: ['users'], repliedUser: false },
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember
  ]
});

client.config = config;
client.commands = new Collection();

function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  const files = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
  for (const file of files) {
    const command = require(path.join(commandsPath, file));
    if (!command?.data?.name || typeof command.execute !== 'function') {
      logger.warn('Commande ignorée', { file });
      continue;
    }
    client.commands.set(command.data.name, command);
  }
}

function loadEvents() {
  const eventsPath = path.join(__dirname, 'events');
  const files = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
  for (const file of files) {
    const event = require(path.join(eventsPath, file));
    if (!event?.name || typeof event.execute !== 'function') {
      logger.warn('Événement ignoré', { file });
      continue;
    }
    if (event.once) {
      client.once(event.name, (...args) => event.execute(client, ...args));
    } else {
      client.on(event.name, (...args) => event.execute(client, ...args));
    }
  }
}

loadCommands();
loadEvents();

let httpServer = null;
if (config.webEnabled !== false) {
  httpServer = startWebServer(client);
}

// High availability (v7, utils/leader.js): only the container holding the Redis lock connects to
// Discord, migrates the databases and runs the jobs; the others wait as standbys and take over if it
// stops. A single container takes the lock at once.
const leader = require('./utils/leader');
leader.start({
  onLeader: () => {
    logger.info('Conteneur actif', { id: leader.ID });
    // Without DISCORD_TOKEN (v4): no bot, but the databases are migrated and the automations start
    // all the same (Discord-only jobs skip themselves, utils/jobQueue.js)
    if (config.token) {
      client.login(config.token);
    } else {
      logger.info('Démarrage sans Discord : pas de bot, dashboard et automatismes seulement');
      require('./events/ready').migrateTenants().finally(() => client.emit('tenantsMigrated'));
      require('./utils/installation').announceIfNeeded(client).catch(err => logger.error('Installation', { err: err.message }));
    }
  },
  // Lock lost while active: never two active containers — leave, Docker brings us back as a standby
  onLost: err => { logger.error('Verrou du conteneur actif perdu : arrêt', { err: err?.message }); setTimeout(() => process.exit(1), 200); },
}).catch(err => logger.error('Verrou du conteneur actif', { err: err.message }));
if (!leader.isLeader()) setTimeout(() => { if (!leader.isLeader()) logger.info('Conteneur en attente : un autre conteneur est actif', { id: leader.ID }); }, 3000).unref();

client.once(Events.ClientReady, () => logger.info('Bot connecté', { tag: client.user.tag }));
// All recurring automations (inactivity, escalation, reminders, scheduled messages,
// weekly report, retention purge) are BullMQ job schedulers — see utils/jobQueue.js. They start
// once the guild databases are migrated (events/ready.js).
client.once('tenantsMigrated', () => {
  startWorkers(client).catch(err => logger.error('startWorkers failed', { err: err.message }));
});

async function shutdown(signal) {
  logger.info('Arrêt en cours', { signal });
  httpServer?.close();
  require('./utils/leader').stop();
  await require('./utils/leader').release(); // a standby takes over at once
  await require('./utils/sse').stopBus();
  client.destroy();
  await require('./utils/globalDb').getPool().end().catch(() => {});
  await require('./utils/tenantDb').closeAll();
  await require('./utils/redis').getRedis().quit().catch(() => {});
  process.exit(0);
}

client.on(Events.Error, err => logger.error('Erreur client Discord', { err: err?.stack || String(err) }));

// A stray rejection in an event handler must not take the whole bot down.
process.on('unhandledRejection', err => {
  logger.error('unhandledRejection', { err: err?.stack || String(err) });
});
// After an uncaught exception the process state is unknown: log and let Docker restart us.
process.on('uncaughtException', err => {
  logger.error('uncaughtException', { err: err?.stack || String(err) });
  setTimeout(() => process.exit(1), 500).unref(); // leaves time to write the error journal
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

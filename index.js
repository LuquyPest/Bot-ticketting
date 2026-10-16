const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Collection, Events } = require('discord.js');
const { config } = require('./utils/config');
const logger = require('./utils/logger');
require('./utils/errorLog').captureConsoleErrors();
const { startWebServer } = require('./web/server');
const { startWorkers }  = require('./utils/jobQueue');

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

client.login(config.token);

client.once(Events.ClientReady, () => {
  logger.info('Bot connecté', { tag: client.user.tag });
  // All recurring automations (inactivity, escalation, reminders, scheduled messages,
  // weekly report, retention purge) are BullMQ job schedulers — see utils/jobQueue.js
  startWorkers(client).catch(err => logger.error('startWorkers failed', { err: err.message }));
});

async function shutdown(signal) {
  logger.info('Arrêt en cours', { signal });
  httpServer?.close();
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

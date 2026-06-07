const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const config = require('./config.json');
const logger = require('./utils/logger');
const { startInactiveChecker } = require('./utils/inactiveTicketChecker');
const { startWeeklyReport } = require('./utils/weeklyReport');
const { startScheduledMessages } = require('./utils/scheduledMessages');
const { startEscalationChecker } = require('./utils/escalationChecker');
const { startWebServer } = require('./web/server');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
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

client.once('ready', () => {
  logger.info('Bot connecté', { tag: client.user.tag });
  startInactiveChecker(client);
  startWeeklyReport(client);
  startScheduledMessages(client);
  startEscalationChecker(client);
});

async function shutdown(signal) {
  logger.info('Arrêt en cours', { signal });
  httpServer?.close();
  client.destroy();
  const { pool } = require('./utils/db');
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

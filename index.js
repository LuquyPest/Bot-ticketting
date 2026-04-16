const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const config = require('./config.json');

// ?? Client Discord (FULL FIX)
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

// ?? Chargement commandes
function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  const files = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of files) {
    const command = require(path.join(commandsPath, file));

    if (!command?.data?.name || typeof command.execute !== 'function') {
      console.warn(`Commande ignorée: ${file}`);
      continue;
    }

    client.commands.set(command.data.name, command);
  }
}

// ? Chargement events
function loadEvents() {
  const eventsPath = path.join(__dirname, 'events');
  const files = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

  console.log('Events trouvés:', files);

  for (const file of files) {
    const event = require(path.join(eventsPath, file));
    console.log('Event chargé:', event?.name, 'depuis', file);

    if (!event?.name || typeof event.execute !== 'function') {
      console.warn(`Événement ignoré: ${file}`);
      continue;
    }

    if (event.once) {
      client.once(event.name, (...args) => event.execute(client, ...args));
    } else {
      client.on(event.name, (...args) => event.execute(client, ...args));
    }
  }
}

// ?? DEBUG RAW (ULTRA IMPORTANT)
client.on('raw', (packet) => {
  if (packet.t === 'MESSAGE_CREATE') {
    console.log('?? RAW MESSAGE DETECTED:', packet.d.content);
  }
});

// ?? Init
loadCommands();
loadEvents();

// ?? Connexion
client.login(config.token);

// ? Ready
client.once('ready', () => {
  console.log(`? Connecté en tant que ${client.user.tag}`);
});
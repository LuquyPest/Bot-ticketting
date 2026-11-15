const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { config } = require('./utils/config');
const { localizeCommand } = require('./utils/locales/commands');

// Commands as registered on Discord: translated (utils/locales/commands.js), English by default
function buildCommands() {
  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');
  const files = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of files) {
    const command = require(path.join(commandsPath, file));
    if (command?.data) {
      // Staff commands need a tenant DB: guild only (0 = Guild). Member commands (dm: true): DM with the bot (1 = BotDM)
      commands.push({ ...localizeCommand(command.data.toJSON()), contexts: command.dm ? [1] : [0], integration_types: [0] });
    }
  }
  return commands;
}

async function deployCommands() {
  const commands = buildCommands();
  const rest = new REST({ version: '10' }).setToken(config.token);

  console.log('Enregistrement des commandes...');
  await rest.put(
    Routes.applicationCommands(config.clientId),
    { body: commands }
  );
  console.log(`${commands.length} commandes enregistrées globalement.`);
}

if (require.main === module) deployCommands().catch(console.error);
module.exports = { buildCommands };

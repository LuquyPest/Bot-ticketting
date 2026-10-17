const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { config } = require('./utils/config');

async function deployCommands() {
  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');
  const files = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of files) {
    const command = require(path.join(commandsPath, file));
    if (command?.data) {
      // Staff commands need a tenant DB: guild only (0 = Guild). Member commands (dm: true): DM with the bot (1 = BotDM)
      commands.push({ ...command.data.toJSON(), contexts: command.dm ? [1] : [0], integration_types: [0] });
    }
  }

  const rest = new REST({ version: '10' }).setToken(config.token);

  console.log('Enregistrement des commandes...');
  await rest.put(
    Routes.applicationCommands(config.clientId),
    { body: commands }
  );
  console.log(`${commands.length} commandes enregistrées globalement.`);
}

deployCommands().catch(console.error);

const { SlashCommandBuilder } = require('discord.js');
const { myTicketsEmbed } = require('../utils/memberTickets');

// Member command, in DM with the bot
module.exports = {
  dm: true,
  data: new SlashCommandBuilder()
    .setName('mestickets')
    .setDescription('Voir l\'état de mes tickets ouverts'),

  async execute(client, interaction) {
    await interaction.reply({ embeds: [await myTicketsEmbed(interaction.user, client)] });
  },
};

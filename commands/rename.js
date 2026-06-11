const { SlashCommandBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');
const { sanitizeChannelName } = require('../utils/sanitize');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rename')
    .setDescription('Renomme le ticket')
    .addStringOption(option =>
      option.setName('name').setDescription('Nouveau nom').setRequired(true)
    ),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: '❌ Pas un salon ticket.', ephemeral: true });
    }

    const newName = sanitizeChannelName(interaction.options.getString('name', true));
    if (!newName) {
      return interaction.reply({ content: '❌ Nom invalide.', ephemeral: true });
    }

    await interaction.channel.setName(newName);
    await interaction.reply(`✅ Salon renommé en **${newName}**.`);
  }
};

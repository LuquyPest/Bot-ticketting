const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const { getOpenTicketByChannelId } = require('../utils/ticketManager');

function sanitizeName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rename')
    .setDescription('Renomme le ticket')
    .addStringOption(option =>
      option.setName('name').setDescription('Nouveau nom').setRequired(true)
    ),

  async execute(client, interaction) {
    const allowed = await ensureSupport(interaction, client);
    if (!allowed) return;

    const ticket = await getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: '❌ Pas un salon ticket.', ephemeral: true });
      return;
    }

    const newName = sanitizeName(interaction.options.getString('name', true));
    if (!newName) {
      await interaction.reply({ content: '❌ Nom invalide.', ephemeral: true });
      return;
    }

    await interaction.channel.setName(newName);
    await interaction.reply(`✅ Salon renommé en **${newName}**.`);
  }
};

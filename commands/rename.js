const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rename')
    .setDescription('Change le titre du ticket (le salon est renommé pareil)')
    .addStringOption(option =>
      option.setName('name').setDescription('Nouveau titre').setRequired(true).setMaxLength(100)
    ),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: '❌ Pas un salon ticket.', flags: MessageFlags.Ephemeral });
    }

    const result = await tm.setSubject(ticket.id, interaction.options.getString('name', true), interaction.user);
    if (!result?.subject) return interaction.reply({ content: '❌ Titre invalide.', flags: MessageFlags.Ephemeral });
    await interaction.reply(`✅ Titre du ticket : **${result.subject}**${result.channelName ? ` (salon : \`${result.channelName}\`)` : ''}.`);
  }
};

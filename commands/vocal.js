const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vocal')
    .setDescription('Ouvre ou ferme le salon vocal temporaire du ticket')
    .addStringOption(o => o.setName('action').setDescription('Ouvrir ou fermer').setRequired(false)
      .addChoices({ name: 'Ouvrir', value: 'open' }, { name: 'Fermer', value: 'close' })),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'reply_ticket'))) return;
    const tm = createManager(db, client, interaction.guildId);
    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) return interaction.reply({ content: 'Pas un ticket ouvert.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (interaction.options.getString('action') === 'close') {
      const closed = await tm.closeVoiceChannel(ticket.id, interaction.user);
      return interaction.editReply({ content: closed ? 'Salon vocal fermé.' : 'Ce ticket n\'a pas de salon vocal.' });
    }
    const r = await tm.openVoiceChannel(ticket.id, interaction.user);
    await interaction.editReply({ content: r.ok ? `🔊 <#${r.channel.id}>` : `❌ ${r.error}` });
  },
};

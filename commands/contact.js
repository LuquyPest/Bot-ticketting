const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');
const { openFromDiscord } = require('../utils/staffTicket');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('contact')
    .setDescription('Ouvre un ticket pour contacter un membre (sanction, suivi, remboursement…)')
    .addUserOption(o => o.setName('membre').setDescription('Membre à contacter').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Premier message envoyé au membre').setRequired(true).setMaxLength(2000))
    .addStringOption(o => o.setName('sujet').setDescription('Sujet du ticket').setRequired(false).setMaxLength(100)),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'reply_ticket'))) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const tm = createManager(db, client, interaction.guildId);
    const r = await openFromDiscord({
      client, db, tm, guildId: interaction.guildId, member: interaction.options.getUser('membre'), staff: interaction.user,
      subject: interaction.options.getString('sujet'), message: interaction.options.getString('message'),
    });
    await interaction.editReply({ content: r.error ? `❌ ${r.error}` : `✅ Ticket #${r.ticket.id} ouvert : <#${r.channel.id}>` });
  },
};

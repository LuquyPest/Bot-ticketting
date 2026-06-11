const { SlashCommandBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reopen')
    .setDescription('Réouvre le dernier ticket fermé d\'un utilisateur')
    .addStringOption(o =>
      o.setName('userid').setDescription('ID Discord de l\'utilisateur').setRequired(true)
    ),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db))) return;

    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.options.getString('userid', true);

    const openTicket = await tm.getAnyOpenTicketForUser(userId);
    if (openTicket) {
      return interaction.editReply({ content: `Cet utilisateur a déjà un ticket ouvert (ticket #${openTicket.id}).` });
    }

    const ticket = await tm.getLastClosedTicketByOwnerId(userId);
    if (!ticket) {
      return interaction.editReply({ content: 'Aucun ticket fermé trouvé pour cet utilisateur.' });
    }

    const channel = await tm.reopenTicket(ticket, interaction.user);

    await interaction.editReply({ content: `Ticket #${ticket.id} réouvert dans ${channel}.` });
  }
};

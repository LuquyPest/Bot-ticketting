const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const { getLastClosedTicketByOwnerId, reopenTicket, getAnyOpenTicketForUser } = require('../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reopen')
    .setDescription('Réouvre le dernier ticket fermé d\'un utilisateur')
    .addStringOption(o =>
      o.setName('userid').setDescription('ID Discord de l\'utilisateur').setRequired(true)
    ),

  async execute(client, interaction) {
    if (!(await ensureSupport(interaction, client))) return;

    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.options.getString('userid', true);

    const openTicket = await getAnyOpenTicketForUser(userId);
    if (openTicket) {
      return interaction.editReply({ content: `Cet utilisateur a déjà un ticket ouvert (ticket #${openTicket.id}).` });
    }

    const ticket = await getLastClosedTicketByOwnerId(userId);
    if (!ticket) {
      return interaction.editReply({ content: 'Aucun ticket fermé trouvé pour cet utilisateur.' });
    }

    const channel = await reopenTicket(client, ticket, interaction.user);

    await interaction.editReply({
      content: `Ticket #${ticket.id} réouvert dans ${channel}.`
    });
  }
};

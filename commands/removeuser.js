const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const {
  getOpenTicketByChannelId,
  removeParticipant,
  logRemoveUser
} = require('../utils/ticketManager');
const { broadcast } = require('../utils/sse');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removeuser')
    .setDescription('Retire un utilisateur des participants DM lies au ticket')
    .addUserOption(option =>
      option
        .setName('utilisateur')
        .setDescription('Utilisateur a retirer')
        .setRequired(true)
    ),

  async execute(client, interaction) {
    if (!(await ensureSupport(interaction, client))) return;

    const ticket = await getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({
        content: 'Pas un ticket valide.',
        ephemeral: true
      });
    }

    const user = interaction.options.getUser('utilisateur');

    if (ticket.owner_id === user.id) {
      return interaction.reply({
        content: 'Impossible de retirer le proprietaire principal du ticket.',
        ephemeral: true
      });
    }

    await removeParticipant(ticket.id, user.id);
    await logRemoveUser(client, ticket.id, user.id, interaction.user);
    broadcast('participant_remove', { ticketId: ticket.id, userId: user.id });

    await interaction.reply({
      content: `Utilisateur retire des participants DM lies : ${user.tag}`,
      ephemeral: true
    });

    await interaction.channel.send(
      `--- ${interaction.user.username} : a retire ${user.tag} des participants DM lies du ticket`
    );
  }
};
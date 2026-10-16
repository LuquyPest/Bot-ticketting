const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');
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
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'manage_participants'))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: 'Pas un ticket valide.', flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('utilisateur');

    if (ticket.owner_id === user.id) {
      return interaction.reply({ content: 'Impossible de retirer le proprietaire principal du ticket.', flags: MessageFlags.Ephemeral });
    }

    await tm.removeParticipant(ticket.id, user.id);
    await tm.logRemoveUser(ticket.id, user.id, interaction.user);
    broadcast('participant_remove', { ticketId: ticket.id, userId: user.id }, interaction.guildId);

    await interaction.reply({ content: `Utilisateur retire des participants DM lies : ${user.username}`, flags: MessageFlags.Ephemeral });
    await interaction.channel.send(`--- ${interaction.user.username} : a retire ${user.username} des participants DM lies du ticket`);
  }
};

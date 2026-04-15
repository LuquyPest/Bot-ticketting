const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const {
  getOpenTicketByChannelId,
  removeParticipant,
  logRemoveUser
} = require('../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removeuser')
    .setDescription('Retire un utilisateur du ticket')
    .addStringOption(option =>
      option.setName('userid').setDescription('ID Discord').setRequired(true)
    ),

  async execute(client, interaction) {
    const allowed = await ensureSupport(interaction, client);
    if (!allowed) return;

    const ticket = await getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: '❌ Pas un salon ticket.', ephemeral: true });
      return;
    }

    const userId = interaction.options.getString('userid', true);

    if (ticket.owner_id === userId) {
      await interaction.reply({
        content: '❌ Impossible de retirer le propriétaire du ticket.',
        ephemeral: true
      });
      return;
    }

    await interaction.channel.permissionOverwrites.delete(userId).catch(() => null);
    await removeParticipant(ticket.id, userId);
    await logRemoveUser(client, ticket.id, userId, interaction.user);

    await interaction.reply(`✅ <@${userId}> a été retiré du ticket.`);
  }
};

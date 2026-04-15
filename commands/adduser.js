const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const {
  getOpenTicketByChannelId,
  addParticipant,
  logAddUser
} = require('../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adduser')
    .setDescription('Ajoute un utilisateur au ticket')
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
    const target = await interaction.guild.members.fetch(userId).catch(() => null);

    if (!target) {
      await interaction.reply({
        content: '❌ Utilisateur introuvable sur le serveur.',
        ephemeral: true
      });
      return;
    }

    await interaction.channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true
    });

    await addParticipant(ticket.id, userId);
    await logAddUser(client, ticket.id, userId, interaction.user);

    await interaction.reply(`✅ <@${userId}> a été ajouté au ticket.`);
  }
};

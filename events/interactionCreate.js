const { Events, AttachmentBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const {
  getOpenTicketByChannelId,
  saveTranscriptSnapshot,
  closeTicketWithTranscript,
  getOldTicketsByUserId
} = require('../utils/ticketManager');
const {
  closeConfirmationButtons,
  oldTicketsPaginationButtons
} = require('../utils/components');
const {
  closeConfirmationEmbed,
  buildOldTicketsPageEmbed
} = require('../utils/embeds');

module.exports = {
  name: Events.InteractionCreate,
  async execute(client, interaction) {
    try {
      if (interaction.isButton()) {
        const allowed = await ensureSupport(interaction, client);
        if (!allowed) return;

        if (interaction.customId.startsWith('oldtickets_')) {
          const parts = interaction.customId.split('_');
          const action = parts[1];
          const userId = parts[2];
          const currentPage = Number(parts[3]) || 0;

          const tickets = await getOldTicketsByUserId(userId);

          if (!tickets.length) {
            await interaction.reply({
              content: 'Aucun ticket trouve.',
              ephemeral: true
            });
            return;
          }

          let newPage = currentPage;
          if (action === 'prev') newPage -= 1;
          if (action === 'next') newPage += 1;

          const { embed, totalPages, safePage } = buildOldTicketsPageEmbed(userId, tickets, newPage, 5);

          await interaction.update({
            embeds: [embed],
            components: [oldTicketsPaginationButtons(userId, safePage, totalPages)]
          });
          return;
        }

        const ticket = await getOpenTicketByChannelId(interaction.channelId);
        if (!ticket) {
          await interaction.reply({
            content: 'Ce salon n est pas un ticket ouvert.',
            ephemeral: true
          });
          return;
        }

        if (interaction.customId === 'ticket_transcript') {
          const saved = await saveTranscriptSnapshot(interaction.channel, interaction.user);

          if (!saved) {
            await interaction.reply({
              content: 'Impossible de generer le transcript.',
              ephemeral: true
            });
            return;
          }

          const htmlFile = new AttachmentBuilder(
            Buffer.from(saved.html, 'utf8'),
            { name: `transcript-${saved.transcriptId}.html` }
          );

          await interaction.reply({
            content: `Transcript enregistre.\nID du transcript : ${saved.transcriptId}`,
            files: [htmlFile],
            ephemeral: true
          });
          return;
        }

        if (interaction.customId === 'ticket_close_with_transcript') {
          await interaction.reply({
            embeds: [closeConfirmationEmbed()],
            components: [closeConfirmationButtons()],
            ephemeral: true
          });
          return;
        }

        if (interaction.customId === 'ticket_close_with_transcript_confirm') {
          await interaction.update({
            content: 'Fermeture du ticket et generation du transcript...',
            embeds: [],
            components: []
          });

          await closeTicketWithTranscript(client, interaction.channel, interaction.user);
          return;
        }

        if (interaction.customId === 'ticket_close_with_transcript_cancel') {
          await interaction.update({
            content: 'Fermeture annulee.',
            embeds: [],
            components: []
          });
          return;
        }
      }

      if (!interaction.isChatInputCommand()) return;

      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      await command.execute(client, interaction);
    } catch (error) {
      console.error('Erreur interactionCreate:', error);

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: 'Une erreur est survenue.',
          ephemeral: true
        }).catch(() => null);
      } else {
        await interaction.reply({
          content: 'Une erreur est survenue.',
          ephemeral: true
        }).catch(() => null);
      }
    }
  }
};
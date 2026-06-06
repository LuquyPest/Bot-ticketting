const { Events } = require('discord.js');
const { hostTranscript, buildUrl } = require('../utils/transcriptServer');
const { ensureSupport } = require('../utils/permissions');
const { query } = require('../utils/db');
const {
  getOpenTicketByChannelId,
  saveTranscriptSnapshot,
  closeTicketWithTranscript,
  getOldTicketsByUserId,
  relayDmToTicket,
  sendWelcomeDm,
  saveRating
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

        // ── Boutons DM : sélection de sujet (pas de guild requis) ──
        if (interaction.customId.startsWith('subject_')) {
          const subject = interaction.customId.slice('subject_'.length);
          const { pendingSubject } = require('./messageCreate');
          const pending = pendingSubject.get(interaction.user.id);

          await interaction.update({
            content: `Sujet sélectionné : **${subject}**\nTon ticket est en cours de création...`,
            components: []
          });

          const { content, attachments } = pending || { content: '', attachments: [] };
          pendingSubject.delete(interaction.user.id);

          const result = await relayDmToTicket(client, interaction.user, content, attachments, subject);
          await sendWelcomeDm(client, interaction.user, result.created);
          return;
        }

        // ── Boutons DM : notation de satisfaction ──
        if (interaction.customId.startsWith('rating_')) {
          const parts = interaction.customId.split('_');
          const rating = parseInt(parts[1]);
          const ticketId = parseInt(parts[2]);

          // Fix #6 : valider que rating et ticketId sont bien des nombres
          if (isNaN(rating) || rating < 1 || rating > 5 || isNaN(ticketId)) {
            await interaction.reply({ content: 'Interaction invalide.', ephemeral: true });
            return;
          }

          // Fix #6 : vérifier en base que ce ticket appartient bien à cet utilisateur
          const [ticket] = await query(
            'SELECT id, claimed_by, closed_by_tag FROM tickets WHERE id = ? AND owner_id = ? AND status = "closed"',
            [ticketId, interaction.user.id]
          );
          if (!ticket) {
            await interaction.reply({ content: 'Tu ne peux pas noter ce ticket.', ephemeral: true });
            return;
          }

          // Fix #6 : empêcher les doubles notations
          const [existing] = await query(
            'SELECT id FROM ticket_ratings WHERE ticket_id = ? AND owner_id = ?',
            [ticketId, interaction.user.id]
          );
          if (existing) {
            await interaction.update({ content: 'Tu as déjà noté ce ticket.', components: [] });
            return;
          }

          // Fix #6 : récupérer closedById depuis la base, pas depuis le customId forgeable
          const closedById = ticket.claimed_by;
          const closedByUser = await client.users.fetch(closedById).catch(() => null);
          const closedByTag = closedByUser?.tag || ticket.closed_by_tag || closedById;

          await saveRating(ticketId, interaction.user.id, closedById, rating, closedByTag);

          const stars = '⭐'.repeat(rating);
          await interaction.update({
            content: `Merci pour ton avis ! Tu as mis ${stars} (${rating}/5).`,
            components: []
          });
          return;
        }

        // ── Boutons serveur : vérification staff ──
        if (!interaction.guild) return;

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
          await interaction.deferReply({ ephemeral: true });

          const saved = await saveTranscriptSnapshot(interaction.channel, interaction.user);

          if (!saved) {
            await interaction.editReply({ content: 'Impossible de generer le transcript.' });
            return;
          }

          const token = hostTranscript(saved.html);
          const url = buildUrl(interaction.client.config.webServerBaseUrl, token);

          await interaction.editReply({
            content: `Transcript enregistré (ID : ${saved.transcriptId})\nLien valable 10 minutes : ${url}`
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

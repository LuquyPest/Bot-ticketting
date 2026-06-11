const { Events } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { getActiveGuilds } = require('../utils/guildScan');
const { ensureSupport } = require('../utils/permissions');
const { hostTranscript, buildUrl } = require('../utils/transcriptServer');
const { closeConfirmationButtons, oldTicketsPaginationButtons } = require('../utils/components');
const { closeConfirmationEmbed, buildOldTicketsPageEmbed } = require('../utils/embeds');

async function findGuildForClosedTicket(ticketId, ownerId) {
  const guilds = await getActiveGuilds();
  for (const { guild_id } of guilds) {
    try {
      const db = getTenantDb(guild_id);
      const [ticket] = await db(
        'SELECT id, claimed_by, closed_by_tag FROM tickets WHERE id = ? AND owner_id = ? AND status = "closed"',
        [ticketId, ownerId]
      );
      if (ticket) return { db, ticket, guildId: guild_id };
    } catch {}
  }
  return null;
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(client, interaction) {
    try {
      if (interaction.isButton()) {

        // ── Sujet (DM) ──
        if (interaction.customId.startsWith('subject_')) {
          const subject = interaction.customId.slice('subject_'.length);
          const { pendingSubject, openTicketForGuild } = require('./messageCreate');
          const pending = pendingSubject.get(interaction.user.id);
          if (!pending) {
            return interaction.reply({ content: 'Session expirée. Renvoie ton message.', ephemeral: true });
          }
          await interaction.update({ content: `Sujet sélectionné : **${subject}**\nCréation du ticket...`, components: [] });
          pendingSubject.delete(interaction.user.id);
          const { content, attachments, guildId, db, tm, config } = pending;
          await openTicketForGuild(interaction.user, content, attachments, { guildId, db, tm, config }, client, subject);
          return;
        }

        // ── Sélection de serveur (DM) ──
        if (interaction.customId.startsWith('guildselect_')) {
          const guildId = interaction.customId.slice('guildselect_'.length);
          const { pendingGuildSelect, openTicketForGuild } = require('./messageCreate');
          const pending = pendingGuildSelect.get(interaction.user.id);
          if (!pending) {
            return interaction.reply({ content: 'Session expirée. Renvoie ton message.', ephemeral: true });
          }
          const guildEntry = pending.guilds.find(g => g.guildId === guildId);
          if (!guildEntry) {
            return interaction.reply({ content: 'Serveur invalide.', ephemeral: true });
          }
          pendingGuildSelect.delete(interaction.user.id);
          await interaction.update({ content: 'Serveur sélectionné. Création du ticket...', components: [] });
          await openTicketForGuild(interaction.user, pending.content, pending.attachments, guildEntry, client, null);
          return;
        }

        // ── Notation (DM) ──
        if (interaction.customId.startsWith('rating_')) {
          const parts = interaction.customId.split('_');
          const rating = parseInt(parts[1]);
          const ticketId = parseInt(parts[2]);
          if (isNaN(rating) || rating < 1 || rating > 5 || isNaN(ticketId)) {
            return interaction.reply({ content: 'Interaction invalide.', ephemeral: true });
          }
          const found = await findGuildForClosedTicket(ticketId, interaction.user.id);
          if (!found) {
            return interaction.reply({ content: 'Tu ne peux pas noter ce ticket.', ephemeral: true });
          }
          const { db, ticket, guildId } = found;
          const [existing] = await db(
            'SELECT id FROM ticket_ratings WHERE ticket_id = ? AND owner_id = ?',
            [ticketId, interaction.user.id]
          );
          if (existing) {
            return interaction.update({ content: 'Tu as déjà noté ce ticket.', components: [] });
          }
          const closedById = ticket.claimed_by;
          const closedByUser = await client.users.fetch(closedById).catch(() => null);
          const closedByTag = closedByUser?.username || ticket.closed_by_tag || closedById;
          const tm = createManager(db, client, guildId);
          await tm.saveRating(ticketId, interaction.user.id, closedById, rating, closedByTag);
          const stars = '⭐'.repeat(rating);
          return interaction.update({ content: `Merci pour ton avis ! Tu as mis ${stars} (${rating}/5).`, components: [] });
        }

        // ── Boutons en contexte serveur ──
        if (!interaction.guild) return;
        const db = getTenantDb(interaction.guildId);
        const tm = createManager(db, client, interaction.guildId);

        if (!(await ensureSupport(interaction, client, db))) return;

        if (interaction.customId.startsWith('oldtickets_')) {
          const parts = interaction.customId.split('_');
          const action = parts[1];
          const userId = parts[2];
          const currentPage = Number(parts[3]) || 0;
          const tickets = await tm.getOldTicketsByUserId(userId);
          if (!tickets.length) {
            return interaction.reply({ content: 'Aucun ticket trouvé.', ephemeral: true });
          }
          let newPage = currentPage;
          if (action === 'prev') newPage -= 1;
          if (action === 'next') newPage += 1;
          const { embed, totalPages, safePage } = buildOldTicketsPageEmbed(userId, tickets, newPage, 5);
          return interaction.update({ embeds: [embed], components: [oldTicketsPaginationButtons(userId, safePage, totalPages)] });
        }

        const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
        if (!ticket) {
          return interaction.reply({ content: 'Ce salon n est pas un ticket ouvert.', ephemeral: true });
        }

        if (interaction.customId === 'ticket_transcript') {
          await interaction.deferReply({ ephemeral: true });
          const saved = await tm.saveTranscriptSnapshot(interaction.channel, interaction.user);
          if (!saved) {
            return interaction.editReply({ content: 'Impossible de generer le transcript.' });
          }
          const token = hostTranscript(saved.html);
          const url = buildUrl(client.config.webServerBaseUrl, token);
          return interaction.editReply({ content: `Transcript enregistré (ID : ${saved.transcriptId})\nLien valable 10 minutes : ${url}` });
        }

        if (interaction.customId === 'ticket_close_with_transcript') {
          return interaction.reply({ embeds: [closeConfirmationEmbed()], components: [closeConfirmationButtons()], ephemeral: true });
        }

        if (interaction.customId === 'ticket_close_with_transcript_confirm') {
          await interaction.update({ content: 'Fermeture du ticket et generation du transcript...', embeds: [], components: [] });
          await tm.closeTicketWithTranscript(interaction.channel, interaction.user);
          return;
        }

        if (interaction.customId === 'ticket_close_with_transcript_cancel') {
          return interaction.update({ content: 'Fermeture annulee.', embeds: [], components: [] });
        }
      }

      if (!interaction.isChatInputCommand()) return;
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(client, interaction);
    } catch (error) {
      console.error('Erreur interactionCreate:', error);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'Une erreur est survenue.', ephemeral: true }).catch(() => null);
      } else {
        await interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true }).catch(() => null);
      }
    }
  }
};

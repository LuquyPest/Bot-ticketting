const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { getActiveGuilds } = require('../utils/guildScan');
const { ensureSupport } = require('../utils/permissions');
const { hostTranscript, buildUrl } = require('../utils/transcriptServer');
const { closeConfirmationButtons, oldTicketsPaginationButtons } = require('../utils/components');
const { closeConfirmationEmbed, buildOldTicketsPageEmbed } = require('../utils/embeds');
const {
  sessionExpiredEmbed, relayConfirmEmbed,
  ticketCreatingEmbed, ratingConfirmEmbed, alreadyRatedEmbed,
} = require('../utils/dmEmbeds');

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

        // ── FAQ — ouvrir ticket quand même (DM) ──
        if (interaction.customId.startsWith('faq_open_')) {
          const { pendingFaqTicket, openTicketForGuild } = require('./messageCreate');
          const pending = pendingFaqTicket.get(interaction.user.id);
          if (!pending) {
            return interaction.reply({ embeds: [sessionExpiredEmbed()], ephemeral: true });
          }
          pendingFaqTicket.delete(interaction.user.id);
          await interaction.update({ embeds: [ticketCreatingEmbed('…')], components: [] });
          const { guildId, db, tm, config } = pending;
          // Get original content from interaction message text (remove FAQ prefix)
          await openTicketForGuild(interaction.user, '', [], { guildId, db, tm, config }, client, null);
          return;
        }

        // ── Sujet (DM) ──
        if (interaction.customId.startsWith('subject_')) {
          const subject = interaction.customId.slice('subject_'.length);
          const { pendingSubject, openTicketForGuild } = require('./messageCreate');
          const pending = pendingSubject.get(interaction.user.id);
          if (!pending) {
            return interaction.reply({ embeds: [sessionExpiredEmbed()], ephemeral: true });
          }
          await interaction.update({ embeds: [ticketCreatingEmbed(null)], components: [] });
          pendingSubject.delete(interaction.user.id);
          const { content, attachments, guildId, db, tm, config } = pending;
          // Note: openTicketForGuild handles intake form check before creating
          await openTicketForGuild(interaction.user, content, attachments, { guildId, db, tm, config }, client, subject);
          return;
        }

        // ── Sélection de serveur — bouton legacy (compat sessions en cours) ──
        if (interaction.customId.startsWith('guildselect_')) {
          const guildId = interaction.customId.slice('guildselect_'.length);
          const { pendingGuildSelect, openTicketForGuild } = require('./messageCreate');
          const pending = pendingGuildSelect.get(interaction.user.id);
          if (!pending) {
            return interaction.reply({ embeds: [sessionExpiredEmbed()], ephemeral: true });
          }
          const guildEntry = pending.guilds.find(g => g.guildId === guildId);
          if (!guildEntry) {
            return interaction.reply({ content: 'Serveur invalide.', ephemeral: true });
          }
          pendingGuildSelect.delete(interaction.user.id);
          await interaction.update({ embeds: [ticketCreatingEmbed(guildEntry.discordGuild?.name)], components: [] });
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
            return interaction.update({ embeds: [alreadyRatedEmbed()], components: [] });
          }
          const closedById = ticket.claimed_by;
          const closedByUser = await client.users.fetch(closedById).catch(() => null);
          const closedByTag = closedByUser?.username || ticket.closed_by_tag || closedById;
          const tm = createManager(db, client, guildId);
          await tm.saveRating(ticketId, interaction.user.id, closedById, rating, closedByTag);
          return interaction.update({ embeds: [ratingConfirmEmbed(rating)], components: [] });
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

        // ── Bouton panel (guild) ──
        if (interaction.customId.startsWith('panel_btn_') && interaction.guild) {
          const btnId = parseInt(interaction.customId.slice('panel_btn_'.length));
          const db = getTenantDb(interaction.guildId);
          const [btn] = await db('SELECT * FROM panel_buttons WHERE id = ?', [btnId]).catch(() => [null]);
          if (!btn) return interaction.reply({ content: 'Bouton invalide ou expiré.', ephemeral: true });

          if (btn.form_id) {
            const fields = await db(
              'SELECT * FROM intake_form_fields WHERE form_id = ? ORDER BY position ASC LIMIT 5',
              [btn.form_id]
            ).catch(() => []);

            if (!fields.length) {
              const { openTicketFromPanel } = require('./panelTicket');
              await interaction.deferReply({ ephemeral: true });
              await openTicketFromPanel(interaction, client, db, btn, '');
              return;
            }

            const modal = new ModalBuilder()
              .setCustomId(`panel_form_${btnId}`)
              .setTitle(btn.label.slice(0, 45));

            for (const f of fields) {
              const input = new TextInputBuilder()
                .setCustomId(`field_${f.id}`)
                .setLabel(f.label.slice(0, 45))
                .setStyle(f.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(!!f.required);
              if (f.placeholder) input.setPlaceholder(f.placeholder.slice(0, 100));
              if (f.min_length)   input.setMinLength(f.min_length);
              if (f.max_length)   input.setMaxLength(f.max_length);
              modal.addComponents(new ActionRowBuilder().addComponents(input));
            }

            return interaction.showModal(modal);
          }

          // Pas de formulaire — ouvre le ticket directement
          await interaction.deferReply({ ephemeral: true });
          const { openTicketFromPanel } = require('./panelTicket');
          await openTicketFromPanel(interaction, client, db, btn, '');
          return;
        }
      }

      // ── Sélection de serveur via menu déroulant (DM) ──
      if (interaction.isStringSelectMenu() && interaction.customId === 'guild_select') {
        const guildId = interaction.values[0];
        const { pendingGuildSelect, openTicketForGuild } = require('./messageCreate');
        const pending = pendingGuildSelect.get(interaction.user.id);
        if (!pending) {
          return interaction.update({ embeds: [sessionExpiredEmbed()], components: [] });
        }
        pendingGuildSelect.delete(interaction.user.id);

        if (pending.mode === 'relay') {
          const entry = pending.guilds.find(g => g.guildId === guildId);
          if (!entry) return interaction.update({ content: 'Serveur invalide.', components: [] });
          await interaction.update({ embeds: [relayConfirmEmbed(entry.guildName)], components: [] });
          await entry.tm.relayDmToTicket(interaction.user, pending.content, pending.attachments);
          return;
        }

        // Ouverture d'un nouveau ticket sur le serveur choisi
        const guildEntry = pending.guilds.find(g => g.guildId === guildId);
        if (!guildEntry) return interaction.update({ content: 'Serveur invalide.', components: [] });
        await interaction.update({ embeds: [ticketCreatingEmbed(guildEntry.discordGuild?.name)], components: [] });
        await openTicketForGuild(interaction.user, pending.content, pending.attachments, guildEntry, client, null);
        return;
      }

      // ── Soumission de formulaire panel (modal) ──
      if (interaction.isModalSubmit() && interaction.customId.startsWith('panel_form_')) {
        const btnId = parseInt(interaction.customId.slice('panel_form_'.length));
        const db = getTenantDb(interaction.guildId);
        const [btn] = await db('SELECT * FROM panel_buttons WHERE id = ?', [btnId]).catch(() => [null]);
        if (!btn) return interaction.reply({ content: 'Bouton invalide.', ephemeral: true });

        const fields = await db(
          'SELECT * FROM intake_form_fields WHERE form_id = ? ORDER BY position ASC LIMIT 5',
          [btn.form_id]
        ).catch(() => []);

        const lines = fields.map(f => {
          const val = interaction.fields.getTextInputValue(`field_${f.id}`).trim() || '—';
          return `**${f.label}** : ${val}`;
        });
        const formContent = lines.join('\n');

        await interaction.deferReply({ ephemeral: true });
        const { openTicketFromPanel } = require('./panelTicket');
        await openTicketFromPanel(interaction, client, db, btn, formContent);
        return;
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

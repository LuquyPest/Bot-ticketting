const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { getActiveGuilds, isGuildOperational } = require('../utils/guildScan');
const { ensureSupport } = require('../utils/permissions');
const { hostTranscript, buildUrl } = require('../utils/transcriptServer');
const { closeConfirmationButtons, oldTicketsPaginationButtons } = require('../utils/components');
const { closeConfirmationEmbed, buildOldTicketsPageEmbed } = require('../utils/embeds');
const {
  sessionExpiredEmbed, relayedToTicketEmbed, subjectAskEmbed, choiceEmbed,
  ticketCreatingEmbed, ratingConfirmEmbed, alreadyRatedEmbed,
} = require('../utils/dmEmbeds');

async function findGuildForClosedTicket(ticketId, ownerId, guildId) {
  const guilds = await getActiveGuilds();
  for (const { guild_id } of guilds) {
    if (guildId && guild_id !== guildId) continue; // legacy buttons carry no guildId
    try {
      const db = getTenantDb(guild_id);
      const [ticket] = await db(
        'SELECT id, claimed_by, closed_by_id, closed_by_tag FROM tickets WHERE id = ? AND owner_id = ? AND status = "closed"',
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
      // Pending, suspended or maintenance guilds: the bot stays inert (commands, buttons, panels, modals)
      if (interaction.guildId && !(await isGuildOperational(interaction.guildId))) {
        if (interaction.isRepliable()) {
          await interaction.reply({ content: '❌ Le bot n\'est pas actif sur ce serveur (en attente, suspendu ou en maintenance).', ephemeral: true }).catch(() => null);
        }
        return;
      }
      if (interaction.isChatInputCommand() && !interaction.guildId) {
        return interaction.reply({ content: 'Cette commande s\'utilise uniquement sur un serveur.', ephemeral: true });
      }

      if (interaction.isButton()) {

        // ── Sujet (DM) ── configured subject, or « Autre sujet » to type it
        if (interaction.customId === 'subject_other') {
          const { switchToTextSubject } = require('./messageCreate');
          const state = switchToTextSubject(interaction.user, client);
          if (!state) return interaction.reply({ embeds: [sessionExpiredEmbed()], ephemeral: true });
          const guildName = client.guilds.cache.get(state.guildEntry.guildId)?.name;
          return interaction.update({ embeds: [subjectAskEmbed(guildName)], components: [] });
        }
        if (interaction.customId.startsWith('subject_')) {
          const { pendingSubject, openTicketForGuild } = require('./messageCreate');
          const pending = pendingSubject.get(interaction.user.id);
          const subject = pending?.subjects?.[parseInt(interaction.customId.slice('subject_'.length))];
          if (!pending || !subject) {
            return interaction.reply({ embeds: [sessionExpiredEmbed()], ephemeral: true });
          }
          pendingSubject.delete(interaction.user.id);
          await interaction.update({ embeds: [ticketCreatingEmbed(null)], components: [] });
          // openTicketForGuild handles the intake form before creating
          await openTicketForGuild(interaction.user, pending.content, pending.attachments, pending.guildEntry, client, subject);
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
          const found = await findGuildForClosedTicket(ticketId, interaction.user.id, parts[3]);
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
          // Credit the staff member who handled the ticket: the claimer, else whoever closed it
          const closedById = ticket.claimed_by || ticket.closed_by_id || null;
          const closedByUser = closedById ? await client.users.fetch(closedById).catch(() => null) : null;
          const closedByTag = closedByUser?.username || ticket.closed_by_tag || closedById;
          const tm = createManager(db, client, guildId);
          await tm.saveRating(ticketId, interaction.user.id, closedById, rating, closedByTag);
          return interaction.update({ embeds: [ratingConfirmEmbed(rating)], components: [] });
        }

        // ── Boutons en contexte serveur ──
        if (!interaction.guild) return;
        const db = getTenantDb(interaction.guildId);
        const tm = createManager(db, client, interaction.guildId);

        // ── Bouton panel (guild) ──
        // Public: any member can open a ticket from a panel, so this runs before ensureSupport.
        if (interaction.customId.startsWith('panel_btn_')) {
          const btnId = parseInt(interaction.customId.slice('panel_btn_'.length));
          const [btn] = await db('SELECT * FROM panel_buttons WHERE id = ?', [btnId]).catch(() => [null]);
          if (!btn) return interaction.reply({ content: 'Bouton invalide ou expiré.', ephemeral: true });

          // Modal: ticket subject (unless the button sets one) + the linked form's fields (5 inputs max)
          const fields = btn.form_id ? await db(
            'SELECT * FROM intake_form_fields WHERE form_id = ? ORDER BY position ASC LIMIT 5',
            [btn.form_id]
          ).catch(() => []) : [];
          const askSubject = !btn.subject && fields.length < 5;

          if (!askSubject && !fields.length) {
            const { openTicketFromPanel } = require('./panelTicket');
            await interaction.deferReply({ ephemeral: true });
            await openTicketFromPanel(interaction, client, db, btn, '', btn.subject || btn.label);
            return;
          }

          const modal = new ModalBuilder()
            .setCustomId(`panel_form_${btnId}`)
            .setTitle(btn.label.slice(0, 45));
          if (askSubject) {
            modal.addComponents(new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('ticket_subject')
                .setLabel('Sujet du ticket')
                .setPlaceholder('En quelques mots — sert de titre au ticket')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100)
            ));
          }
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

        if (!(await ensureSupport(interaction, client, db))) return;

        if (interaction.customId.startsWith('oldtickets_')) {
          const parts = interaction.customId.split('_');
          const action = parts[1];
          const userId = parts[2];
          const currentPage = Number(parts[3]) || 0;
          const tickets = await tm.getOldTicketsByUserId(userId, interaction.user.id);
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

      // ── Choix du ticket pour un message privé (DM) ── existing ticket or a new one
      if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_route') {
        const { pendingRoute, startNewTicket } = require('./messageCreate');
        const pending = pendingRoute.get(interaction.user.id);
        if (!pending) return interaction.update({ embeds: [sessionExpiredEmbed()], components: [] });
        pendingRoute.delete(interaction.user.id);
        const value = interaction.values[0];

        if (value === 'new') {
          await interaction.update({ embeds: [choiceEmbed('➕ Nouveau ticket')], components: [] });
          await startNewTicket(interaction.user, pending.content, pending.attachments, client);
          return;
        }
        const [, guildId, ticketId] = value.split(':');
        const entry = pending.tickets.find(t => t.guildId === guildId && String(t.ticket.id) === ticketId);
        if (!entry) return interaction.update({ content: 'Ticket invalide.', embeds: [], components: [] });
        // Still open and still linked to this member?
        const [fresh] = await entry.db(
          `SELECT * FROM tickets WHERE id = ? AND status = 'open' AND (owner_id = ? OR id IN (SELECT ticket_id FROM ticket_participants WHERE user_id = ?))`,
          [entry.ticket.id, interaction.user.id, interaction.user.id]
        );
        if (!fresh) return interaction.update({ content: 'Ce ticket n\'est plus ouvert. Renvoie ton message pour choisir un autre ticket.', embeds: [], components: [] });
        const relayed = await entry.tm.relayToTicket(fresh, interaction.user, pending.content, pending.attachments);
        if (!relayed) return interaction.update({ content: 'Impossible de joindre le salon de ce ticket. Réessaie plus tard.', embeds: [], components: [] });
        await interaction.update({ embeds: [relayedToTicketEmbed(entry.guildName, fresh)], components: [] });
        return;
      }

      // ── Sélection de serveur pour un nouveau ticket (DM) ──
      if (interaction.isStringSelectMenu() && interaction.customId === 'guild_select') {
        const guildId = interaction.values[0];
        const { pendingGuildSelect, openTicketForGuild } = require('./messageCreate');
        const pending = pendingGuildSelect.get(interaction.user.id);
        if (!pending) {
          return interaction.update({ embeds: [sessionExpiredEmbed()], components: [] });
        }
        pendingGuildSelect.delete(interaction.user.id);
        const guildEntry = pending.guilds.find(g => g.guildId === guildId);
        if (!guildEntry) return interaction.update({ content: 'Serveur invalide.', components: [] });
        await interaction.update({ embeds: [choiceEmbed(`Serveur choisi : **${guildEntry.discordGuild?.name || guildId}**`)], components: [] });
        await openTicketForGuild(interaction.user, pending.content, pending.attachments, guildEntry, client, null);
        return;
      }

      // ── Soumission de formulaire panel (modal) ──
      if (interaction.isModalSubmit() && interaction.customId.startsWith('panel_form_')) {
        const btnId = parseInt(interaction.customId.slice('panel_form_'.length));
        const db = getTenantDb(interaction.guildId);
        const [btn] = await db('SELECT * FROM panel_buttons WHERE id = ?', [btnId]).catch(() => [null]);
        if (!btn) return interaction.reply({ content: 'Bouton invalide.', ephemeral: true });

        const fields = btn.form_id ? await db(
          'SELECT * FROM intake_form_fields WHERE form_id = ? ORDER BY position ASC LIMIT 5',
          [btn.form_id]
        ).catch(() => []) : [];
        const valueOf = id => { try { return interaction.fields.getTextInputValue(id).trim(); } catch { return ''; } };

        const lines = fields.map(f => `**${f.label}** : ${valueOf(`field_${f.id}`) || '—'}`);
        const formContent = lines.join('\n');
        const subject = btn.subject || valueOf('ticket_subject') || btn.label;

        await interaction.deferReply({ ephemeral: true });
        const { openTicketFromPanel } = require('./panelTicket');
        await openTicketFromPanel(interaction, client, db, btn, formContent, subject);
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

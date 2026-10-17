const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { getActiveGuilds, isGuildOperational } = require('../utils/guildScan');
const { ensureSupport } = require('../utils/permissions');
const { takePending } = require('../utils/pendingStore');
const { t, inMemberLang, rememberLocale } = require('../utils/i18n');
const { hostTranscript, buildUrl } = require('../utils/transcriptServer');
const { closeConfirmationButtons, oldTicketsPaginationButtons } = require('../utils/components');
const { closeConfirmationEmbed, buildOldTicketsPageEmbed } = require('../utils/embeds');
const {
  sessionExpiredEmbed, relayedToTicketEmbed, subjectAskEmbed, choiceEmbed,
  ticketCreatingEmbed, ratingConfirmEmbed, ratingCommentEmbed, memberCloseConfirmEmbed, alreadyRatedEmbed,
  blacklistedEmbed, serverLimitEmbed,
} = require('../utils/dmEmbeds');
const { ratingCommentButton, memberCloseConfirmButtons } = require('../utils/components');

// Open ticket owned by the member on an active guild (member close button).
async function findOpenOwnedTicket(ticketId, ownerId, guildId) {
  if (!ticketId || !guildId || !(await isGuildOperational(guildId))) return null;
  const db = getTenantDb(guildId);
  const [ticket] = await db("SELECT id, channel_id, subject FROM tickets WHERE id = ? AND owner_id = ? AND status = 'open'", [ticketId, ownerId]).catch(() => []);
  return ticket ? { db, ticket } : null;
}

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

// Server referenced by a member button (…_<ticketId>_<guildId>), when there is one.
function guildFromCustomId(customId) {
  const m = /_(\d{17,20})$/.exec(customId || '');
  return m ? m[1] : null;
}

module.exports = {
  name: Events.InteractionCreate,
  // Member-facing replies use the member's language (utils/i18n.js); their Discord language is
  // remembered for later DMs, which carry no locale.
  async execute(client, interaction) {
    if (interaction.locale) rememberLocale(interaction.user?.id, interaction.locale).catch(() => {});
    const guildId = interaction.guildId || guildFromCustomId(interaction.customId);
    return inMemberLang(interaction.user?.id, guildId, client, () => handleInteraction(client, interaction));
  },
};

async function handleInteraction(client, interaction) {
    try {
      // Slash command option suggestions (/template, /merge)
      if (interaction.isAutocomplete?.()) {
        if (!interaction.guildId || !(await isGuildOperational(interaction.guildId))) return interaction.respond([]).catch(() => {});
        const command = client.commands?.get(interaction.commandName);
        if (!command?.autocomplete) return interaction.respond([]).catch(() => {});
        return command.autocomplete(client, interaction).catch(() => interaction.respond([]).catch(() => {}));
      }

      // Pending, suspended or maintenance guilds: the bot stays inert (commands, buttons, panels, modals)
      if (interaction.guildId && !(await isGuildOperational(interaction.guildId))) {
        if (interaction.isRepliable()) {
          await interaction.reply({ content: '❌ Le bot n\'est pas actif sur ce serveur (en attente, suspendu ou en maintenance).', flags: MessageFlags.Ephemeral }).catch(() => null);
        }
        return;
      }
      if (interaction.isChatInputCommand() && !interaction.guildId && !client.commands?.get(interaction.commandName)?.dm) {
        return interaction.reply({ content: 'Cette commande s\'utilise uniquement sur un serveur.', flags: MessageFlags.Ephemeral });
      }

      if (interaction.isButton()) {

        // ── Sujet (DM) ── configured subject, or « Autre sujet » to type it
        if (interaction.customId === 'subject_other') {
          const { switchToTextSubject } = require('./messageCreate');
          const state = await switchToTextSubject(interaction.user);
          if (!state) return interaction.reply({ embeds: [sessionExpiredEmbed()], flags: MessageFlags.Ephemeral });
          const guildName = client.guilds.cache.get(state.guildId)?.name;
          return interaction.update({ embeds: [subjectAskEmbed(guildName)], components: [] });
        }
        if (interaction.customId.startsWith('subject_')) {
          const { openTicketInGuild } = require('./messageCreate');
          const pending = await takePending('subject', interaction.user.id);
          const subject = pending?.subjects?.[parseInt(interaction.customId.slice('subject_'.length))];
          if (!pending || !subject) {
            return interaction.reply({ embeds: [sessionExpiredEmbed()], flags: MessageFlags.Ephemeral });
          }
          await interaction.update({ embeds: [ticketCreatingEmbed(null)], components: [] });
          // openTicketForGuild handles the intake form before creating
          await openTicketInGuild(interaction.user, pending.content, pending.attachments, pending.guildId, client, subject);
          return;
        }

        // ── FAQ automatique (DM) ── solved, or open the ticket anyway
        if (interaction.customId === 'faq_continue' || interaction.customId.startsWith('faq_solved_')) {
          const faq = await takePending('faq', interaction.user.id);
          if (!faq) return interaction.update({ embeds: [sessionExpiredEmbed()], components: [] });
          if (interaction.customId === 'faq_continue') {
            await interaction.update({ embeds: [interaction.message?.embeds?.[0], choiceEmbed(t('faq.opening'))].filter(Boolean), components: [] });
            const { openTicketInGuild } = require('./messageCreate');
            await openTicketInGuild(interaction.user, faq.content, faq.attachments, faq.guildId, client, null, { skipFaq: true });
            return;
          }
          const entryId = parseInt(interaction.customId.slice('faq_solved_'.length));
          if (faq.entryIds.includes(entryId) && await isGuildOperational(faq.guildId)) {
            const db = getTenantDb(faq.guildId);
            await db('UPDATE faq_entries SET solved_count = solved_count + 1 WHERE id = ?', [entryId]).catch(() => null);
            const { recordEvent } = require('../utils/audit');
            await recordEvent(db, { actor: interaction.user, action: 'faq_solved', targetType: 'faq', targetId: entryId });
          }
          return interaction.update({ embeds: [interaction.message?.embeds?.[0], choiceEmbed(t('faq.great'))].filter(Boolean), components: [] });
        }

        // ── Notation (DM) ──
        if (interaction.customId.startsWith('rating_')) {
          const parts = interaction.customId.split('_');
          const rating = parseInt(parts[1]);
          const ticketId = parseInt(parts[2]);
          if (isNaN(rating) || rating < 1 || rating > 5 || isNaN(ticketId)) {
            return interaction.reply({ content: t('invalidInteraction'), flags: MessageFlags.Ephemeral });
          }
          const found = await findGuildForClosedTicket(ticketId, interaction.user.id, parts[3]);
          if (!found) {
            return interaction.reply({ content: t('rating.cannot'), flags: MessageFlags.Ephemeral });
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
          return interaction.update({ embeds: [ratingConfirmEmbed(rating)], components: [ratingCommentButton(ticketId, guildId)] });
        }

        // ── Commentaire de satisfaction (DM) ── button → modal
        if (interaction.customId.startsWith('ratecomment_')) {
          const [, ticketId, guildId] = interaction.customId.split('_');
          const modal = new ModalBuilder()
            .setCustomId(`ratecomment_modal_${ticketId}_${guildId}`)
            .setTitle(t('rating.modalTitle'))
            .addComponents(new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('comment').setLabel(t('rating.modalLabel')).setStyle(TextInputStyle.Paragraph)
                .setRequired(true).setMinLength(2).setMaxLength(1000).setPlaceholder(t('rating.modalPlaceholder'))
            ));
          return interaction.showModal(modal);
        }

        // ── Rouvrir mon ticket (DM, propriétaire, quelques jours après la fermeture) ──
        if (interaction.customId.startsWith('memberreopen_')) {
          const [, ticketId, guildId] = interaction.customId.split('_');
          const expired = () => interaction.update({ embeds: [choiceEmbed(t('reopen.expired'))], components: [] });
          if (!(await isGuildOperational(guildId))) return expired();
          const db = getTenantDb(guildId);
          const [cfg] = await db('SELECT member_reopen_days FROM guild_config WHERE id = 1');
          const days = Number(cfg?.member_reopen_days ?? 7);
          const [ticket] = days > 0 ? await db(
            `SELECT * FROM tickets WHERE id = ? AND owner_id = ? AND status = 'closed' AND merged_into IS NULL
             AND closed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [parseInt(ticketId), interaction.user.id, days]) : [];
          if (!ticket) return expired();
          const { isBlacklistedIn } = require('../utils/guildScan');
          if (await isBlacklistedIn(db, interaction.user.id)) return interaction.update({ embeds: [blacklistedEmbed()], components: [] });
          // The server's open-ticket limit applies to reopened tickets too
          const [lim] = await require('../utils/globalDb').globalQuery('SELECT max_tickets FROM guilds WHERE guild_id = ?', [guildId]);
          if (lim?.max_tickets > 0) {
            const [{ n }] = await db("SELECT COUNT(*) AS n FROM tickets WHERE status = 'open'");
            if (Number(n) >= lim.max_tickets) return interaction.update({ embeds: [serverLimitEmbed()], components: [] });
          }
          await interaction.update({ embeds: [choiceEmbed(t('reopen.done', { id: ticket.id }))], components: [] });
          const tm = createManager(db, client, guildId);
          const member = { id: interaction.user.id, tag: interaction.user.username, username: interaction.user.username, source: 'discord', member: true, reason: 'Rouvert par le membre' };
          await tm.reopenTicket(ticket, member);
          await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, '🔄 Ticket rouvert par le membre.', 'system')",
            [ticket.id, interaction.user.id, interaction.user.username]).catch(() => null);
          const { broadcast } = require('../utils/sse');
          broadcast('ticket', { id: ticket.id, status: 'open' }, guildId);
          return;
        }

        // ── Mes tickets (DM) ──
        if (interaction.customId === 'my_tickets') {
          const { myTicketsEmbed } = require('../utils/memberTickets');
          return interaction.reply({ embeds: [await myTicketsEmbed(interaction.user, client)], flags: MessageFlags.Ephemeral });
        }

        // ── Fermer mon ticket (DM, propriétaire du ticket) ──
        if (interaction.customId === 'memberclose_cancel') {
          return interaction.update({ embeds: [choiceEmbed(t('close.cancelled'))], components: [] });
        }
        if (interaction.customId.startsWith('memberclose_')) {
          const confirm = interaction.customId.startsWith('memberclose_confirm_');
          const [ticketId, guildId] = interaction.customId.split('_').slice(confirm ? 2 : 1);
          const found = await findOpenOwnedTicket(parseInt(ticketId), interaction.user.id, guildId);
          if (!found) {
            const payload = { content: t('close.already'), embeds: [], components: [] };
            return confirm ? interaction.update(payload) : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
          }
          if (!confirm) {
            return interaction.reply({ embeds: [memberCloseConfirmEmbed(found.ticket)], components: [memberCloseConfirmButtons(found.ticket.id, guildId)], flags: MessageFlags.Ephemeral });
          }
          const channel = await client.channels.fetch(found.ticket.channel_id).catch(() => null);
          if (!channel) return interaction.update({ content: t('close.unavailable'), embeds: [], components: [] });
          await interaction.update({ embeds: [choiceEmbed(t('close.closing', { id: found.ticket.id }))], components: [] });
          const tm = createManager(found.db, client, guildId);
          await tm.closeTicketWithTranscript(channel, {
            id: interaction.user.id, tag: interaction.user.username, username: interaction.user.username,
            source: 'discord', member: true, reason: 'Fermé par le membre',
          });
          return;
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
          if (!btn) return interaction.reply({ content: t('invalidButton'), flags: MessageFlags.Ephemeral });

          // Modal: ticket subject (unless the button sets one) + the linked form's fields (5 inputs max)
          const fields = btn.form_id ? await db(
            'SELECT * FROM intake_form_fields WHERE form_id = ? ORDER BY position ASC LIMIT 5',
            [btn.form_id]
          ).catch(() => []) : [];
          const askSubject = !btn.subject && fields.length < 5;

          if (!askSubject && !fields.length) {
            const { openTicketFromPanel } = require('../utils/panelTicket');
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
                .setLabel(t('panel.subject'))
                .setPlaceholder(t('panel.subjectPlaceholder'))
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

        // Staff buttons: same grade permissions as the matching commands
        const buttonPermission = interaction.customId === 'ticket_transcript' ? 'view_transcripts'
          : interaction.customId.startsWith('ticket_close_with_transcript') ? 'close_ticket'
          : 'view_tickets';
        if (!(await ensureSupport(interaction, client, db, buttonPermission))) return;

        if (interaction.customId.startsWith('oldtickets_')) {
          const parts = interaction.customId.split('_');
          const action = parts[1];
          const userId = parts[2];
          const currentPage = Number(parts[3]) || 0;
          const tickets = await tm.getOldTicketsByUserId(userId, interaction.user.id);
          if (!tickets.length) {
            return interaction.reply({ content: 'Aucun ticket trouvé.', flags: MessageFlags.Ephemeral });
          }
          let newPage = currentPage;
          if (action === 'prev') newPage -= 1;
          if (action === 'next') newPage += 1;
          const { embed, totalPages, safePage } = buildOldTicketsPageEmbed(userId, tickets, newPage, 5);
          return interaction.update({ embeds: [embed], components: [oldTicketsPaginationButtons(userId, safePage, totalPages)] });
        }

        const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
        if (!ticket) {
          return interaction.reply({ content: 'Ce salon n est pas un ticket ouvert.', flags: MessageFlags.Ephemeral });
        }

        if (interaction.customId === 'ticket_transcript') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const saved = await tm.saveTranscriptSnapshot(interaction.channel, interaction.user);
          if (!saved) {
            return interaction.editReply({ content: 'Impossible de generer le transcript.' });
          }
          const token = hostTranscript(saved.html);
          const url = buildUrl(client.config.webServerBaseUrl, token);
          return interaction.editReply({ content: `Transcript enregistré (ID : ${saved.transcriptId})\nLien valable 10 minutes : ${url}` });
        }

        if (interaction.customId === 'ticket_close_with_transcript') {
          return interaction.reply({ embeds: [closeConfirmationEmbed()], components: [closeConfirmationButtons()], flags: MessageFlags.Ephemeral });
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
        const { startNewTicket } = require('./messageCreate');
        const pending = await takePending('route', interaction.user.id);
        if (!pending) return interaction.update({ embeds: [sessionExpiredEmbed()], components: [] });
        const value = interaction.values[0];

        if (value === 'new') {
          await interaction.update({ embeds: [choiceEmbed(t('newTicketChosen'))], components: [] });
          await startNewTicket(interaction.user, pending.content, pending.attachments, client);
          return;
        }
        const [, guildId, ticketId] = value.split(':');
        const entry = pending.tickets.find(t => t.guildId === guildId && String(t.ticketId) === ticketId);
        if (!entry || !(await isGuildOperational(guildId))) return interaction.update({ content: t('ticketInvalid'), embeds: [], components: [] });
        const routeDb = getTenantDb(guildId);
        // Still open and still linked to this member?
        const [fresh] = await routeDb(
          `SELECT * FROM tickets WHERE id = ? AND status = 'open' AND (owner_id = ? OR id IN (SELECT ticket_id FROM ticket_participants WHERE user_id = ?))`,
          [entry.ticketId, interaction.user.id, interaction.user.id]
        );
        if (!fresh) return interaction.update({ content: t('ticketNotOpen'), embeds: [], components: [] });
        const relayed = await createManager(routeDb, client, guildId).relayToTicket(fresh, interaction.user, pending.content, pending.attachments);
        if (!relayed) return interaction.update({ content: t('ticketUnreachable'), embeds: [], components: [] });
        const guildName = client.guilds.cache.get(guildId)?.name || guildId;
        await interaction.update({ embeds: [relayedToTicketEmbed(guildName, fresh)], components: [] });
        return;
      }

      // ── Sélection de serveur pour un nouveau ticket (DM) ──
      if (interaction.isStringSelectMenu() && interaction.customId === 'guild_select') {
        const guildId = interaction.values[0];
        const { openTicketInGuild } = require('./messageCreate');
        const pending = await takePending('guildSelect', interaction.user.id);
        if (!pending) {
          return interaction.update({ embeds: [sessionExpiredEmbed()], components: [] });
        }
        const choice = pending.guilds.find(g => g.guildId === guildId);
        if (!choice) return interaction.update({ content: t('serverInvalid'), components: [] });
        await interaction.update({ embeds: [choiceEmbed(t('serverChosen', { guild: choice.name || guildId }))], components: [] });
        await openTicketInGuild(interaction.user, pending.content, pending.attachments, guildId, client, null);
        return;
      }

      // ── Soumission de formulaire panel (modal) ──
      if (interaction.isModalSubmit() && interaction.customId.startsWith('ratecomment_modal_')) {
        const [ticketId, guildId] = interaction.customId.split('_').slice(2);
        const found = await findGuildForClosedTicket(parseInt(ticketId), interaction.user.id, guildId);
        const comment = interaction.fields.getTextInputValue('comment').trim().slice(0, 1000);
        if (!found || !comment) return interaction.reply({ content: t('rating.commentError'), flags: MessageFlags.Ephemeral });
        const [rating] = await found.db('SELECT rating FROM ticket_ratings WHERE ticket_id = ? AND owner_id = ?', [found.ticket.id, interaction.user.id]);
        const saved = rating && await createManager(found.db, client, found.guildId).saveRatingComment(found.ticket.id, interaction.user.id, comment);
        if (!saved) return interaction.reply({ content: t('rating.commentSaved'), flags: MessageFlags.Ephemeral });
        return interaction.update({ embeds: [ratingCommentEmbed(rating.rating, comment)], components: [] });
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('panel_form_')) {
        const btnId = parseInt(interaction.customId.slice('panel_form_'.length));
        const db = getTenantDb(interaction.guildId);
        const [btn] = await db('SELECT * FROM panel_buttons WHERE id = ?', [btnId]).catch(() => [null]);
        if (!btn) return interaction.reply({ content: t('invalidButton'), flags: MessageFlags.Ephemeral });

        const fields = btn.form_id ? await db(
          'SELECT * FROM intake_form_fields WHERE form_id = ? ORDER BY position ASC LIMIT 5',
          [btn.form_id]
        ).catch(() => []) : [];
        const valueOf = id => { try { return interaction.fields.getTextInputValue(id).trim(); } catch { return ''; } };

        const lines = fields.map(f => `**${f.label}** : ${valueOf(`field_${f.id}`) || '—'}`);
        const formContent = lines.join('\n');
        const subject = btn.subject || valueOf('ticket_subject') || btn.label;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { openTicketFromPanel } = require('../utils/panelTicket');
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
        await interaction.followUp({ content: t('error'), flags: MessageFlags.Ephemeral }).catch(() => null);
      } else {
        await interaction.reply({ content: t('error'), flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    }
}

const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { findAllOpenTickets, isBlacklistedIn, isGuildOperational, findGuildsForUser } = require('../utils/guildScan');
const { allowBurst, firstOverflow } = require('../utils/rateLimit');
const { parseJsonField } = require('../utils/jsonField');
const { fetchGuildChannel } = require('../utils/discordGuard');
const { subjectButtons } = require('../utils/components');
const { broadcast } = require('../utils/sse');
const { globalQuery } = require('../utils/globalDb');
const {
  emptyMessageEmbed, blacklistedEmbed, notInGuildEmbed,
  serverLimitEmbed, dailyLimitEmbed, serverSelectEmbed,
  subjectSelectEmbed, subjectAskEmbed, ticketRouteEmbed,
  intakeFormStartEmbed, intakeFormStepEmbed,
} = require('../utils/dmEmbeds');

// DM conversation states, per user. Flow for a new ticket:
//   first message → (server choice) → subject (buttons or free text) → (intake form) → ticket created
// userId → { user, content, attachments, guildEntry, subjects }        subject buttons
const pendingSubject = new Map();
// userId → { user, content, attachments, guildEntry }                  free-text subject
const pendingSubjectText = new Map();
// userId → { content, attachments, guilds: [{guildId, discordGuild, db, tm, config}] }   server for a new ticket
const pendingGuildSelect = new Map();
// userId → { content, attachments, tickets: [{ ticket, guildId, guildName, tm }] }       which ticket to write in
const pendingRoute = new Map();
// userId → { content, attachments, guildEntry, subject, questions: [], step: 0, answers: [] }
const pendingIntakeForm = new Map();

const PENDING_TTL_MS = 10 * 60 * 1000;

// Stores a pending state that expires after `ttlMs` — without a later state being wiped by an older timer.
// onExpire runs only if the state was never consumed.
function setPending(map, userId, state, ttlMs = PENDING_TTL_MS, onExpire = null) {
  map.set(userId, state);
  setTimeout(() => {
    if (map.get(userId) !== state) return;
    map.delete(userId);
    if (onExpire) onExpire().catch(err => console.error('pending expiry:', err.message));
  }, ttlMs);
}

// DM flood protection: each DM scans every active guild, so cap it per user.
const DM_MAX = 8;
const DM_WINDOW_MS = 30 * 1000;

// Starts intake form questioning sequence, returns true if form was triggered
async function checkIntakeForm(user, content, attachments, guildEntry, client, subject) {
  const { db, config } = guildEntry;
  if (!config.intake_form_enabled) return false;

  let forms;
  try {
    forms = await db(
      'SELECT * FROM intake_forms WHERE active = 1 AND (subject = ? OR subject IS NULL) ORDER BY subject IS NULL ASC LIMIT 1',
      [subject || null]
    );
  } catch { return false; }
  if (!forms.length) return false;

  const form = forms[0];
  let questions;
  try {
    questions = await db(
      'SELECT * FROM intake_form_fields WHERE form_id = ? ORDER BY position ASC',
      [form.id]
    );
  } catch { return false; }
  if (!questions.length) return false;

  setPending(pendingIntakeForm, user.id, {
    content, attachments, guildEntry, subject,
    questions, step: 0, answers: []
  }, 15 * 60 * 1000);

  await user.send({ embeds: [intakeFormStartEmbed(questions[0].label, 1, questions.length)] }).catch(() => null);
  return true;
}

// Opens a new ticket on a guild. subject: null = not asked yet (the member is asked),
// '' = asked but none given (ticket opened without subject), otherwise the subject.
async function openTicketForGuild(user, content, attachments, guildEntry, client, subject = null) {
  const { guildId, db, tm, config } = guildEntry;

  // Every entry point (DM, subject/guild buttons, timeouts) ends here, so the per-guild checks live here
  if (!(await isGuildOperational(guildId))) {
    await user.send({ embeds: [notInGuildEmbed()] }).catch(() => null);
    return;
  }
  if (await isBlacklistedIn(db, user.id)) {
    await user.send({ embeds: [blacklistedEmbed()] }).catch(() => null);
    return;
  }

  // Check guild-wide concurrent ticket limit set by superadmin
  const [guildLimits] = await globalQuery('SELECT max_tickets FROM guilds WHERE guild_id = ?', [guildId]).catch(() => [{}]);
  if (guildLimits?.max_tickets > 0) {
    const [{ openCount }] = await db('SELECT COUNT(*) as openCount FROM tickets WHERE status = "open"').catch(() => [{ openCount: 0 }]);
    if (openCount >= guildLimits.max_tickets) {
      await user.send({ embeds: [serverLimitEmbed()] }).catch(() => null);
      return;
    }
  }

  const maxPerDay = config.max_tickets_per_day ?? 3;
  const dailyCount = await tm.getDailyTicketCount(user.id);
  if (dailyCount >= maxPerDay) {
    await user.send({ embeds: [dailyLimitEmbed(maxPerDay)] }).catch(() => null);
    if (config.spam_alert_channel_id) {
      const alertCh = await fetchGuildChannel(client, guildId, config.spam_alert_channel_id);
      if (alertCh?.isTextBased()) {
        await alertCh.send(
          `⚠️ **Anti-spam** : \`${user.username}\` (${user.id}) a tenté d'ouvrir un ${dailyCount + 1}e ticket (limite : ${maxPerDay}).`
        ).catch(() => null);
      }
    }
    return;
  }

  // Ask the subject after the first message; if nobody answers, open the ticket without subject
  if (subject === null) {
    const guildName = client.guilds.cache.get(guildId)?.name;
    const entry = { guildId, db, tm, config };
    const openWithoutSubject = () => openTicketForGuild(user, content, attachments, entry, client, '');
    const subjects = parseJsonField(config.ticket_subjects);
    if (subjects.length > 0) {
      setPending(pendingSubject, user.id, { user, content, attachments, guildEntry: entry, subjects }, PENDING_TTL_MS, openWithoutSubject);
      await user.send({ embeds: [subjectSelectEmbed(guildName)], components: subjectButtons(subjects) }).catch(() => null);
    } else {
      setPending(pendingSubjectText, user.id, { user, content, attachments, guildEntry: entry }, PENDING_TTL_MS, openWithoutSubject);
      await user.send({ embeds: [subjectAskEmbed(guildName)] }).catch(() => null);
    }
    return;
  }

  // Intake form check before creating the ticket
  const intakeHandled = await checkIntakeForm(user, content, attachments, { guildId, db, tm, config }, client, subject);
  if (intakeHandled) return;

  const result = await tm.createTicket(user, content, attachments, subject || null, { forceNew: true });
  await tm.sendWelcomeDm(user, result.created, subject || null, result.ticket?.id);
  if (result.created) {
    broadcast('new_ticket', { id: result.ticket.id, ownerTag: user.username, subject: result.ticket.subject }, guildId);
  }
}

// "Autre sujet" button: the member will type the subject. Returns the pending state, or null if expired.
function switchToTextSubject(user, client) {
  const state = pendingSubject.get(user.id);
  if (!state) return null;
  pendingSubject.delete(user.id);
  setPending(pendingSubjectText, user.id, state, PENDING_TTL_MS,
    () => openTicketForGuild(user, state.content, state.attachments, state.guildEntry, client, ''));
  return state;
}

// New ticket: pick the server (or ask which one), then openTicketForGuild asks the subject.
async function startNewTicket(user, content, attachments, client) {
  const memberGuilds = await findGuildsForUser(user.id, client);
  const candidateGuilds = [];
  for (const g of memberGuilds) if (!(await isBlacklistedIn(g.db, user.id).catch(() => false))) candidateGuilds.push(g);

  if (candidateGuilds.length === 0) {
    await user.send({ embeds: [memberGuilds.length ? blacklistedEmbed() : notInGuildEmbed()] }).catch(() => null);
    return;
  }
  if (candidateGuilds.length === 1) {
    await openTicketForGuild(user, content, attachments, candidateGuilds[0], client, null);
    return;
  }
  setPending(pendingGuildSelect, user.id, { content, attachments, guilds: candidateGuilds });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('guild_select')
    .setPlaceholder('Choisir un serveur…')
    .addOptions(candidateGuilds.slice(0, 25).map(g =>
      new StringSelectMenuOptionBuilder()
        .setLabel(g.discordGuild.name.slice(0, 100))
        .setValue(g.guildId)
        .setDescription('Ouvrir un ticket sur ce serveur')
    ));
  await user.send({ embeds: [serverSelectEmbed()], components: [new ActionRowBuilder().addComponents(menu)] }).catch(() => null);
}

// Menu: one option per open ticket (server · #id — subject) + "new ticket".
function buildTicketRouteMenu(tickets, userId) {
  const options = tickets.slice(0, 24).map(t =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`#${t.ticket.id} — ${t.ticket.subject || 'Sans sujet'}`.slice(0, 100))
      .setValue(`t:${t.guildId}:${t.ticket.id}`)
      .setDescription(`${t.guildName}${t.ticket.owner_id === userId ? '' : ' · tu es participant'}`.slice(0, 100))
      .setEmoji('🎫')
  );
  options.push(new StringSelectMenuOptionBuilder().setLabel('Ouvrir un nouveau ticket').setValue('new').setEmoji('➕'));
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_route')
    .setPlaceholder('Choisir le ticket…')
    .addOptions(options);
  return new ActionRowBuilder().addComponents(menu);
}

module.exports = {
  name: 'raw',

  async execute(client, packet) {
    try {
      if (packet.t !== 'MESSAGE_CREATE') return;
      const data = packet.d;
      if (data.author?.bot) return;

      // ── Message dans un salon de ticket (staff → note web) ──
      if (data.guild_id) {
        // Skip pending/suspended guilds (no tenant DB, or must stay inert)
        if (!(await isGuildOperational(data.guild_id))) return;
        const db = getTenantDb(data.guild_id);
        const tm = createManager(db, client, data.guild_id);
        const ticket = await tm.getOpenTicketByChannelId(data.channel_id);
        if (!ticket) return;

        const content = data.content?.trim() || '';
        const attachments = Array.isArray(data.attachments) && data.attachments.length > 0
          ? data.attachments.map(a => a.url).join('\n')
          : '';
        const noteContent = [content, attachments].filter(Boolean).join('\n');
        if (!noteContent) return;

        const authorTag = data.member?.nick || data.author.username;
        const nr = await db(
          'INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, "discord")',
          [ticket.id, data.author.id, authorTag, noteContent]
        );
        broadcast('note', {
          ticketId: ticket.id,
          note: {
            id: nr.insertId,
            ticket_id: ticket.id,
            author_id: data.author.id,
            author_tag: authorTag,
            content: noteContent,
            source: 'discord',
            created_at: new Date()
          }
        }, data.guild_id);
        return;
      }

      // ── Message privé ──
      const user = await client.users.fetch(data.author.id).catch(() => null);
      if (!user) return;

      const content = data.content?.trim() || '';
      const attachments = Array.isArray(data.attachments)
        ? data.attachments.map(a => ({ url: a.url, name: a.filename }))
        : [];

      if (!content && attachments.length === 0) {
        await user.send({ embeds: [emptyMessageEmbed()] }).catch(() => null);
        return;
      }

      if (!allowBurst(`dm:${user.id}`, DM_MAX, DM_WINDOW_MS)) {
        if (firstOverflow(`dm:${user.id}`)) {
          await user.send('⏳ Tu envoies trop de messages à la suite — attends quelques secondes avant de réessayer.').catch(() => null);
        }
        return;
      }

      // Answer to "what is the subject of your ticket?"
      if (pendingSubjectText.has(user.id)) {
        const state = pendingSubjectText.get(user.id);
        if (!content) {
          await user.send('📝 Envoie le sujet de ton ticket en texte (quelques mots).').catch(() => null);
          return;
        }
        pendingSubjectText.delete(user.id);
        const subject = content.replace(/\s+/g, ' ').slice(0, 100);
        await openTicketForGuild(user, state.content, state.attachments, state.guildEntry, client, subject);
        return;
      }

      // Intake form — step-by-step question reply
      if (pendingIntakeForm.has(user.id)) {
        const state = pendingIntakeForm.get(user.id);
        state.answers.push(content);
        state.step += 1;

        if (state.step < state.questions.length) {
          await user.send({ embeds: [intakeFormStepEmbed(state.questions[state.step].label, state.step + 1, state.questions.length)] }).catch(() => null);
        } else {
          // All questions answered — build intake summary and open ticket
          pendingIntakeForm.delete(user.id);
          const summary = state.questions.map((q, i) => `**${q.label}** : ${state.answers[i] || '—'}`).join('\n');
          const enrichedContent = `${state.content || ''}\n\n📋 **Formulaire d'intake :**\n${summary}`.trim();
          await openTicketForGuild(user, enrichedContent, state.attachments, state.guildEntry, client, state.subject ?? '');
        }
        return;
      }

      // Open tickets of the member (owner or participant), except on servers where they are blacklisted
      const allOpen = await findAllOpenTickets(user.id, client);
      const openTickets = [];
      for (const t of allOpen) if (!(await isBlacklistedIn(t.db, user.id).catch(() => false))) openTickets.push(t);

      // At least one open ticket: ask, for every message, which ticket it goes to (or a new ticket)
      if (openTickets.length) {
        setPending(pendingRoute, user.id, { content, attachments, tickets: openTickets });
        await user.send({ embeds: [ticketRouteEmbed(openTickets.length)], components: [buildTicketRouteMenu(openTickets, user.id)] }).catch(() => null);
        return;
      }
      if (allOpen.length) {
        await user.send({ embeds: [blacklistedEmbed()] }).catch(() => null);
        return;
      }

      await startNewTicket(user, content, attachments, client);
    } catch (error) {
      console.error('Erreur RAW handler:', error);
    }
  },

  pendingSubject,
  pendingSubjectText,
  pendingGuildSelect,
  pendingRoute,
  pendingIntakeForm,
  openTicketForGuild,
  startNewTicket,
  switchToTextSubject,
};

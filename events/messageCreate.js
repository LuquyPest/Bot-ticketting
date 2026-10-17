const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { findAllOpenTickets, isBlacklistedIn, isGuildOperational, findGuildsForUser } = require('../utils/guildScan');
const { allowBurst, firstOverflow } = require('../utils/rateLimit');
const { parseJsonField } = require('../utils/jsonField');
const { fetchGuildChannel } = require('../utils/discordGuard');
const { subjectButtons, faqButtons } = require('../utils/components');
const { findFaqMatches } = require('../utils/faq');
const { applicableFields, parseFieldAnswer, saveFieldValues, fieldsForTicket } = require('../utils/ticketFields');
const { broadcast } = require('../utils/sse');
const { globalQuery } = require('../utils/globalDb');
const {
  emptyMessageEmbed, blacklistedEmbed, notInGuildEmbed,
  serverLimitEmbed, dailyLimitEmbed, serverSelectEmbed,
  subjectSelectEmbed, subjectAskEmbed, ticketRouteEmbed,
  intakeFormStartEmbed, intakeFormStepEmbed, faqSuggestEmbed, fieldQuestionEmbed,
} = require('../utils/dmEmbeds');

// DM conversation states, per user, kept in Redis (utils/pendingStore.js) so an answer sent
// while the bot restarts is not lost. Flow for a new ticket:
//   first message → (server choice) → subject (buttons or free text) → (intake form) → ticket created
// States hold plain data only; the guild entry is rebuilt from guildId when used.
//   subject      { guildId, content, attachments, subjects }         subject buttons
//   subjectText  { guildId, content, attachments }                   free-text subject
//   guildSelect  { content, attachments, guilds: [{ guildId, name }] } server for a new ticket
//   route        { content, attachments, tickets: [{ guildId, ticketId }] } which ticket to write in
//   intake       { guildId, content, attachments, subject, questions: [label], step, answers }
const store = require('../utils/pendingStore');
const { t, inMemberLang } = require('../utils/i18n');

const PENDING_TTL_MS = 10 * 60 * 1000;
const INTAKE_TTL_MS = 15 * 60 * 1000;

// { guildId, db, tm, config } for a guild, or null if it is no longer operational.
async function loadGuildEntry(guildId, client) {
  if (!(await isGuildOperational(guildId))) return null;
  try {
    const db = getTenantDb(guildId);
    const [cfg] = await db('SELECT * FROM guild_config LIMIT 1');
    return { guildId, db, tm: createManager(db, client, guildId), config: cfg || {} };
  } catch { return null; }
}

// Continues the flow on a guild known by its id (states restored from Redis).
async function openTicketInGuild(user, content, attachments, guildId, client, subject, opts = {}) {
  const entry = await loadGuildEntry(guildId, client);
  if (!entry) return user.send({ embeds: [notInGuildEmbed()] }).catch(() => null);
  return openTicketForGuild(user, content, attachments, entry, client, subject, opts);
}

// DM flood protection: each DM scans every active guild, so cap it per user.
const DM_MAX = 8;
const DM_WINDOW_MS = 30 * 1000;

// Starts intake form questioning sequence, returns true if form was triggered
async function checkIntakeForm(user, content, attachments, guildEntry, client, subject, fieldValues = null) {
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

  await store.setPending('intake', user.id, {
    guildId: guildEntry.guildId, content, attachments, subject, fieldValues,
    questions: questions.map(q => q.label), step: 0, answers: [],
  }, INTAKE_TTL_MS);

  await user.send({ embeds: [intakeFormStartEmbed(questions[0].label, 1, questions.length)] }).catch(() => null);
  return true;
}

// Opens a new ticket on a guild. subject: null = not asked yet (the member is asked),
// '' = asked but none given (ticket opened without subject), otherwise the subject.
// opts.skipFaq: the member already saw the FAQ suggestions and chose to open a ticket.
async function openTicketForGuild(user, content, attachments, guildEntry, client, subject = null, opts = {}) {
  // From here the server is known: its language setting applies
  return inMemberLang(user.id, guildEntry.guildId, client, () => openTicketForGuildInLang(user, content, attachments, guildEntry, client, subject, opts));
}

async function openTicketForGuildInLang(user, content, attachments, guildEntry, client, subject, opts) {
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
  // Automatic FAQ: suggest answers before asking the subject (the member may not need a ticket)
  if (subject === null && config.faq_enabled && !opts.skipFaq) {
    const matches = await findFaqMatches(db, content);
    if (matches.length) {
      await db('UPDATE faq_entries SET shown_count = shown_count + 1 WHERE id IN (?)', [matches.map(m => m.id)]).catch(() => null);
      await store.setPending('faq', user.id, { guildId, content, attachments, entryIds: matches.map(m => m.id) }, PENDING_TTL_MS);
      const guildName = client.guilds.cache.get(guildId)?.name;
      await user.send({ embeds: [faqSuggestEmbed(guildName, matches)], components: faqButtons(matches) }).catch(() => null);
      return;
    }
  }

  if (subject === null) {
    // No answer within the TTL: the 'pending-expiry' job opens the ticket without subject
    const guildName = client.guilds.cache.get(guildId)?.name;
    const subjects = parseJsonField(config.ticket_subjects);
    if (subjects.length > 0) {
      await store.setPending('subject', user.id, { guildId, content, attachments, subjects }, PENDING_TTL_MS, { onExpire: true });
      await user.send({ embeds: [subjectSelectEmbed(guildName)], components: subjectButtons(subjects) }).catch(() => null);
    } else {
      await store.setPending('subjectText', user.id, { guildId, content, attachments }, PENDING_TTL_MS, { onExpire: true });
      await user.send({ embeds: [subjectAskEmbed(guildName)] }).catch(() => null);
    }
    return;
  }

  // Intake form check before creating the ticket
  // Custom fields (asked once, after the subject)
  if (!opts.fieldsDone) {
    const fields = await applicableFields(db, subject);
    if (fields.length) {
      await store.setPending('fields', user.id, { guildId, content, attachments, subject, fields, step: 0, values: {} }, INTAKE_TTL_MS);
      await user.send({ embeds: [fieldQuestionEmbed(fields[0], 1, fields.length)] }).catch(() => null);
      return;
    }
  }

  // Intake form check before creating the ticket
  if (!opts.intakeDone) {
    const intakeHandled = await checkIntakeForm(user, content, attachments, { guildId, db, tm, config }, client, subject, opts.fieldValues || null);
    if (intakeHandled) return;
  }

  const result = await tm.createTicket(user, content, attachments, subject || null, { forceNew: true });
  if (result.created && opts.fieldValues) {
    await saveFieldValues(db, result.ticket.id, opts.fieldValues);
    const lines = (await fieldsForTicket(db, result.ticket.id)).filter(f => f.value).map(f => `**${f.label}** : ${f.value}`);
    if (lines.length) await result.channel?.send(`📋 **Informations du membre**\n${lines.join('\n')}`.slice(0, 2000)).catch(() => null);
  }
  await tm.sendWelcomeDm(user, result.created, subject || null, result.ticket?.id);
  if (result.created) {
    broadcast('new_ticket', { id: result.ticket.id, ownerTag: user.username, subject: result.ticket.subject }, guildId);
  }
}

// "Autre sujet" button: the member will type the subject. Returns the pending state, or null if expired.
async function switchToTextSubject(user) {
  const state = await store.takePending('subject', user.id);
  if (!state) return null;
  const { guildId, content, attachments } = state;
  await store.setPending('subjectText', user.id, { guildId, content, attachments }, PENDING_TTL_MS, { onExpire: true });
  return state;
}

// Subject questions nobody answered: open those tickets without subject (job 'pending-expiry').
async function runPendingExpiry(client) {
  for (const { kind, userId, data } of await store.claimExpired()) {
    if (kind !== 'subject' && kind !== 'subjectText') continue;
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) continue;
    await openTicketInGuild(user, data.content, data.attachments, data.guildId, client, '')
      .catch(err => console.error('pending expiry:', err.message));
  }
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
  await store.setPending('guildSelect', user.id, {
    content, attachments, guilds: candidateGuilds.map(g => ({ guildId: g.guildId, name: g.discordGuild.name })),
  }, PENDING_TTL_MS);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('guild_select')
    .setPlaceholder(t('serverSelect.placeholder'))
    .addOptions(candidateGuilds.slice(0, 25).map(g =>
      new StringSelectMenuOptionBuilder()
        .setLabel(g.discordGuild.name.slice(0, 100))
        .setValue(g.guildId)
        .setDescription(t('serverSelect.option'))
    ));
  await user.send({ embeds: [serverSelectEmbed()], components: [new ActionRowBuilder().addComponents(menu)] }).catch(() => null);
}

// Menu: one option per open ticket (server · #id — subject) + "new ticket".
function buildTicketRouteMenu(tickets, userId) {
  const options = tickets.slice(0, 24).map(tk =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`#${tk.ticket.id} — ${tk.ticket.subject || t('route.noSubject')}`.slice(0, 100))
      .setValue(`t:${tk.guildId}:${tk.ticket.id}`)
      .setDescription(`${tk.guildName}${tk.ticket.owner_id === userId ? '' : t('route.participant')}`.slice(0, 100))
      .setEmoji('🎫')
  );
  options.push(new StringSelectMenuOptionBuilder().setLabel(t('route.new')).setValue('new').setEmoji('➕'));
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_route')
    .setPlaceholder(t('route.placeholder'))
    .addOptions(options);
  return new ActionRowBuilder().addComponents(menu);
}

// Private message from a member (runs in the member's language, see utils/i18n.js).
async function handleDm(client, user, data) {
  const content = data.content?.trim() || '';
  const attachments = Array.isArray(data.attachments)
    ? data.attachments.map(a => ({ url: a.url, name: a.filename }))
    : [];

  if (!content && attachments.length === 0) {
    await user.send({ embeds: [emptyMessageEmbed()] }).catch(() => null);
    return;
  }

  if (!(await allowBurst(`dm:${user.id}`, DM_MAX, DM_WINDOW_MS))) {
    if (await firstOverflow(`dm:${user.id}`)) {
      await user.send(t('flood')).catch(() => null);
    }
    return;
  }

  // New message while FAQ suggestions are shown: the member still needs help → open the ticket
  const faq = await store.takePending('faq', user.id);
  if (faq) {
    await openTicketInGuild(user, [faq.content, content].filter(Boolean).join('\n'), [...(faq.attachments || []), ...attachments], faq.guildId, client, null, { skipFaq: true });
    return;
  }

  // Answer to "what is the subject of your ticket?"
  if (await store.hasPending('subjectText', user.id)) {
    if (!content) {
      await user.send(t('subject.textOnly')).catch(() => null);
      return;
    }
    const state = await store.takePending('subjectText', user.id);
    if (state) {
      const subject = content.replace(/\s+/g, ' ').slice(0, 100);
      await openTicketInGuild(user, state.content, state.attachments, state.guildId, client, subject);
      return;
    }
  }

  // Intake form — step-by-step question reply
  // Custom fields — one answer per message, validated
  const fstate = await store.takePending('fields', user.id);
  if (fstate) {
    const field = fstate.fields[fstate.step];
    const parsed = parseFieldAnswer(field, content, [t('fields.skip'), 'passer', 'skip']);
    if (parsed.error) {
      const { expiresAt, ...rest } = fstate;
      await store.setPending('fields', user.id, rest, INTAKE_TTL_MS);
      await user.send(t(parsed.error === 'number' ? 'fields.number' : 'fields.empty')).catch(() => null);
      return;
    }
    fstate.values[field.id] = parsed.value;
    fstate.step += 1;
    if (fstate.step < fstate.fields.length) {
      const { expiresAt, ...rest } = fstate;
      await store.setPending('fields', user.id, rest, INTAKE_TTL_MS);
      await user.send({ embeds: [fieldQuestionEmbed(fstate.fields[fstate.step], fstate.step + 1, fstate.fields.length)] }).catch(() => null);
    } else {
      await openTicketInGuild(user, fstate.content, fstate.attachments, fstate.guildId, client, fstate.subject ?? '',
        { skipFaq: true, fieldsDone: true, fieldValues: fstate.values });
    }
    return;
  }

  // Taken then stored back: two quick answers never count for the same question
  const intake = await store.takePending('intake', user.id);
  if (intake) {
    intake.answers.push(content);
    intake.step += 1;

    if (intake.step < intake.questions.length) {
      const { expiresAt, ...rest } = intake;
      await store.setPending('intake', user.id, rest, INTAKE_TTL_MS);
      await user.send({ embeds: [intakeFormStepEmbed(intake.questions[intake.step], intake.step + 1, intake.questions.length)] }).catch(() => null);
    } else {
      // All questions answered — build intake summary and open ticket
      const summary = intake.questions.map((label, i) => `**${label}** : ${intake.answers[i] || '—'}`).join('\n');
      const enrichedContent = `${intake.content || ''}\n\n📋 **Formulaire d'intake :**\n${summary}`.trim();
      await openTicketInGuild(user, enrichedContent, intake.attachments, intake.guildId, client, intake.subject ?? '',
        { skipFaq: true, fieldsDone: true, intakeDone: true, fieldValues: intake.fieldValues || null });
    }
    return;
  }

  // Open tickets of the member (owner or participant), except on servers where they are blacklisted
  const allOpen = await findAllOpenTickets(user.id, client);
  const openTickets = [];
  for (const t of allOpen) if (!(await isBlacklistedIn(t.db, user.id).catch(() => false))) openTickets.push(t);

  // At least one open ticket: ask, for every message, which ticket it goes to (or a new ticket)
  if (openTickets.length) {
    await store.setPending('route', user.id, {
      content, attachments, tickets: openTickets.map(t => ({ guildId: t.guildId, ticketId: t.ticket.id })),
    }, PENDING_TTL_MS);
    await user.send({ embeds: [ticketRouteEmbed(openTickets.length)], components: [buildTicketRouteMenu(openTickets, user.id)] }).catch(() => null);
    return;
  }
  if (allOpen.length) {
    await user.send({ embeds: [blacklistedEmbed()] }).catch(() => null);
    return;
  }

  await startNewTicket(user, content, attachments, client);
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

      // Member's language (no server known yet: their Discord language when remembered)
      await inMemberLang(user.id, null, client, () => handleDm(client, user, data));
    } catch (error) {
      console.error('Erreur RAW handler:', error);
    }
  },

  openTicketForGuild,
  openTicketInGuild,
  runPendingExpiry,
  startNewTicket,
  switchToTextSubject,
};

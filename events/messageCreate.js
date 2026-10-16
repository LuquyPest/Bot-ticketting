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
async function openTicketInGuild(user, content, attachments, guildId, client, subject) {
  const entry = await loadGuildEntry(guildId, client);
  if (!entry) return user.send({ embeds: [notInGuildEmbed()] }).catch(() => null);
  return openTicketForGuild(user, content, attachments, entry, client, subject);
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

  await store.setPending('intake', user.id, {
    guildId: guildEntry.guildId, content, attachments, subject,
    questions: questions.map(q => q.label), step: 0, answers: [],
  }, INTAKE_TTL_MS);

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
  const intakeHandled = await checkIntakeForm(user, content, attachments, { guildId, db, tm, config }, client, subject);
  if (intakeHandled) return;

  const result = await tm.createTicket(user, content, attachments, subject || null, { forceNew: true });
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

      if (!(await allowBurst(`dm:${user.id}`, DM_MAX, DM_WINDOW_MS))) {
        if (await firstOverflow(`dm:${user.id}`)) {
          await user.send('⏳ Tu envoies trop de messages à la suite — attends quelques secondes avant de réessayer.').catch(() => null);
        }
        return;
      }

      // Answer to "what is the subject of your ticket?"
      if (await store.hasPending('subjectText', user.id)) {
        if (!content) {
          await user.send('📝 Envoie le sujet de ton ticket en texte (quelques mots).').catch(() => null);
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
          await openTicketInGuild(user, enrichedContent, intake.attachments, intake.guildId, client, intake.subject ?? '');
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

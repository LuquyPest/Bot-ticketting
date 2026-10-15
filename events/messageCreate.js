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
  subjectSelectEmbed,
  intakeFormStartEmbed, intakeFormStepEmbed,
} = require('../utils/dmEmbeds');

// userId → { content, attachments, guildId, db, tm, config }
const pendingSubject = new Map();
// userId → { content, attachments, guilds: [{guildId, discordGuild, db, tm, config}] }
const pendingGuildSelect = new Map();
// userId → { content, attachments, guildEntry, subject, questions: [], step: 0, answers: [] }
const pendingIntakeForm = new Map();

// Stores a pending state that expires after `ttlMs` — without a later state being wiped by an older timer.
function setPending(map, userId, state, ttlMs) {
  map.set(userId, state);
  setTimeout(() => { if (map.get(userId) === state) map.delete(userId); }, ttlMs);
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

async function openTicketForGuild(user, content, attachments, guildEntry, client, subject = null) {
  const { guildId, db, tm, config } = guildEntry;

  // Every entry point (DM, subject/guild buttons) ends here, so the per-guild checks live here
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

  if (subject === null) {
    const subjects = parseJsonField(config.ticket_subjects);

    if (subjects.length > 0) {
      setPending(pendingSubject, user.id, { content, attachments, guildId, db, tm, config, subjects }, 10 * 60 * 1000);
      const rows = subjectButtons(subjects);
      await user.send({ embeds: [subjectSelectEmbed()], components: rows }).catch(() => null);
      return;
    }
  }

  // Intake form check before creating the ticket
  const intakeHandled = await checkIntakeForm(user, content, attachments, { guildId, db, tm, config }, client, subject);
  if (intakeHandled) return;

  const result = await tm.relayDmToTicket(user, content, attachments, subject);
  await tm.sendWelcomeDm(user, result.created, subject, result.ticket?.id);
  if (result.created) {
    broadcast('new_ticket', { id: result.ticket.id, ownerTag: user.username, subject: result.ticket.subject }, guildId);
  }
}

// Builds a StringSelectMenu row for guild/ticket selection in DMs.
// entries: [{ guildId, name, description }]
function buildGuildSelectMenu(entries) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('guild_select')
    .setPlaceholder('Choisir un serveur…')
    .addOptions(
      entries.slice(0, 25).map(e =>
        new StringSelectMenuOptionBuilder()
          .setLabel(e.name.slice(0, 100))
          .setValue(e.guildId)
          .setDescription(e.description.slice(0, 100))
      )
    );
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
          await openTicketForGuild(user, enrichedContent, state.attachments, state.guildEntry, client, state.subject);
        }
        return;
      }

      // Cherche tous les tickets ouverts de l'utilisateur sur tous les serveurs actifs
      // (sauf ceux où il est blacklisté — la blacklist est propre à chaque serveur)
      const allOpen = await findAllOpenTickets(user.id, client);
      const openTickets = [];
      for (const t of allOpen) if (!(await isBlacklistedIn(t.db, user.id).catch(() => false))) openTickets.push(t);
      if (allOpen.length && !openTickets.length) {
        await user.send({ embeds: [blacklistedEmbed()] }).catch(() => null);
        return;
      }

      if (openTickets.length === 1) {
        // Un seul ticket ouvert — relay direct, sans question
        const found = openTickets[0];
        const result = await found.tm.relayDmToTicket(user, content, attachments);
        await found.tm.sendWelcomeDm(user, result.created, null, result.ticket?.id);
        if (result.created) {
          broadcast('new_ticket', { id: result.ticket.id, ownerTag: user.username, subject: result.ticket.subject }, found.guildId);
        }
        return;
      }

      if (openTickets.length > 1) {
        // Plusieurs tickets ouverts sur des serveurs différents — demander lequel
        setPending(pendingGuildSelect, user.id, { mode: 'relay', content, attachments, guilds: openTickets }, 10 * 60 * 1000);
        const menu = buildGuildSelectMenu(openTickets.map(t => ({
          guildId: t.guildId,
          name: t.guildName,
          description: `Ticket #${t.ticket.id}${t.ticket.subject ? ` — ${t.ticket.subject}` : ''}`,
        })));
        await user.send({ embeds: [serverSelectEmbed('relay')], components: [menu] }).catch(() => null);
        return;
      }

      // Aucun ticket ouvert — cherche les serveurs où l'utilisateur est membre
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

      // Plusieurs serveurs disponibles — demander lequel
      setPending(pendingGuildSelect, user.id, { mode: 'new_ticket', content, attachments, guilds: candidateGuilds }, 10 * 60 * 1000);
      const menu = buildGuildSelectMenu(candidateGuilds.map(g => ({
        guildId: g.guildId,
        name: g.discordGuild.name,
        description: 'Ouvrir un ticket sur ce serveur',
      })));
      await user.send({ embeds: [serverSelectEmbed('new_ticket')], components: [menu] }).catch(() => null);
    } catch (error) {
      console.error('Erreur RAW handler:', error);
    }
  },

  pendingSubject,
  pendingGuildSelect,
  pendingIntakeForm,
  openTicketForGuild
};

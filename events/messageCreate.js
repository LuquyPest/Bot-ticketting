const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { findAllOpenTickets, isUserBlacklisted, findGuildsForUser } = require('../utils/guildScan');
const { subjectButtons } = require('../utils/components');
const { broadcast } = require('../utils/sse');
const { globalQuery } = require('../utils/globalDb');

// userId → { content, attachments, guildId, db, tm, config }
const pendingSubject = new Map();
// userId → { content, attachments, guilds: [{guildId, discordGuild, db, tm, config}] }
const pendingGuildSelect = new Map();
// userId → { content, attachments, guildEntry, subject, questions: [], step: 0, answers: [] }
const pendingIntakeForm = new Map();
// userId → { content, attachments, guildEntry, subject }
const pendingFaqTicket = new Map();

// Returns true if a FAQ rule matched and the user was shown a reply (ticket creation paused)
async function checkFaq(user, content, guildEntry, client) {
  const { guildId, db, config } = guildEntry;
  if (!config.faq_enabled) return false;

  let rules;
  try {
    rules = await db('SELECT * FROM faq_rules WHERE active = 1');
  } catch { return false; }
  if (!rules.length) return false;

  const lower = content.toLowerCase();
  for (const rule of rules) {
    let keywords = [];
    try { keywords = Array.isArray(rule.keywords) ? rule.keywords : JSON.parse(rule.keywords || '[]'); } catch {}
    if (!keywords.length) continue;
    const matched = keywords.some(kw => lower.includes(String(kw).toLowerCase()));
    if (!matched) continue;

    const row = [];
    if (rule.allow_ticket) {
      row.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`faq_open_${guildId}`)
            .setLabel('Ouvrir un ticket quand même')
            .setStyle(ButtonStyle.Secondary)
        )
      );
      pendingFaqTicket.set(user.id, { guildId, db, tm: guildEntry.tm, config });
      setTimeout(() => pendingFaqTicket.delete(user.id), 10 * 60 * 1000);
    }

    const msg = rule.allow_ticket
      ? { content: `📚 **Réponse automatique :**\n${rule.response}\n\n*Cette réponse répond-elle à ta question ? Sinon tu peux ouvrir un ticket.*`, components: row }
      : { content: `📚 **Réponse automatique :**\n${rule.response}` };

    await user.send(msg).catch(() => null);
    return true;
  }
  return false;
}

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

  pendingIntakeForm.set(user.id, {
    content, attachments, guildEntry, subject,
    questions, step: 0, answers: []
  });
  setTimeout(() => pendingIntakeForm.delete(user.id), 15 * 60 * 1000);

  await user.send(`📋 **Quelques questions avant d'ouvrir ton ticket** (${questions.length} question${questions.length > 1 ? 's' : ''}) :\n\n**${questions[0].label}**`).catch(() => null);
  return true;
}

async function openTicketForGuild(user, content, attachments, guildEntry, client, subject = null) {
  const { guildId, db, tm, config } = guildEntry;

  // Check guild-wide concurrent ticket limit set by superadmin
  const [guildLimits] = await globalQuery('SELECT max_tickets FROM guilds WHERE guild_id = ?', [guildId]).catch(() => [{}]);
  if (guildLimits?.max_tickets > 0) {
    const [[{ openCount }]] = await db('SELECT COUNT(*) as openCount FROM tickets WHERE status = "open"').catch(() => [[{ openCount: 0 }]]);
    if (openCount >= guildLimits.max_tickets) {
      await user.send('Le serveur a atteint sa limite de tickets simultanés. Réessaie plus tard.').catch(() => null);
      return;
    }
  }

  const maxPerDay = config.max_tickets_per_day ?? 3;
  const dailyCount = await tm.getDailyTicketCount(user.id);
  if (dailyCount >= maxPerDay) {
    await user.send(`Tu as déjà ouvert ${maxPerDay} ticket(s) aujourd'hui. Réessaie demain.`).catch(() => null);
    if (config.spam_alert_channel_id) {
      const alertCh = await client.channels.fetch(config.spam_alert_channel_id).catch(() => null);
      if (alertCh?.isTextBased()) {
        await alertCh.send(
          `⚠️ **Anti-spam** : \`${user.username}\` (${user.id}) a tenté d'ouvrir un ${dailyCount + 1}e ticket (limite : ${maxPerDay}).`
        ).catch(() => null);
      }
    }
    return;
  }

  if (subject === null) {
    // FAQ check before anything (only on first message without existing ticket)
    const faqHandled = await checkFaq(user, content, { guildId, db, tm, config }, client);
    if (faqHandled) return;

    let subjects = [];
    try {
      subjects = Array.isArray(config.ticket_subjects)
        ? config.ticket_subjects
        : JSON.parse(config.ticket_subjects || '[]');
    } catch {}

    if (subjects.length > 0) {
      pendingSubject.set(user.id, { content, attachments, guildId, db, tm, config });
      setTimeout(() => pendingSubject.delete(user.id), 10 * 60 * 1000);
      const rows = subjectButtons(subjects);
      await user.send({ content: 'Quel est le sujet de ta demande ?', components: rows }).catch(() => null);
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
        await user.send('Envoie un message ou un fichier.').catch(() => null);
        return;
      }

      const { blacklisted } = await isUserBlacklisted(user.id);
      if (blacklisted) {
        await user.send('Tu ne peux pas ouvrir de ticket.').catch(() => null);
        return;
      }

      // Intake form — step-by-step question reply
      if (pendingIntakeForm.has(user.id)) {
        const state = pendingIntakeForm.get(user.id);
        state.answers.push(content);
        state.step += 1;

        if (state.step < state.questions.length) {
          await user.send(`**${state.questions[state.step].label}**`).catch(() => null);
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
      const openTickets = await findAllOpenTickets(user.id, client);

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
        pendingGuildSelect.set(user.id, { mode: 'relay', content, attachments, guilds: openTickets });
        setTimeout(() => pendingGuildSelect.delete(user.id), 10 * 60 * 1000);
        const menu = buildGuildSelectMenu(openTickets.map(t => ({
          guildId: t.guildId,
          name: t.guildName,
          description: `Ticket #${t.ticket.id}${t.ticket.subject ? ` — ${t.ticket.subject}` : ''}`,
        })));
        await user.send({ content: 'Tu as des tickets ouverts sur plusieurs serveurs. Lequel veux-tu contacter ?', components: [menu] }).catch(() => null);
        return;
      }

      // Aucun ticket ouvert — cherche les serveurs où l'utilisateur est membre
      const candidateGuilds = await findGuildsForUser(user.id, client);

      if (candidateGuilds.length === 0) {
        await user.send('Tu ne fais partie d\'aucun serveur utilisant ce bot.').catch(() => null);
        return;
      }

      if (candidateGuilds.length === 1) {
        await openTicketForGuild(user, content, attachments, candidateGuilds[0], client, null);
        return;
      }

      // Plusieurs serveurs disponibles — demander lequel
      pendingGuildSelect.set(user.id, { mode: 'new_ticket', content, attachments, guilds: candidateGuilds });
      setTimeout(() => pendingGuildSelect.delete(user.id), 10 * 60 * 1000);
      const menu = buildGuildSelectMenu(candidateGuilds.map(g => ({
        guildId: g.guildId,
        name: g.discordGuild.name,
        description: 'Ouvrir un ticket sur ce serveur',
      })));
      await user.send({ content: 'Sur quel serveur veux-tu ouvrir un ticket ?', components: [menu] }).catch(() => null);
    } catch (error) {
      console.error('Erreur RAW handler:', error);
    }
  },

  pendingSubject,
  pendingGuildSelect,
  pendingIntakeForm,
  pendingFaqTicket,
  openTicketForGuild
};

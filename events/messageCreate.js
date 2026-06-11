const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { findUserOpenTicket, isUserBlacklisted, findGuildsForUser } = require('../utils/guildScan');
const { subjectButtons } = require('../utils/components');
const { broadcast } = require('../utils/sse');

// userId → { content, attachments, guildId, db, tm, config }
const pendingSubject = new Map();
// userId → { content, attachments, guilds: [{guildId, discordGuild, db, tm, config}] }
const pendingGuildSelect = new Map();

async function openTicketForGuild(user, content, attachments, guildEntry, client, subject = null) {
  const { guildId, db, tm, config } = guildEntry;

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

  const result = await tm.relayDmToTicket(user, content, attachments, subject);
  await tm.sendWelcomeDm(user, result.created);
  if (result.created) {
    broadcast('new_ticket', { id: result.ticket.id, ownerTag: user.username, subject: result.ticket.subject }, guildId);
  }
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

      // Si l'utilisateur a déjà un ticket ouvert, on relay
      const found = await findUserOpenTicket(user.id, client);
      if (found) {
        const result = await found.tm.relayDmToTicket(user, content, attachments);
        await found.tm.sendWelcomeDm(user, result.created);
        if (result.created) {
          broadcast('new_ticket', { id: result.ticket.id, ownerTag: user.username, subject: result.ticket.subject }, found.guildId);
        }
        return;
      }

      // Pas de ticket ouvert — cherche les serveurs où l'utilisateur est membre
      const candidateGuilds = await findGuildsForUser(user.id, client);

      if (candidateGuilds.length === 0) {
        await user.send('Tu ne fais partie d\'aucun serveur utilisant ce bot.').catch(() => null);
        return;
      }

      if (candidateGuilds.length === 1) {
        await openTicketForGuild(user, content, attachments, candidateGuilds[0], client, null);
        return;
      }

      // Plusieurs serveurs — afficher un sélecteur
      pendingGuildSelect.set(user.id, { content, attachments, guilds: candidateGuilds });
      setTimeout(() => pendingGuildSelect.delete(user.id), 10 * 60 * 1000);

      const rows = [];
      let row = new ActionRowBuilder();
      candidateGuilds.slice(0, 5).forEach((g, i) => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`guildselect_${g.guildId}`)
            .setLabel(g.discordGuild.name.slice(0, 80))
            .setStyle(ButtonStyle.Primary)
        );
        if ((i + 1) % 5 === 0 || i === candidateGuilds.length - 1) {
          rows.push(row);
          row = new ActionRowBuilder();
        }
      });

      await user.send({ content: 'Sur quel serveur veux-tu ouvrir un ticket ?', components: rows }).catch(() => null);
    } catch (error) {
      console.error('Erreur RAW handler:', error);
    }
  },

  pendingSubject,
  pendingGuildSelect,
  openTicketForGuild
};

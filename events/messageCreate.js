const {
  relayDmToTicket,
  sendWelcomeDm,
  getAnyOpenTicketForUser,
  getOpenTicketByChannelId,
  isBlacklisted,
  getDailyTicketCount
} = require('../utils/ticketManager');
const { subjectButtons } = require('../utils/components');
const { query } = require('../utils/db');
const { broadcast } = require('../utils/sse');

// userId -> { content, attachments } — en attente de sélection de sujet
const pendingSubject = new Map();

module.exports = {
  name: 'raw',
  async execute(client, packet) {
    try {
      if (packet.t !== 'MESSAGE_CREATE') return;

      const data = packet.d;
      if (data.author?.bot) return;

      // ── Message dans un salon de ticket (staff → note web) ──────────────
      if (data.guild_id) {
        const ticket = await getOpenTicketByChannelId(data.channel_id);
        if (!ticket) return;

        const content = data.content?.trim() || '';
        const attachments = Array.isArray(data.attachments) && data.attachments.length > 0
          ? data.attachments.map(a => a.url).join('\n')
          : '';
        const noteContent = [content, attachments].filter(Boolean).join('\n');
        if (!noteContent) return;

        const authorTag = data.member?.nick || data.author.username;

        const noteResult = await query(
          'INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, "discord")',
          [ticket.id, data.author.id, authorTag, noteContent]
        );
        broadcast('note', {
          ticketId: ticket.id,
          note: {
            id: noteResult.insertId,
            ticket_id: ticket.id,
            author_id: data.author.id,
            author_tag: authorTag,
            content: noteContent,
            source: 'discord',
            created_at: new Date()
          }
        });
        return;
      }

      // ── Message privé (utilisateur → relay ticket) ───────────────────────
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

      if (await isBlacklisted(user.id)) {
        await user.send('Tu ne peux pas ouvrir de ticket.').catch(() => null);
        return;
      }

      const openTicket = await getAnyOpenTicketForUser(user.id);

      if (!openTicket) {
        const maxPerDay = client.config.maxTicketsPerDay ?? 3;
        const dailyCount = await getDailyTicketCount(user.id);
        if (dailyCount >= maxPerDay) {
          await user.send(`Tu as déjà ouvert ${maxPerDay} ticket(s) aujourd'hui. Réessaie demain.`).catch(() => null);

          // Alert fondateur/logs channel about spam
          const alertChannelId = client.config.spamAlertChannelId || client.config.closeLogChannelId;
          if (alertChannelId) {
            const alertCh = await client.channels.fetch(alertChannelId).catch(() => null);
            if (alertCh?.isTextBased()) {
              await alertCh.send(
                `⚠️ **Anti-spam** : \`${user.tag}\` (${user.id}) a tenté d'ouvrir un ${dailyCount + 1}e ticket aujourd'hui (limite : ${maxPerDay}).`
              ).catch(() => null);
            }
          }
          return;
        }

        const subjects = client.config.ticketSubjects;
        if (Array.isArray(subjects) && subjects.length > 0) {
          pendingSubject.set(user.id, { content, attachments });
          setTimeout(() => pendingSubject.delete(user.id), 10 * 60 * 1000);
          const rows = subjectButtons(subjects);
          await user.send({
            content: 'Quel est le sujet de ta demande ?',
            components: rows
          }).catch(() => null);
          return;
        }
      }

      const result = await relayDmToTicket(client, user, content, attachments);
      await sendWelcomeDm(client, user, result.created);
      if (result.created) {
        broadcast('new_ticket', {
          id: result.ticket.id,
          ownerTag: user.username,
          subject: result.ticket.subject
        });
      }
    } catch (error) {
      console.error('Erreur RAW handler:', error);
    }
  },

  pendingSubject
};

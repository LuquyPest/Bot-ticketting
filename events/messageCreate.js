const {
  relayDmToTicket,
  sendWelcomeDm,
  getAnyOpenTicketForUser
} = require('../utils/ticketManager');
const { subjectButtons } = require('../utils/components');

// userId -> { content, attachments } — en attente de sélection de sujet
const pendingSubject = new Map();

module.exports = {
  name: 'raw',
  async execute(client, packet) {
    try {
      if (packet.t !== 'MESSAGE_CREATE') return;

      const data = packet.d;
      if (data.author?.bot) return;
      if (data.guild_id) return;

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

      const openTicket = await getAnyOpenTicketForUser(user.id);

      if (!openTicket) {
        // Menu de sujet si configuré
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
    } catch (error) {
      console.error('Erreur RAW handler:', error);
    }
  },

  // Exporté pour que interactionCreate puisse accéder au Map
  pendingSubject
};

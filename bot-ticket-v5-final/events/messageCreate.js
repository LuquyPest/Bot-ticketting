const { Events, ChannelType } = require('discord.js');
const {
  relayDmToTicket,
  sendWelcomeDm,
  getOpenTicketByChannelId
} = require('../utils/ticketManager');

module.exports = {
  name: Events.MessageCreate,
  async execute(client, message) {
    try {
      if (message.author.bot) return;

      if (message.channel.type === ChannelType.DM) {
        const content = message.content?.trim() || '';
        const attachments = [...message.attachments.values()];

        if (!content && attachments.length === 0) {
          await message.author.send('❌ Envoie un texte ou une pièce jointe.').catch(() => null);
          return;
        }

        const result = await relayDmToTicket(client, message.author, content, attachments);
        await sendWelcomeDm(client, message.author, result.created);
        return;
      }

      if (!message.guild) return;

      const ticket = await getOpenTicketByChannelId(message.channel.id);
      if (!ticket) return;

      // Les messages normaux du staff restent dans le salon.
      // Ils ne sont jamais envoyés au membre.
    } catch (error) {
      console.error('Erreur messageCreate:', error);
    }
  }
};

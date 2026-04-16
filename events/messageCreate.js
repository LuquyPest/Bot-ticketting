const { relayDmToTicket, sendWelcomeDm } = require('../utils/ticketManager');

module.exports = {
  name: 'raw',
  async execute(client, packet) {
    try {
      if (packet.t !== 'MESSAGE_CREATE') return;

      const data = packet.d;

      // Ignore les bots
      if (data.author?.bot) return;

      // Ignore les messages venant d'un serveur
      if (data.guild_id) return;

      console.log('?? DM RAW RECU:', data.content);

      const user = await client.users.fetch(data.author.id).catch(() => null);
      if (!user) return;

      const content = data.content?.trim() || '';

      if (!content) {
        await user.send('? Envoie un message valide.').catch(() => null);
        return;
      }

      const result = await relayDmToTicket(client, user, content, []);
      await sendWelcomeDm(client, user, result.created);
    } catch (error) {
      console.error('Erreur RAW handler:', error);
    }
  }
};
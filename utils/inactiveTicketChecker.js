const { getInactiveTickets, markWarnedInactive, closeTicketWithTranscript } = require('./ticketManager');

async function runInactiveCheck(client) {
  const warningHours = client.config.inactiveWarningHours ?? 24;
  const closeHours   = client.config.inactiveHours ?? 48;

  try {
    const { toWarn, toClose } = await getInactiveTickets(warningHours, closeHours);

    for (const ticket of toWarn) {
      const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
      if (!channel) continue;

      await channel.send(
        `⚠️ Ce ticket est inactif depuis plus de ${warningHours}h. Il sera fermé automatiquement dans ${closeHours - warningHours}h si aucun message n'est envoyé.`
      ).catch(() => null);

      await markWarnedInactive(ticket.id);
    }

    for (const ticket of toClose) {
      const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
      if (!channel) continue;

      await closeTicketWithTranscript(client, channel, client.user);
    }
  } catch (err) {
    console.error('Erreur inactive checker:', err);
  }
}

function startInactiveChecker(client) {
  const intervalMs = 60 * 60 * 1000; // toutes les heures
  setTimeout(async () => {
    await runInactiveCheck(client);
    setInterval(() => runInactiveCheck(client), intervalMs);
  }, 5 * 60 * 1000); // premier check 5 minutes après le démarrage
}

module.exports = { startInactiveChecker };

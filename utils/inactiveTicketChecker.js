const { getActiveGuilds } = require('./guildScan');
const { getTenantDb } = require('./tenantDb');
const { recordEvent } = require('./audit');

// Automatic closures are made by the system (no staff stats, journal source "Automatique")
const SYSTEM_CLOSER = { id: 'system', tag: 'Système (inactivité)', username: 'Système', source: 'system', reason: 'inactivité' };
const { createManager, getGuildConfig } = require('./ticketManager');

async function runInactiveCheck(client) {
  let guilds;
  try {
    guilds = await getActiveGuilds();
  } catch (err) {
    console.error('Erreur inactive checker (getActiveGuilds):', err);
    return;
  }

  for (const { guild_id } of guilds) {
    try {
      const db = getTenantDb(guild_id);
      const tm = createManager(db, client, guild_id);
      const cfg = await getGuildConfig(db);
      const warningHours = cfg.inactive_warning_hours ?? 48;
      const closeHours   = cfg.inactive_hours ?? 72;

      const { toWarn, toClose } = await tm.getInactiveTickets(warningHours, closeHours);

      for (const ticket of toWarn) {
        const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
        if (!channel) continue;
        await channel.send(
          `⚠️ Ce ticket est inactif depuis plus de ${warningHours}h. Il sera fermé automatiquement dans ${closeHours - warningHours}h si aucun message n'est envoyé.`
        ).catch(() => null);
        await tm.markWarnedInactive(ticket.id);
      }

      for (const ticket of toClose) {
        const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
        if (!channel) {
          await db(`UPDATE tickets SET status='closed', closed_at=NOW(), closed_by_tag='system' WHERE id=?`, [ticket.id]);
          await recordEvent(db, { actor: SYSTEM_CLOSER, action: 'ticket_close', ticketId: ticket.id, details: { reason: 'inactivité', channel: 'introuvable' } });
          continue;
        }
        await tm.closeTicketWithTranscript(channel, SYSTEM_CLOSER);
      }
    } catch (err) {
      console.error(`Erreur inactive checker [${guild_id}]:`, err);
    }
  }
}

module.exports = { runInactiveCheck };

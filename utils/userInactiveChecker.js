const { getActiveGuilds } = require('./guildScan');
const { getTenantDb } = require('./tenantDb');
const { createManager, getGuildConfig } = require('./ticketManager');
const { recordEvent } = require('./audit');
const { ticketNoticeDmEmbed } = require('./dmEmbeds');

const SYSTEM_CLOSER = { id: 'system', tag: 'Système (inactivité utilisateur)', username: 'Système', source: 'system', reason: 'inactivité du membre' };

async function runUserInactiveCheck(client) {
  let guilds;
  try {
    guilds = await getActiveGuilds();
  } catch (err) {
    console.error('Erreur userInactiveChecker (getActiveGuilds):', err);
    return;
  }

  for (const { guild_id } of guilds) {
    try {
      const db = getTenantDb(guild_id);
      const cfg = await getGuildConfig(db);
      if (!cfg.user_inactive_enabled) continue;

      const warnHours  = cfg.user_inactive_warn_hours  ?? 24;
      const closeHours = cfg.user_inactive_close_hours ?? 72;
      const tm = createManager(db, client, guild_id);
      const { toWarn, toClose } = await tm.getTicketsForUserInactive(warnHours, closeHours);

      for (const ticket of toWarn) {
        const owner = await client.users.fetch(ticket.owner_id).catch(() => null);
        if (owner) {
          await owner.send({ embeds: [ticketNoticeDmEmbed(client, guild_id, ticket, {
            title: '⚠️ Ton ticket attend ta réponse',
            description: `Le staff t'a répondu mais nous n'avons pas eu de nouvelle depuis ${warnHours}h.\nSans message de ta part dans les ${closeHours - warnHours}h, le ticket sera fermé automatiquement.`,
            color: 'warning',
            footer: `Réponds ici pour écrire dans le ticket #${ticket.id}`,
          })] }).catch(() => null);
        }
        // Also warn in the ticket channel
        const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
        if (channel) {
          await channel.send(
            `⚠️ <@${ticket.owner_id}> n'a pas répondu depuis ${warnHours}h. Le ticket sera fermé automatiquement dans ${closeHours - warnHours}h si aucun message n'est envoyé.`
          ).catch(() => null);
        }
        await tm.markUserWarnedInactive(ticket.id);
      }

      for (const ticket of toClose) {
        const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
        if (!channel) {
          await db(`UPDATE tickets SET status='closed', closed_at=NOW(), closed_by_tag='system (inactivité utilisateur)' WHERE id=?`, [ticket.id]);
          await recordEvent(db, { actor: SYSTEM_CLOSER, action: 'ticket_close', ticketId: ticket.id, details: { reason: 'inactivité du membre', channel: 'introuvable' } });
          continue;
        }
        // Notify user before close
        const owner = await client.users.fetch(ticket.owner_id).catch(() => null);
        if (owner) {
          await owner.send({ embeds: [ticketNoticeDmEmbed(client, guild_id, ticket, {
            title: '🔒 Ticket fermé automatiquement',
            description: `Fermé après ${closeHours}h sans réponse de ta part. Tu peux en ouvrir un nouveau à tout moment.`,
          })] }).catch(() => null);
        }
        await tm.closeTicketWithTranscript(channel, SYSTEM_CLOSER);
      }
    } catch (err) {
      console.error(`Erreur userInactiveChecker [${guild_id}]:`, err);
    }
  }
}

function startUserInactiveChecker(client) {
  const intervalMs = 60 * 60 * 1000;
  setTimeout(async () => {
    await runUserInactiveCheck(client);
    setInterval(() => runUserInactiveCheck(client), intervalMs);
  }, 9 * 60 * 1000);
}

module.exports = { startUserInactiveChecker };

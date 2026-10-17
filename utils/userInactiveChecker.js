const { getActiveGuilds } = require('./guildScan');
const { getTenantDb } = require('./tenantDb');
const { createManager, getGuildConfig } = require('./ticketManager');
const { recordEvent } = require('./audit');
const { ticketNoticeDmEmbed } = require('./dmEmbeds');
const { t, sendToMember } = require('./i18n');

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
        await sendToMember(client, ticket.owner_id, guild_id, () => ({ embeds: [ticketNoticeDmEmbed(client, guild_id, ticket, {
          title: t('inactive.warn.title'),
          description: t('inactive.warn.body', { warn: warnHours, left: closeHours - warnHours }),
          color: 'warning',
          footer: t('reply.footer', { id: ticket.id }),
        })] }));
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
        await sendToMember(client, ticket.owner_id, guild_id, () => ({ embeds: [ticketNoticeDmEmbed(client, guild_id, ticket, {
          title: t('inactive.closed.title'),
          description: t('inactive.closed.body', { hours: closeHours }),
        })] }));
        await tm.closeTicketWithTranscript(channel, SYSTEM_CLOSER);
      }
    } catch (err) {
      console.error(`Erreur userInactiveChecker [${guild_id}]:`, err);
    }
  }
}

module.exports = { runUserInactiveCheck };

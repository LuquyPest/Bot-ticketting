const { getActiveGuilds } = require('./guildScan');
const { getTenantDb } = require('./tenantDb');
const { createManager, getGuildConfig } = require('./ticketManager');

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
          await owner.send(
            `⚠️ **Ticket #${ticket.id}** — Le staff t'a répondu mais nous n'avons pas eu de nouvelle depuis ${warnHours}h.\nSi tu n'envoies pas de message dans les prochaines ${closeHours - warnHours}h, le ticket sera fermé automatiquement.`
          ).catch(() => null);
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
          continue;
        }
        // Notify user before close
        const owner = await client.users.fetch(ticket.owner_id).catch(() => null);
        if (owner) {
          await owner.send(`🔒 **Ticket #${ticket.id}** fermé automatiquement après ${closeHours}h sans réponse de ta part.`).catch(() => null);
        }
        await tm.closeTicketWithTranscript(channel, { id: client.user.id, tag: 'système (inactivité utilisateur)', username: 'système' });
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

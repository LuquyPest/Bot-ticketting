const { getActiveGuilds } = require('./guildScan');
const { getTenantDb } = require('./tenantDb');
const { createManager, getGuildConfig } = require('./ticketManager');

async function runStaffReminderCheck(client) {
  let guilds;
  try {
    guilds = await getActiveGuilds();
  } catch (err) {
    console.error('Erreur staffReminderChecker (getActiveGuilds):', err);
    return;
  }

  for (const { guild_id } of guilds) {
    try {
      const db = getTenantDb(guild_id);
      const cfg = await getGuildConfig(db);
      if (!cfg.staff_reminder_enabled) continue;

      const hours = cfg.staff_reminder_hours ?? 4;
      const tm = createManager(db, client, guild_id);
      const tickets = await tm.getTicketsForStaffReminder(hours);

      for (const ticket of tickets) {
        if (!ticket.claimed_by) continue;
        const staffUser = await client.users.fetch(ticket.claimed_by).catch(() => null);
        if (!staffUser) continue;

        const subject = ticket.subject ? ` (sujet : ${ticket.subject})` : '';
        await staffUser.send(
          `⏰ **Rappel ticket #${ticket.id}${subject}** — L'utilisateur **${ticket.owner_tag}** attend une réponse depuis plus de ${hours}h.\nMerci de répondre via </reply:0> ou de réassigner ce ticket.`
        ).catch(() => null);

        await tm.markStaffReminderSent(ticket.id);
      }
    } catch (err) {
      console.error(`Erreur staffReminderChecker [${guild_id}]:`, err);
    }
  }
}

function startStaffReminderChecker(client) {
  const intervalMs = 60 * 60 * 1000;
  setTimeout(async () => {
    await runStaffReminderCheck(client);
    setInterval(() => runStaffReminderCheck(client), intervalMs);
  }, 7 * 60 * 1000);
}

module.exports = { startStaffReminderChecker };

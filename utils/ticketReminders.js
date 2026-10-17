// Personal reminders on tickets ("remind me in 2 days"): sent when due to the staff member who
// set them (live notification, push, Discord DM with the ticket link). BullMQ job every minute.
const { EmbedBuilder } = require('discord.js');
const { getActiveGuilds } = require('./guildScan');
const { getTenantDb } = require('./tenantDb');
const { sendToUser } = require('./sse');
const logger = require('./logger');

async function sendDueReminders(client) {
  let sent = 0;
  for (const { guild_id } of await getActiveGuilds()) {
    try {
      const db = getTenantDb(guild_id);
      const due = await db(
        `SELECT r.id, r.ticket_id, r.user_id, r.note, t.subject, t.owner_tag, t.status FROM ticket_reminders r
         JOIN tickets t ON t.id = r.ticket_id WHERE r.sent_at IS NULL AND r.remind_at <= NOW() LIMIT 100`).catch(() => []);
      for (const r of due) {
        // Claim first: a reminder is sent once even if two runs overlap
        if (!(await db('UPDATE ticket_reminders SET sent_at = NOW() WHERE id = ? AND sent_at IS NULL', [r.id])).affectedRows) continue;
        const text = `Rappel : ticket #${r.ticket_id}${r.subject ? ` — ${r.subject}` : ''}${r.note ? ` · ${r.note}` : ''}`;
        sendToUser(guild_id, r.user_id, 'reminder', { ticketId: r.ticket_id, subject: r.subject, note: r.note });
        require('../web/routes/push').sendPushToUser(guild_id, r.user_id, { type: 'reminder', title: '⏰ Rappel', body: text, ticketId: r.ticket_id }).catch(() => null);
        const user = await client?.users.fetch(r.user_id).catch(() => null);
        if (user) {
          const { config } = require('./config');
          const base = config.webServerBaseUrl;
          const embed = new EmbedBuilder()
            .setColor(0x6366f1)
            .setAuthor({ name: `${client.guilds.cache.get(guild_id)?.name || 'Support'} · Ticket #${r.ticket_id}${r.subject ? ` — ${r.subject}` : ''}`.slice(0, 256) })
            .setDescription(`⏰ Tu m'as demandé de te rappeler ce ticket${r.note ? ` :\n> ${r.note}` : '.'}${r.status === 'closed' ? '\n(Il est fermé depuis.)' : ''}`)
            .setTimestamp();
          if (base) embed.setTitle('Ouvrir le ticket').setURL(`${base.replace(/\/$/, '')}/tickets/${r.ticket_id}`);
          await user.send({ embeds: [embed] }).catch(() => null);
        }
        sent++;
      }
    } catch (err) {
      logger.error('Rappels de tickets', { guildId: guild_id, err: err.message });
    }
  }
  return sent;
}

module.exports = { sendDueReminders };

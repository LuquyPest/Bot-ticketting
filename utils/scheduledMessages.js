const { getActiveGuilds } = require('./guildScan');
const { getTenantDb } = require('./tenantDb');
const { createManager } = require('./ticketManager');
const { broadcast } = require('./sse');

async function processPending(client) {
  let guilds;
  try {
    guilds = await getActiveGuilds();
  } catch (err) {
    console.error('scheduledMessages: getActiveGuilds error:', err);
    return;
  }

  for (const { guild_id } of guilds) {
    try {
      const db = getTenantDb(guild_id);
      const tm = createManager(db, client, guild_id);
      const due = await db("SELECT * FROM scheduled_messages WHERE sent = 0 AND send_at <= NOW()");

      for (const msg of due) {
        try {
          const [ticket] = await db('SELECT * FROM tickets WHERE id = ?', [msg.ticket_id]);
          if (!ticket || ticket.status !== 'open') {
            await db('UPDATE scheduled_messages SET sent = 1 WHERE id = ?', [msg.id]);
            continue;
          }

          const text = `--- ${msg.sender_tag} (programmé) : ${msg.content}`;

          const linkedUserIds = await tm.getAllLinkedUserIds(msg.ticket_id);
          for (const userId of linkedUserIds) {
            const user = await client.users.fetch(userId).catch(() => null);
            if (user) await user.send(text).catch(() => null);
          }

          if (ticket.channel_id) {
            const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
            if (channel) await channel.send(text).catch(() => null);
          }

          const nr = await db(
            "INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, 'scheduled')",
            [msg.ticket_id, msg.sender_id, msg.sender_tag, msg.content]
          );
          broadcast('note', {
            ticketId: msg.ticket_id,
            note: {
              id: nr.insertId,
              ticket_id: msg.ticket_id,
              author_id: msg.sender_id,
              author_tag: msg.sender_tag,
              content: msg.content,
              source: 'scheduled',
              created_at: new Date()
            }
          }, guild_id);

          await db('UPDATE scheduled_messages SET sent = 1, sent_at = NOW() WHERE id = ?', [msg.id]);
        } catch (err) {
          console.error(`scheduledMessages msg error [${guild_id}]:`, err);
        }
      }
    } catch (err) {
      console.error(`scheduledMessages guild error [${guild_id}]:`, err);
    }
  }
}

function startScheduledMessages(client) {
  setInterval(() => processPending(client).catch(console.error), 60 * 1000);
}

module.exports = { startScheduledMessages };

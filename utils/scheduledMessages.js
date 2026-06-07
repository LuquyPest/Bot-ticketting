const { query } = require('./db');
const { getAllLinkedUserIds } = require('./ticketManager');

async function processPending(client) {
  const due = await query(
    "SELECT * FROM scheduled_messages WHERE sent = 0 AND send_at <= NOW()"
  );

  for (const msg of due) {
    try {
      const [ticket] = await query('SELECT * FROM tickets WHERE id = ?', [msg.ticket_id]);
      if (!ticket || ticket.status !== 'open') {
        await query('UPDATE scheduled_messages SET sent = 1 WHERE id = ?', [msg.id]);
        continue;
      }

      const text = `--- ${msg.sender_tag} (programmé) : ${msg.content}`;

      const linkedUserIds = await getAllLinkedUserIds(msg.ticket_id);
      for (const userId of linkedUserIds) {
        const user = await client.users.fetch(userId).catch(() => null);
        if (user) await user.send(text).catch(() => null);
      }

      if (ticket.channel_id) {
        const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
        if (channel) await channel.send(text).catch(() => null);
      }

      await query(
        "INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, 'scheduled')",
        [msg.ticket_id, msg.sender_id, msg.sender_tag, msg.content]
      );

      await query('UPDATE scheduled_messages SET sent = 1 WHERE id = ?', [msg.id]);
    } catch (err) {
      console.error('scheduledMessages error:', err);
    }
  }
}

function startScheduledMessages(client) {
  setInterval(() => processPending(client).catch(console.error), 60 * 1000);
}

module.exports = { startScheduledMessages };

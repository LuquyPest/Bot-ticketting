const { getActiveGuilds } = require('./guildScan');
const { getTenantDb } = require('./tenantDb');
const { createManager } = require('./ticketManager');
const { broadcast } = require('./sse');
const { recordEvent } = require('./audit');
const { staffReplyDmEmbed } = require('./dmEmbeds');
const { ticketDmComponents } = require('./components');
const { sendToMember } = require('./i18n');

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
          // Claim first (atomic): a message is sent at most once, even if a run overlaps or crashes
          const claim = await db('UPDATE scheduled_messages SET sent = 1, sent_at = NOW() WHERE id = ? AND sent = 0', [msg.id]);
          if (claim.affectedRows !== 1) continue;

          const [ticket] = await db('SELECT * FROM tickets WHERE id = ?', [msg.ticket_id]);
          if (!ticket || ticket.status !== 'open') continue;

          const text = `--- ${msg.sender_tag} (programmé) : ${msg.content}`;

          // Each member receives the reply in their language
          const linkedUserIds = await tm.getAllLinkedUserIds(msg.ticket_id);
          for (const userId of linkedUserIds) {
            await sendToMember(client, userId, guild_id, () => ({ embeds: [staffReplyDmEmbed(client, guild_id, ticket, { sender: msg.sender_tag, content: msg.content, scheduled: true })], components: ticketDmComponents(ticket, guild_id, userId) }));
          }
          await recordEvent(db, {
            actor: { id: msg.sender_id, tag: msg.sender_tag, source: 'system' }, action: 'scheduled_sent', ticketId: msg.ticket_id,
            targetType: 'scheduled_message', targetId: msg.id, details: { excerpt: String(msg.content).slice(0, 120) },
          });

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
        } catch (err) {
          console.error(`scheduledMessages msg error [${guild_id}]:`, err);
        }
      }
    } catch (err) {
      console.error(`scheduledMessages guild error [${guild_id}]:`, err);
    }
  }
}

module.exports = { processPending };

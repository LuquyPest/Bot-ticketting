// Staff reply sent from Discord (/reply, /areply, /template): DM to every member linked to the
// ticket (in their language), copy in the channel, history note, journal and stats.
const { EmbedBuilder } = require('discord.js');
const { broadcast } = require('./sse');
const { recordEvent } = require('./audit');
const { staffReplyDmEmbed } = require('./dmEmbeds');
const { ticketDmComponents } = require('./components');
const { sendToMember } = require('./i18n');

async function sendDiscordReply({ client, db, tm, guildId, ticket, author, channel, content = '', fileUrl = null, anonymous = false }) {
  const sender = anonymous ? 'Support' : author.username;
  for (const userId of await tm.getAllLinkedUserIds(ticket.id)) {
    await sendToMember(client, userId, guildId, async () => ({
      embeds: [staffReplyDmEmbed(client, guildId, ticket, { sender, content, fileUrl })],
      components: await ticketDmComponents(ticket, guildId, userId),
    }));
  }
  await recordEvent(db, { actor: author, action: 'ticket_reply', ticketId: ticket.id, details: { anonymous, excerpt: (content || fileUrl || '').slice(0, 120) } });
  await tm.recordStaffResponse(ticket.id, author);
  await tm.updateLastMessage(ticket.id);

  if (anonymous) {
    let msg = `--- Support : ${content || ''}`.trim();
    if (fileUrl) msg += `\nFichier : ${fileUrl}`;
    await channel?.send(msg).catch(() => null);
  } else {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: `${author.username} · Staff` })
      .setDescription(content || '​')
      .setFooter({ text: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) });
    if (fileUrl) embed.addFields({ name: '📎 Fichier', value: fileUrl });
    await channel?.send({ embeds: [embed] }).catch(() => null);
  }

  const authorTag = anonymous ? `${author.username} (anonyme)` : author.username;
  const noteContent = [content, fileUrl].filter(Boolean).join('\n');
  const result = await db(
    'INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, "reply")',
    [ticket.id, author.id, authorTag, noteContent]
  ).catch(() => null);
  if (result) {
    broadcast('note', { ticketId: ticket.id, note: { id: result.insertId, ticket_id: ticket.id, author_id: author.id, author_tag: authorTag, content: noteContent, source: 'reply', created_at: new Date() } }, guildId);
  }
}

// Template variables, same as the dashboard
function resolveTemplateVars(text, ticket, staffName) {
  return String(text)
    .replace(/\{\{username\}\}/gi, ticket?.owner_tag ?? '')
    .replace(/\{\{ticket_id\}\}/gi, String(ticket?.id ?? ''))
    .replace(/\{\{date\}\}/gi, new Date().toLocaleDateString('fr-FR'))
    .replace(/\{\{staff_name\}\}/gi, staffName ?? '')
    .replace(/\{\{subject\}\}/gi, ticket?.subject ?? '');
}

module.exports = { sendDiscordReply, resolveTemplateVars };

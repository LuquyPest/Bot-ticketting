// A staff reply already sent can be corrected or withdrawn: the member's DMs and the copy in the
// ticket channel are edited (or deleted) along with the history note. ticket_notes.reply_refs
// remembers where each copy went: { sender, fileLine, channel: { channelId, messageId, format },
// dms: [{ userId, channelId, messageId }] }. Replies sent before reply_refs existed cannot be changed.
const { EmbedBuilder } = require('discord.js');
const { parseJsonField } = require('./jsonField');
const { recordEvent } = require('./audit');
const { broadcast } = require('./sse');

const MAX_HISTORY = 10;

// Text of the channel copy of a dashboard reply (same format as when it was sent)
const channelText = (sender, content, fileUrl) => `--- ${sender} : ${content || ''}`.trim() + (fileUrl ? `\nFichier : ${fileUrl}` : '');

async function fetchMessage(client, channelId, messageId) {
  const ch = await client?.channels.fetch(channelId).catch(() => null);
  return ch?.messages ? ch.messages.fetch(messageId).catch(() => null) : null;
}

// Collects the refs while a reply is sent. dm / channel: discord.js Message (or null)
function refsBuilder({ sender, format }) {
  const refs = { sender, fileLine: null, channel: null, dms: [] };
  return {
    file(line) { refs.fileLine = line || null; },
    channel(msg, fileUrl = null) { if (msg) refs.channel = { channelId: msg.channelId, messageId: msg.id, format, fileUrl }; },
    dm(userId, msg) { if (msg) refs.dms.push({ userId, channelId: msg.channelId, messageId: msg.id }); },
    json: () => JSON.stringify(refs),
  };
}

// note: a ticket_notes row with reply_refs, or with has_refs (SELECT reply_refs IS NOT NULL AS has_refs)
const editable = note => note?.source === 'reply' && !note.deleted_at
  && (note.has_refs !== undefined ? !!Number(note.has_refs) : !!parseJsonField(note.reply_refs, null));

async function publish(db, guildId, ticketId, noteId) {
  const [n] = await db('SELECT id, author_id, author_tag, content, source, created_at, edited_at, edit_history, deleted_at, reply_refs IS NOT NULL AS has_refs FROM ticket_notes WHERE id = ?', [noteId]);
  if (!n) return;
  const { has_refs, ...note } = n;
  broadcast('note_update', { ticketId, note: { ...note, edit_history: parseJsonField(n.edit_history, null), editable: editable(n) } }, guildId);
}

// Returns { ok, dms: { done, total } } or { error }.
async function editReply({ client, db, guildId, ticket, note, content, actor }) {
  const refs = parseJsonField(note.reply_refs, null);
  if (!refs) return { error: 'Cette réponse a été envoyée avant cette fonctionnalité : elle ne peut pas être modifiée' };
  if (note.deleted_at) return { error: 'Cette réponse a été retirée' };
  let done = 0;
  for (const d of refs.dms || []) {
    const msg = await fetchMessage(client, d.channelId, d.messageId);
    if (!msg?.embeds?.[0]) continue;
    if (await msg.edit({ embeds: [EmbedBuilder.from(msg.embeds[0]).setDescription(content.slice(0, 4096))] }).then(() => true, () => false)) done++;
  }
  if (refs.channel) {
    const msg = await fetchMessage(client, refs.channel.channelId, refs.channel.messageId);
    if (msg && refs.channel.format === 'embed' && msg.embeds?.[0]) {
      await msg.edit({ embeds: [EmbedBuilder.from(msg.embeds[0]).setDescription(content.slice(0, 4096))] }).catch(() => null);
    } else if (msg) {
      await msg.edit({ content: channelText(refs.sender, content, refs.channel.fileUrl).slice(0, 2000) }).catch(() => null);
    }
  }
  const history = [...(parseJsonField(note.edit_history, []) || []), { content: note.content, at: new Date().toISOString() }].slice(-MAX_HISTORY);
  const newContent = [content, refs.fileLine].filter(Boolean).join('\n');
  await db('UPDATE ticket_notes SET content = ?, edit_history = ?, edited_at = NOW() WHERE id = ?', [newContent, JSON.stringify(history), note.id]);
  await recordEvent(db, { actor, action: 'reply_edit', ticketId: ticket.id, details: { before: String(note.content).slice(0, 120), after: content.slice(0, 120) } });
  await publish(db, guildId, ticket.id, note.id);
  return { ok: true, dms: { done, total: (refs.dms || []).length } };
}

// The member's DMs are deleted; the channel copy says the reply was withdrawn. The note stays
// visible to the staff, marked as withdrawn.
async function retractReply({ client, db, guildId, ticket, note, actor }) {
  const refs = parseJsonField(note.reply_refs, null);
  if (!refs) return { error: 'Cette réponse a été envoyée avant cette fonctionnalité : elle ne peut pas être retirée' };
  if (note.deleted_at) return { error: 'Cette réponse est déjà retirée' };
  let done = 0;
  for (const d of refs.dms || []) {
    const msg = await fetchMessage(client, d.channelId, d.messageId);
    if (msg && await msg.delete().then(() => true, () => false)) done++;
  }
  if (refs.channel) {
    const msg = await fetchMessage(client, refs.channel.channelId, refs.channel.messageId);
    await msg?.edit({ content: `🗑️ Réponse retirée par **${actor.username || actor.tag}** (MP supprimé chez le membre).`, embeds: [], attachments: [] }).catch(() => null);
  }
  await db('UPDATE ticket_notes SET deleted_at = NOW() WHERE id = ?', [note.id]);
  await recordEvent(db, { actor, action: 'reply_retract', ticketId: ticket.id, details: { excerpt: String(note.content).slice(0, 120) } });
  await publish(db, guildId, ticket.id, note.id);
  return { ok: true, dms: { done, total: (refs.dms || []).length } };
}

module.exports = { refsBuilder, editReply, retractReply, editable, channelText };

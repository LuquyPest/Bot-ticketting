// A member who edits or deletes a DM already relayed to a ticket: the ticket keeps the old version
// (edit_history), shows "modified"/"deleted" to the staff, and the ticket channel is told.
// Linking a DM to its ticket message: every DM is remembered briefly in Redis (id + text); when
// the text is stored as a ticket message, the matching DM is linked to it (dmnote:<messageId>).
// Matching on the text survives every step in between (server choice, subject, form…).
const { getRedis } = require('./redis');
const { getTenantDb } = require('./tenantDb');
const { broadcast } = require('./sse');
const { parseJsonField } = require('./jsonField');

const RECENT_TTL = 24 * 3600;
const LINK_TTL = 30 * 24 * 3600;
const MAX_HISTORY = 10;

const noteText = (content, attachments = []) => [content, ...attachments.map(a => a.url)].filter(Boolean).join('\n');
const recentKey = userId => `dmrecent:${userId}`;
const linkKey = messageId => `dmnote:${messageId}`;

async function rememberDm(userId, messageId, text) {
  if (!messageId || !text) return;
  const r = getRedis();
  await r.lpush(recentKey(userId), JSON.stringify({ id: messageId, text }));
  await r.ltrim(recentKey(userId), 0, 19);
  await r.expire(recentKey(userId), RECENT_TTL);
}

// Called right after a member message is stored in a ticket
async function linkDmNote(db, guildId, userId, noteId, text) {
  const r = getRedis();
  const raw = await r.lrange(recentKey(userId), 0, -1);
  const hit = raw.find(x => { try { return JSON.parse(x).text === text; } catch { return false; } });
  if (!hit) return false;
  const { id } = JSON.parse(hit);
  await r.lrem(recentKey(userId), 1, hit);
  await db('UPDATE ticket_notes SET discord_message_id = ? WHERE id = ?', [id, noteId]);
  await r.set(linkKey(id), JSON.stringify({ guildId, noteId }), 'EX', LINK_TTL);
  return true;
}

async function linkedNote(messageId) {
  const raw = await getRedis().get(linkKey(messageId)).catch(() => null);
  if (!raw) return null;
  const { guildId, noteId } = JSON.parse(raw);
  const db = getTenantDb(guildId);
  const [note] = await db(
    `SELECT n.id, n.ticket_id, n.author_id, n.author_tag, n.content, n.source, n.created_at, n.edit_history, n.edited_at, n.deleted_at, t.channel_id, t.status
     FROM ticket_notes n JOIN tickets t ON t.id = n.ticket_id WHERE n.id = ? AND n.discord_message_id = ?`,
    [noteId, messageId]
  );
  return note ? { db, guildId, note } : null;
}

async function notifyChannel(client, note, text) {
  if (note.status !== 'open') return;
  const ch = await client.channels.fetch(note.channel_id).catch(() => null);
  if (ch?.isTextBased()) await ch.send({ content: text.slice(0, 2000), allowedMentions: { parse: [] } }).catch(() => null);
}

const quote = s => String(s || '').split('\n').map(l => `> ${l}`).join('\n').slice(0, 900);

async function publish(db, guildId, noteId, ticketId) {
  const [n] = await db('SELECT id, author_id, author_tag, content, source, created_at, edited_at, edit_history, deleted_at, pinned_at, pinned_by_tag FROM ticket_notes WHERE id = ?', [noteId]);
  if (n) broadcast('note_update', { ticketId, note: { ...n, edit_history: parseJsonField(n.edit_history, null) } }, guildId);
}

// Raw MESSAGE_UPDATE of a DM
async function handleDmEdit(client, d) {
  if (d.guild_id || d.content === undefined || !d.edited_timestamp || d.author?.bot) return;
  const found = await linkedNote(d.id);
  if (!found || found.note.deleted_at) return;
  const { db, guildId, note } = found;
  const attachments = Array.isArray(d.attachments) ? d.attachments.map(a => ({ url: a.url })) : [];
  const text = noteText(d.content?.trim() || '', attachments);
  if (!text || text === note.content) return;
  const history = [...(parseJsonField(note.edit_history, []) || []), { content: note.content, at: new Date().toISOString() }].slice(-MAX_HISTORY);
  await db('UPDATE ticket_notes SET content = ?, edit_history = ?, edited_at = NOW() WHERE id = ?', [text, JSON.stringify(history), note.id]);
  await publish(db, guildId, note.id, note.ticket_id);
  await notifyChannel(client, note, `✏️ **${note.author_tag}** a modifié son message :\n${quote(text)}\n*Avant :*\n${quote(note.content)}`);
}

// Raw MESSAGE_DELETE of a DM (the content stays visible to the staff, marked as deleted)
async function handleDmDelete(client, d) {
  if (d.guild_id) return;
  const found = await linkedNote(d.id);
  if (!found || found.note.deleted_at) return;
  const { db, guildId, note } = found;
  await db('UPDATE ticket_notes SET deleted_at = NOW() WHERE id = ?', [note.id]);
  await publish(db, guildId, note.id, note.ticket_id);
  await notifyChannel(client, note, `🗑️ **${note.author_tag}** a supprimé ce message de ses MP :\n${quote(note.content)}`);
}

module.exports = { noteText, rememberDm, linkDmNote, handleDmEdit, handleDmDelete };

// Tickets without any Discord channel (ticket format « database », Paramètres → Tickets): the
// conversation lives only in the database and is handled from the dashboard; the member still
// writes and reads by DM (or in the member space). Such a ticket gets a virtual channel ID
// (« db-… ») instead of a Discord one, and a virtual channel object that answers what the ticket
// code expects from a channel: sending, renaming or deleting does nothing on Discord, and its
// messages are rebuilt from the ticket history (transcript at closing). No call ever reaches
// Discord with a virtual ID: ChannelManager.fetch refuses it right away, like an unknown channel.
const crypto = require('crypto');
const { Collection, ChannelManager, ChannelType } = require('discord.js');

const PREFIX = 'db-';
const isVirtualChannelId = id => typeof id === 'string' && id.startsWith(PREFIX);
const newVirtualChannelId = () => `${PREFIX}${crypto.randomBytes(9).toString('base64url')}`;

// Unknown channel, without asking Discord (the callers already catch an unknown channel)
if (!ChannelManager.prototype.fetch.__virtualAware) {
  const original = ChannelManager.prototype.fetch;
  ChannelManager.prototype.fetch = function fetch(id, ...rest) {
    if (isVirtualChannelId(id)) return Promise.reject(Object.assign(new Error('Unknown Channel'), { code: 10003, status: 404 }));
    return original.call(this, id, ...rest);
  };
  ChannelManager.prototype.fetch.__virtualAware = true;
}

// History visible to the member, as Discord-like messages (internal notes never included)
const PUBLIC_SOURCES = ['user', 'reply', 'scheduled', 'system'];
function toMessage(note, owner) {
  const isStaff = note.source !== 'user';
  const files = String(note.content || '').match(/https?:\/\/\S+/g) || [];
  return {
    id: String(note.id),
    createdTimestamp: new Date(note.created_at).getTime(),
    content: note.content || '',
    author: {
      id: note.source === 'system' ? 'system' : String(note.author_id || ''),
      tag: note.source === 'system' ? 'Système' : note.author_tag || (isStaff ? 'Support' : owner),
      username: note.author_tag || 'Support',
      bot: note.source === 'system',
      displayAvatarURL: () => null,
    },
    attachments: new Collection(files.filter(u => /cdn\.discordapp\.(com|net)\/attachments\//.test(u)).map((url, i) => [String(i), { url, name: url.split('/').pop().split('?')[0], size: 0, contentType: null }])),
    embeds: [],
  };
}

// The virtual channel of a ticket (or of a ticket being created: ticket = { channel_id, subject… })
function virtualChannel(db, ticket) {
  const id = ticket.channel_id;
  return {
    id,
    virtual: true,
    name: ticket.subject || `ticket-${ticket.id || ''}`,
    type: ChannelType.GuildText,
    parentId: null,
    isThread: () => false,
    isTextBased: () => true,
    send: async () => null,
    setTopic: async () => null,
    setName: async () => null,
    setParent: async () => null,
    delete: async () => null,
    permissionOverwrites: { cache: new Collection(), edit: async () => null, delete: async () => null, set: async () => null },
    messages: {
      // Newest first, 100 at most, before a given ID: what transcript.js pages through
      fetch: async ({ limit = 100, before } = {}) => {
        const [t] = await db('SELECT id, owner_tag FROM tickets WHERE channel_id = ?', [id]);
        if (!t) return new Collection();
        const rows = await db(
          `SELECT id, author_id, author_tag, content, source, created_at FROM ticket_notes
           WHERE ticket_id = ? AND source IN (?) AND deleted_at IS NULL ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
          before ? [t.id, PUBLIC_SOURCES, Number(before), Math.min(100, limit)] : [t.id, PUBLIC_SOURCES, Math.min(100, limit)]
        );
        return new Collection(rows.map(n => [String(n.id), toMessage(n, t.owner_tag)]));
      },
    },
  };
}

// Discord channel of a ticket, or its virtual channel; null when the Discord channel is gone
async function ticketChannel(client, db, ticket) {
  if (!ticket?.channel_id) return null;
  if (isVirtualChannelId(ticket.channel_id)) return virtualChannel(db, ticket);
  return client ? client.channels.fetch(ticket.channel_id).catch(() => null) : null;
}

module.exports = { PREFIX, isVirtualChannelId, newVirtualChannelId, virtualChannel, ticketChannel };

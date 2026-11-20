// Requesters of the web portal without Discord (v4 PR 10, conception/v4.md §3.7): signed in to the
// member space with a link sent by e-mail, they get the identity « web:<hash of the address> ».
// The address is kept in email_contacts like for e-mail tickets (so the contact card shows it);
// what the bot would send them by DM goes out through the instance e-mail, with a link to the
// conversation in the member space (they answer there).
const crypto = require('crypto');
const { getTenantDb } = require('./tenantDb');

const WEB_RE = /^web:[0-9a-f]{24}$/;
const isWebOwner = id => WEB_RE.test(String(id || ''));
const hashOf = address => crypto.createHash('sha256').update(String(address).trim().toLowerCase()).digest('hex').slice(0, 24);
const webOwnerIdFor = address => `web:${hashOf(address)}`;

// Address of the requester in this space (written when they open or answer a ticket)
async function rememberAddress(db, ownerId, address) {
  await db('INSERT INTO email_contacts (owner_id, address) VALUES (?, ?) ON DUPLICATE KEY UPDATE address = VALUES(address)',
    [ownerId, String(address).toLowerCase().slice(0, 254)]);
}

// Sends what the bot would have sent by DM; returns a message-like object (or null)
async function sendToWebOwner(guildId, ownerId, build, ticketId = null, opts = {}) {
  const db = getTenantDb(guildId);
  const [contact] = await db('SELECT address FROM email_contacts WHERE owner_id = ?', [ownerId]).catch(() => []);
  if (!contact) return null;
  const { renderPayload, EMAIL_RE } = require('./emailTickets');
  if (!EMAIL_RE.test(contact.address)) return null;
  const payload = await build(webUserFor(ownerId, contact.address));
  // Signatures follow a staff reply here too (the instance's e-mail template holds the text)
  const look = await require('./emailTickets').emailLook(db, guildId, await require('./emailTickets').emailSettings(db), opts.sender);
  const { text } = renderPayload(payload, { signatures: look.signatures });
  if (!text) return null;
  const ticket = await require('./emailTickets').requesterTicket(db, ownerId, ticketId);
  // Live chat (v7, utils/liveChat.js): the visitor reads it in the widget, no e-mail while they are there
  const chatting = await require('./redis').getRedis().get(`chatopen:${ownerId}`).catch(() => null)
    || await require('./liveChat').visitorOnline(db, ticket?.id).catch(() => false);
  if (chatting) return { id: `chat-${Date.now()}`, channelId: null, email: false, attachments: { first: () => null } };
  const { ticketWebUrl, portalUrl } = require('./memberPortal');
  const link = (ticket && await ticketWebUrl(guildId, ticket.id).catch(() => null)) || portalUrl() || '';
  const { globalQuery } = require('./globalDb');
  const [space] = await globalQuery('SELECT guild_name FROM guilds WHERE guild_id = ?', [guildId]).catch(() => []);
  try {
    await require('./instanceMail').sendInstanceMail({
      to: contact.address, template: 'portalMessage', lang: require('./i18n').lang(),
      vars: { space: space?.guild_name || 'Support', id: ticket?.id || '—', body: text, link },
    });
    return { id: `web-${Date.now()}`, channelId: null, email: true, attachments: { first: () => null } };
  } catch { return null; }
}

// A user-like object for the ticket code (like the e-mail one): « send » is an instance e-mail
// name: the one given in the web widget, else the address
const webUserFor = (ownerId, address, guildId = null, name = '') => ({
  id: ownerId, username: (name || address).slice(0, 100), tag: address.slice(0, 100), bot: false,
  send: async payload => (guildId ? sendToWebOwner(guildId, ownerId, () => payload) : null),
});

module.exports = { WEB_RE, isWebOwner, webOwnerIdFor, rememberAddress, sendToWebOwner, webUserFor };

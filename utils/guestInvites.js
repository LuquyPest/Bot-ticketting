// Temporary guest access: a founder shares chosen tickets, read-only, with someone outside the
// server (a partner's moderator, a lawyer…). The link carries a token whose hash only is stored;
// it names the server (gi_<guildId>_<64 hex>) so the right database is found, like API keys.
const crypto = require('crypto');
const { globalQuery } = require('./globalDb');
const { getTenantDb } = require('./tenantDb');
const { parseJsonField } = require('./jsonField');

const TOKEN_RE = /^gi_(\d{17,20})_([a-f0-9]{64})$/;
const DURATIONS = { '1h': 3600, '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };
const hash = token => crypto.createHash('sha256').update(token).digest('hex');

function newToken(guildId) {
  const token = `gi_${guildId}_${crypto.randomBytes(32).toString('hex')}`;
  return { token, tokenHash: hash(token) };
}

const parse = row => ({ ...row, ticket_ids: (parseJsonField(row.ticket_ids, []) || []).map(Number), include_notes: !!row.include_notes });
const isLive = inv => !inv.revoked_at && new Date(inv.expires_at) > new Date();

// Token → { guildId, db, invite } when the invitation is valid, else null
async function resolveToken(token) {
  const m = TOKEN_RE.exec(String(token || ''));
  if (!m) return null;
  const guildId = m[1];
  const [guild] = await globalQuery("SELECT guild_id FROM guilds WHERE guild_id = ? AND status = 'active'", [guildId]);
  if (!guild) return null;
  const db = getTenantDb(guildId);
  const [row] = await db('SELECT * FROM guest_invites WHERE token_hash = ?', [hash(token)]);
  if (!row || !isLive(row)) return null;
  return { guildId, db, invite: parse(row) };
}

// The invitation behind a guest session, still valid (expiry and revocation checked every time)
async function sessionInvite(guest) {
  if (!guest?.guildId || !guest?.inviteId) return null;
  // A suspended or removed server closes its guest accesses at once
  const [guild] = await globalQuery("SELECT guild_id FROM guilds WHERE guild_id = ? AND status = 'active'", [guest.guildId]);
  if (!guild) return null;
  const db = getTenantDb(guest.guildId);
  const [row] = await db('SELECT * FROM guest_invites WHERE id = ?', [guest.inviteId]).catch(() => []);
  if (!row || !isLive(row)) return null;
  return { db, invite: parse(row) };
}

// Messages a guest may read: the conversation, plus internal notes and staff channel messages
// only when the founder allowed it
function guestSources(invite) {
  return invite.include_notes ? ['user', 'reply', 'scheduled', 'system', 'web', 'discord'] : ['user', 'reply', 'scheduled', 'system'];
}

// Is this attachment link part of a message the guest may read? (image previews)
async function guestCanSeeAttachment(guest, url) {
  const found = await sessionInvite(guest);
  if (!found || !found.invite.ticket_ids.length) return false;
  const like = `%${String(url).replace(/[%_\\]/g, '\\$&')}%`;
  const [row] = await found.db('SELECT id FROM ticket_notes WHERE ticket_id IN (?) AND source IN (?) AND content LIKE ? LIMIT 1',
    [found.invite.ticket_ids, guestSources(found.invite), like]);
  return !!row;
}

module.exports = { guestCanSeeAttachment, TOKEN_RE, DURATIONS, newToken, resolveToken, sessionInvite, guestSources, parse, isLive };

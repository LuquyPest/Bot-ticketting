// Live chat in the web widget (v7, conception/v7.md §3.7). When the space turned it on and someone
// of the staff is « available », the widget offers to chat: the visitor gives a name, an address and
// a first message, a ticket opens (from « web:<address> », like a widget ticket) and a chat session
// is returned — a random token the widget keeps. The visitor's messages reach the ticket like the
// member space's; the staff answers from the ticket view as usual and the widget picks the answers
// up every few seconds. While the visitor is there (seen less than 45 s ago) the answers are not
// also e-mailed; once they leave, everything goes on by e-mail as for any web ticket. The ticket
// keeps the whole conversation (its transcript).
const crypto = require('crypto');

const ONLINE_MS = 45000;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const TOKEN_RE = /^[A-Za-z0-9_-]{30,60}$/;

async function enabled(db) {
  const [c] = await db('SELECT widget_chat FROM guild_config WHERE id = 1').catch(() => []);
  return Number(c?.widget_chat) === 1;
}
// Someone to answer: a staff member whose availability is « available » and not on holiday
async function available(db) {
  if (!(await enabled(db))) return false;
  const [r] = await db("SELECT COUNT(*) AS n FROM dashboard_users WHERE role IN ('support', 'fondateur') AND availability = 'available' AND COALESCE(vacation_mode, 0) = 0").catch(() => [{ n: 0 }]);
  return Number(r?.n) > 0;
}

async function startSession(db, ticketId, ownerId) {
  const token = crypto.randomBytes(30).toString('base64url');
  await db('INSERT INTO chat_sessions (token_hash, ticket_id, owner_id, last_seen_at) VALUES (?, ?, ?, NOW(3))', [sha(token), ticketId, ownerId]);
  return token;
}
// The session of a token (and its ticket), seen now
async function sessionOf(db, token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const [s] = await db('SELECT s.*, t.status, t.owner_id AS ticket_owner FROM chat_sessions s JOIN tickets t ON t.id = s.ticket_id WHERE s.token_hash = ?', [sha(token)]);
  if (!s || s.ended_at) return null;
  await db('UPDATE chat_sessions SET last_seen_at = NOW(3) WHERE id = ?', [s.id]);
  return s;
}
async function endSession(db, id) { await db('UPDATE chat_sessions SET ended_at = NOW() WHERE id = ?', [id]); }

// The conversation after a note id: the visitor's messages and the staff's answers (never notes)
async function messages(db, ticketId, after = 0) {
  const rows = await db(`SELECT id, source, author_tag, content, created_at FROM ticket_notes WHERE ticket_id = ? AND id > ? AND source IN ('user', 'reply', 'scheduled')
    ORDER BY id LIMIT 100`, [ticketId, Math.max(0, Number(after) || 0)]);
  return rows.map(r => ({ id: r.id, from: r.source === 'user' ? 'visitor' : 'staff', author: r.source === 'user' ? null : String(r.author_tag || '').replace(/ \(anonyme\)$/, '').replace(/^.* \(anonyme\)$/, 'Support'), text: r.content, at: r.created_at }));
}

// Is the visitor of this ticket in the chat right now? (utils/webRequesters.js skips the e-mail)
async function visitorOnline(db, ticketId) {
  if (!ticketId) return false;
  const [s] = await db('SELECT last_seen_at FROM chat_sessions WHERE ticket_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1', [ticketId]).catch(() => []);
  return !!s && Date.now() - new Date(s.last_seen_at).getTime() < ONLINE_MS;
}
// For the ticket view: a chat ticket, and whether the visitor is there
async function stateOf(db, ticketId) {
  const [s] = await db('SELECT last_seen_at, ended_at FROM chat_sessions WHERE ticket_id = ? ORDER BY id DESC LIMIT 1', [ticketId]).catch(() => []);
  if (!s) return null;
  return { online: !s.ended_at && Date.now() - new Date(s.last_seen_at).getTime() < ONLINE_MS, ended: !!s.ended_at };
}

module.exports = { ONLINE_MS, enabled, available, startSession, sessionOf, endSession, messages, visitorOnline, stateOf };

// Files sent by the requester from the member space or the web widget (v5.0): the same rules as
// the attachments of an e-mail (utils/emailAttachments.js: kept or not, size, total space, refused
// types, retention, copy in the Discord channel). The message names each file (« 📎 name (size) »).
const multer = require('multer');
const attach = require('./emailAttachments');

const MAX_FILES = 5;
// Hard cap of the upload itself; the space's own limit (≤ 25 Mo) is applied by decide()
const upload = (maxFiles = MAX_FILES) => multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: maxFiles, fields: 20, fieldSize: 64 * 1024 } }).array('files', maxFiles);

// What the requester is allowed to send here: for the form
async function uploadRules(db) {
  const s = attach.attachSettings(await require('./emailTickets').emailSettings(db));
  return { enabled: s.enabled, maxMb: s.maxMb, blocked: s.blocked, maxFiles: MAX_FILES };
}

// Posts « text + one line per file » in the ticket as the requester, then keeps the files linked
// to that message. → { sent, files: [{ name, kept, line }] } ; sent false if the ticket is unreachable
async function addFiles({ db, guildId, tm, ticket, user, files, text = '' }) {
  const s = await require('./emailTickets').emailSettings(db);
  const decisions = await attach.decide(db, (files || []).map(f => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype, size: f.size })), s);
  const body = [text, ...decisions.map(d => d.line)].filter(Boolean).join('\n');
  const sent = await tm.relayToTicket(ticket, user, body, []);
  if (!sent) return { sent: false, files: [] };
  if (decisions.some(d => d.keep)) {
    const [note] = await db("SELECT MAX(id) AS id FROM ticket_notes WHERE ticket_id = ? AND author_id = ? AND source = 'user'", [ticket.id, String(user.id)]);
    const rows = await attach.store(db, guildId, ticket.id, note?.id || null, decisions);
    if (attach.attachSettings(s).postDiscord) await attach.postToChannel(await tm.channelOf(ticket), rows).catch(() => null);
  }
  return { sent: true, files: decisions.map(d => ({ name: d.name, kept: d.keep, line: d.line })) };
}

module.exports = { MAX_FILES, upload, uploadRules, addFiles };

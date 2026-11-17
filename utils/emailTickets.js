// Tickets by e-mail (Paramètres → Intégrations → Tickets par e-mail), per server: a support mailbox
// read over IMAP every minute, replies sent over SMTP. Someone who writes to the address gets a
// ticket like a member who writes to the bot: same channel (or thread, or none), same dashboard,
// same automations. Their identity is « mail:<hash> » (email_contacts keeps the address), and
// every message the bot would send them by DM (welcome, staff replies, closing…) goes out by
// e-mail instead — utils/i18n.js sendToMember hands them over to sendToEmailOwner().
//
// Threading: the subject carries « [#<ticket>-<token>] », the token being an HMAC of the server
// and ticket: an answer lands in its ticket only with the right token and from the address that
// opened it (a forged sender cannot write into someone else's ticket without the token).
// Safety: the IMAP and SMTP hosts must resolve to public addresses (EMAIL_ALLOW_PRIVATE_HOSTS=true
// for a mail server on the local network), standard ports only; automatic replies, bounces and
// mailing lists are ignored; 10 messages per hour per sender and 60 new tickets per hour per server.
// Attachments: kept or refused per the server's settings (utils/emailAttachments.js).
const crypto = require('crypto');
const { config } = require('./config');
const { getTenantDb } = require('./tenantDb');
const { seal, open } = require('./secretBox');

const OWNER_RE = /^mail:[0-9a-f]{24}$/;
const isEmailOwner = id => OWNER_RE.test(String(id || ''));
const ownerIdFor = address => `mail:${crypto.createHash('sha256').update(String(address).trim().toLowerCase()).digest('hex').slice(0, 24)}`;
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,253}\.[a-z]{2,}$/i;
const IMAP_PORTS = [993, 143];
const SMTP_PORTS = [465, 587, 25, 2525];
const MAX_PER_RUN = 25;
const MAX_BYTES = 10 * 1024 * 1024;
const NEW_PER_HOUR = 60; // new tickets by e-mail per server and per hour (spam with made-up senders)

// Discord never sees these IDs: discord.js answers « unknown user » without a request
const { UserManager } = require('discord.js');
if (!UserManager.prototype.fetch.__emailAware) {
  const original = UserManager.prototype.fetch;
  UserManager.prototype.fetch = function fetch(id, ...rest) {
    if (isEmailOwner(id)) return Promise.reject(Object.assign(new Error('Unknown User'), { code: 10013, status: 404 }));
    return original.call(this, id, ...rest);
  };
  UserManager.prototype.fetch.__emailAware = true;
}

// ── Settings ──
const SECRET_COLUMNS = ['imap_password', 'smtp_password'];
async function emailSettings(db, { withSecrets = false } = {}) {
  const [row] = await db('SELECT * FROM email_settings WHERE id = 1').catch(() => []);
  if (!row) return { enabled: false, imap_port: 993, smtp_port: 587 };
  const out = { ...row, enabled: !!Number(row.enabled) };
  for (const c of SECRET_COLUMNS) {
    out[`${c}_set`] = !!row[c];
    if (withSecrets) { try { out[c] = row[c] ? open(row[c]) : null; } catch { out[c] = null; } } else delete out[c];
  }
  return out;
}

// input: { enabled, address, displayName, imapHost, imapPort, imapUser, imapPassword, smtpHost,
// smtpPort, smtpUser, smtpPassword } — a password left empty keeps the saved one
function cleanSettings(input = {}) {
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const host = v => { const h = str(v, 255).toLowerCase(); return /^[a-z0-9.-]+$/.test(h) && h.includes('.') ? h : null; };
  const out = {
    enabled: input.enabled === true,
    address: str(input.address, 254).toLowerCase(),
    display_name: str(input.displayName, 100) || null,
    imap_host: host(input.imapHost), imap_port: Number(input.imapPort) || 993, imap_user: str(input.imapUser, 254) || null,
    smtp_host: host(input.smtpHost), smtp_port: Number(input.smtpPort) || 587, smtp_user: str(input.smtpUser, 254) || null,
  };
  if (out.address && !EMAIL_RE.test(out.address)) return { error: 'Adresse e-mail invalide' };
  if (!IMAP_PORTS.includes(out.imap_port)) return { error: `Port IMAP accepté : ${IMAP_PORTS.join(' ou ')}` };
  if (!SMTP_PORTS.includes(out.smtp_port)) return { error: `Port SMTP accepté : ${SMTP_PORTS.join(', ')}` };
  if (input.imapHost && !out.imap_host) return { error: 'Serveur IMAP invalide' };
  if (input.smtpHost && !out.smtp_host) return { error: 'Serveur SMTP invalide' };
  if (out.enabled && (!out.address || !out.imap_host || !out.smtp_host || !out.imap_user || !out.smtp_user)) {
    return { error: 'Pour activer, renseigne l\'adresse, les serveurs IMAP et SMTP et leurs identifiants' };
  }
  for (const [k, c] of [['imapPassword', 'imap_password'], ['smtpPassword', 'smtp_password']]) {
    if (typeof input[k] === 'string' && input[k]) out[c] = seal(input[k].slice(0, 500));
  }
  return { value: out };
}

async function saveEmailSettings(db, input) {
  const { value, error } = cleanSettings(input);
  if (error) return { error };
  const att = require('./emailAttachments').cleanAttachInput(input.attachments);
  if (att.error) return { error: att.error };
  Object.assign(value, att.value || {});
  const cols = Object.keys(value);
  await db(`INSERT INTO email_settings (id, ${cols.join(', ')}) VALUES (1, ${cols.map(() => '?').join(', ')})
            ON DUPLICATE KEY UPDATE ${cols.map(c => `${c} = VALUES(${c})`).join(', ')}`, cols.map(c => value[c]));
  const saved = await emailSettings(db);
  if (saved.enabled && (!saved.imap_password_set || !saved.smtp_password_set)) {
    await db('UPDATE email_settings SET enabled = 0 WHERE id = 1');
    return { error: 'Renseigne les mots de passe IMAP et SMTP avant d\'activer' };
  }
  return { value: saved };
}

// ── Connections (public hosts only, pinned address, TLS checked against the host name) ──
async function pinnedHost(host) {
  if (process.env.EMAIL_ALLOW_PRIVATE_HOSTS === 'true') return host;
  const ip = await require('./webhookEmitter').resolveAndPin(host);
  if (!ip) throw Object.assign(new Error(`${host} : adresse privée ou introuvable`), { expose: true });
  return ip;
}

async function smtpTransport(s) {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: await pinnedHost(s.smtp_host), port: s.smtp_port, secure: s.smtp_port === 465,
    requireTLS: s.smtp_port === 587, tls: { servername: s.smtp_host },
    // No account: a relay that accepts the server without signing in (local network, port 25)
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_password } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
}

async function imapClient(s) {
  const { ImapFlow } = require('imapflow');
  return new ImapFlow({
    host: await pinnedHost(s.imap_host), port: s.imap_port, secure: s.imap_port === 993,
    servername: s.imap_host, tls: { servername: s.imap_host },
    auth: { user: s.imap_user, pass: s.imap_password },
    logger: false, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 60000,
  });
}

// Checks both connections with the saved settings
async function testEmailSettings(db) {
  const s = await emailSettings(db, { withSecrets: true });
  const result = { imap: null, smtp: null };
  try { const c = await imapClient(s); await c.connect(); await c.logout(); result.imap = { ok: true }; }
  catch (err) { result.imap = { ok: false, error: String(err.responseText || err.message).slice(0, 200) }; }
  try { const t = await smtpTransport(s); await t.verify(); t.close(); result.smtp = { ok: true }; }
  catch (err) { result.smtp = { ok: false, error: String(err.message).slice(0, 200) }; }
  return result;
}

// ── Threading ──
const tokenFor = (guildId, ticketId) => crypto.createHmac('sha256', config.dashboard?.sessionSecret || 'ticketbot').update(`email:${guildId}:${ticketId}`).digest('hex').slice(0, 8);
const subjectTag = (guildId, ticketId) => `[#${ticketId}-${tokenFor(guildId, ticketId)}]`;
const domainOf = address => String(address || '').split('@')[1] || 'localhost';

// Ticket an incoming message belongs to: [#id-token] in the subject, or our Message-ID in the thread
function threadTicketId(guildId, mail) {
  const hay = [mail.subject, mail.inReplyTo, ...(Array.isArray(mail.references) ? mail.references : [mail.references])].filter(Boolean).join(' ');
  for (const m of hay.matchAll(/(?:\[#|<ticket-)(\d{1,9})[-.]([0-9a-f]{8})/g)) {
    const id = Number(m[1]);
    const expected = tokenFor(guildId, id);
    if (m[2].length === expected.length && crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(expected))) return id;
  }
  return null;
}

// ── Contacts ──
async function contactOf(db, ownerId) {
  const [c] = await db('SELECT address, name FROM email_contacts WHERE owner_id = ?', [ownerId]).catch(() => []);
  return c || null;
}
async function upsertContact(db, address, name) {
  const ownerId = ownerIdFor(address);
  await db('INSERT INTO email_contacts (owner_id, address, name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = COALESCE(VALUES(name), name)',
    [ownerId, address.toLowerCase().slice(0, 254), name ? String(name).slice(0, 100) : null]);
  return ownerId;
}
// A user-like object for the ticket code; what is « sent » to it by DM goes out as an e-mail
const userFor = (ownerId, address, name, guildId = null) => ({
  id: ownerId, username: (name || address).slice(0, 100), tag: address.slice(0, 100), bot: false,
  send: async payload => (guildId ? sendToEmailOwner(guildId, ownerId, () => payload) : null),
});

// ── Outgoing: a Discord message built for a member, sent as an e-mail ──
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stripMarkdown = s => String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/<t:(\d+)(?::\w)?>/g, (m, t) => new Date(Number(t) * 1000).toLocaleString('fr-FR'));
function renderPayload(payload) {
  const p = typeof payload === 'string' ? { content: payload } : payload || {};
  const blocks = [];
  if (p.content) blocks.push(stripMarkdown(p.content));
  for (const e of p.embeds || []) {
    const d = typeof e?.toJSON === 'function' ? e.toJSON() : e?.data || e || {};
    const lines = [];
    if (d.title) lines.push(stripMarkdown(d.title));
    if (d.description) lines.push(stripMarkdown(d.description));
    for (const f of d.fields || []) lines.push(`${stripMarkdown(f.name)} : ${stripMarkdown(f.value)}`);
    if (d.footer?.text) lines.push(`— ${stripMarkdown(d.footer.text)}`);
    if (lines.length) blocks.push(lines.join('\n\n'));
  }
  const text = blocks.join('\n\n────────\n\n').trim();
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#1f2330">${
    blocks.map(b => `<p>${escapeHtml(b).replace(/\n/g, '<br>')}</p>`).join('<hr style="border:0;border-top:1px solid #ddd">')}</div>`;
  const attachments = (p.files || []).filter(f => f?.attachment && Buffer.isBuffer(f.attachment)).map(f => ({ filename: f.name || 'fichier', content: f.attachment }));
  return { text, html, attachments };
}

// Sends what the bot would have sent by DM; returns a message-like object (or null)
async function sendToEmailOwner(guildId, ownerId, build) {
  const db = getTenantDb(guildId);
  const s = await emailSettings(db, { withSecrets: true });
  if (!s.enabled) return null;
  const contact = await contactOf(db, ownerId);
  if (!contact) return null;
  const payload = await build(userFor(ownerId, contact.address, contact.name));
  const [ticket] = await db("SELECT id, subject FROM tickets WHERE owner_id = ? ORDER BY status = 'open' DESC, id DESC LIMIT 1", [ownerId]);
  const { text, html, attachments } = renderPayload(payload);
  if (!text && !attachments.length) return null;
  const [thread] = ticket ? await db('SELECT last_message_id FROM email_threads WHERE ticket_id = ?', [ticket.id]) : [];
  const messageId = `<ticket-${ticket?.id || 0}.${ticket ? tokenFor(guildId, ticket.id) : 'x'}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}@${domainOf(s.address)}>`;
  try {
    const transport = await smtpTransport(s);
    const info = await transport.sendMail({
      from: s.display_name ? { name: s.display_name, address: s.address } : s.address,
      to: contact.name ? { name: contact.name, address: contact.address } : contact.address,
      subject: ticket ? `${subjectTag(guildId, ticket.id)} ${ticket.subject || 'Support'}` : 'Support',
      text, html, attachments, messageId,
      ...(thread?.last_message_id ? { inReplyTo: thread.last_message_id, references: [thread.last_message_id] } : {}),
      headers: { 'Auto-Submitted': 'auto-replied' },
    });
    transport.close?.();
    if (ticket) await db('INSERT INTO email_threads (ticket_id, last_message_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_message_id = VALUES(last_message_id)', [ticket.id, messageId]);
    return { id: info?.messageId || messageId, channelId: null, email: true, attachments: { first: () => null } };
  } catch (err) {
    await db('UPDATE email_settings SET last_error = ? WHERE id = 1', [`Envoi : ${err.message}`.slice(0, 300)]).catch(() => null);
    return null;
  }
}

// ── Incoming ──
const AUTO = mail => {
  const h = name => String(mail.headers?.get?.(name) || '').toLowerCase();
  const from = String(mail.from?.value?.[0]?.address || '').toLowerCase();
  return (h('auto-submitted') && h('auto-submitted') !== 'no')
    || ['bulk', 'junk', 'list', 'auto_reply'].includes(h('precedence'))
    || !!mail.headers?.get?.('list-id') || !!mail.headers?.get?.('x-autoreply') || !!mail.headers?.get?.('x-autorespond')
    || /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/.test(from);
};

// Keeps what the person wrote: quoted history (« > », « Le … a écrit : », « On … wrote: ») removed
function newText(mail) {
  let text = String(mail.text || '').replace(/\r\n/g, '\n');
  if (!text && mail.html) text = String(mail.html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^(le|on|am|el|il|em)\s.{4,200}(a écrit|wrote|schrieb|escribió|ha scritto|escreveu)\s*:\s*$/i.test(line.trim())) break;
    if (/^-{2,}\s*(original message|message d'origine|ursprüngliche nachricht)/i.test(line.trim())) break;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
}

// One parsed message (mailparser) for a server, in the language the bot uses with that person.
// Returns what happened, for the tests and logs.
async function processEmail(client, guildId, mail, s) {
  const address = String(mail.from?.value?.[0]?.address || '').trim().toLowerCase();
  return require('./i18n').inMemberLang(ownerIdFor(address), guildId, client, () => processEmailInLang(client, guildId, mail, s));
}

async function processEmailInLang(client, guildId, mail, s) {
  const db = getTenantDb(guildId);
  const fromVal = mail.from?.value?.[0];
  const address = String(fromVal?.address || '').trim().toLowerCase();
  if (!EMAIL_RE.test(address) || address === String(s.address).toLowerCase()) return { skipped: 'expéditeur' };
  if (AUTO(mail)) return { skipped: 'automatique' };
  const ownerId = ownerIdFor(address);
  const { createManager } = require('./ticketManager');
  const tm = createManager(db, client, guildId);
  if (await tm.isBlacklisted(ownerId)) return { skipped: 'bloqué' };
  if (!(await require('./rateLimit').allowBurst(`mailin:${guildId}:${ownerId}`, 10, 3600 * 1000))) return { skipped: 'trop de messages' };

  // Attachments (inline images of a signature excluded): kept or refused per the server's settings
  const attach = require('./emailAttachments');
  const decisions = await attach.decide(db, (mail.attachments || []).filter(a => a.contentDisposition !== 'inline' || !a.contentId), s);
  const body = [newText(mail), ...decisions.map(d => d.line)].filter(Boolean).join('\n') || '*[aucun texte]*';
  // Once the message is in its ticket: the kept files are written, linked to that note
  const keepFiles = async ticket => {
    if (!decisions.some(d => d.keep)) return;
    const [note] = await db("SELECT MAX(id) AS id FROM ticket_notes WHERE ticket_id = ? AND author_id = ? AND source = 'user'", [ticket.id, ownerId]);
    const rows = await attach.store(db, guildId, ticket.id, note?.id || null, decisions);
    if (attach.attachSettings(s).postDiscord) await attach.postToChannel(await tm.channelOf(ticket), rows);
  };
  await upsertContact(db, address, fromVal?.name || null);
  const user = userFor(ownerId, address, fromVal?.name || null, guildId);

  // The answer to a ticket: right token, same sender, ticket still open
  const threadId = threadTicketId(guildId, mail);
  if (threadId) {
    const [t] = await db("SELECT * FROM tickets WHERE id = ? AND owner_id = ? AND status = 'open'", [threadId, ownerId]);
    if (t) {
      await tm.relayToTicket(t, user, body, []);
      await keepFiles(t).catch(err => console.error('email: pièces jointes', guildId, err.message));
      if (mail.messageId) await db('INSERT INTO email_threads (ticket_id, last_message_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_message_id = VALUES(last_message_id)', [t.id, String(mail.messageId).slice(0, 255)]);
      return { ticketId: t.id, created: false };
    }
  }
  const [cfg] = await db('SELECT max_tickets_per_day FROM guild_config WHERE id = 1');
  const openTicket = await tm.getOpenTicketByOwnerId(ownerId);
  if (!openTicket && cfg?.max_tickets_per_day && await tm.getDailyTicketCount(ownerId) >= cfg.max_tickets_per_day) return { skipped: 'limite quotidienne' };
  // Senders can be made up at will: new tickets by e-mail are capped per server as well
  if (!openTicket && !(await require('./rateLimit').allowBurst(`mailnew:${guildId}`, NEW_PER_HOUR, 3600 * 1000))) return { skipped: 'trop de nouveaux tickets par e-mail' };
  const subject = String(mail.subject || '').replace(/^\s*((re|fwd?|tr|aw|wg)\s*:\s*)+/i, '').trim().slice(0, 100) || null;
  const res = await tm.relayDmToTicket(user, body, [], subject);
  if (!res?.ticket) return { skipped: 'ticket impossible' };
  await keepFiles(res.ticket).catch(err => console.error('email: pièces jointes', guildId, err.message));
  if (mail.messageId) await db('INSERT INTO email_threads (ticket_id, last_message_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_message_id = VALUES(last_message_id)', [res.ticket.id, String(mail.messageId).slice(0, 255)]);
  if (res.created) await tm.sendWelcomeDm(user, true, subject, res.ticket.id).catch(() => null);
  return { ticketId: res.ticket.id, created: !!res.created };
}

// Reads the unread messages of a server's mailbox (BullMQ job « email-fetch », every minute)
async function fetchMailbox(client, guildId) {
  const db = getTenantDb(guildId);
  const s = await emailSettings(db, { withSecrets: true });
  if (!s.enabled) return { skipped: 'désactivé' };
  const { getRedis } = require('./redis');
  if (!(await getRedis().set(`lock:email:${guildId}`, '1', 'EX', 300, 'NX'))) return { skipped: 'déjà en cours' };
  const { simpleParser } = require('mailparser');
  let imap = null, handled = 0;
  try {
    imap = await imapClient(s);
    await imap.connect();
    const lock = await imap.getMailboxLock('INBOX');
    try {
      const uids = (await imap.search({ seen: false }, { uid: true })) || [];
      for (const uid of uids.slice(0, MAX_PER_RUN)) {
        const msg = await imap.fetchOne(String(uid), { source: true, size: true }, { uid: true });
        // Marked as read first: a message that breaks the parser is never read again and again
        await imap.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        if (!msg?.source || msg.size > MAX_BYTES) continue;
        const mail = await simpleParser(msg.source);
        await processEmail(client, guildId, mail, s).catch(err => console.error('email: message', guildId, err.message));
        handled++;
      }
    } finally { lock.release(); }
    await db('UPDATE email_settings SET last_fetch_at = NOW(), last_error = NULL WHERE id = 1');
    return { handled };
  } catch (err) {
    await db('UPDATE email_settings SET last_fetch_at = NOW(), last_error = ? WHERE id = 1', [`Réception : ${err.responseText || err.message}`.slice(0, 300)]).catch(() => null);
    return { error: err.message };
  } finally {
    await imap?.logout().catch(() => null);
    await getRedis().del(`lock:email:${guildId}`).catch(() => null);
  }
}

async function runEmailFetch(client) {
  const { globalQuery } = require('./globalDb');
  const guilds = await globalQuery("SELECT guild_id FROM guilds WHERE status = 'active'");
  let handled = 0;
  for (const { guild_id: guildId } of guilds) {
    const [on] = await getTenantDb(guildId)('SELECT enabled FROM email_settings WHERE id = 1 AND enabled = 1').catch(() => []);
    if (!on) continue;
    const r = await fetchMailbox(client, guildId);
    handled += r.handled || 0;
  }
  return { handled };
}

module.exports = {
  isEmailOwner, ownerIdFor, emailSettings, saveEmailSettings, testEmailSettings, sendToEmailOwner, processEmail,
  fetchMailbox, runEmailFetch, threadTicketId, subjectTag, tokenFor, renderPayload, newText, contactOf,
  smtpTransport, EMAIL_RE, SMTP_PORTS,
};

// Incoming e-mails pushed by a provider (v5.0, conception/v5.md §3.14), instead of reading the
// mailbox over IMAP: Mailgun, Postmark, SendGrid Inbound Parse, Amazon SES (through SNS).
//   POST /api/inbound/<provider>/<space>.<secret>   (web/routes/inboundEmail.js)
// Whatever the provider sends is turned into one MIME message and read by mailparser, so a pushed
// e-mail follows exactly the path of an e-mail read over IMAP (threads, rules, attachments, loops).
// Authentication: the secret of the URL (per space, sealed), plus the provider's own signature
// where there is one (Mailgun HMAC, SNS certificate).
const crypto = require('crypto');
const axios = require('axios');
const { seal, open } = require('./secretBox');
const { config } = require('./config');

const PROVIDERS = ['mailgun', 'postmark', 'sendgrid', 'ses'];
const LABELS = { mailgun: 'Mailgun', postmark: 'Postmark', sendgrid: 'SendGrid', ses: 'Amazon SES' };
const TOKEN_RE = /^(\d{17,20})\.([A-Za-z0-9_-]{40,60})$/;
const MAX_BYTES = 10 * 1024 * 1024; // as over IMAP
const base = () => (config.webServerBaseUrl || '').replace(/\/$/, '');
const err = (message, status = 400) => Object.assign(new Error(message), { status });

const urlOf = (provider, token) => (provider && token ? `${base()}/api/inbound/${provider}/${token}` : null);

// ── Settings of the space ──
function view(s) {
  let token = null;
  try { token = s.inbound_token ? open(s.inbound_token) : null; } catch { /* key changed */ }
  return {
    mode: s.inbound_mode === 'webhook' ? 'webhook' : 'imap',
    provider: PROVIDERS.includes(s.inbound_provider) ? s.inbound_provider : null,
    url: s.inbound_mode === 'webhook' ? urlOf(s.inbound_provider, token) : null,
    signingKeySet: !!s.inbound_secret, topicArn: s.inbound_topic || '', lastInboundAt: s.last_inbound_at || null,
  };
}

// { mode, provider, signingKey, topicArn } — a signing key left empty keeps the saved one
async function saveInbound(db, guildId, input = {}) {
  const mode = input.mode === 'webhook' ? 'webhook' : 'imap';
  const provider = mode === 'webhook' ? input.provider : null;
  if (mode === 'webhook' && !PROVIDERS.includes(provider)) return { error: 'Choisis le fournisseur qui reçoit les e-mails' };
  const topic = typeof input.topicArn === 'string' ? input.topicArn.trim() : '';
  if (topic && !/^arn:aws(-cn|-us-gov)?:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}$/.test(topic)) return { error: 'ARN de sujet SNS invalide (arn:aws:sns:<région>:<compte>:<nom>)' };
  if (provider === 'ses' && !topic) return { error: 'Amazon SES : renseigne l\'ARN du sujet SNS, seuls ses messages seront acceptés' };
  const [cur] = await db('SELECT inbound_token FROM email_settings WHERE id = 1').catch(() => []);
  const sets = { inbound_mode: mode, inbound_provider: provider, inbound_topic: topic || null };
  if (typeof input.signingKey === 'string' && input.signingKey.trim()) sets.inbound_secret = seal(input.signingKey.trim().slice(0, 300));
  if (mode === 'webhook' && !cur?.inbound_token) sets.inbound_token = seal(newToken(guildId));
  const cols = Object.keys(sets);
  await db(`INSERT INTO email_settings (id, ${cols.join(', ')}) VALUES (1, ${cols.map(() => '?').join(', ')})
            ON DUPLICATE KEY UPDATE ${cols.map(c => `${c} = VALUES(${c})`).join(', ')}`, cols.map(c => sets[c]));
  return { ok: true };
}
const newToken = guildId => `${guildId}.${crypto.randomBytes(32).toString('base64url')}`;
// A new URL: the one pasted at the provider stops working at once (in case it leaked)
async function regenerateToken(db, guildId) {
  await db('UPDATE email_settings SET inbound_token = ? WHERE id = 1', [seal(newToken(guildId))]);
}

// The space a pushed e-mail is for, or null (unknown space, wrong secret, other provider, off)
async function resolve(provider, token) {
  const m = TOKEN_RE.exec(String(token || ''));
  if (!m || !PROVIDERS.includes(provider)) return null;
  const { globalQuery } = require('./globalDb');
  const [g] = await globalQuery("SELECT guild_id FROM guilds WHERE guild_id = ? AND status = 'active'", [m[1]]).catch(() => []);
  if (!g) return null;
  const db = require('./tenantDb').getTenantDb(g.guild_id);
  const s = await require('./emailTickets').emailSettings(db, { withSecrets: true });
  let stored = null;
  try { const [row] = await db('SELECT inbound_token FROM email_settings WHERE id = 1'); stored = row?.inbound_token ? open(row.inbound_token) : null; } catch { return null; }
  if (!stored) return null;
  const a = Buffer.from(stored), b = Buffer.from(String(token));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!s.enabled || s.inbound_mode !== 'webhook' || s.inbound_provider !== provider) return null;
  let secret = null;
  try { secret = s.inbound_secret ? open(s.inbound_secret) : null; } catch { /* key changed */ }
  return { guildId: g.guild_id, db, s, secret };
}

// ── Turning a payload into a message ──
async function parseRaw(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
  if (!buf.length) throw err('Message vide');
  if (buf.length > MAX_BYTES) throw err('Message trop volumineux', 413);
  const mail = await require('mailparser').simpleParser(buf);
  mail._raw = buf; // kept if the message goes to the quarantine
  return mail;
}

// Fields → a MIME message (nodemailer's composer), then mailparser: the same object as over IMAP
async function compose({ from, to, cc, subject, text, html, messageId, inReplyTo, references, headers = {}, attachments = [] }) {
  const MailComposer = require('nodemailer/lib/mail-composer');
  const total = attachments.reduce((n, a) => n + (a.content?.length || 0), 0) + String(text || '').length + String(html || '').length;
  if (total > MAX_BYTES) throw err('Message trop volumineux', 413);
  const mail = new MailComposer({
    from, to, cc, subject: subject || '', text: text || undefined, html: html || undefined,
    messageId: messageId || undefined, inReplyTo: inReplyTo || undefined, references: references || undefined,
    headers, attachments: attachments.map(a => ({ filename: a.filename || 'fichier', content: a.content, contentType: a.contentType || 'application/octet-stream' })),
  });
  const raw = await new Promise((resolveP, reject) => mail.compile().build((e, out) => (e ? reject(e) : resolveP(out))));
  return parseRaw(raw);
}

// Headers worth keeping (threading, loops, routing): never From/To/Subject twice
const KEEP = ['auto-submitted', 'precedence', 'list-id', 'x-autoreply', 'x-autorespond', 'delivered-to', 'x-original-to', 'envelope-to', 'return-path'];
const pickHeaders = pairs => {
  const out = {};
  for (const [k, v] of pairs) if (KEEP.includes(String(k).toLowerCase()) && v != null) out[String(k).toLowerCase()] = String(v).slice(0, 1000);
  return out;
};
const filesOf = files => (Array.isArray(files) ? files : []).map(f => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype }));

// Mailgun « forward() »: the raw message when the route asks for it (URL ending in /mime), else
// the parsed fields. Signed with the webhook signing key: HMAC-SHA256(timestamp + token).
async function mailgun(body, files, secret) {
  if (secret) {
    const { timestamp, token, signature } = body;
    const ts = Number(timestamp);
    if (!ts || Math.abs(Date.now() / 1000 - ts) > 15 * 60) throw err('Signature Mailgun expirée', 401);
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}${token}`).digest('hex');
    if (typeof signature !== 'string' || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw err('Signature Mailgun invalide', 401);
    // The same signed request once only (a captured request replayed)
    if (!(await require('./redis').getRedis().set(`inbound:mg:${token}`, '1', 'EX', 3600, 'NX'))) throw err('Requête déjà reçue', 409);
  }
  if (body['body-mime']) return parseRaw(body['body-mime']);
  let headers = [];
  try { headers = JSON.parse(body['message-headers'] || '[]'); } catch { /* none */ }
  const h = name => (headers.find(([k]) => String(k).toLowerCase() === name) || [])[1];
  return compose({
    from: body.from || body.sender, to: body.To || body.recipient, cc: body.Cc, subject: body.subject,
    text: body['body-plain'], html: body['body-html'], messageId: body['Message-Id'] || h('message-id'),
    inReplyTo: body['In-Reply-To'] || h('in-reply-to'), references: body.References || h('references'),
    headers: pickHeaders(headers), attachments: filesOf(files),
  });
}

// Postmark inbound: JSON; the raw message when « Include raw email content » is on
async function postmark(body) {
  if (body.RawEmail) return parseRaw(body.RawEmail);
  const headers = (Array.isArray(body.Headers) ? body.Headers : []).map(x => [x?.Name, x?.Value]);
  const h = name => (headers.find(([k]) => String(k).toLowerCase() === name) || [])[1];
  const addr = x => (x?.Email ? (x.Name ? { name: x.Name, address: x.Email } : x.Email) : undefined);
  return compose({
    from: addr(body.FromFull) || body.From, to: (body.ToFull || []).map(addr).filter(Boolean), cc: (body.CcFull || []).map(addr).filter(Boolean),
    subject: body.Subject, text: body.TextBody, html: body.HtmlBody,
    messageId: h('message-id'), inReplyTo: h('in-reply-to'), references: h('references'), headers: pickHeaders(headers),
    attachments: (Array.isArray(body.Attachments) ? body.Attachments : []).slice(0, 20).map(a => ({ filename: a.Name, content: Buffer.from(String(a.Content || ''), 'base64'), contentType: a.ContentType })),
  });
}

// SendGrid Inbound Parse with « POST the raw, full MIME message »
async function sendgrid(body) {
  if (!body.email) throw err('SendGrid : coche « POST the raw, full MIME message » dans Inbound Parse');
  return parseRaw(body.email);
}

// ── Amazon SES through SNS: the SNS signature is checked with Amazon's certificate ──
const CERT_RE = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?\/SimpleNotificationService-[A-Za-z0-9]+\.pem$/;
const SUBSCRIBE_RE = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?\/\?Action=ConfirmSubscription&/;
const certs = new Map();
async function cert(url) {
  if (!CERT_RE.test(url)) throw err('Certificat SNS refusé', 401);
  const hit = certs.get(url);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.pem;
  const { data } = await axios.get(url, { timeout: 10000, maxContentLength: 64 * 1024, maxRedirects: 0, responseType: 'text' });
  if (!/BEGIN CERTIFICATE/.test(String(data))) throw err('Certificat SNS invalide', 401);
  certs.set(url, { pem: String(data), at: Date.now() });
  return String(data);
}
const SIGNED = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};
async function verifySns(m) {
  const keys = SIGNED[m?.Type];
  if (!keys) throw err('Message SNS inconnu');
  if (!(Math.abs(Date.now() - new Date(m.Timestamp).getTime()) < 3600 * 1000)) throw err('Message SNS expiré', 401);
  const text = keys.filter(k => m[k] !== undefined).map(k => `${k}\n${m[k]}\n`).join('');
  const v = crypto.createVerify(m.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1');
  v.update(text, 'utf8');
  if (!v.verify(await cert(m.SigningCertURL), String(m.Signature || ''), 'base64')) throw err('Signature SNS invalide', 401);
}
// { confirmed } for a subscription, or the message for a received e-mail
async function ses(body, topicArn) {
  const m = typeof body === 'string' ? JSON.parse(body) : body;
  await verifySns(m);
  if (!topicArn || m.TopicArn !== topicArn) throw err('Sujet SNS inattendu', 403);
  if (m.Type === 'SubscriptionConfirmation') {
    if (!SUBSCRIBE_RE.test(m.SubscribeURL || '')) throw err('Adresse de confirmation refusée', 401);
    await axios.get(m.SubscribeURL, { timeout: 10000, maxRedirects: 0 });
    return { confirmed: true };
  }
  const n = JSON.parse(m.Message || '{}');
  if (n.notificationType !== 'Received') return { ignored: n.notificationType || 'autre' };
  if (!n.content) throw err('Amazon SES : l\'action SNS doit inclure le message (taille de 150 Ko au plus)');
  const raw = n.receipt?.action?.encoding === 'BASE64' ? Buffer.from(n.content, 'base64') : n.content;
  return { mail: await parseRaw(raw) };
}

module.exports = { PROVIDERS, LABELS, view, saveInbound, regenerateToken, resolve, mailgun, postmark, sendgrid, ses, parseRaw, compose, urlOf, _certs: certs };

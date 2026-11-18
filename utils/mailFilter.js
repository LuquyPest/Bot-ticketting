// What comes into the support mailbox before it becomes a ticket (v5.0, conception/v5.md §3.14):
// import rules (refused domains or addresses, only some domains, size), the spam verdict the mail
// servers already wrote in the headers (SpamAssassin, Microsoft 365, Mailgun, Amazon SES, DMARC),
// loops between automatic replies, and a quarantine the founders review (release or delete).
const crypto = require('crypto');
const zlib = require('zlib');

const SPAM_ACTIONS = ['quarantine', 'drop', 'off'];
const QUARANTINE_MAX = 500;
const QUARANTINE_DAYS = 30;
const LOOP_MAX = 3;           // the same message from the same sender, within 24 hours
const norm = a => String(a || '').trim().toLowerCase();

// « exemple.com, @spam.test, quelqu.un@ex.fr » → ['exemple.com', 'spam.test', 'quelqu.un@ex.fr']
function parseList(text) {
  return [...new Set(String(text || '').split(/[\s,;]+/).map(x => norm(x).replace(/^@/, '')).filter(x => /^([^\s@]+@)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(x)))].slice(0, 200);
}
const matches = (list, address) => {
  const domain = address.split('@')[1] || '';
  return list.some(x => (x.includes('@') ? x === address : domain === x || domain.endsWith(`.${x}`)));
};

function settingsOf(s) {
  const n = Number(s.spam_threshold);
  return {
    blocked: parseList(s.filter_block), allowed: parseList(s.filter_allow),
    maxMb: Math.min(Math.max(Number(s.filter_max_mb) || 10, 1), 10),
    spamAction: SPAM_ACTIONS.includes(s.spam_action) ? s.spam_action : 'quarantine',
    spamThreshold: Number.isFinite(n) && n > 0 ? n : 5,
  };
}

// { filter_block, filter_allow, filter_max_mb, spam_action, spam_threshold } from the form, or { error }
function cleanFilterInput(input = {}) {
  if (input.filters === undefined) return { value: {} };
  const f = input.filters && typeof input.filters === 'object' ? input.filters : {};
  const maxMb = f.maxMb === undefined ? 10 : Number(f.maxMb);
  if (!Number.isInteger(maxMb) || maxMb < 1 || maxMb > 10) return { error: 'Taille maximale d\'un e-mail : entre 1 et 10 Mo' };
  const threshold = f.spamThreshold === undefined ? 5 : Number(f.spamThreshold);
  if (!(threshold >= 1 && threshold <= 30)) return { error: 'Seuil de spam : entre 1 et 30' };
  if (f.spamAction !== undefined && !SPAM_ACTIONS.includes(f.spamAction)) return { error: 'Action sur le spam invalide' };
  return { value: {
    filter_block: parseList(f.blocked).join('\n') || null, filter_allow: parseList(f.allowed).join('\n') || null,
    filter_max_mb: maxMb, spam_action: f.spamAction || 'quarantine', spam_threshold: Math.round(threshold * 10) / 10,
  } };
}
const view = s => { const v = settingsOf(s); return { ...v, blocked: v.blocked.join('\n'), allowed: v.allowed.join('\n') }; };

// ── The verdict of the mail servers, read from the headers ──
const header = (mail, name) => {
  const v = mail.headers?.get?.(name);
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : x?.text || x?.value || '')).join(' ');
  return String(v.text || v.value || v);
};
// { spam, score, reason } — reason in words for the quarantine list
function spamVerdict(mail, threshold = 5) {
  const flag = header(mail, 'x-spam-flag'), status = header(mail, 'x-spam-status');
  const score = Number((/score=(-?[\d.]+)/i.exec(status) || [])[1] ?? header(mail, 'x-spam-score')) || null;
  if (/^\s*yes/i.test(flag) || /^\s*yes/i.test(status)) return { spam: true, score, reason: `Signalé comme spam par le serveur de messagerie${score != null ? ` (score ${score})` : ''}` };
  if (score != null && score >= threshold) return { spam: true, score, reason: `Score de spam ${score} (seuil ${threshold})` };
  const stars = (header(mail, 'x-spam-level').match(/\*/g) || []).length;
  if (stars >= threshold) return { spam: true, score: stars, reason: `Niveau de spam ${stars} (seuil ${threshold})` };
  if (/yes/i.test(header(mail, 'x-mailgun-sflag'))) return { spam: true, score: Number(header(mail, 'x-mailgun-sscore')) || null, reason: 'Signalé comme spam par Mailgun' };
  if (/fail/i.test(header(mail, 'x-ses-virus-verdict')) || /infected|virus/i.test(header(mail, 'x-virus-status'))) return { spam: true, score: null, reason: 'Virus détecté par le serveur de messagerie' };
  if (/fail/i.test(header(mail, 'x-ses-spam-verdict'))) return { spam: true, score: null, reason: 'Signalé comme spam par Amazon SES' };
  const scl = Number(header(mail, 'x-ms-exchange-organization-scl') || (/SCL:(-?\d)/i.exec(header(mail, 'x-forefront-antispam-report')) || [])[1]);
  if (Number.isFinite(scl) && scl >= 5) return { spam: true, score: scl, reason: `Signalé comme spam par Microsoft 365 (SCL ${scl})` };
  if (/\bdmarc=fail\b/i.test(header(mail, 'authentication-results'))) return { spam: true, score: null, reason: 'Expéditeur non authentifié (DMARC en échec) : peut-être usurpé' };
  return { spam: false };
}

// ── Decision for one message: { action: 'accept' | 'drop' | 'quarantine', reason } ──
async function decide(db, guildId, mail, s, sender) {
  const f = settingsOf(s);
  const size = Number(mail._raw?.length || 0) || (String(mail.text || '').length + String(mail.html || '').length + (mail.attachments || []).reduce((n, a) => n + (a.size || a.content?.length || 0), 0));
  // Our own mark on a message that comes back: a loop with another robot
  const ours = [s.address, s.oauth_account].filter(Boolean).map(norm);
  if (ours.some(a => norm(header(mail, 'x-loop')).includes(a))) return { action: 'drop', reason: 'boucle (notre propre message revenu)' };
  if (matches(f.blocked, sender)) return { action: 'drop', reason: 'expéditeur refusé' };
  if (size > f.maxMb * 1024 * 1024) return { action: 'quarantine', reason: `Message trop volumineux (plus de ${f.maxMb} Mo)` };
  if (f.allowed.length && !matches(f.allowed, sender)) return { action: 'quarantine', reason: 'Expéditeur hors des domaines autorisés' };
  if (f.spamAction !== 'off') {
    const v = spamVerdict(mail, f.spamThreshold);
    if (v.spam) return { action: f.spamAction, reason: v.reason, score: v.score };
  }
  // The same message again and again from the same sender: two automatic replies answering each other
  const hash = crypto.createHash('sha256').update(`${String(mail.subject || '').replace(/^\s*((re|fwd?|tr|aw)\s*:\s*)+/i, '')}\n${String(mail.text || '').trim().slice(0, 2000)}`).digest('hex').slice(0, 24);
  const redis = require('./redis').getRedis();
  const key = `mailloop:${guildId}:${sender}:${hash}`;
  const n = await redis.incr(key).catch(() => 0);
  if (n === 1) await redis.expire(key, 24 * 3600).catch(() => null);
  if (n > LOOP_MAX) return { action: 'drop', reason: 'boucle (même message reçu plusieurs fois)' };
  return { action: 'accept' };
}

// ── Quarantine ──
async function quarantine(db, mail, sender, reason, score = null) {
  // The raw message when we have it (IMAP, webhooks), else its main fields: enough to release it
  const raw = mail._raw ? (Buffer.isBuffer(mail._raw) ? mail._raw : Buffer.from(String(mail._raw))) : null;
  const fields = raw ? null : JSON.stringify({ from: { address: sender, name: mail.from?.value?.[0]?.name || null }, subject: mail.subject || '', text: String(mail.text || '').slice(0, 20000) });
  const [n] = await db('SELECT COUNT(*) AS n FROM email_quarantine');
  if (Number(n.n) >= QUARANTINE_MAX) await db('DELETE FROM email_quarantine ORDER BY id ASC LIMIT ?', [Number(n.n) - QUARANTINE_MAX + 1]);
  const { insertId } = await db(
    'INSERT INTO email_quarantine (from_address, from_name, subject, excerpt, reason, score, raw_gz, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [sender.slice(0, 254), String(mail.from?.value?.[0]?.name || '').slice(0, 100) || null, String(mail.subject || '').slice(0, 200), String(mail.text || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      String(reason).slice(0, 200), score, raw ? zlib.gzipSync(raw) : null, fields]);
  return insertId;
}

async function listQuarantine(db) {
  return db('SELECT id, from_address, from_name, subject, excerpt, reason, score, received_at FROM email_quarantine ORDER BY id DESC LIMIT 200').catch(() => []);
}

// The message again, as received (mailparser), to process it without the filters
async function messageOf(db, id) {
  const [row] = await db('SELECT * FROM email_quarantine WHERE id = ?', [id]);
  if (!row) return null;
  if (row.raw_gz) {
    const raw = zlib.gunzipSync(row.raw_gz);
    const mail = await require('mailparser').simpleParser(raw);
    mail._raw = raw;
    return { row, mail };
  }
  const f = JSON.parse(row.fields || '{}');
  return { row, mail: { from: { value: [f.from || {}] }, subject: f.subject, text: f.text, headers: new Map(), attachments: [] } };
}

async function purgeQuarantine(db) {
  await db('DELETE FROM email_quarantine WHERE received_at < NOW() - INTERVAL ? DAY', [QUARANTINE_DAYS]).catch(() => null);
}

module.exports = { SPAM_ACTIONS, QUARANTINE_DAYS, parseList, settingsOf, cleanFilterInput, view, spamVerdict, decide, quarantine, listQuarantine, messageOf, purgeQuarantine };

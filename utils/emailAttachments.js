// Attachments of the e-mails received for tickets (tickets by e-mail): kept on the server, in
// ATTACHMENTS_DIR (/app/data/attachments, Docker volume « attachments »), one folder per server,
// files under a random name. Everything is set per server in Paramètres → Intégrations → Tickets
// par e-mail: on or off, size per file, total space, refused types, how long files are kept once
// the ticket is closed, and whether they are also posted in the ticket's Discord channel.
// The staff downloads them from the ticket view (same visibility as the ticket); nothing is
// ever served inline except plain images, and never with the sender's content type.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('./config');

const SNOWFLAKE = /^\d{17,20}$/;
const DEFAULT_BLOCKED = ['exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'ps1', 'vbs', 'js', 'jar', 'apk', 'sh', 'hta', 'lnk', 'dll', 'html', 'htm', 'svg'];
const DEFAULTS = { enabled: true, maxMb: 10, quotaMb: 500, retentionDays: 90, postDiscord: true, blocked: DEFAULT_BLOCKED };
const LIMITS = { maxMb: [1, 25], quotaMb: [10, 50000], retentionDays: [0, 3650] };
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const DISCORD_MAX = 8 * 1024 * 1024;

const baseDir = () => config.attachmentsDir || process.env.ATTACHMENTS_DIR || '/app/data/attachments';
const guildDir = guildId => {
  if (!SNOWFLAKE.test(String(guildId))) throw new Error('Serveur invalide');
  return path.join(baseDir(), String(guildId));
};

// Settings stored in email_settings (attach_* columns) → plain object
function attachSettings(row = {}) {
  const num = (v, [min, max], def) => (Number.isFinite(Number(v)) && v !== null ? Math.min(max, Math.max(min, Math.round(Number(v)))) : def);
  let blocked = DEFAULT_BLOCKED;
  if (typeof row.attach_blocked === 'string') blocked = row.attach_blocked.split(',').map(x => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean);
  return {
    enabled: row.attach_enabled === undefined || row.attach_enabled === null ? DEFAULTS.enabled : !!Number(row.attach_enabled),
    maxMb: num(row.attach_max_mb, LIMITS.maxMb, DEFAULTS.maxMb),
    quotaMb: num(row.attach_quota_mb, LIMITS.quotaMb, DEFAULTS.quotaMb),
    retentionDays: num(row.attach_retention_days, LIMITS.retentionDays, DEFAULTS.retentionDays),
    postDiscord: row.attach_post_discord === undefined || row.attach_post_discord === null ? DEFAULTS.postDiscord : !!Number(row.attach_post_discord),
    blocked,
  };
}

// Input of the settings page → columns (null when nothing about attachments was sent)
function cleanAttachInput(input = {}) {
  if (!input || typeof input !== 'object') return { value: null };
  const out = {};
  if ('enabled' in input) out.attach_enabled = input.enabled === true ? 1 : 0;
  if ('postDiscord' in input) out.attach_post_discord = input.postDiscord === true ? 1 : 0;
  for (const [k, col] of [['maxMb', 'attach_max_mb'], ['quotaMb', 'attach_quota_mb'], ['retentionDays', 'attach_retention_days']]) {
    if (!(k in input)) continue;
    const n = Number(input[k]);
    const [min, max] = LIMITS[k];
    if (!Number.isInteger(n) || n < min || n > max) return { error: `Pièces jointes : valeur entre ${min} et ${max} attendue (${{ maxMb: 'taille par fichier', quotaMb: 'espace total', retentionDays: 'conservation' }[k]})` };
    out[col] = n;
  }
  if ('blocked' in input) {
    const list = (Array.isArray(input.blocked) ? input.blocked : String(input.blocked || '').split(','))
      .map(x => String(x).trim().toLowerCase().replace(/^\./, '')).filter(Boolean);
    if (list.some(x => !/^[a-z0-9]{1,10}$/.test(x))) return { error: 'Pièces jointes : types refusés en extensions simples, séparées par des virgules (exe, bat…)' };
    out.attach_blocked = [...new Set(list)].slice(0, 60).join(',');
  }
  return { value: out };
}

async function usage(db) {
  const [r] = await db('SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes FROM email_attachments').catch(() => [{ files: 0, bytes: 0 }]);
  return { files: Number(r.files) || 0, bytes: Number(r.bytes) || 0 };
}

const extOf = name => (/\.([a-z0-9]{1,10})$/i.exec(String(name || '')) || [])[1]?.toLowerCase() || '';
const cleanName = name => String(name || 'pièce jointe').replace(/[\\/\0\r\n<>:"|?*]+/g, '_').replace(/^\.+/, '').trim().slice(0, 150) || 'pièce jointe';
const human = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`);

// What will be done with each attachment of a message (before the ticket note is written)
async function decide(db, attachments, settings) {
  const s = attachSettings(settings);
  let { bytes: used } = s.enabled ? await usage(db) : { bytes: 0 };
  return (attachments || []).map(a => {
    const name = cleanName(a.filename);
    const size = Number(a.size) || a.content?.length || 0;
    let reason = null;
    if (!s.enabled) reason = 'non conservée';
    else if (s.blocked.includes(extOf(name))) reason = 'non conservée : type refusé';
    else if (size > s.maxMb * 1048576) reason = `non conservée : plus de ${s.maxMb} Mo`;
    else if (used + size > s.quotaMb * 1048576) reason = 'non conservée : espace des pièces jointes plein';
    if (!reason) used += size;
    return { a, name, size, keep: !reason, line: `📎 ${name} (${reason || human(size)})` };
  });
}

// Writes the kept ones, linked to the ticket note; returns the stored rows
async function store(db, guildId, ticketId, noteId, decisions) {
  const kept = decisions.filter(d => d.keep && Buffer.isBuffer(d.a.content));
  if (!kept.length) return [];
  const dir = guildDir(guildId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const rows = [];
  for (const d of kept) {
    const stored = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(dir, stored), d.a.content, { mode: 0o600 });
    const type = String(d.a.contentType || 'application/octet-stream').toLowerCase().slice(0, 100);
    const sha = crypto.createHash('sha256').update(d.a.content).digest('hex');
    const r = await db('INSERT INTO email_attachments (ticket_id, note_id, filename, content_type, size, sha256, stored_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [ticketId, noteId, d.name, type, d.a.content.length, sha, stored]);
    rows.push({ id: Number(r.insertId), filename: d.name, size: d.a.content.length, content_type: type, buffer: d.a.content });
  }
  return rows;
}

// Also in the ticket's Discord channel (when it has one), up to 8 MB per file and 10 per message
async function postToChannel(channel, rows) {
  if (!channel || channel.virtual || !rows.length) return;
  const files = rows.filter(r => r.size <= DISCORD_MAX).slice(0, 10).map(r => ({ attachment: r.buffer, name: r.filename }));
  if (files.length) await channel.send({ content: '📎 Pièces jointes reçues par e-mail', files }).catch(() => null);
}

const listForTicket = (db, ticketId) => db(
  'SELECT id, note_id, filename, content_type, size, created_at FROM email_attachments WHERE ticket_id = ? ORDER BY id', [ticketId]
);

async function fileFor(db, guildId, ticketId, id) {
  const [row] = await db('SELECT * FROM email_attachments WHERE id = ? AND ticket_id = ?', [id, ticketId]);
  if (!row || !/^[0-9a-f]{32}$/.test(row.stored_name)) return null;
  const file = path.join(guildDir(guildId), row.stored_name);
  return fs.existsSync(file) ? { row, file, inline: INLINE_TYPES.has(row.content_type) } : null;
}

// Files of tickets closed more than `days` ago (all closed tickets with days = 0 and force),
// and files left without a row (member data deleted, ticket removed): removed
async function purge(db, guildId, { days, closedOnly = true } = {}) {
  let rows;
  if (closedOnly) {
    rows = await db(`SELECT a.id, a.stored_name, a.size FROM email_attachments a JOIN tickets t ON t.id = a.ticket_id
                     WHERE t.status = 'closed' AND t.closed_at < DATE_SUB(NOW(), INTERVAL ? DAY)`, [Math.max(0, days || 0)]);
  } else rows = await db('SELECT id, stored_name, size FROM email_attachments');
  let dir = null;
  try { dir = guildDir(guildId); } catch { return { files: 0, bytes: 0 }; }
  let bytes = 0;
  for (const r of rows) {
    fs.rmSync(path.join(dir, r.stored_name), { force: true });
    bytes += Number(r.size) || 0;
  }
  if (rows.length) await db('DELETE FROM email_attachments WHERE id IN (?)', [rows.map(r => r.id)]);
  // Orphans: files on disk that no row points to any more
  let orphans = 0;
  if (fs.existsSync(dir)) {
    const known = new Set((await db('SELECT stored_name FROM email_attachments')).map(r => r.stored_name));
    for (const f of fs.readdirSync(dir)) if (/^[0-9a-f]{32}$/.test(f) && !known.has(f)) { fs.rmSync(path.join(dir, f), { force: true }); orphans++; }
  }
  return { files: rows.length + orphans, bytes };
}

// Daily retention (job « retention-purge »): per server, its own setting (0 = kept forever)
async function runAttachmentRetention(guildId, db) {
  const [row] = await db('SELECT * FROM email_settings WHERE id = 1').catch(() => []);
  if (!row) return { files: 0, bytes: 0 };
  const s = attachSettings(row);
  if (!s.retentionDays) return purgeOrphansOnly(db, guildId);
  return purge(db, guildId, { days: s.retentionDays });
}
const purgeOrphansOnly = (db, guildId) => purge(db, guildId, { days: 36500 });

module.exports = { DEFAULTS, LIMITS, attachSettings, cleanAttachInput, usage, decide, store, postToChannel, listForTicket, fileFor, purge, runAttachmentRetention, human };

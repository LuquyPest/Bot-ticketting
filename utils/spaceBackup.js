// Backup of one space, downloaded from the dashboard (v8, conception/v8.md §3.2). It is also the
// space's complete export (reversibility): its format is documented (docs → Sauvegardes) and
// readable without Datick once decrypted (scripts/decrypt-space-backup.js).
//
//   file  = "DATICKS1" (8 bytes) · salt (16) · iv (12) · AES-256-GCM(gzip(JSON lines)) · tag (16)
//   key   = scrypt(passphrase, salt, 32 bytes, N = 2^15, r = 8, p = 1)
//   lines = { format: "datick-space", version: 1, … } then { t: table, r: row } for each row,
//           then { f: "files/<name>" | "kb/<name>", b64 } for each stored file, then { end: true, rows, files }
// In a row, a binary value is { $b64: "…" }; dates are kept as written in the database.
//
// The space's sealed secrets (tokens of the CRM, trackers…) stay sealed: the instance key is not
// in the archive. Restoring (owner of the instance only) replaces every table of the target space
// in one transaction, with the space in maintenance meanwhile; the target keeps its own schema
// (the archive's rows go into the columns both have), so an archive of an older version restores.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');

const MAGIC = Buffer.from('DATICKS1');
const FORMAT = 'datick-space', FORMAT_VERSION = 1;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MIN_PASSPHRASE = 12;
const SKIP_TABLES = new Set(['schema_migrations']); // the target keeps its own
const BATCH = 200;

const deriveKey = (passphrase, salt) => new Promise((res, rej) => crypto.scrypt(String(passphrase), salt, 32, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
const checkPassphrase = p => (typeof p === 'string' && p.length >= MIN_PASSPHRASE ? null : `Phrase de passe : ${MIN_PASSPHRASE} caractères au moins`);

const attachmentsBase = () => require('./config').config.attachmentsDir || process.env.ATTACHMENTS_DIR || '/app/data/attachments';
const fileDirs = guildId => [['files', path.join(attachmentsBase(), String(guildId))], ['kb', path.join(attachmentsBase(), 'kb', String(guildId))]];

// A connection of its own: dates and big numbers as written, JSON as text, binary as Buffer
async function connect(guildId) {
  const cfg = require('./config').config.database;
  const mysql = require('mysql2/promise');
  return mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: require('./tenantDb').getDbName(guildId),
    charset: 'utf8mb4', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, multipleStatements: false,
    typeCast: (field, next) => (field.type === 'JSON' ? field.string() : next()) });
}
async function baseTables(conn) {
  const [rows] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  return rows.map(r => Object.values(r)[0]).filter(t => /^[a-z0-9_]+$/.test(t)).sort();
}
const encodeRow = row => {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = Buffer.isBuffer(v) ? { $b64: v.toString('base64') } : v;
  return out;
};
const decodeValue = v => (v && typeof v === 'object' && typeof v.$b64 === 'string' ? Buffer.from(v.$b64, 'base64') : v && typeof v === 'object' ? JSON.stringify(v) : v);

// ── Export: an async generator of JSON lines, then encrypted ──
async function* lines(guildId, meta) {
  const conn = await connect(guildId);
  let rows = 0, files = 0;
  try {
    // One consistent view of every table
    await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const tables = await baseTables(conn);
    yield `${JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, ...meta, tables })}\n`;
    for (const t of tables) {
      let last = 0;
      // A single integer primary key: read in pages, never the whole table in memory
      const [pkCols] = await conn.query(`SELECT k.COLUMN_NAME AS c, c.DATA_TYPE AS d FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA = k.TABLE_SCHEMA AND c.TABLE_NAME = k.TABLE_NAME AND c.COLUMN_NAME = k.COLUMN_NAME
        WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ? AND k.CONSTRAINT_NAME = 'PRIMARY'`, [t]);
      const pk = pkCols.length === 1 && /int$/.test(pkCols[0].d) ? pkCols[0] : null;
      if (pk) {
        for (;;) {
          const [page] = await conn.query(`SELECT * FROM \`${t}\` WHERE \`${pk.c}\` > ? ORDER BY \`${pk.c}\` LIMIT 1000`, [last]);
          for (const r of page) { rows++; yield `${JSON.stringify({ t, r: encodeRow(r) })}\n`; }
          if (page.length < 1000) break;
          last = page[page.length - 1][pk.c];
        }
      } else {
        const [all] = await conn.query(`SELECT * FROM \`${t}\``);
        for (const r of all) { rows++; yield `${JSON.stringify({ t, r: encodeRow(r) })}\n`; }
      }
    }
    await conn.query('COMMIT');
  } finally { await conn.end().catch(() => null); }
  for (const [prefix, dir] of fileDirs(guildId)) {
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile()).map(d => d.name); } catch { names = []; }
    for (const name of names) {
      const buf = fs.readFileSync(path.join(dir, name));
      files++;
      yield `${JSON.stringify({ f: `${prefix}/${name}`, b64: buf.toString('base64') })}\n`;
    }
  }
  yield `${JSON.stringify({ end: true, rows, files })}\n`;
}

// → a Readable of the encrypted archive
async function exportSpace(guildId, passphrase, meta = {}) {
  const bad = checkPassphrase(passphrase);
  if (bad) throw Object.assign(new Error(bad), { status: 400 });
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const gzip = zlib.createGzip({ level: 6 });
  const src = Readable.from(lines(guildId, { appVersion: require('../package.json').version, schemaVersion: await require('./tenantMigrations').schemaVersion(require('./tenantDb').getTenantDb(guildId)).catch(() => null), createdAt: new Date().toISOString(), ...meta }));
  async function* out() {
    yield Buffer.concat([MAGIC, salt, iv]);
    for await (const chunk of src.pipe(gzip).pipe(cipher)) yield chunk;
    yield cipher.getAuthTag();
  }
  return Readable.from(out());
}

// ── Reading an archive: decrypts and checks it in full before anything is changed ──
async function decrypt(buf, passphrase) {
  if (!Buffer.isBuffer(buf) || buf.length < MAGIC.length + 16 + 12 + 16 || !buf.subarray(0, 8).equals(MAGIC)) throw Object.assign(new Error('Ce fichier n\'est pas une sauvegarde d\'espace Datick'), { status: 400 });
  const salt = buf.subarray(8, 24), iv = buf.subarray(24, 36), tag = buf.subarray(buf.length - 16), body = buf.subarray(36, buf.length - 16);
  const key = await deriveKey(passphrase, salt);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  let gz;
  try { gz = Buffer.concat([d.update(body), d.final()]); } catch { throw Object.assign(new Error('Phrase de passe incorrecte, ou fichier modifié'), { status: 400 }); }
  return zlib.gunzipSync(gz, { maxOutputLength: 4 * 1024 * 1024 * 1024 - 1 });
}
async function* parseLines(plain) {
  const rl = readline.createInterface({ input: Readable.from([plain]), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}
async function inspect(buf, passphrase) {
  const plain = await decrypt(buf, passphrase);
  let header = null, end = null;
  for await (const o of parseLines(plain)) { if (!header) header = o; if (o.end) end = o; }
  if (header?.format !== FORMAT || !end) throw Object.assign(new Error('Sauvegarde incomplète ou d\'un autre format'), { status: 400 });
  return { header, end, plain };
}

// ── Restore into a space of this instance ──
async function restoreSpace(targetGuildId, buf, passphrase, actor) {
  const { header, end, plain } = await inspect(buf, passphrase);
  const { LATEST_VERSION } = require('./tenantMigrations');
  if (header.version > FORMAT_VERSION) throw Object.assign(new Error('Sauvegarde d\'un format plus récent : mets Datick à jour d\'abord'), { status: 400 });
  if (Number(header.schemaVersion) > LATEST_VERSION) throw Object.assign(new Error(`Sauvegarde d'une version plus récente (schéma ${header.schemaVersion}, ici ${LATEST_VERSION}) : mets Datick à jour d'abord`), { status: 400 });
  const { globalQuery } = require('./globalDb');
  const [g] = await globalQuery('SELECT guild_id, maintenance_mode FROM guilds WHERE guild_id = ?', [targetGuildId]);
  if (!g) throw Object.assign(new Error('Espace introuvable'), { status: 404 });
  await require('./tenantSchema').ensureTenantSchema(targetGuildId);
  await globalQuery('UPDATE guilds SET maintenance_mode = 1 WHERE guild_id = ?', [targetGuildId]);
  const conn = await connect(targetGuildId);
  const counts = {};
  try {
    const tables = (await baseTables(conn)).filter(t => !SKIP_TABLES.has(t));
    const cols = {};
    for (const t of tables) {
      const [c] = await conn.query('SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND (EXTRA IS NULL OR EXTRA NOT LIKE \'%GENERATED%\')', [t]);
      cols[t] = new Set(c.map(x => x.c));
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.beginTransaction();
    for (const t of tables) await conn.query(`DELETE FROM \`${t}\``);
    let pending = null; // { t, keys, values[] }
    const flush = async () => {
      if (!pending?.values.length) return;
      await conn.query(`INSERT INTO \`${pending.t}\` (${pending.keys.map(k => `\`${k}\``).join(', ')}) VALUES ?`, [pending.values]);
      counts[pending.t] = (counts[pending.t] || 0) + pending.values.length;
      pending = null;
    };
    for await (const o of parseLines(plain)) {
      if (!o.t || !cols[o.t]) continue;
      const keys = Object.keys(o.r).filter(k => cols[o.t].has(k));
      if (!keys.length) continue;
      const sig = keys.join(',');
      if (!pending || pending.t !== o.t || pending.sig !== sig || pending.values.length >= BATCH) { await flush(); pending = { t: o.t, keys, sig, values: [] }; }
      pending.values.push(keys.map(k => decodeValue(o.r[k])));
    }
    await flush();
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => null);
    throw Object.assign(new Error(`Restauration annulée, rien n'a changé : ${err.message}`), { status: 500 });
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => null);
    await conn.end().catch(() => null);
    await globalQuery('UPDATE guilds SET maintenance_mode = ? WHERE guild_id = ?', [Number(g.maintenance_mode) ? 1 : 0, targetGuildId]).catch(() => null);
  }
  // Stored files: written next to the target's (an existing name is kept)
  let files = 0;
  const dirs = Object.fromEntries(fileDirs(targetGuildId));
  for await (const o of parseLines(plain)) {
    if (!o.f || typeof o.b64 !== 'string') continue;
    const [prefix, name] = String(o.f).split('/');
    if (!dirs[prefix] || !/^[\w.-]{1,200}$/.test(name || '') || name.startsWith('.')) continue;
    fs.mkdirSync(dirs[prefix], { recursive: true, mode: 0o700 });
    const file = path.join(dirs[prefix], name);
    if (!fs.existsSync(file)) { fs.writeFileSync(file, Buffer.from(o.b64, 'base64'), { mode: 0o600 }); files++; }
  }
  await require('./audit').recordEvent(require('./tenantDb').getTenantDb(targetGuildId), { actor, action: 'space_restore', details: { from: header.guildId || null, createdAt: header.createdAt || null, rows: end.rows, files } }).catch(() => null);
  return { ok: true, rows: Object.values(counts).reduce((a, b) => a + b, 0), tables: Object.keys(counts).length, files, from: { guildId: header.guildId || null, name: header.guildName || null, createdAt: header.createdAt || null, appVersion: header.appVersion || null } };
}

module.exports = { MAGIC, MIN_PASSPHRASE, checkPassphrase, exportSpace, decrypt, inspect, restoreSpace };

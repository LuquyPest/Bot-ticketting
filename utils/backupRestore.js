// Restoring one Discord server from a nightly archive, asked from Instance → Santé. The bot never
// reads the archives nor holds the MariaDB root password: it writes a request file into
// ./backups/requests, and the backup service (docker/backup.sh) checks the archive (HMAC), rebuilds
// that server's database in a temporary database and swaps its tables in one atomic RENAME. The
// previous tables stay in ticketbot_guild_<ID>_prev: the owner cancels the restore (tables swapped
// back) or deletes that copy. Once done, the bot applies its migrations to the restored database.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('./config');
const { globalQuery } = require('./globalDb');

const ARCHIVE_RE = /^ticketbot-\d{8}-\d{6}\.sql\.gz\.enc$/;
const SNOWFLAKE = /^\d{17,20}$/;
const statusDir = () => config.backupStatusDir || process.env.BACKUP_STATUS_DIR || null;
const requestsDir = () => config.backupRequestsDir || process.env.BACKUP_REQUESTS_DIR || null;
const requestFile = () => path.join(requestsDir(), 'restore.req');

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function listArchives() {
  const dir = statusDir();
  const list = dir ? readJson(path.join(dir, 'archives.json')) : null;
  return Array.isArray(list)
    ? list.filter(a => ARCHIVE_RE.test(a?.file)).map(a => ({ file: a.file, bytes: Number(a.bytes) || 0, at: Date.parse(a.at) || null }))
    : [];
}

function lastRestore() {
  const dir = statusDir();
  const s = dir ? readJson(path.join(dir, 'restore.json')) : null;
  if (!s || typeof s !== 'object') return null;
  return { ok: s.ok === true, at: Date.parse(s.at) || null, guildId: String(s.guild || ''), file: String(s.file || ''), request: String(s.request || ''), message: String(s.message || '').slice(0, 300) };
}

// Servers with a copy of their tables from before a restore
async function previousCopies() {
  const rows = await globalQuery("SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name LIKE 'ticketbot\\_guild\\_%\\_prev'").catch(() => []);
  return rows.map(r => /^ticketbot_guild_(\d{17,20})_prev$/.exec(r.name || r.NAME || r.SCHEMA_NAME)?.[1]).filter(Boolean);
}

function available() {
  const dir = requestsDir();
  if (!dir || !statusDir()) return false;
  try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
}

async function restoreState() {
  const { getRedis } = require('./redis');
  const pending = available() && fs.existsSync(requestFile());
  const last = lastRestore();
  const request = await getRedis().get('restore:request').then(v => (v ? JSON.parse(v) : null)).catch(() => null);
  if (last?.request && request?.id === last.request) await finalize(last, request);
  return { available: available(), archives: listArchives(), pending: pending ? request : null, last, previous: await previousCopies() };
}

// After the backup service is done: migrations on the restored database, fresh connections, journal
async function finalize(last, request) {
  const { getRedis } = require('./redis');
  if (!(await getRedis().set(`restore:done:${request.id}`, '1', 'EX', 30 * 86400, 'NX'))) return;
  await getRedis().del('restore:request');
  if (last.ok) {
    await require('./tenantDb').closeTenant(last.guildId);
    await require('./tenantSchema').ensureTenantSchema(last.guildId).catch(err => console.error('restore: migrations', err.message));
    require('./i18n').clearGuildLanguageCache?.(last.guildId);
  }
  await globalQuery('INSERT INTO instance_audit_log (actor_id, actor_name, action, guild_id, details) VALUES (?, ?, ?, ?, ?)',
    [request.by.id, request.by.username, last.ok ? 'guild_restore_done' : 'guild_restore_failed', last.guildId, JSON.stringify({ archive: last.file, message: last.message })]).catch(() => null);
}

async function requestRestore(owner, { archive, guildId }) {
  const err = (status, message) => Object.assign(new Error(message), { status });
  if (!available()) throw err(409, 'Restauration indisponible : le service de sauvegarde n\'est pas installé ou pas à jour (docker-compose.backup.yml)');
  if (!ARCHIVE_RE.test(String(archive || '')) || !listArchives().some(a => a.file === archive)) throw err(400, 'Archive introuvable');
  if (!SNOWFLAKE.test(String(guildId || ''))) throw err(400, 'Serveur invalide');
  const [g] = await globalQuery('SELECT guild_id FROM guilds WHERE guild_id = ?', [guildId]);
  if (!g) throw err(404, 'Serveur inconnu de l\'instance');
  if (guildId === require('./demo').DEMO_GUILD_ID) throw err(400, 'La démonstration se remet à zéro toute seule');
  if (fs.existsSync(requestFile())) throw err(409, 'Une restauration est déjà en cours');
  const request = { id: crypto.randomUUID(), guildId, archive, at: Date.now(), by: { id: owner.id, username: owner.username } };
  const tmp = `${requestFile()}.part`;
  fs.writeFileSync(tmp, `archive=${archive}\nguild=${guildId}\nid=${request.id}\n`, { mode: 0o600 });
  fs.renameSync(tmp, requestFile());
  await require('./redis').getRedis().set('restore:request', JSON.stringify(request), 'EX', 3600);
  return request;
}

const quoteId = s => `\`${String(s).replace(/`/g, '')}\``;
async function tablesOf(db) {
  return (await globalQuery('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [db])).map(r => r.t || r.TABLE_NAME);
}

// Cancels the last restore of a server: its current tables and those of _prev are swapped back
async function rollback(guildId) {
  if (!SNOWFLAKE.test(String(guildId))) throw Object.assign(new Error('Serveur invalide'), { status: 400 });
  const target = `ticketbot_guild_${guildId}`, prev = `${target}_prev`, swap = `${target}_swap`;
  const before = await tablesOf(prev);
  if (!before.length) throw Object.assign(new Error('Aucune copie d\'avant restauration pour ce serveur'), { status: 404 });
  const current = await tablesOf(target);
  await globalQuery(`CREATE DATABASE IF NOT EXISTS ${quoteId(swap)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const renames = [
    ...current.map(t => `${quoteId(target)}.${quoteId(t)} TO ${quoteId(swap)}.${quoteId(t)}`),
    ...before.map(t => `${quoteId(prev)}.${quoteId(t)} TO ${quoteId(target)}.${quoteId(t)}`),
    ...current.map(t => `${quoteId(swap)}.${quoteId(t)} TO ${quoteId(prev)}.${quoteId(t)}`),
  ];
  await globalQuery(`RENAME TABLE ${renames.join(', ')}`);
  await globalQuery(`DROP DATABASE ${quoteId(swap)}`);
  await require('./tenantDb').closeTenant(guildId);
  await require('./tenantSchema').ensureTenantSchema(guildId);
  return { swapped: before.length };
}

async function dropPrevious(guildId) {
  if (!SNOWFLAKE.test(String(guildId))) throw Object.assign(new Error('Serveur invalide'), { status: 400 });
  await globalQuery(`DROP DATABASE IF EXISTS ${quoteId(`ticketbot_guild_${guildId}_prev`)}`);
}

module.exports = { listArchives, restoreState, requestRestore, rollback, dropPrevious, finalize, lastRestore };

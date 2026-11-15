// Results of the backup services, read from the status files they write (docker/backup.sh,
// docker/offsite.sh) into ./backups/status, mounted read-only in the bot (BACKUP_STATUS_DIR).
// Never the archives themselves. Shown in Instance → Santé; problems alert the owner (backup-watch job).
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const STALE_MS = 26 * 3600 * 1000; // a nightly job more than 26 h old missed its run

function readStatus(dir, name) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
    if (typeof s !== 'object' || !s) return null;
    const at = Date.parse(s.at);
    return { ok: s.ok === true, at: Number.isFinite(at) ? at : null, file: String(s.file || ''), bytes: Number(s.bytes) || 0, message: String(s.message || '').slice(0, 300), remote: s.remote ? String(s.remote).slice(0, 200) : undefined };
  } catch { return null; }
}

// { configured, backup, verify, offsite, problems: [{ key, text }] }
function backupStatus({ dir = config.backupStatusDir || process.env.BACKUP_STATUS_DIR, now = Date.now() } = {}) {
  if (!dir || !fs.existsSync(dir)) return { configured: false, backup: null, verify: null, offsite: null, problems: [] };
  const backup = readStatus(dir, 'backup');
  const verify = readStatus(dir, 'verify');
  const offsite = readStatus(dir, 'offsite');
  const problems = [];
  if (!backup) problems.push({ key: 'backup-none', text: 'Aucune sauvegarde n\'a encore été faite' });
  else if (!backup.ok) problems.push({ key: `backup-failed:${backup.at}`, text: `La dernière sauvegarde a échoué : ${backup.message || 'voir docker compose logs backup'}` });
  else if (backup.at && now - backup.at > STALE_MS) problems.push({ key: `backup-stale:${backup.at}`, text: 'Aucune sauvegarde depuis plus de 26 heures' });
  if (verify && !verify.ok) problems.push({ key: `verify-failed:${verify.at}`, text: `La vérification de la dernière archive a échoué : ${verify.message}` });
  if (offsite && !offsite.ok) problems.push({ key: `offsite-failed:${offsite.at}`, text: `La copie hors du serveur a échoué : ${offsite.message || 'voir docker compose logs offsite'}` });
  else if (offsite?.at && now - offsite.at > STALE_MS) problems.push({ key: `offsite-stale:${offsite.at}`, text: 'Aucune copie hors du serveur depuis plus de 26 heures' });
  return { configured: true, backup, verify, offsite, problems };
}

// BullMQ job 'backup-watch': one alert per problem (same channels as the error alert)
async function runBackupWatch(client) {
  const status = backupStatus();
  if (!status.configured || !status.problems.length) return { problems: 0 };
  const { getRedis } = require('./redis');
  const fresh = [];
  for (const p of status.problems) {
    // backup-none stays silent the first day (fresh install, first backup not due yet)
    if (p.key === 'backup-none' && process.uptime() < 26 * 3600) continue;
    if (await getRedis().set(`alert:backup:${p.key}`, '1', 'EX', 7 * 86400, 'NX')) fresh.push(p);
  }
  if (!fresh.length) return { problems: status.problems.length, skipped: 'déjà signalé' };
  const { deliver, KEY, DEFAULTS } = require('./errorAlert');
  const { getSetting } = require('./instanceSettings');
  const settings = await getSetting(KEY, DEFAULTS);
  const link = config.webServerBaseUrl ? `\n\n[Ouvrir Instance → Santé](${config.webServerBaseUrl}/instance/health)` : '';
  const results = await deliver(client, settings, {
    title: '💾 Problème de sauvegarde',
    description: fresh.map(p => `• ${p.text}`).join('\n') + link,
    event: 'backup_problem', data: { problems: fresh.map(p => p.text) },
  });
  return { problems: status.problems.length, sent: results };
}

module.exports = { backupStatus, runBackupWatch, readStatus, STALE_MS };

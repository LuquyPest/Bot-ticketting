// Notifications of the mobile app (v7, conception/v7.md §3.11) through Firebase Cloud Messaging.
// The owner of the instance gives the service account of a Firebase project (Instance → Santé →
// Notifications mobiles; the private key is sealed, never sent back). The app registers the device
// and the signed-in person attaches its token to their account (/mobile-link); every push of the
// dashboard (web/routes/push.js) then also goes to their devices. A token Firebase says is gone is
// forgotten. FCM_TOKEN_URL / FCM_API_URL exist for tests.
const crypto = require('crypto');
const { getSetting, setSetting } = require('./instanceSettings');
const { seal, open } = require('./secretBox');
const { globalQuery } = require('./globalDb');

const KEY = 'fcm_service_account';
const TOKEN_URL = () => process.env.FCM_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const API_URL = () => (process.env.FCM_API_URL || 'https://fcm.googleapis.com').replace(/\/$/, '');
const PLATFORMS = ['android', 'ios'];
const MAX_DEVICES = 10;

async function load() {
  const s = await getSetting(KEY, {});
  let privateKey = null;
  try { privateKey = s.privateKey ? open(s.privateKey) : null; } catch { privateKey = null; }
  return { projectId: s.projectId || '', clientEmail: s.clientEmail || '', privateKey };
}
async function publicSettings() { const s = await load(); return { configured: !!(s.projectId && s.clientEmail && s.privateKey), projectId: s.projectId, clientEmail: s.clientEmail }; }
// input: the service account JSON (or null to remove it)
async function save(json) {
  if (json === null || json === '') { await setSetting(KEY, {}); token.value = null; return { ok: true }; }
  let a;
  try { a = typeof json === 'string' ? JSON.parse(json) : json; } catch { return { error: 'Compte de service : JSON invalide' }; }
  if (a?.type !== 'service_account' || !a.project_id || !a.client_email || !/BEGIN PRIVATE KEY/.test(String(a.private_key || ''))) return { error: 'Compte de service Firebase attendu (type service_account, project_id, client_email, private_key)' };
  try { crypto.createPrivateKey(a.private_key); } catch { return { error: 'Clé privée illisible' }; }
  await setSetting(KEY, { projectId: String(a.project_id).slice(0, 100), clientEmail: String(a.client_email).slice(0, 200), privateKey: seal(a.private_key) });
  token.value = null;
  return { ok: true };
}

// OAuth 2 access token of the service account (JWT bearer, RS256), kept until 5 minutes before its end
const token = { value: null, until: 0 };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
async function accessToken(s) {
  if (token.value && Date.now() < token.until) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claims = b64({ iss: s.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: TOKEN_URL(), iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(s.privateKey).toString('base64url');
  const r = await fetch(TOKEN_URL(), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Firebase : jeton refusé (${r.status})`);
  token.value = j.access_token;
  token.until = Date.now() + (Number(j.expires_in || 3600) - 300) * 1000;
  return token.value;
}

// ── Devices ──
async function register(userId, deviceToken, platform) {
  const t = String(deviceToken || '').trim();
  if (!/^[A-Za-z0-9:_-]{20,4096}$/.test(t)) return { error: 'Jeton d\'appareil invalide' };
  if (!PLATFORMS.includes(platform)) return { error: 'Plateforme : android ou ios' };
  await globalQuery(`INSERT INTO mobile_push_tokens (token_hash, token, user_id, platform) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform), last_seen_at = NOW()`, [crypto.createHash('sha256').update(t).digest('hex'), seal(t), String(userId), platform]);
  // The oldest devices beyond the limit are forgotten
  const rows = await globalQuery('SELECT token_hash FROM mobile_push_tokens WHERE user_id = ? ORDER BY last_seen_at DESC', [String(userId)]);
  for (const r of rows.slice(MAX_DEVICES)) await globalQuery('DELETE FROM mobile_push_tokens WHERE token_hash = ?', [r.token_hash]);
  return { ok: true };
}
async function devices(userId) {
  return (await globalQuery('SELECT token_hash, platform, created_at, last_seen_at FROM mobile_push_tokens WHERE user_id = ? ORDER BY last_seen_at DESC', [String(userId)]).catch(() => []))
    .map(r => ({ id: r.token_hash.slice(0, 16), platform: r.platform, createdAt: r.created_at, lastSeenAt: r.last_seen_at }));
}
async function forget(userId, id) {
  await globalQuery('DELETE FROM mobile_push_tokens WHERE user_id = ? AND token_hash LIKE ?', [String(userId), `${String(id).replace(/[^0-9a-f]/g, '').slice(0, 16)}%`]);
  return { ok: true };
}

// One notification to every device of a person → number sent
async function sendToUser(userId, { title, body = '', url = null }) {
  const s = await load();
  if (!s.projectId || !s.privateKey) return 0;
  const rows = await globalQuery('SELECT token_hash, token FROM mobile_push_tokens WHERE user_id = ?', [String(userId)]).catch(() => []);
  if (!rows.length) return 0;
  let at;
  try { at = await accessToken(s); } catch (err) { console.error('fcm:', err.message); return 0; }
  let sent = 0;
  for (const r of rows) {
    let t; try { t = open(r.token); } catch { continue; }
    const res = await fetch(`${API_URL()}/v1/projects/${encodeURIComponent(s.projectId)}/messages:send`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token: t, notification: { title: String(title).slice(0, 120), body: String(body).slice(0, 240) }, data: url ? { url: String(url) } : {} } }),
    }).catch(() => null);
    if (res?.ok) { sent++; continue; }
    // Gone for good (uninstalled, expired): forgotten
    if (res && (res.status === 404 || res.status === 400)) {
      const j = await res.json().catch(() => ({}));
      if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(JSON.stringify(j))) await globalQuery('DELETE FROM mobile_push_tokens WHERE token_hash = ?', [r.token_hash]).catch(() => null);
    }
  }
  return sent;
}

module.exports = { PLATFORMS, publicSettings, save, register, devices, forget, sendToUser };

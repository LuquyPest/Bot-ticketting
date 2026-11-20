// Extensions of a space (v7, conception/v7.md §3.10). An extension is described by a manifest:
//   { "name": "…", "version": "1.0.0", "description": "…",
//     "panel": { "url": "https://…", "height": 260 },            — shown in the ticket view
//     "permissions": ["read_tickets", "reply_tickets", …],          — of its API v3 key
//     "webhook": { "url": "https://…", "events": ["ticket_open", …] } }
// Installed by a founder (manifest pasted, or read from an https address): it gets its own API key,
// limited to its permissions (shown once, revoked when it is removed) and a secret signing its
// webhooks (X-Datick-Signature-256, HMAC-SHA256 of the body). Its panel is an iframe sandboxed
// without « allow-same-origin », which only talks to the page by postMessage: the page sends it the
// ticket's context, and it may ask to resize itself or to insert a text in the reply box.
// The panels' origins are the only ones the dashboard's CSP lets be framed (table extension_frames).
const crypto = require('crypto');
const { globalQuery } = require('./globalDb');

const PERMISSIONS = ['read_tickets', 'reply_tickets', 'update_tickets', 'create_tickets', 'read_contacts', 'read_assets', 'write_assets'];
const EVENTS = ['ticket_open', 'ticket_close', 'ticket_claim', 'rule_applied'];
const MAX_EXTENSIONS = 20;
const httpsUrl = v => { try { const u = new URL(String(v)); return u.protocol === 'https:' && !u.username && !u.password ? u : null; } catch { return null; } };

function cleanManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { error: 'Manifeste : un objet JSON' };
  const name = typeof m.name === 'string' ? m.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  if (!name) return { error: 'Manifeste : « name » requis' };
  const out = { name, version: typeof m.version === 'string' ? m.version.slice(0, 20) : '', description: typeof m.description === 'string' ? m.description.slice(0, 300) : '', panel: null, permissions: [], webhook: null };
  if (m.panel) {
    const u = httpsUrl(m.panel.url);
    if (!u) return { error: 'Manifeste : « panel.url » doit être une adresse https' };
    const h = Number(m.panel.height) || 240;
    out.panel = { url: u.toString(), origin: u.origin, height: Math.min(800, Math.max(80, Math.round(h))) };
  }
  const perms = Array.isArray(m.permissions) ? m.permissions : [];
  const bad = perms.find(p => !PERMISSIONS.includes(p));
  if (bad) return { error: `Manifeste : permission inconnue « ${String(bad).slice(0, 40)} »` };
  out.permissions = [...new Set(perms)];
  if (m.webhook) {
    const u = httpsUrl(m.webhook.url);
    if (!u) return { error: 'Manifeste : « webhook.url » doit être une adresse https' };
    const events = (Array.isArray(m.webhook.events) ? m.webhook.events : EVENTS).filter(e => EVENTS.includes(e));
    out.webhook = { url: u.toString(), events };
  }
  if (!out.panel && !out.webhook && !out.permissions.length) return { error: 'Manifeste : un panneau, un webhook ou des permissions' };
  return { value: out };
}
// From an https address (no redirection, 100 KB, public address only)
async function fetchManifest(url) {
  const u = httpsUrl(url);
  if (!u) return { error: 'Adresse du manifeste : https://…' };
  const { resolveAndPin } = require('./webhookEmitter');
  if (process.env.EXT_ALLOW_PRIVATE_HOSTS !== '1' && !(await resolveAndPin(u.hostname))) return { error: 'Adresse du manifeste refusée (privée ou introuvable)' };
  try {
    const r = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
    if (!r.ok) return { error: `Manifeste : réponse ${r.status}` };
    const text = (await r.text()).slice(0, 100000);
    return { manifest: JSON.parse(text) };
  } catch (err) { return { error: `Manifeste illisible : ${err.message}` }; }
}

const shape = e => {
  const m = JSON.parse(e.manifest || '{}');
  return { id: e.id, name: e.name, version: m.version || '', description: m.description || '', panel: m.panel || null, permissions: m.permissions || [], webhook: m.webhook ? { url: m.webhook.url, events: m.webhook.events } : null, active: !!Number(e.active), installedAt: e.installed_at };
};
async function list(db) { return (await db('SELECT * FROM extensions ORDER BY name').catch(() => [])).map(shape); }

async function refreshFrames(guildId, db) {
  await globalQuery('DELETE FROM extension_frames WHERE guild_id = ?', [guildId]);
  for (const e of await list(db)) if (e.active && e.panel?.origin) await globalQuery('INSERT IGNORE INTO extension_frames (guild_id, ext_id, origin) VALUES (?, ?, ?)', [guildId, e.id, e.panel.origin]);
  cache.at = 0;
}

// → { extension, apiKey?, webhookSecret? } (both shown once) or { error }
async function install(db, guildId, input, actor) {
  let manifest = input.manifest;
  if (!manifest && input.manifestUrl) { const f = await fetchManifest(input.manifestUrl); if (f.error) return f; manifest = f.manifest; }
  if (typeof manifest === 'string') { try { manifest = JSON.parse(manifest); } catch { return { error: 'Manifeste : JSON invalide' }; } }
  const c = cleanManifest(manifest);
  if (c.error) return c;
  const m = c.value;
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM extensions');
  if (Number(n) >= MAX_EXTENSIONS) return { error: `${MAX_EXTENSIONS} extensions au plus` };
  let apiKey = null, keyId = null;
  if (m.permissions.length) {
    const secret = crypto.randomBytes(32).toString('hex');
    apiKey = `tb_${guildId}_${secret}`;
    const ins = await db('INSERT INTO api_keys (name, key_hash, key_prefix, permissions, created_by) VALUES (?, ?, ?, ?, ?)',
      [`Extension · ${m.name}`.slice(0, 100), crypto.createHash('sha256').update(apiKey).digest('hex'), secret.slice(0, 8), JSON.stringify(m.permissions), String(actor?.id || 'system')]);
    keyId = ins.insertId;
  }
  const webhookSecret = m.webhook ? crypto.randomBytes(24).toString('hex') : null;
  const id = (await db('INSERT INTO extensions (name, manifest, api_key_id, webhook_secret, active) VALUES (?, ?, ?, ?, 1)', [m.name, JSON.stringify(m), keyId, webhookSecret])).insertId;
  await refreshFrames(guildId, db);
  await require('./audit').recordEvent(db, { actor, action: 'extension_install', details: { name: m.name, permissions: m.permissions } });
  const [row] = await db('SELECT * FROM extensions WHERE id = ?', [id]);
  return { extension: shape(row), apiKey, webhookSecret };
}
async function setActive(db, guildId, id, active) {
  const r = await db('UPDATE extensions SET active = ? WHERE id = ?', [active ? 1 : 0, id]);
  if (!r.affectedRows) return { error: 'Extension introuvable', status: 404 };
  const [e] = await db('SELECT api_key_id FROM extensions WHERE id = ?', [id]);
  if (e?.api_key_id) await db('UPDATE api_keys SET active = ? WHERE id = ?', [active ? 1 : 0, e.api_key_id]).catch(() => null);
  await refreshFrames(guildId, db);
  return { ok: true };
}
async function uninstall(db, guildId, id, actor) {
  const [e] = await db('SELECT * FROM extensions WHERE id = ?', [id]);
  if (!e) return { error: 'Extension introuvable', status: 404 };
  if (e.api_key_id) await db('DELETE FROM api_keys WHERE id = ?', [e.api_key_id]); // its key stops working at once
  await db('DELETE FROM extensions WHERE id = ?', [id]);
  await refreshFrames(guildId, db);
  await require('./audit').recordEvent(db, { actor, action: 'extension_remove', details: { name: e.name } });
  return { ok: true };
}

// Webhooks of the extensions (called with the space's own, utils/webhookEmitter.js)
async function deliver(db, event, payload) {
  const rows = await db('SELECT * FROM extensions WHERE active = 1 AND webhook_secret IS NOT NULL').catch(() => []);
  const { safePostJson } = require('./webhookEmitter');
  for (const e of rows) {
    const m = JSON.parse(e.manifest || '{}');
    if (!m.webhook?.url || !(m.webhook.events || []).includes(event)) continue;
    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload });
    const sig = `sha256=${crypto.createHmac('sha256', e.webhook_secret).update(body).digest('hex')}`;
    safePostJson(m.webhook.url, body, { 'X-Datick-Event': event, 'X-Datick-Signature-256': sig, 'X-Datick-Extension': String(e.id) }).catch(() => null);
  }
}

// Origins the CSP lets the dashboard frame (cached 30 s; synchronous for helmet)
const cache = { at: 0, origins: [], loading: false };
function frameOrigins() {
  if (Date.now() - cache.at > 30000 && !cache.loading) {
    cache.loading = true;
    globalQuery('SELECT DISTINCT origin FROM extension_frames LIMIT 200').then(rows => { cache.origins = rows.map(r => r.origin).filter(o => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o)); cache.at = Date.now(); })
      .catch(() => { cache.at = Date.now(); }).finally(() => { cache.loading = false; });
  }
  return cache.origins;
}
async function warmFrames() { cache.at = 0; frameOrigins(); }

module.exports = { PERMISSIONS, EVENTS, cleanManifest, fetchManifest, list, install, setActive, uninstall, deliver, frameOrigins, warmFrames };

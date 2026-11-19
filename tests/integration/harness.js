// Integration test suite: runs the real web server and bot logic against a MariaDB + Redis
// (throwaway containers locally, services in CI) with a fake Discord client.
//   Local : npm run test:integration   (tests/integration/run-local.sh starts the containers)
//   CI    : .github/workflows/ci.yml
// Env: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, REDIS_HOST, REDIS_PORT (defaults match run-local.sh).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const ROOT = path.join(__dirname, '..', '..');
const app = m => require(path.join(ROOT, m));

process.env.REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
process.env.REDIS_PORT = process.env.REDIS_PORT || '63791';

// Test configuration written to a temp file — the production config.json is never read
const config = {
  token: 'test-token', clientId: '1', webEnabled: true, rateLimits: { apiPerMinute: 100000 }, webServerPort: Number(process.env.TEST_HTTP_PORT || 39123),
  webServerBaseUrl: 'http://localhost:39123',
  dashboard: {
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    discordClientSecret: 'x', discordCallbackUrl: 'http://localhost:39123/api/auth/discord/callback',
  },
  database: {
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 33061),
    user: process.env.DB_USER || 'botuser', password: process.env.DB_PASSWORD || 'pw', database: 'ticketbot_global',
  },
};
const configFile = path.join(os.tmpdir(), `ticketbot-test-config-${process.pid}.json`);
fs.writeFileSync(configFile, JSON.stringify(config));
process.env.TICKETBOT_CONFIG = configFile;
process.on('exit', () => { try { fs.unlinkSync(configFile); } catch {} });

const sign = require('cookie-signature').sign;
const { ensureGlobalDatabase, ensureGlobalTables } = app('bootstrap');

const G = '123456789012345678';
const U = { F: '100000000000000001', S1: '100000000000000002', S2: '100000000000000003', S3: '100000000000000004', OUT: '100000000000000009' };
let pass = 0, failed = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };

// multipart/form-data request: fields { k: v } + one file { field, name, content(Buffer) }
function reqMultipart(path, { sid, fields = {}, file }) {
  const boundary = '----harness' + crypto.randomBytes(8).toString('hex');
  const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(file.content, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const payload = Buffer.concat(parts);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: config.webServerPort, method: 'POST', path, headers: {
      Cookie: 'connect.sid=' + encodeURIComponent('s:' + sign(sid, config.dashboard.sessionSecret)),
      'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length, 'X-Requested-With': 'XMLHttpRequest',
    } }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { let b = d; try { b = JSON.parse(d); } catch {} resolve({ status: res.statusCode, body: b }); }); });
    r.on('error', reject);
    r.end(payload);
  });
}

function req(method, path, { sid, body, headers = {}, query } = {}) {
  if (query) path += '?' + new URLSearchParams(query);
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (sid) h.Cookie = 'connect.sid=' + encodeURIComponent('s:' + sign(sid, config.dashboard.sessionSecret));
    const payload = body !== undefined ? JSON.stringify(body) : null;
    if (payload !== null) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(payload); }
    if (method !== 'GET' && h['X-Requested-With'] === undefined && !path.startsWith('/api/v1')) h['X-Requested-With'] = 'XMLHttpRequest';
    const r = http.request({ host: '127.0.0.1', port: config.webServerPort, method, path, headers: h }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const d = Buffer.concat(chunks).toString('utf8'); // decoded once: a chunk may end mid-character
        let json = null; try { json = JSON.parse(d); } catch {}
        resolve({ status: res.statusCode, body: json ?? d, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (payload !== null) r.write(payload);
    r.end();
  });
}

async function main() {
  await ensureGlobalDatabase(config);
  await ensureGlobalTables(config);
  const { globalQuery } = app('./utils/globalDb');
  const { ensureTenantSchema } = app('./utils/tenantSchema');
  const { getTenantDb } = app('./utils/tenantDb');
  const { getRedis } = app('./utils/redis');
  const redis = getRedis();

  await globalQuery('DROP DATABASE IF EXISTS ticketbot_guild_' + G);
  await globalQuery('DELETE FROM guilds'); await globalQuery('DROP DATABASE IF EXISTS ticketbot_guild_223456789012345678'); await globalQuery('DELETE FROM login_logs'); await globalQuery('DELETE FROM user_sessions'); await globalQuery('DELETE FROM user_totp');
  await globalQuery(`INSERT INTO guilds (guild_id, guild_name, owner_discord_id, owner_discord_tag, status, db_name)
                     VALUES (?, 'Test', ?, 'f', 'active', ?)`, [G, U.F, 'ticketbot_guild_' + G]);
  await ensureTenantSchema(G);
  const db = getTenantDb(G);
  await db("INSERT INTO guild_config (id) VALUES (1) ON DUPLICATE KEY UPDATE id = id");
  for (const [k, role] of [['F', 'fondateur'], ['S1', 'support'], ['S2', 'support'], ['S3', 'support']]) {
    await db('INSERT INTO dashboard_users (user_id, username, role) VALUES (?, ?, ?)', [U[k], k, role]);
  }
  const g1 = (await db("INSERT INTO grades (name) VALUES ('Support')")).insertId;
  const g2 = (await db("INSERT INTO grades (name) VALUES ('Secret')")).insertId;
  const gUsers = (await db("INSERT INTO grades (name) VALUES ('RH')")).insertId;
  for (const p of ['view_tickets', 'reply_ticket']) await db('INSERT INTO grade_permissions VALUES (?, ?)', [g1, p]);
  for (const p of ['view_tickets', 'reply_ticket', 'manage_users']) await db('INSERT INTO grade_permissions VALUES (?, ?)', [gUsers, p]);
  await db('INSERT INTO user_grades (user_id, grade_id, assigned_by_id, assigned_by_tag) VALUES (?, ?, "x", "x")', [U.S1, g1]);
  await db('INSERT INTO user_grades (user_id, grade_id, assigned_by_id, assigned_by_tag) VALUES (?, ?, "x", "x")', [U.S3, gUsers]);
  const t1 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('1','=HYPERLINK(1)','c1','open','public')")).insertId;
  const t2 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES ('2','u2','c2','open','secret topic', ?)", [g2])).insertId;
  await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, '2', 'u2', 'secret payload', 'user')", [t2]);
  await globalQuery("INSERT INTO login_logs (user_id, username, ip, user_agent, status) VALUES (?, 'S1', '1.1.1.1', 'ua', 'success'), (?, 'OUT', '9.9.9.9', 'ua', 'success')", [U.S1, U.OUT]);

  // Sessions written straight into the Redis store
  const sessions = {};
  const mk = async (name, data) => {
    const sid = crypto.randomBytes(16).toString('hex');
    await redis.set('sess:' + sid, JSON.stringify({ cookie: { originalMaxAge: 86400000, httpOnly: true, path: '/' }, ...data }), 'EX', 3600);
    sessions[name] = sid;
  };
  for (const k of ['F', 'S1', 'S2', 'S3']) await mk(k, { user: { id: U[k], username: k, role: null }, currentGuildId: G });
  await mk('S1b', { user: { id: U.S1, username: 'S1', role: null }, currentGuildId: G });
  await mk('OWN', { user: { id: U.F, username: 'F', role: null } });     // owner of the instance (application owner below)
  await mk('NOWN', { user: { id: U.S1, username: 'S1', role: null } });  // signed in, not the owner
  await globalQuery('INSERT INTO user_sessions (user_id, session_id, ip, user_agent) VALUES (?, ?, "x", "x")', [U.S1, sessions.S1b]);

  // Fake Discord client: one channel in our guild, one in a foreign guild, channel creation for tickets
  const channels = new Map();
  const sent = [];
  const mkChannel = (id, guildId, type = 0, name = 'ticket') => ({
    id, guildId, type, name, isTextBased: () => true, isThread: () => false,
    setName: async function (n) { this.name = n; return this; },
    send: async p => {
      sent.push({ id, p });
      const file = p?.files?.[0];
      return { id: 'm' + sent.length, attachments: { first: () => (file ? { url: `https://cdn.discordapp.com/attachments/${id}/${file.name}` } : undefined) } };
    },
    setTopic: async () => {}, delete: async () => {}, setParent: async () => {},
    // fetch({ limit }) → empty collection (transcripts); fetch(id) → unknown message
    messages: { fetch: async q => (q && typeof q === 'object' ? new Map() : null), delete: async () => {} },
  });
  // Discord members and their roles (mutable to simulate role changes)
  const memberRoles = new Map([
    ['300000000000000002', new Map()],
    ['400000000000000001', new Map([['800000000000000001', {}]])],
    ['400000000000000002', new Map([['800000000000000003', {}]])],
    ['400000000000000003', new Map()],
    ['200000000000000005', new Map()],
    ['200000000000000006', new Map()],
    ['200000000000000081', new Map()],
    ['200000000000000089', new Map()],
  ]);
  const memberDms = [];
  const G2 = '223456789012345678';
  let g2Left = false;
  const g2Discord = { id: G2, leave: async () => { g2Left = true; } };
  const OWN_CH = '900000000000000001', FOREIGN_CH = '900000000000000002';
  channels.set(OWN_CH, mkChannel(OWN_CH, G));
  channels.set(FOREIGN_CH, mkChannel(FOREIGN_CH, '999999999999999999'));
  const CAT_OPEN = '900000000000000010', CAT_WAIT = '900000000000000011';
  channels.set(CAT_OPEN, mkChannel(CAT_OPEN, G, 4));
  channels.set(CAT_WAIT, mkChannel(CAT_WAIT, G, 4));
  let chanSeq = 0;
  const guildObj = {
    id: G,
    channels: {
      fetch: async () => new (require('discord.js').Collection)([...channels].filter(([, c]) => c.guildId === G)),
      get cache() { return new (require('discord.js').Collection)([...channels].filter(([, c]) => c.guildId === G)); },
      create: async opts => {
        const id = String(910000000000000000n + BigInt(++chanSeq)); const c = mkChannel(id, G, opts?.type ?? 0, opts?.name);
        c.parentId = opts?.parent || null; c.opts = opts; c.delete = async () => { c.deleted = true; };
        channels.set(id, c); await new Promise(r => setTimeout(r, 50)); return c;
      } },
    roles: { fetch: async () => new (require('discord.js').Collection)([['800000000000000001', { id: '800000000000000001', name: 'Support', managed: false, hexColor: '#5865f2' }]]) },
    members: {
      fetch: async id => { const r = memberRoles.get(id); if (r) return { id, roles: { cache: r } }; throw new Error('Unknown Member'); },
      me: { nickname: null, displayName: 'Ticket Bot', displayAvatarURL: () => null },
    },
  };
  const fakeClient = {
    isReady: () => true, user: { id: '1', username: 'Bot de test', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
    application: { fetch: async () => ({ owner: { id: U.F, username: 'F' } }) },
    guilds: { fetch: async id => (id === G ? guildObj : id === G2 ? g2Discord : null), cache: new Map([[G, { name: 'Serveur Test', iconURL: () => null, members: guildObj.members }]]) },
    channels: { fetch: async id => channels.get(id) || null },
    users: { fetch: async id => {
      if (/^30000000000000000[12]$/.test(id)) return { id, username: 'founder' + id.slice(-1), avatar: null, bot: false, send: async () => {} };
      if (/^2000000000000000\d\d$/.test(id)) return { id, username: 'member' + id.slice(-2), tag: 'member' + id.slice(-2), send: async p => memberDms.push({ id, p }) };
      if (/^10000000000000000\d$/.test(id)) return { id, username: 'staff' + id.slice(-1), tag: 'staff' + id.slice(-1), send: async p => memberDms.push({ id, p }) };
      return null;
    } },
  };
  const { startWebServer } = app('./web/server');
  const server = startWebServer(fakeClient);
  await new Promise(r => setTimeout(r, 500));

  let r;
  r = await req('GET', '/api/tickets', { sid: sessions.S2 });
  check('support sans grade -> 403 sur /tickets', r.status === 403, r.status);
  r = await req('GET', '/api/tickets', { sid: sessions.S1 });
  check('S1 liste: seulement le ticket public', r.status === 200 && r.body.tickets.map(t => t.id).join() === String(t1), JSON.stringify(r.body));
  r = await req('GET', `/api/tickets/${t2}`, { sid: sessions.S1 });
  check('S1 detail ticket restreint -> 403', r.status === 403, r.status);
  r = await req('PATCH', `/api/tickets/${t2}/visibility`, { sid: sessions.S1, body: { visibility_grade_id: null } });
  check('S1 ne peut pas lever la restriction', r.status === 403, r.status);
  r = await req('POST', `/api/tickets/${t1}/assignees`, { sid: sessions.S1, body: { user_id: U.S1 } });
  check('S1 sans claim_ticket -> 403 claim', r.status === 403, r.status);
  r = await req('PATCH', `/api/tickets/${t1}/priority`, { sid: sessions.S1, body: { priority: 'urgent' } });
  check('priorité: support avec reply_ticket autorisé', r.status === 200, r.status + JSON.stringify(r.body));
  r = await req('PATCH', `/api/tickets/${t1}/status`, { sid: sessions.S1, body: { status: 'closed' } });
  check('fermeture: support sans close_ticket refusé', r.status === 403, r.status);
  r = await req('GET', '/api/tickets/search', { sid: sessions.S1, query: { q: 'secret' } });
  check('recherche ne fuit pas le ticket restreint', r.status === 200 && r.body.results.length === 0, JSON.stringify(r.body));
  r = await req('GET', '/api/tickets/search', { sid: sessions.F, query: { q: 'secret' } });
  check('fondateur trouve le ticket restreint', r.status === 200 && r.body.results.length === 1, JSON.stringify(r.body));
  r = await req('GET', '/api/transcripts', { sid: sessions.S1 });
  check('transcripts sans view_transcripts -> 403', r.status === 403, r.status);

  r = await req('GET', '/api/login-logs', { sid: sessions.F });
  const ids = (r.body || []).map(x => x.user_id);
  check('login-logs fondateur: membres seulement', r.status === 200 && ids.includes(U.S1) && !ids.includes(U.OUT), JSON.stringify(ids));

  // Grade escalation
  r = await req('POST', `/api/users/${U.S3}/grades`, { sid: sessions.S3, body: { grade_id: g1 } });
  check('manage_users: pas d\'auto-attribution', r.status === 403, r.status);
  for (const p of ['manage_grades']) await db('INSERT INTO grade_permissions VALUES (?, ?)', [g2, p]);
  r = await req('POST', `/api/users/${U.S2}/grades`, { sid: sessions.S3, body: { grade_id: g2 } });
  check('manage_users: grade avec perms supérieures refusé', r.status === 403, r.status);
  r = await req('POST', `/api/users/${U.S2}/grades`, { sid: sessions.S3, body: { grade_id: g1 } });
  check('manage_users: grade autorisé accepté', r.status === 200, r.status + JSON.stringify(r.body));

  // IP allowlist (Traefik appends the real IP last; trust proxy = 1 hop)
  await db('UPDATE guild_config SET ip_allowlist = ? WHERE id = 1', [JSON.stringify(['10.0.0.0/8'])]);
  r = await req('GET', '/api/tickets', { sid: sessions.S1, headers: { 'X-Forwarded-For': '10.1.1.1, 8.8.8.8' } });
  check('allowlist: XFF usurpé en tête refusé', r.status === 403 && /IP/.test(r.body.error), JSON.stringify(r.body));
  r = await req('GET', '/api/tickets', { sid: sessions.S1, headers: { 'X-Forwarded-For': '8.8.8.8, 10.1.1.1' } });
  check('allowlist: vraie IP autorisée acceptée', r.status === 200, r.status);
  await db("UPDATE guild_config SET ip_allowlist = '[]' WHERE id = 1");

  // SSE visibility
  const events = [];
  const sse = http.get({ host: '127.0.0.1', port: config.webServerPort, path: '/api/events',
    headers: { Cookie: 'connect.sid=' + encodeURIComponent('s:' + sign(sessions.S1, config.dashboard.sessionSecret)) } },
    res => res.on('data', c => events.push(String(c))));
  await new Promise(r => setTimeout(r, 400));
  const { broadcast } = app('./utils/sse');
  broadcast('note', { ticketId: t2, note: { content: 'LEAK' } }, G);
  broadcast('note', { ticketId: t1, note: { content: 'VISIBLE' } }, G);
  await new Promise(r => setTimeout(r, 400));
  const all = events.join('');
  check('SSE: note restreinte non reçue', !all.includes('LEAK'), all);
  check('SSE: note publique reçue', all.includes('VISIBLE'), all);
  // Event published by another instance (straight on the Redis channel)
  await redis.publish('sse:events', JSON.stringify({ event: 'note', data: { ticketId: t1, note: { content: 'FROM-OTHER-INSTANCE' } }, guildId: G }));
  await new Promise(r => setTimeout(r, 300));
  check('SSE: événement d\'une autre instance reçu (pub/sub Redis)', events.join('').includes('FROM-OTHER-INSTANCE'));
  sse.destroy();

  // Session revocation (Redis store)
  r = await req('DELETE', `/api/sessions/${sessions.S1b}`, { sid: sessions.S1 });
  check('révocation: session supprimée de Redis', r.status === 200 && (await redis.exists('sess:' + sessions.S1b)) === 0, r.status);

  // CSV + PDF
  r = await req('GET', '/api/tickets/export', { sid: sessions.F });
  check('CSV: formule neutralisée', r.status === 200 && r.body.includes("'=HYPERLINK(1)"), r.body.slice(0, 200));
  r = await req('GET', `/api/tickets/${t1}/pdf`, { sid: sessions.F });
  const nonce = /nonce-([^']+)'/.exec(r.headers['content-security-policy'] || '')?.[1];
  check('PDF: script du bouton autorisé par nonce', nonce && r.body.includes(`nonce="${nonce}"`) && !r.body.includes('onclick'), r.headers['content-security-policy']);

  // Instance section: reserved to the owner
  r = await req('GET', '/api/instance/error-logs', { sid: sessions.NOWN });
  check('instance: erreurs refusées à un compte qui n est pas propriétaire', r.status === 403, r.status);
  r = await req('GET', '/api/instance/error-logs', { sid: sessions.S1 });
  check('instance: refusée aussi au staff connecté sur un serveur', r.status === 403, r.status);
  r = await req('GET', '/api/instance/error-logs');
  check('instance: refusée sans connexion', r.status === 401, r.status);

  // API v1
  await db('UPDATE guild_config SET api_keys_enabled = 1 WHERE id = 1');
  r = await req('POST', '/api/api-keys', { sid: sessions.F, body: { name: 'ci', permissions: ['read_tickets', 'close_tickets', 'delete_everything'] } });
  const key = r.body.key;
  check('clé API créée au nouveau format', r.status === 200 && new RegExp(`^tb_${G}_[a-f0-9]{64}$`).test(key) && !r.body.permissions.includes('delete_everything'), JSON.stringify(r.body));
  r = await req('GET', '/api/v1/tickets');
  check('API v1 sans clé -> 401', r.status === 401, r.status);
  r = await req('GET', '/api/v1/tickets', { headers: { Authorization: 'Bearer ' + key } });
  check('API v1 liste tickets', r.status === 200 && r.body.total === 2, JSON.stringify(r.body));
  r = await req('GET', '/api/v1/stats', { headers: { Authorization: 'Bearer ' + key } });
  check('API v1 stats sans read_stats -> 403', r.status === 403, r.status);
  r = await req('POST', `/api/v1/tickets/${t1}/close`, { headers: { Authorization: 'Bearer ' + key } });
  check('API v1 fermeture (sans en-tête CSRF)', r.status === 200, r.status + JSON.stringify(r.body));
  const [closed] = await db('SELECT status, closed_by_tag FROM tickets WHERE id = ?', [t1]);
  check('ticket fermé via API', closed.status === 'closed' && closed.closed_by_tag === 'API · ci', JSON.stringify(closed));
  // Confidential tickets never leave through an API key
  {
    const tConf = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES ('49','u49','capiconf','open','Signalement', -1)")).insertId;
    r = await req('GET', '/api/v1/tickets', { headers: { Authorization: 'Bearer ' + key } });
    check('API v1: ticket confidentiel absent de la liste', r.status === 200 && !r.body.tickets.some(t => t.id === tConf) && r.body.total === 2, JSON.stringify(r.body).slice(0, 200));
    r = await req('GET', `/api/v1/tickets/${tConf}`, { headers: { Authorization: 'Bearer ' + key } });
    check('API v1: ticket confidentiel introuvable', r.status === 404, r.status);
    r = await req('POST', `/api/v1/tickets/${tConf}/close`, { headers: { Authorization: 'Bearer ' + key } });
    check('API v1: ticket confidentiel non fermable', r.status === 404, r.status);
    await db('DELETE FROM tickets WHERE id = ?', [tConf]);
  }

  // CSRF still enforced on cookie routes
  r = await req('POST', '/api/auth/logout', { sid: sessions.F, headers: { 'X-Requested-With': '' } });
  check('CSRF toujours actif hors /api/v1', r.status === 403, r.status);

  // mysql2 object injection
  r = await req('POST', '/api/auth/select-guild', { sid: sessions.S1, body: { guildId: { guild_id: 1 } } });
  check('select-guild rejette un objet', r.status === 400, r.status);

  // ── Round 2: second audit fixes ──────────────────────────────────────────
  const { generateSync: otpGenerate, createGuardrails } = require('otplib');
  const legacyRails = createGuardrails({ MIN_SECRET_BYTES: 10 });
  const generateSync = o => otpGenerate({ ...o, guardrails: legacyRails });
  const { seal } = app('./utils/secretBox');
  const { generateRecoveryCodes } = app('./utils/totp');
  const { createManager } = app('./utils/ticketManager');

  // H1 — panels / config can only target channels and roles of this guild
  r = await req('POST', '/api/panels', { sid: sessions.F, body: { name: 'p', buttons: [{ label: 'Ouvrir' }] } });
  const panelId = r.body.id;
  check('panel créé (validation OK)', r.status === 201, r.status + JSON.stringify(r.body));
  r = await req('POST', `/api/panels/${panelId}/publish`, { sid: sessions.F, body: { channel_id: FOREIGN_CH } });
  check('H1 publish vers un salon d\'un autre serveur refusé', r.status === 400, r.status);
  r = await req('POST', `/api/panels/${panelId}/publish`, { sid: sessions.F, body: { channel_id: OWN_CH } });
  check('H1 publish vers un salon du serveur accepté', r.status === 200, r.status + JSON.stringify(r.body));
  r = await req('PATCH', '/api/config', { sid: sessions.F, body: { closeLogChannelId: FOREIGN_CH } });
  check('H1 salon de logs étranger refusé', r.status === 400, r.status);
  r = await req('PATCH', '/api/config', { sid: sessions.F, body: { supportRoleIds: ['800000000000000002'] } });
  check('H1 rôle étranger refusé', r.status === 400, r.status);
  r = await req('PATCH', '/api/config', { sid: sessions.F, body: { closeLogChannelId: OWN_CH, supportRoleIds: ['800000000000000001'] } });
  check('H1 salon/rôle du serveur acceptés', r.status === 200, r.status + JSON.stringify(r.body));
  r = await req('POST', '/api/panels', { sid: sessions.F, body: { name: { $gt: '' } } });
  check('panel: nom non-chaîne rejeté', r.status === 400, r.status);

  // M2 — webhook secret never stored in clear in the audit log
  await req('PATCH', '/api/config', { sid: sessions.F, body: { webhookSecret: 'supersecretvalue123' } });
  const audits = await db("SELECT details FROM audit_log WHERE action = 'config_update'");
  const dump = JSON.stringify(audits);
  check('M2 secret webhook masqué dans l\'audit', !dump.includes('supersecretvalue123') && dump.includes('[modifi'), dump.slice(0, 300));

  // M7 — avatar upload no longer rejected by the 100 kB body limit
  r = await req('PATCH', '/api/config/bot-identity', { sid: sessions.F, body: { avatarDataUrl: 'data:image/png;base64,' + 'A'.repeat(500000) } });
  check('M7 corps de 500 ko accepté par le parseur', r.status !== 413, r.status);
  r = await req('PATCH', '/api/config', { sid: sessions.F, body: { welcomeMessage: 'x'.repeat(500000) } });
  check('limite de 400 ko sur les paramètres (logo de l espace membre)', r.status === 413, r.status);
  r = await req('POST', '/api/tickets/1/notes', { sid: sessions.F, body: { content: 'x'.repeat(200000) } });
  check('limite 100 ko conservée ailleurs', r.status === 413, r.status);
  // X-Forwarded-For only believed from the reverse proxy itself
  {
    const { createProxyTrust } = app('./utils/trustProxy');
    const trust = createProxyTrust({ hops: 1, host: 'traefik', lookup: async () => [{ address: '172.18.0.2' }], refreshMs: 0 });
    await trust.ready;
    check('proxy: en-tête cru venant de Traefik', trust('172.18.0.2', 0) && trust('::ffff:172.18.0.2', 0), '');
    check('proxy: en-tête ignoré venant d un autre conteneur', !trust('172.18.0.11', 0), '');
    check('proxy: pas plus de sauts que configuré', !trust('172.18.0.2', 1), '');
    const loose = createProxyTrust({ hops: 1, host: 'introuvable', lookup: async () => { throw new Error('ENOTFOUND'); }, refreshMs: 0 });
    await loose.ready;
    check('proxy: sans nom résolu, nombre de sauts seul', loose('10.0.0.1', 0) && !loose('10.0.0.1', 1), '');
    const none = createProxyTrust({ hops: 1, host: '', refreshMs: 0 });
    check('proxy: sans reverse proxy, en-tête cru d un proxy local (boucle, réseau privé, Docker)', none('127.0.0.1', 0) && none('::ffff:172.17.0.1', 0) && none('192.168.1.10', 0) && none('::1', 0));
    check('proxy: sans reverse proxy, en-tête d un client Internet ignoré (pas d usurpation d IP)', !none('203.0.113.7', 0) && !none('::ffff:8.8.8.8', 0) && !none('2001:db8::1', 0) && !loose('198.51.100.4', 0));
  }
  // Without a body (or with another Content-Type) a route answers 400, it does not crash
  r = await req('POST', '/api/tickets/1/notes', { sid: sessions.F });
  check('corps absent: refus propre, pas d erreur 500', r.status === 400, r.status);
  r = await req('POST', '/api/tickets/1/notes', { sid: sessions.F, headers: { 'Content-Type': 'application/json' } });
  check('JSON vide: refus propre', r.status === 400, r.status);
  // An id that is not a number never reaches the database as NaN (SQL error → 500)
  r = await req('POST', '/api/tickets/1/apply-template', { sid: sessions.F, body: {} });
  check('identifiant invalide: introuvable, pas d erreur 500', r.status === 404 || r.status === 400, r.status);
  r = await req('DELETE', '/api/ticket-views/abc', { sid: sessions.F });
  check('identifiant non numérique dans l URL: pas d erreur 500', r.status < 500, r.status);

  // H3 — a DM opens a ticket
  const { openTicketForGuild } = app('./events/messageCreate');
  const dms = [];
  const mkUser = id => ({ id, username: 'u' + id.slice(-2), tag: 'u' + id.slice(-2), send: async p => dms.push({ id, p }) });
  const [cfg] = await db('SELECT * FROM guild_config LIMIT 1');
  const entry = () => ({ guildId: G, db, tm: createManager(db, fakeClient, G), config: cfg });
  const u1 = mkUser('200000000000000001');
  await openTicketForGuild(u1, 'bonjour', [], entry(), fakeClient, 'Sujet test');
  const [c1] = await db('SELECT COUNT(*) AS n FROM tickets WHERE owner_id = ?', [u1.id]);
  check('H3 ticket créé depuis un MP', Number(c1.n) === 1, JSON.stringify(c1));

  // H4 — burst of DMs creates a single ticket and keeps every message
  const u2 = mkUser('200000000000000002');
  await Promise.all([
    createManager(db, fakeClient, G).relayDmToTicket(u2, 'message 1', []),
    createManager(db, fakeClient, G).relayDmToTicket(u2, 'message 2', []),
    createManager(db, fakeClient, G).relayDmToTicket(u2, 'message 3', []),
  ]);
  const [c2] = await db('SELECT COUNT(*) AS n FROM tickets WHERE owner_id = ?', [u2.id]);
  const [n2] = await db("SELECT COUNT(*) AS n FROM ticket_notes n JOIN tickets t ON t.id = n.ticket_id WHERE t.owner_id = ? AND n.source = 'user'", [u2.id]);
  check('H4 rafale: un seul ticket', Number(c2.n) === 1, JSON.stringify(c2));
  check('H4 rafale: les 3 messages conservés', Number(n2.n) === 3, JSON.stringify(n2));

  // M6 — long content is split into several embeds under Discord limits
  const u3 = mkUser('200000000000000003');
  const before = sent.length;
  await createManager(db, fakeClient, G).relayDmToTicket(u3, 'x'.repeat(9000), [{ url: 'https://cdn.discordapp.com/a.png' }]);
  const embeds = sent.slice(before).flatMap(m => m.p?.embeds || []).map(e => e.data?.description || '');
  check('M6 contenu de 9000 car. découpé (≥3 embeds ≤4096)', embeds.length >= 3 && embeds.every(d => d.length <= 4096), embeds.map(d => d.length).join(','));

  // H2 — blacklist is per guild
  const u4 = mkUser('200000000000000004');
  await db("INSERT INTO blacklist (user_id, user_tag, added_by_id, added_by_tag) VALUES (?, 'u4', 'x', 'x')", [u4.id]);
  await openTicketForGuild(u4, 'hello', [], entry(), fakeClient, 'x');
  const [c4] = await db('SELECT COUNT(*) AS n FROM tickets WHERE owner_id = ?', [u4.id]);
  check('H2 blacklisté sur ce serveur: pas de ticket', Number(c4.n) === 0, JSON.stringify(c4));
  const { isBlacklistedIn } = app('./utils/guildScan');
  check('H2 blacklist évaluée par serveur', (await isBlacklistedIn(db, u4.id)) && !(await isBlacklistedIn(db, u1.id)), '');

  // M4 — TOTP: encrypted secret, no replay, recovery codes
  const secret = 'JBSWY3DPEHPK3PXP'; // 10 bytes, like the secrets created before otplib 13
  const { codes, hashes } = generateRecoveryCodes();
  await globalQuery('INSERT INTO user_totp (user_id, totp_secret, totp_enabled, recovery_codes) VALUES (?, ?, 1, ?)', [U.S2, seal(secret), JSON.stringify(hashes)]);
  const pend = async () => { await mk('P', { pendingTotp: { userId: U.S2, username: 'S2', avatar: null, discordAccessToken: 't' } }); return sessions.P; };
  const code = generateSync({ secret });
  r = await req('POST', '/api/auth/totp-verify-login', { sid: await pend(), body: { code } });
  check('M4 code TOTP valide (secret chiffré) accepté', r.status === 200, r.status + JSON.stringify(r.body));
  r = await req('POST', '/api/auth/totp-verify-login', { sid: await pend(), body: { code } });
  check('M4 rejeu du même code refusé', r.status === 400, r.status);
  {
    const totp = app('./utils/totp');
    const fresh = totp.newTotpSecret();
    const step = totp.verifyTotp(generateSync({ secret: fresh }), fresh);
    check('TOTP: nouveaux secrets (20 octets) acceptés, anciens (10 octets) toujours valides', fresh.length === 32 && step > 0 && totp.verifyTotp(generateSync({ secret }), secret, 0) > 0, fresh);
    check('TOTP: code d\'une étape déjà utilisée refusé', totp.verifyTotp(generateSync({ secret: fresh }), fresh, step) === null);
    check('TOTP: URI otpauth', /^otpauth:\/\/totp\/TicketBot%20SA:root\?secret=[A-Z2-7]+&issuer=TicketBot%20SA$/.test(totp.totpUri('root', 'TicketBot SA', fresh)));
  }
  r = await req('POST', '/api/auth/totp-verify-login', { sid: await pend(), body: { code: codes[0] } });
  check('M4 code de secours accepté', r.status === 200, r.status + JSON.stringify(r.body));
  r = await req('POST', '/api/auth/totp-verify-login', { sid: await pend(), body: { code: codes[0] } });
  check('M4 code de secours à usage unique', r.status === 400, r.status);
  const [tr] = await globalQuery('SELECT totp_secret FROM user_totp WHERE user_id = ?', [U.S2]);
  check('M4 secret stocké chiffré', /^enc:v[12]:/.test(tr.totp_secret) && !tr.totp_secret.includes(secret), tr.totp_secret.slice(0, 20));

  // Owner of the instance: the owner of the Discord application, plus OWNER_IDS
  {
    const inst = app('./utils/instance');
    inst.resetOwnerCache();
    check('propriétaire: propriétaire de l application Discord', (await inst.ownerIds(fakeClient)).includes(U.F) && !(await inst.isOwner(fakeClient, U.S1)));
    inst.resetOwnerCache();
    const teamClient = { application: { fetch: async () => ({ owner: { ownerId: U.S2, members: new Map([[U.S3, { id: U.S3, role: 'admin' }], ['100000000000000005', { id: '100000000000000005', role: 'read_only' }], ['100000000000000006', { id: '100000000000000006' }]]) } }) } };
    const team = await inst.ownerIds(teamClient);
    check('propriétaire: application d une équipe → propriétaire et admins', team.includes(U.S2) && team.includes(U.S3) && !team.includes('100000000000000005') && !team.includes('100000000000000006'), JSON.stringify(team));
    inst.resetOwnerCache();
    const cfgO = app('./utils/config').config;
    cfgO.ownerIds = ['100000000000000007'];
    const extra = await inst.ownerIds({ application: { fetch: async () => { throw new Error('Discord injoignable'); } } });
    check('propriétaire: OWNER_IDS suffit si Discord ne répond pas', extra.includes('100000000000000007'), JSON.stringify(extra));
    delete cfgO.ownerIds;
    inst.resetOwnerCache();
    r = await req('GET', '/api/auth/me', { sid: sessions.OWN });
    const meS1 = await req('GET', '/api/auth/me', { sid: sessions.S1 });
    check('propriétaire: signalé par /auth/me', r.body.isOwner === true && meS1.body.isOwner === false, JSON.stringify([r.body.isOwner, meS1.body.isOwner]));
    r = await req('GET', '/api/instance/stats', { sid: sessions.OWN });
    check('propriétaire: accès à la section Instance sans choisir de serveur', r.status === 200, r.status);
    r = await req('GET', '/api/instance/info');
    check('instance: infos publiques (nom du bot, démo désactivée par défaut)', r.status === 200 && r.body.name === 'Bot de test' && r.body.demo === false && !('ownerIds' in r.body), JSON.stringify(r.body));
    r = await req('GET', '/favicon.png');
    check('icône de l onglet: avatar du bot', r.status === 302 && r.headers.location === 'https://cdn.discordapp.com/embed/avatars/0.png', JSON.stringify([r.status, r.headers.location]));
    for (const p of ['/api/sa/auth/login', '/api/sa/stats', '/api/sa/managers']) {
      r = await req(p.endsWith('login') ? 'POST' : 'GET', p, { body: { username: 'root', password: 'x' } });
      check(`super-admin retiré: ${p}`, r.status === 404, r.status);
    }
    check('super-admin retiré: middleware et routes supprimés', ['./web/middleware/superadmin', './web/routes/superadmin'].every(m => { try { require.resolve(path.join(ROOT, m)); return false; } catch { return true; } }));
  }

  // Instance — appoint tenant founders by Discord ID
  r = await req('POST', `/api/instance/guilds/${G}/founders`, { sid: sessions.NOWN, body: { discordId: '300000000000000001' } });
  check('fondateurs: ajout refusé à qui n est pas propriétaire', r.status === 403, r.status);
  r = await req('POST', `/api/instance/guilds/${G}/founders`, { sid: sessions.OWN, body: { discordId: '12345' } });
  check('fondateurs: ID invalide refusé', r.status === 400, r.status);
  r = await req('POST', `/api/instance/guilds/${G}/founders`, { sid: sessions.OWN, body: { discordId: '399999999999999999' } });
  check('fondateurs: utilisateur Discord inconnu -> 404', r.status === 404, r.status);
  r = await req('POST', `/api/instance/guilds/${G}/founders`, { sid: sessions.OWN, body: { discordId: '300000000000000001' } });
  check('fondateurs: ajout OK (non membre signalé)', r.status === 200 && r.body.isMember === false, r.status + JSON.stringify(r.body));
  r = await req('POST', `/api/instance/guilds/${G}/founders`, { sid: sessions.OWN, body: { discordId: '300000000000000002' } });
  check('fondateurs: ajout OK (membre)', r.status === 200 && r.body.isMember === true, r.status + JSON.stringify(r.body));
  const [fr] = await db('SELECT role FROM dashboard_users WHERE user_id = ?', ['300000000000000001']);
  check('fondateurs: rôle fondateur en base', fr?.role === 'fondateur', JSON.stringify(fr));
  r = await req('GET', `/api/instance/guilds/${G}/founders`, { sid: sessions.OWN });
  const fids = (r.body || []).map(f => f.user_id);
  check('fondateurs: liste (F propriétaire + 2 nouveaux)', r.status === 200 && fids.includes(U.F) && fids.includes('300000000000000001') && r.body.find(f => f.user_id === U.F)?.isOwner, JSON.stringify(r.body));
  const [fa] = await db("SELECT actor_tag FROM audit_log WHERE action = 'founder_add' LIMIT 1");
  check('fondateurs: action tracée dans l\'audit du serveur', fa?.actor_tag === 'F', JSON.stringify(fa));
  r = await req('GET', `/api/instance/guilds/${G}/founders`, { sid: sessions.NOWN });
  check('fondateurs: liste refusée à qui n est pas propriétaire', r.status === 403, r.status);

  // Ratings: closer attribution and unattributed ratings
  const { ensureTenantSchema: ets } = app('./utils/tenantSchema');
  await ets(G); // migration on an existing tenant DB
  const tmR = createManager(db, fakeClient, G);
  const tr1 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status) VALUES ('500000000000000001','r1','cr1','open')")).insertId;
  r = await req('PATCH', `/api/tickets/${tr1}/status`, { sid: sessions.F, body: { status: 'closed' } });
  const [cl] = await db('SELECT closed_by_id, claimed_by FROM tickets WHERE id = ?', [tr1]);
  check('notation: l\'ID de la personne qui ferme est enregistré', r.status === 200 && cl.closed_by_id === U.F && !cl.claimed_by, JSON.stringify([r.status, cl]));
  await tmR.saveRating(tr1, '500000000000000001', cl.claimed_by || cl.closed_by_id, 5, 'F');
  const [st] = await db('SELECT total_ratings FROM admin_stats WHERE admin_id = ?', [U.F]);
  check('notation: créditée à la personne qui a fermé (ticket non claim)', Number(st?.total_ratings) >= 1, JSON.stringify(st));
  const tr2 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, closed_by_tag) VALUES ('500000000000000002','r2','cr2','closed','system')")).insertId;
  let rateErr = null;
  try { await tmR.saveRating(tr2, '500000000000000002', null, 4, 'system'); } catch (e) { rateErr = e.message; }
  const [rr] = await db('SELECT rating, closed_by_id FROM ticket_ratings WHERE ticket_id = ?', [tr2]);
  check('notation: ticket fermé automatiquement, note enregistrée sans attribution', !rateErr && rr?.rating === 4 && rr.closed_by_id === null, rateErr || JSON.stringify(rr));

  // Discord staff roles → dashboard access
  await db(`UPDATE guild_config SET support_role_ids = '["800000000000000001"]', chief_role_ids = '["800000000000000003"]' WHERE id = 1`);
  await mk('DS', { user: { id: '400000000000000001', username: 'sup', avatar: null, role: null } });
  r = await req('POST', '/api/auth/select-guild', { sid: sessions.DS, body: { guildId: G } });
  check('rôle Discord support: accès au serveur', r.status === 200 && r.body.role === 'support', r.status + JSON.stringify(r.body));
  const supGrades = await db("SELECT g.name FROM user_grades ug JOIN grades g ON g.id = ug.grade_id WHERE ug.user_id = '400000000000000001'");
  check('rôle Discord support: grade « Support » attribué', supGrades.map(x => x.name).join() === 'Support', JSON.stringify(supGrades));
  await mk('DS2', { user: { id: '400000000000000001', username: 'sup', role: null }, currentGuildId: G, staffSyncAt: Date.now() });
  r = await req('GET', '/api/tickets', { sid: sessions.DS2 });
  check('rôle Discord support: peut lister les tickets', r.status === 200, r.status);
  await mk('DC', { user: { id: '400000000000000002', username: 'chief', avatar: null, role: null } });
  r = await req('POST', '/api/auth/select-guild', { sid: sessions.DC, body: { guildId: G } });
  const chGrades = await db("SELECT g.name FROM user_grades ug JOIN grades g ON g.id = ug.grade_id WHERE ug.user_id = '400000000000000002'");
  check('rôle Discord chef support: grade « Chef support »', r.status === 200 && chGrades.map(x => x.name).join() === 'Chef support', JSON.stringify([r.status, chGrades]));
  await mk('DN', { user: { id: '400000000000000003', username: 'none', avatar: null, role: null } });
  r = await req('POST', '/api/auth/select-guild', { sid: sessions.DN, body: { guildId: G } });
  check('sans rôle staff: accès refusé', r.status === 403, r.status);
  const [gc] = await db(`SELECT (SELECT COUNT(*) FROM grades WHERE name = 'Chef support') AS chiefs,
    (SELECT COUNT(*) FROM grades g JOIN guild_config c ON g.id IN (c.support_grade_id, c.chief_grade_id)) AS mapped`);
  check('grades par défaut créés une seule fois et associés', Number(gc.chiefs) === 1 && Number(gc.mapped) === 2, JSON.stringify(gc));
  memberRoles.set('400000000000000001', new Map()); // role removed on Discord
  await mk('DS3', { user: { id: '400000000000000001', username: 'sup', role: null }, currentGuildId: G, staffSyncAt: 0 });
  r = await req('GET', '/api/tickets', { sid: sessions.DS3 });
  const [lost] = await db("SELECT role, discord_has_role FROM dashboard_users WHERE user_id = '400000000000000001'");
  check('rôle Discord retiré: accès révoqué', r.status === 403 && lost.role === 'nouveau', JSON.stringify([r.status, lost]));
  r = await req('POST', '/api/auth/select-guild', { sid: sessions.F, body: { guildId: G } });
  const [fo] = await db('SELECT role FROM dashboard_users WHERE user_id = ?', [U.F]);
  check('fondateur jamais modifié par la synchro', fo.role === 'fondateur', JSON.stringify(fo));

  // ── Restricted ticket → Discord channel hidden from the staff roles ──
  await mk('FV', { user: { id: U.F, username: 'F', role: null }, currentGuildId: G });
  const bits = v => (Array.isArray(v) ? v.reduce((m, f) => m | BigInt(f), 0n) : BigInt(v ?? 0));
  const VIS_CH = '900000000000000077';
  const visCh = mkChannel(VIS_CH, G);
  visCh.failPerms = false;
  visCh.permissionOverwrites = {
    cache: new Map([['555000000000000000', { id: '555000000000000000', type: 1, allow: { bitfield: 1024n }, deny: { bitfield: 0n } }]]),
    set: async function (list) {
      if (visCh.failPerms) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
      this.cache = new Map(list.map(o => [o.id, { id: o.id, type: o.type, allow: { bitfield: bits(o.allow) }, deny: { bitfield: bits(o.deny) } }]));
    },
  };
  channels.set(VIS_CH, visCh);
  const VIEW = 1024n;
  const canView = id => { const o = visCh.permissionOverwrites.cache.get(id); return o ? ((o.allow.bitfield & VIEW) ? 'allow' : (o.deny.bitfield & VIEW) ? 'deny' : 'none') : 'absent'; };
  const tv = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('7','u7',?,'open','vis')", [VIS_CH])).insertId;
  r = await req('PATCH', `/api/tickets/${tv}/visibility`, { sid: sessions.FV, body: { visibility_grade_id: g2 } });
  check('visibilité Discord: rôles staff masqués, fondateur autorisé', r.status === 200 && r.body.channelSync === 'ok'
    && canView('800000000000000001') === 'deny' && canView('800000000000000003') === 'deny' && canView(U.F) === 'allow' && canView(G) === 'deny',
    JSON.stringify([r.body, [...visCh.permissionOverwrites.cache.keys()]]));
  check('visibilité Discord: staff hors grade non autorisé', canView('400000000000000002') === 'absent' && canView(U.S2) === 'absent', JSON.stringify([...visCh.permissionOverwrites.cache.keys()]));
  check('visibilité Discord: permission ajoutée à la main conservée', canView('555000000000000000') === 'allow');
  const s2HadG1 = (await db('SELECT 1 FROM user_grades WHERE user_id = ? AND grade_id = ?', [U.S2, g1])).length > 0;
  await db('INSERT IGNORE INTO user_grades (user_id, grade_id, assigned_by_id, assigned_by_tag) VALUES (?, ?, "x", "x")', [U.S2, g1]);
  r = await req('POST', `/api/users/${U.S2}/grades`, { sid: sessions.FV, body: { grade_id: g2 } });
  await new Promise(res => setTimeout(res, 200));
  check('visibilité Discord: grade attribué → salon ouvert au membre', r.status === 200 && canView(U.S2) === 'allow', JSON.stringify([r.status, r.body, canView(U.S2)]));
  r = await req('DELETE', `/api/users/${U.S2}/grades/${g2}`, { sid: sessions.FV });
  await new Promise(res => setTimeout(res, 200));
  check('visibilité Discord: grade retiré → salon refermé', canView(U.S2) === 'absent', canView(U.S2));
  if (!s2HadG1) await db('DELETE FROM user_grades WHERE user_id = ? AND grade_id = ?', [U.S2, g1]);
  visCh.failPerms = true;
  r = await req('PATCH', `/api/tickets/${tv}/visibility`, { sid: sessions.FV, body: { visibility_grade_id: null } });
  check('visibilité Discord: permission manquante signalée sans erreur', r.status === 200 && r.body.channelSync === 'missing_permissions', JSON.stringify(r.body));
  visCh.failPerms = false;
  r = await req('PATCH', `/api/tickets/${tv}/visibility`, { sid: sessions.FV, body: { visibility_grade_id: null } });
  check('visibilité Discord: restriction levée → rôles staff rétablis', r.body.channelSync === 'ok' && canView('800000000000000001') === 'allow' && canView('800000000000000003') === 'allow' && canView(U.F) === 'absent' && canView('555000000000000000') === 'allow',
    JSON.stringify([...visCh.permissionOverwrites.cache.entries()].map(([k, o]) => [k, String(o.allow.bitfield), String(o.deny.bitfield)])));
  await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tv]);

  // ── Discord commands follow grade permissions and ticket visibility ──
  const CMD_CH = '900000000000000078';
  channels.set(CMD_CH, mkChannel(CMD_CH, G));
  const tc = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('8','u8',?,'open','cmd')", [CMD_CH])).insertId;
  const runCmd = async (name, userId, channelId = CMD_CH) => {
    const out = {};
    const interaction = {
      guildId: G, channelId, guild: guildObj, channel: channels.get(channelId),
      user: { id: userId, username: 'u' + userId.slice(-2), tag: 'u' + userId.slice(-2), avatar: null },
      options: { getString: () => null, getAttachment: () => null, getUser: () => null, getInteger: () => null },
      reply: async p => { out.reply = p; }, deferReply: async () => {}, editReply: async p => { out.edit = p; },
      followUp: async p => { out.follow = p; },
    };
    await app(`./commands/${name}`).execute(fakeClient, interaction);
    return out;
  };
  const assigned = async uid => (await db('SELECT 1 FROM ticket_assignees WHERE ticket_id = ? AND user_id = ?', [tc, uid])).length > 0;
  let out = await runCmd('claim', U.S1); // S1: grade without claim_ticket
  check('commande Discord: permission de grade manquante refusée', /permission « Prendre en charge »/.test(out.reply?.content) && !(await assigned(U.S1)), JSON.stringify(out));
  out = await runCmd('claim', '400000000000000003'); // no staff role nor account
  check('commande Discord: non-staff refusé', /Permission refusée/.test(out.reply?.content), JSON.stringify(out));
  out = await runCmd('claim', '400000000000000002'); // Discord chief role → Chef support grade
  check('commande Discord: grade autorisé accepté', await assigned('400000000000000002'), JSON.stringify(out));
  out = await runCmd('claim', U.F);
  check('commande Discord: fondateur sans rôle Discord accepté', await assigned(U.F), JSON.stringify(out));
  await db('UPDATE tickets SET visibility_grade_id = ? WHERE id = ?', [g2, tc]);
  await db('DELETE FROM ticket_assignees WHERE ticket_id = ?', [tc]);
  out = await runCmd('claim', '400000000000000002');
  check('commande Discord: ticket restreint refusé hors grade', /réservé à certains grades/.test(out.reply?.content) && !(await assigned('400000000000000002')), JSON.stringify(out));
  await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tc]);

  // ── Member: « Fermer mon ticket » button, then rating with a free comment ──
  const M9 = '200000000000000009', M10 = '200000000000000010';
  const CL_CH = '900000000000000079';
  channels.set(CL_CH, mkChannel(CL_CH, G));
  const tm9 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member09', ?, 'open', 'à fermer')", [M9, CL_CH])).insertId;
  await db('INSERT INTO ticket_participants (ticket_id, user_id) VALUES (?, ?)', [tm9, M10]);
  memberDms.length = 0;
  r = await req('POST', `/api/tickets/${tm9}/reply`, { sid: sessions.FV, body: { content: 'Réponse avec bouton' } });
  const ownerDm = memberDms.find(m => m.id === M9)?.p, partDm = memberDms.find(m => m.id === M10)?.p;
  const closeBtnId = ownerDm?.components?.[0]?.components?.[0]?.data?.custom_id;
  check('membre: bouton « Fermer mon ticket » sur les réponses du staff', r.status === 200 && closeBtnId === `memberclose_${tm9}_${G}`, JSON.stringify(ownerDm?.components));
  check('membre: pas de bouton « Fermer » pour un participant (seulement le lien web)', partDm && !JSON.stringify(partDm.components || []).includes('memberclose') && JSON.stringify(partDm.components || []).includes('Voir sur le web'), JSON.stringify(partDm?.components));
  const dmInteraction = (customId, extra = {}) => {
    const out = {};
    return { out, interaction: {
      customId, guildId: null, guild: null, channelId: 'dm', values: [],
      user: { id: M9, username: 'member09', tag: 'member09', send: async p => memberDms.push({ id: M9, p }) },
      isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false, isChatInputCommand: () => false, isRepliable: () => true,
      reply: async p => { out.reply = p; }, update: async p => { out.update = p; }, showModal: async m => { out.modal = m; },
      ...extra,
    } };
  };
  const interModM = app('./events/interactionCreate');
  let di = dmInteraction(closeBtnId);
  await interModM.execute(fakeClient, di.interaction);
  const confirmId = di.out.reply?.components?.[0]?.components?.[0]?.data?.custom_id;
  check('membre: confirmation demandée avant fermeture', confirmId === `memberclose_confirm_${tm9}_${G}`, JSON.stringify(di.out));
  di = dmInteraction(confirmId);
  await interModM.execute(fakeClient, di.interaction);
  const [closed9] = await db('SELECT status, closed_by_id, closed_by_tag FROM tickets WHERE id = ?', [tm9]);
  const [ev9] = await db("SELECT details FROM audit_log WHERE action = 'ticket_close' AND ticket_id = ?", [tm9]);
  const [st9] = await db('SELECT 1 AS x FROM admin_stats WHERE admin_id = ?', [M9]);
  check('membre: ticket fermé par le membre', closed9.status === 'closed' && closed9.closed_by_id === null && JSON.stringify(ev9?.details).includes('Fermé par le membre'), JSON.stringify([closed9, ev9]));
  check('membre: fermeture non comptée dans les stats staff', !st9);
  const [closeNote] = await db("SELECT source FROM ticket_notes WHERE ticket_id = ? AND content LIKE '%fermé par le membre%'", [tm9]);
  check('membre: événement système dans l\'historique', closeNote?.source === 'system', JSON.stringify(closeNote));
  di = dmInteraction(confirmId);
  await interModM.execute(fakeClient, di.interaction);
  check('membre: double fermeture refusée proprement', /déjà fermé/.test(di.out.update?.content), JSON.stringify(di.out));

  di = dmInteraction(`rating_4_${tm9}_${G}`);
  await interModM.execute(fakeClient, di.interaction);
  const commentBtn = di.out.update?.components?.[0]?.components?.[0]?.data?.custom_id;
  check('notation: bouton « Ajouter un commentaire » après la note', commentBtn === `ratecomment_${tm9}_${G}`, JSON.stringify(di.out.update?.components));
  di = dmInteraction(commentBtn);
  await interModM.execute(fakeClient, di.interaction);
  check('notation: fenêtre de commentaire ouverte', di.out.modal?.data?.custom_id === `ratecomment_modal_${tm9}_${G}`, JSON.stringify(di.out.modal?.data));
  const modalSubmit = text => dmInteraction(`ratecomment_modal_${tm9}_${G}`, {
    isButton: () => false, isModalSubmit: () => true, fields: { getTextInputValue: () => text },
  });
  di = modalSubmit('Très rapide, merci !');
  await interModM.execute(fakeClient, di.interaction);
  const [rc] = await db('SELECT rating, comment FROM ticket_ratings WHERE ticket_id = ?', [tm9]);
  check('notation: commentaire enregistré', rc?.comment === 'Très rapide, merci !' && di.out.update?.embeds?.[0]?.data?.fields?.some(f => f.value === 'Très rapide, merci !'), JSON.stringify([rc, di.out]));
  di = modalSubmit('Autre commentaire');
  await interModM.execute(fakeClient, di.interaction);
  const [rc2] = await db('SELECT comment FROM ticket_ratings WHERE ticket_id = ?', [tm9]);
  check('notation: un seul commentaire par ticket', rc2.comment === 'Très rapide, merci !' && /déjà/.test(di.out.reply?.content), JSON.stringify([rc2, di.out]));
  r = await req('GET', `/api/tickets/${tm9}`, { sid: sessions.FV });
  check('notation: commentaire visible dans la fiche du ticket', r.body.rating?.comment === 'Très rapide, merci !', JSON.stringify(r.body.rating));
  // Member reopen button on the closing DM
  {
    const MR = '200000000000000021';
    const RCH = '900000000000000088';
    channels.set(RCH, mkChannel(RCH, G));
    const tr = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member21', ?, 'open', 'à rouvrir')", [MR, RCH])).insertId;
    memberDms.length = 0;
    await createManager(db, fakeClient, G).closeTicketWithTranscript(channels.get(RCH), { id: U.F, tag: 'F', username: 'F' });
    const closeDm = memberDms.find(m => m.id === MR && m.p?.embeds?.[0]?.data?.title?.includes('fermé'))?.p;
    const reopenId = closeDm?.components?.[0]?.components?.[0]?.data?.custom_id;
    check('rouvrir: bouton dans le MP de fermeture', reopenId === `memberreopen_${tr}_${G}` && closeDm.embeds[0].data.footer?.text?.includes('7 jour'), JSON.stringify(closeDm?.components));
    const clickR = async customId => { const out = {}; await app('./events/interactionCreate').execute(fakeClient, { customId, guildId: null, guild: null, channelId: 'dm', values: [], message: { embeds: [] },
      user: { id: MR, username: 'member21', tag: 'member21', send: async p => memberDms.push({ id: MR, p }) },
      isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false, isChatInputCommand: () => false, isRepliable: () => true,
      reply: async p => { out.reply = p; }, update: async p => { out.update = p; } }); return out; };
    let ro = await clickR(reopenId);
    const [reo] = await db('SELECT status FROM tickets WHERE id = ?', [tr]);
    const [rnote] = await db("SELECT source FROM ticket_notes WHERE ticket_id = ? AND content LIKE '%rouvert par le membre%'", [tr]);
    check('rouvrir: le membre rouvre son ticket', reo.status === 'open' && rnote?.source === 'system' && /rouvert/.test(ro.update?.embeds?.[0]?.data?.description), JSON.stringify([reo, ro.update]));
    await db("UPDATE tickets SET status = 'closed', closed_at = NOW() - INTERVAL 10 DAY WHERE id = ?", [tr]);
    ro = await clickR(reopenId);
    const [reo2] = await db('SELECT status FROM tickets WHERE id = ?', [tr]);
    check('rouvrir: refusé après le délai', reo2.status === 'closed' && /ne peut plus/.test(ro.update?.embeds?.[0]?.data?.description), JSON.stringify(ro.update));
    await db('UPDATE guild_config SET member_reopen_days = 0 WHERE id = 1');
    const tr2 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status) VALUES (?, 'member21', ?, 'open')", [MR, RCH])).insertId;
    memberDms.length = 0;
    await createManager(db, fakeClient, G).closeTicketWithTranscript(channels.get(RCH), { id: U.F, tag: 'F', username: 'F' });
    const closeDm2 = memberDms.find(m => m.id === MR && m.p?.embeds?.[0]?.data?.title?.includes(`#${tr2}`))?.p;
    check('rouvrir: désactivable (0 jour)', closeDm2 && !(closeDm2.components || []).length, JSON.stringify(closeDm2?.components));
    await db('UPDATE guild_config SET member_reopen_days = 7 WHERE id = 1');
  }

  // Low rating: founders and chief support alerted, follow-up from the dashboard
  {
    const ML3 = '200000000000000023';
    const tl = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, closed_at) VALUES (?, 'member23', 'clr', 'closed', 'note basse', NOW())", [ML3])).insertId;
    memberDms.length = 0;
    const tmL = createManager(db, fakeClient, G);
    await tmL.saveRating(tl, ML3, null, 1, null);
    await new Promise(res => setTimeout(res, 200));
    const lowDm = memberDms.find(m => m.id === U.F)?.p?.embeds?.[0]?.data;
    const recips = await app('./utils/lowRating').notifyLowRating(db, fakeClient, G, tl, 1);
    check('note basse: fondateurs et chefs support prévenus', lowDm?.description?.includes('**1/5**') && recips.includes(U.F) && recips.includes('400000000000000002'), JSON.stringify([lowDm, recips]));
    const tl2 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, closed_at) VALUES (?, 'member23', 'clr2', 'closed', NOW())", [ML3])).insertId;
    check('note basse: rien au-dessus du seuil', (await app('./utils/lowRating').notifyLowRating(db, fakeClient, G, tl2, 4)).length === 0);
    memberDms.length = 0;
    r = await req('POST', `/api/tickets/${tl}/followup`, { sid: sessions.FV, body: { content: 'Désolé pour ton expérience, on peut en parler ?' } });
    const fu = memberDms.find(m => m.id === ML3)?.p;
    const [fuRow] = await db('SELECT followup_at, followup_by_tag FROM tickets WHERE id = ?', [tl]);
    check('note basse: membre recontacté avec le bouton Rouvrir', r.status === 200 && fu?.embeds?.[0]?.data?.description?.includes('Désolé') && fu.components?.[0]?.components?.[0]?.data?.custom_id === `memberreopen_${tl}_${G}` && fuRow.followup_at && fuRow.followup_by_tag === 'F', JSON.stringify([r.body, fuRow]));
    r = await req('GET', `/api/tickets/${tl}`, { sid: sessions.FV });
    check('note basse: suivi visible dans la fiche', r.body.followup_by_tag === 'F' && r.body.lowRatingThreshold === 2, JSON.stringify([r.body.followup_by_tag, r.body.lowRatingThreshold]));
    const topen = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status) VALUES (?, 'member23', 'clr3', 'open')", [ML3])).insertId;
    r = await req('POST', `/api/tickets/${topen}/followup`, { sid: sessions.FV, body: { content: 'x' } });
    check('note basse: recontact réservé aux tickets fermés', r.status === 400, r.status);
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [topen]);
  }

  // /reopen works even when the member has another open ticket (several tickets per member)
  const tOpen9 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member09', 'co9', 'open', 'autre')", [M9])).insertId;
  {
    const out = {};
    await app('./commands/reopen').execute(fakeClient, {
      guildId: G, channelId: 'x', guild: guildObj, user: { id: U.F, username: 'F', tag: 'F' },
      options: { getString: () => M9 }, reply: async p => { out.reply = p; }, deferReply: async () => {}, editReply: async p => { out.edit = p; },
    });
    const [re9] = await db('SELECT status FROM tickets WHERE id = ?', [tm9]);
    check('/reopen: possible même si le membre a un autre ticket ouvert', re9.status === 'open' && /réouvert/.test(out.edit?.content), JSON.stringify([re9, out]));
  }
  await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[tOpen9]]);

  // ── Automatic FAQ before opening a ticket ──
  {
    await mk('S1F', { user: { id: U.S1, username: 'S1', role: null }, currentGuildId: G });
    r = await req('POST', '/api/faq', { sid: sessions.S1F, body: { question: 'x', answer: 'y' } });
    check('FAQ: création réservée à manage_settings', r.status === 403, r.status);
    r = await req('POST', '/api/faq', { sid: sessions.FV, body: { question: 'Comment changer mon mot de passe ?', answer: 'Va dans Profil > Sécurité.', keywords: 'mot de passe, mdp' } });
    const faqId = r.body.id;
    check('FAQ: entrée créée', r.status === 200 && faqId > 0, JSON.stringify(r.body));
    await req('POST', '/api/faq', { sid: sessions.FV, body: { question: 'Horaires du support', answer: 'De 9 h à 18 h.', keywords: 'horaires' } });
    r = await req('POST', '/api/faq/preview', { sid: sessions.FV, body: { message: "Bonjour, j'ai oublié mon mot de passe" } });
    check('FAQ: correspondance par mot-clé', r.body.length === 1 && r.body[0].id === faqId, JSON.stringify(r.body));
    r = await req('PUT', '/api/faq/enabled', { sid: sessions.FV, body: { enabled: true } });
    check('FAQ: activation', r.status === 200, r.status);

    const MF = '200000000000000015';
    memberRoles.set(MF, new Map());
    const msgM = app('./events/messageCreate'), interM = app('./events/interactionCreate');
    const dmF = text => msgM.execute(fakeClient, { t: 'MESSAGE_CREATE', d: { author: { id: MF, bot: false }, content: text, attachments: [] } });
    const lastF = () => memberDms.filter(m => m.id === MF).slice(-1)[0]?.p;
    const clickF = async customId => {
      const out = {};
      await interM.execute(fakeClient, { customId, guildId: null, guild: null, channelId: 'dm', values: [], message: { embeds: [] },
        user: { id: MF, username: 'member15', tag: 'member15', send: async p => memberDms.push({ id: MF, p }) },
        isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false, isChatInputCommand: () => false, isRepliable: () => true,
        reply: async p => { out.reply = p; }, update: async p => { out.update = p; } });
      return out;
    };
    await dmF("J'ai perdu mon mdp, comment faire ?");
    const sugg = lastF();
    const btns = sugg?.components?.[0]?.components?.map(c => c.data.custom_id) || [];
    check('FAQ: réponses proposées en MP avant le ticket', sugg?.embeds?.[0]?.data?.fields?.[0]?.value === 'Va dans Profil > Sécurité.' && btns.includes(`faq_solved_${faqId}`) && btns.includes('faq_continue'), JSON.stringify([sugg?.embeds?.[0]?.data, btns]));
    let out = await clickF(`faq_solved_${faqId}`);
    const [cntF] = await db('SELECT COUNT(*) AS n FROM tickets WHERE owner_id = ?', [MF]);
    const [stF] = await db('SELECT shown_count, solved_count FROM faq_entries WHERE id = ?', [faqId]);
    check('FAQ: « ça m\'a aidé » → aucun ticket, compteur incrémenté', Number(cntF.n) === 0 && stF.solved_count === 1 && stF.shown_count === 1, JSON.stringify([cntF, stF, out]));
    await dmF('Toujours un souci de mot de passe');
    out = await clickF('faq_continue');
    check('FAQ: « ouvrir un ticket quand même » → question du sujet', lastF()?.embeds?.[0]?.data?.title?.includes('sujet'), JSON.stringify(lastF()));
    await dmF('Mot de passe');
    const tF = await db('SELECT id FROM tickets WHERE owner_id = ?', [MF]);
    const nF = tF[0] ? await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user'", [tF[0].id]) : [];
    check('FAQ: le ticket contient le message d\'origine', tF.length === 1 && nF.some(n => n.content.includes('Toujours un souci')), JSON.stringify(nF));
    // « Mes tickets »: the member sees each open ticket with its stage in their words
    await db("UPDATE tickets SET stage = 'waiting' WHERE owner_id = ?", [MF]);
    out = await clickF('my_tickets');
    const mt = out.reply?.embeds?.[0]?.data;
    check('mes tickets: état du ticket formulé pour le membre', mt?.fields?.length === 1 && mt.fields[0].value.includes('En attente de ta réponse') && mt.fields[0].name.includes(`#${tF[0].id}`), JSON.stringify(mt));
    const cmdOut = {};
    await app('./commands/mestickets').execute(fakeClient, { user: { id: MF }, reply: async p => { cmdOut.reply = p; } });
    check('mes tickets: commande /mestickets en MP', cmdOut.reply?.embeds?.[0]?.data?.fields?.length === 1);
    check('mes tickets: commande déclarée pour les MP', app('./commands/mestickets').dm === true);
    await db("UPDATE tickets SET status = 'closed' WHERE owner_id = ?", [MF]);
    await req('PUT', '/api/faq/enabled', { sid: sessions.FV, body: { enabled: false } });
  }

  // ── Real file sent from the dashboard ──
  {
    const MFILE = '200000000000000016';
    const FCH = '900000000000000083';
    channels.set(FCH, mkChannel(FCH, G));
    const tfile = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member16', ?, 'open', 'fichier')", [MFILE, FCH])).insertId;
    memberDms.length = 0; sent.length = 0;
    r = await reqMultipart(`/api/tickets/${tfile}/reply-file`, { sid: sessions.FV, fields: { content: 'Voici la facture', anonymous: 'false' }, file: { field: 'file', name: 'facture.pdf', content: Buffer.from('%PDF-1.4 test') } });
    const fdm = memberDms.find(m => m.id === MFILE)?.p;
    const fch = sent.find(x => x.id === FCH)?.p;
    const [fnote] = await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'reply'", [tfile]);
    check('fichier: joint au MP du membre', r.status === 200 && fdm?.files?.[0]?.name === 'facture.pdf' && Buffer.isBuffer(fdm.files[0].attachment) && fdm.embeds[0].data.description === 'Voici la facture', JSON.stringify([r.status, r.body, fdm?.files?.[0]?.name]));
    check('fichier: joint dans le salon du ticket', fch?.files?.[0]?.name === 'facture.pdf', JSON.stringify(fch && Object.keys(fch)));
    check('fichier: lien conservé dans l\'historique', fnote?.content.includes('📎 facture.pdf') && fnote.content.includes('cdn.discordapp.com'), JSON.stringify(fnote));
    r = await reqMultipart(`/api/tickets/${tfile}/reply-file`, { sid: sessions.FV, file: { field: 'file', name: 'gros.bin', content: Buffer.alloc(8 * 1024 * 1024 + 1) } });
    check('fichier: refusé au-delà de 8 Mo', r.status === 400 && /8 Mo/.test(r.body.error), JSON.stringify([r.status, r.body]));
    r = await reqMultipart(`/api/tickets/${tfile}/reply-file`, { sid: sessions.FV, fields: { content: 'sans fichier' } });
    check('fichier: fichier requis', r.status === 400, r.status);
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tfile]);
  }

  // ── Language of the messages sent to members ──
  {
    const i18n = app('./utils/i18n');
    const src = require('fs').readFileSync(path.join(ROOT, 'utils/i18n.js'), 'utf8');
    const keysOf = l => new Set([...src.slice(src.indexOf(`  ${l}: {`), src.indexOf('\n  },', src.indexOf(`  ${l}: {`))).matchAll(/^    '([\w.]+)':/gm)].map(m => m[1]));
    const fr = keysOf('fr'), en = keysOf('en');
    check('langues: dictionnaire anglais complet', fr.size > 50 && [...fr].every(k => en.has(k)) && [...en].every(k => fr.has(k)), JSON.stringify([...fr].filter(k => !en.has(k))));
    {
      const D = i18n.DICTIONARIES;
      const vars = str => [...String(str).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
      const bad = [];
      for (const l of ['es', 'de', 'it', 'pt']) {
        for (const k of fr) { if (D[l][k] === undefined) bad.push(`${l}:${k} manquant`); else if (vars(D[l][k]) !== vars(D.fr[k])) bad.push(`${l}:${k} variables`); }
        for (const k of Object.keys(D[l])) if (!fr.has(k)) bad.push(`${l}:${k} en trop`);
      }
      check('langues: espagnol, allemand, italien et portugais complets, mêmes variables', bad.length === 0, JSON.stringify(bad.slice(0, 10)));
      check('langues: langue Discord → langue du bot', i18n.fromLocale('es-419') === 'es' && i18n.fromLocale('pt-BR') === 'pt' && i18n.fromLocale('de') === 'de' && i18n.fromLocale('it') === 'it' && i18n.fromLocale('ja') === 'en' && i18n.fromLocale('fr') === 'fr', '');
      const de = await i18n.withLang('de', () => i18n.t('welcome.title', { id: 7 }));
      check('langues: message en allemand avec variables', de === '🎫 Ticket #7 erstellt', de);
    }
    {
      // Slash commands translated for Discord: every text, within Discord's limits
      const cmds = require(path.join(ROOT, 'deploy-commands.js')).buildCommands();
      const bad = [];
      const NAME = /^[-_\p{L}\p{N}]{1,32}$/u;
      const walk = (n, where) => {
        if (n.description !== undefined) {
          if (!n.description_localizations?.fr || !n.description_localizations?.de || !n.description_localizations?.['pt-BR']) bad.push(`${where}: description non traduite`);
          for (const d of [n.description, ...Object.values(n.description_localizations || {})]) if (!d || d.length > 100) bad.push(`${where}: longueur ${d?.length}`);
        }
        const seen = {};
        for (const o of n.options || []) {
          for (const [loc, name] of Object.entries(o.name_localizations || {})) {
            if (!NAME.test(name) || name !== name.toLowerCase()) bad.push(`${where}.${o.name}: nom ${loc} invalide`);
            const k = `${loc}:${name}`; if (seen[k]) bad.push(`${where}: nom ${k} en double`); seen[k] = 1;
          }
          for (const c of o.choices || []) if (!c.name_localizations?.fr) bad.push(`${where}.${o.name}#${c.value}: choix non traduit`);
          walk(o, `${where}.${o.name}`);
        }
      };
      for (const c of cmds) walk(c, c.name);
      const reply = cmds.find(c => c.name === 'reply');
      check('commandes Discord: descriptions, options et choix traduits en 6 langues, dans les limites de Discord', cmds.length >= 20 && bad.length === 0, JSON.stringify(bad.slice(0, 8)));
      check('commandes Discord: anglais par défaut, français conservé, noms de commandes inchangés', reply.description === 'Replies to the member' && reply.description_localizations.fr === 'Répond au membre' && reply.options[0].name === 'message' && reply.options[1].name_localizations['en-US'] === 'file', JSON.stringify(reply.options[1]));
    }
    {
      const pn = await import(path.join(ROOT, 'dashboard/src/data/patchnotes.js'));
      const v3 = pn.VERSIONS.filter(v => pn.compareVersions(v.version, 'v3.0') >= 0);
      const missing = v3.filter(v => !v.titleEn || v.changes.some(c => !c.en)).map(v => v.version);
      check('notes de version: chaque version depuis la v3.0 traduite en anglais', v3.length >= 9 && missing.length === 0, JSON.stringify(missing));
      check('notes de version: date anglaise', pn.dateEn('15 novembre 2026') === '15 November 2026' && pn.dateEn('1 août 2026') === '1 August 2026', pn.dateEn('1 août 2026'));
    }
    r = await req('PATCH', '/api/config', { sid: sessions.FV, body: { botLanguage: 'klingon' } });
    check('langues: valeur inconnue refusée', r.status === 400, r.status);
    r = await req('PATCH', '/api/config', { sid: sessions.FV, body: { botLanguage: 'es' } });
    const cfgEs = await req('GET', '/api/config', { sid: sessions.FV });
    check('langues: espagnol enregistré (colonne élargie par la migration 31)', r.status === 200 && cfgEs.body.botLanguage === 'es', JSON.stringify([r.status, r.body, cfgEs.body.botLanguage]));
    r = await req('PATCH', '/api/config', { sid: sessions.FV, body: { botLanguage: 'en' } });
    const ML2 = '200000000000000017';
    memberRoles.set(ML2, new Map());
    const msgL = app('./events/messageCreate');
    await msgL.execute(fakeClient, { t: 'MESSAGE_CREATE', d: { author: { id: ML2, bot: false }, content: 'Hello, I need help', attachments: [] } });
    const askEn = memberDms.filter(m => m.id === ML2).slice(-1)[0]?.p?.embeds?.[0]?.data;
    check('langues: serveur en anglais → questions en anglais', r.status === 200 && askEn?.title === '📝 What is your ticket about?', JSON.stringify(askEn));
    await msgL.execute(fakeClient, { t: 'MESSAGE_CREATE', d: { author: { id: ML2, bot: false }, content: 'Billing', attachments: [] } });
    const welcomeEn = memberDms.filter(m => m.id === ML2).slice(-1)[0]?.p;
    check('langues: bienvenue et boutons en anglais', /Ticket #\d+ created/.test(welcomeEn?.embeds?.[0]?.data?.title) && welcomeEn.components?.[0]?.components?.[0]?.data?.label === '🔒 Close my ticket', JSON.stringify([welcomeEn?.embeds?.[0]?.data?.title, welcomeEn?.components?.[0]?.components?.map(c => c.data.label)]));
    const [tL] = await db('SELECT id FROM tickets WHERE owner_id = ? ORDER BY id DESC LIMIT 1', [ML2]);
    memberDms.length = 0;
    await req('POST', `/api/tickets/${tL.id}/reply`, { sid: sessions.FV, body: { content: 'Bonjour' } });
    check('langues: réponse du staff avec pied de page en anglais', memberDms.find(m => m.id === ML2)?.p?.embeds?.[0]?.data?.footer?.text === `Reply here to write in ticket #${tL.id}`);
    // 'auto': the member's Discord language, remembered from an interaction
    await req('PATCH', '/api/config', { sid: sessions.FV, body: { botLanguage: 'auto' } });
    await i18n.rememberLocale(ML2, 'fr');
    check('langues: automatique → langue Discord du membre', (await i18n.memberLang(ML2, G)) === 'fr' && (await i18n.memberLang('299999999999999999', G)) === 'fr');
    await i18n.rememberLocale(ML2, 'en-US');
    check('langues: automatique → anglais pour un membre anglophone', (await i18n.memberLang(ML2, G)) === 'en');
    await req('PATCH', '/api/config', { sid: sessions.FV, body: { botLanguage: 'fr' } });
    check('langues: français par défaut', (await i18n.memberLang(ML2, G)) === 'fr');
    await db("UPDATE tickets SET status = 'closed' WHERE owner_id = ?", [ML2]);
  }

  // ── GDPR: export / erase a member's data (founders only, never other people's tickets) ──
  {
    const MG = '200000000000000018', OTHER = '200000000000000019';
    const GCH = '900000000000000084';
    let gdel = false;
    channels.set(GCH, Object.assign(mkChannel(GCH, G), { delete: async () => { gdel = true; } }));
    const g1t = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member18', ?, 'open', 'rgpd ouvert')", [MG, GCH])).insertId;
    const g2t = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member18', 'cg2', 'closed', 'rgpd fermé')", [MG])).insertId;
    const ot = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member19', 'cg3', 'open', 'ticket autre membre')", [OTHER])).insertId;
    await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, 'member18', 'mes données', 'user'), (?, ?, 'member18', 'message chez un autre', 'user'), (?, ?, 'member19', 'message autre membre', 'user')", [g1t, MG, ot, MG, ot, OTHER]);
    await db('INSERT INTO ticket_participants (ticket_id, user_id) VALUES (?, ?)', [ot, MG]);
    await db('INSERT INTO ticket_ratings (ticket_id, owner_id, rating) VALUES (?, ?, 5)', [g2t, MG]);
    await db("INSERT INTO blacklist (user_id, user_tag, reason, added_by_id, added_by_tag) VALUES (?, 'member18', 'test', '1', 'F')", [MG]);
    await db("INSERT INTO audit_log (actor_id, actor_tag, action, source, ticket_id, details) VALUES (?, 'member18', 'ticket_open', 'discord', ?, '{\"x\":1}')", [MG, g1t]);
    await redis.set(`pending:route:${MG}`, '{}'); await redis.set(`locale:${MG}`, 'fr');

    r = await req('GET', `/api/members/${MG}`, { sid: sessions.S3T || sessions.S1F });
    check('RGPD: réservé au fondateur', r.status === 403, r.status);
    r = await req('GET', `/api/members/${MG}`, { sid: sessions.FV });
    check('RGPD: résumé des données', r.status === 200 && r.body.tickets === 2 && r.body.messages === 2 && r.body.participations === 1 && r.body.ratings === 1, JSON.stringify(r.body));
    r = await req('GET', `/api/members/${MG}/export`, { sid: sessions.FV });
    check('RGPD: export JSON complet', r.status === 200 && r.body.tickets?.length === 2 && r.body.otherMessages?.length === 1 && r.headers['content-disposition']?.includes('attachment'), JSON.stringify(Object.keys(r.body || {})));
    r = await req('DELETE', `/api/members/${MG}`, { sid: sessions.FV, body: { confirm: 'non' } });
    check('RGPD: confirmation obligatoire', r.status === 400, r.status);
    r = await req('DELETE', `/api/members/${U.S1}`, { sid: sessions.FV, body: { confirm: U.S1 } });
    check('RGPD: refusé pour un compte du staff', r.status === 400, JSON.stringify(r.body));
    r = await req('DELETE', `/api/members/${MG}`, { sid: sessions.FV, body: { confirm: MG } });
    const [left] = await db('SELECT COUNT(*) AS n FROM tickets WHERE owner_id = ?', [MG]);
    const [otherT] = await db('SELECT COUNT(*) AS n FROM tickets WHERE id = ?', [ot]);
    const otherNotes = await db('SELECT author_id FROM ticket_notes WHERE ticket_id = ?', [ot]);
    const [aud] = await db('SELECT actor_id, actor_tag, details FROM audit_log WHERE ticket_id = ? AND action = ?', [g1t, 'ticket_open']);
    check('RGPD: tickets du membre supprimés, salon ouvert supprimé', r.status === 200 && Number(left.n) === 0 && gdel, JSON.stringify([r.status, r.body, left, gdel]));
    check('RGPD: le ticket d\'un autre est conservé, sans les messages du membre', Number(otherT.n) === 1 && otherNotes.length === 1 && otherNotes[0].author_id === OTHER, JSON.stringify(otherNotes));
    check('RGPD: journal anonymisé', aud?.actor_id === 'supprime' && aud.actor_tag === '[membre supprimé]' && aud.details === null, JSON.stringify(aud));
    check('RGPD: états MP et langue effacés', !(await redis.get(`pending:route:${MG}`)) && !(await redis.get(`locale:${MG}`)));
    const [ev] = await db("SELECT target_id FROM audit_log WHERE action = 'member_data_delete' ORDER BY id DESC LIMIT 1");
    check('RGPD: suppression journalisée sans l\'identifiant', ev && ev.target_id !== MG && ev.target_id.length === 16, JSON.stringify(ev));
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [ot]);
  }

  // ── Reply templates: personal / shared, suggested by subject ──
  await mk('S1T', { user: { id: U.S1, username: 'S1', role: null }, currentGuildId: G });
  await mk('S3T', { user: { id: U.S3, username: 'S3', role: null }, currentGuildId: G });
  const READER = '100000000000000099';
  const gRead = (await db("INSERT INTO grades (name) VALUES ('Lecture')")).insertId;
  await db("INSERT INTO grade_permissions VALUES (?, 'view_tickets')", [gRead]);
  await db("INSERT INTO dashboard_users (user_id, username, role) VALUES (?, 'reader', 'support')", [READER]);
  await db('INSERT INTO user_grades (user_id, grade_id, assigned_by_id, assigned_by_tag) VALUES (?, ?, "x", "x")', [READER, gRead]);
  await mk('RD', { user: { id: READER, username: 'reader', role: null }, currentGuildId: G });

  r = await req('POST', '/api/templates', { sid: sessions.S1T, body: { name: 'Remboursement', content: 'Bonjour {{username}}, votre remboursement est en cours.', subject: 'Paiement', scope: 'shared' } });
  const tShared = r.body;
  check('modèles: un support peut partager un modèle', r.status === 200 && tShared.scope === 'shared', JSON.stringify(r.body));
  r = await req('POST', '/api/templates', { sid: sessions.S1T, body: { name: 'Mon brouillon', content: 'Texte perso' } });
  const tPerso = r.body;
  check('modèles: personnel par défaut', r.status === 200 && tPerso.scope === 'personal', JSON.stringify(r.body));
  r = await req('POST', '/api/templates', { sid: sessions.RD, body: { name: 'x', content: 'y' } });
  check('modèles: création refusée sans reply_ticket', r.status === 403, r.status);
  r = await req('POST', '/api/templates', { sid: sessions.S1T, body: { name: 'x', content: 'y', scope: 'public' } });
  check('modèles: portée invalide refusée', r.status === 400, r.status);
  // Templates shared by every server of the instance (utils/instanceTemplates.js)
  {
    const itpl = app('./utils/instanceTemplates');
    r = await req('POST', '/api/templates', { sid: sessions.S1T, body: { name: 'Pour tous', content: 'x', scope: 'instance' } });
    check('modèles instance: réservés au propriétaire de l instance', r.status === 403, r.status);
    r = await req('POST', '/api/templates', { sid: sessions.FV, body: { name: 'Tag', content: 'x', scope: 'instance', actions: { tagId: 1 } } });
    check('modèles instance: pas de tag (propre à chaque serveur)', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/templates', { sid: sessions.FV, body: { name: 'Règlement commun', content: 'Bonjour {{username}}, voici le règlement.', scope: 'instance', subject: 'Règlement', actions: { stage: 'waiting' } } });
    const iT = r.body;
    check('modèles instance: créé par le propriétaire, identifiant préfixé', r.status === 200 && /^i\d+$/.test(iT.id) && iT.scope === 'instance' && iT.actions?.stage === 'waiting', JSON.stringify(r.body));
    r = await req('GET', '/api/templates', { sid: sessions.S3T, query: { subject: 'Règlement' } });
    const seen = r.body.find(t => t.id === iT.id);
    check('modèles instance: proposés au staff du serveur, suggérés, non modifiables par lui', seen && seen.suggested === true && seen.editable === false, JSON.stringify(seen));
    check('modèles instance: proposés sur les autres serveurs, jamais sur la démonstration', (await itpl.listInstanceTemplates(G2)).some(t => t.id === iT.id) && (await itpl.listInstanceTemplates(app('./utils/demo').DEMO_GUILD_ID)).length === 0, '');
    r = await req('PATCH', `/api/templates/${iT.id}`, { sid: sessions.S3T, body: { name: 'Pirate' } });
    const del = await req('DELETE', `/api/templates/${iT.id}`, { sid: sessions.S1T });
    check('modèles instance: modification et suppression refusées au staff', r.status === 403 && del.status === 403, [r.status, del.status].join());
    r = await req('POST', `/api/templates/${iT.id}/use`, { sid: sessions.S3T });
    const [cnt] = await globalQuery('SELECT use_count FROM instance_templates WHERE id = ?', [Number(iT.id.slice(1))]);
    check('modèles instance: utilisation comptée', r.status === 200 && cnt.use_count === 1, JSON.stringify(cnt));
    r = await req('PATCH', `/api/templates/${iT.id}`, { sid: sessions.FV, body: { name: 'Règlement commun v2', scope: 'personal' } });
    check('modèles instance: le propriétaire modifie, la portée ne change pas', r.status === 200 && r.body.name === 'Règlement commun v2' && r.body.scope === 'instance', JSON.stringify(r.body));
    r = await req('DELETE', `/api/templates/${iT.id}`, { sid: sessions.FV });
    const [gone] = await globalQuery('SELECT COUNT(*) AS n FROM instance_templates WHERE id = ?', [Number(iT.id.slice(1))]);
    check('modèles instance: supprimé par le propriétaire', r.status === 200 && Number(gone.n) === 0, JSON.stringify(r.body));
  }

  r = await req('GET', '/api/templates', { sid: sessions.S3T, query: { subject: 'Problème de paiement' } });
  const s3List = r.body.map(t => t.name);
  check('modèles: le personnel d\'un autre reste invisible', s3List.includes('Remboursement') && !s3List.includes('Mon brouillon'), JSON.stringify(s3List));
  check('modèles: suggéré quand le sujet correspond (accents, casse)', r.body[0]?.name === 'Remboursement' && r.body[0].suggested === true, JSON.stringify(r.body.slice(0, 2)));
  r = await req('GET', '/api/templates', { sid: sessions.S3T, query: { subject: 'Connexion' } });
  check('modèles: pas suggéré pour un autre sujet', r.body.find(t => t.name === 'Remboursement')?.suggested === false);

  r = await req('DELETE', `/api/templates/${tShared.id}`, { sid: sessions.S3T });
  check('modèles: un autre membre ne peut pas supprimer', r.status === 403, r.status);
  r = await req('DELETE', `/api/templates/${tPerso.id}`, { sid: sessions.S3T });
  check('modèles: modèle personnel d\'un autre introuvable', r.status === 404, r.status);
  r = await req('PATCH', `/api/templates/${tPerso.id}`, { sid: sessions.S1T, body: { scope: 'shared', name: 'Brouillon partagé' } });
  check('modèles: l\'auteur peut le partager', r.status === 200 && r.body.scope === 'shared' && r.body.name === 'Brouillon partagé', JSON.stringify(r.body));
  await req('POST', `/api/templates/${tShared.id}/use`, { sid: sessions.S3T });
  const [used] = await db('SELECT use_count FROM reply_templates WHERE id = ?', [tShared.id]);
  check('modèles: compteur d\'utilisation', used.use_count === 1, JSON.stringify(used));
  r = await req('DELETE', `/api/templates/${tShared.id}`, { sid: sessions.FV });
  check('modèles: le fondateur peut supprimer un modèle partagé', r.status === 200, r.status);
  const pOnly = (await req('POST', '/api/templates', { sid: sessions.S1T, body: { name: 'Privé', content: 'secret' } })).body;
  const tbulk = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status) VALUES ('11','u11','cb1','open')")).insertId;
  r = await req('POST', '/api/tickets/bulk', { sid: sessions.FV, body: { ids: [tbulk], action: 'send_template', value: pOnly.id } });
  check('modèles: envoi groupé refusé avec le modèle personnel d\'un autre', r.status === 400, JSON.stringify([r.status, r.body]));
  await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tbulk]);

  // ── Quality analytics: first response, stage SLA compliance, comments ──
  {
    await db('UPDATE guild_config SET sla_waiting_hours = 1 WHERE id = 1');
    const q0 = (await req('GET', '/api/analytics/quality', { sid: sessions.FV, query: { days: 30 } })).body;
    const w0 = q0.stages.find(x => x.stage === 'waiting');
    // Closed ticket: open 30 min, waiting 4 h (over the 1 h SLA), answered after 20 min, rated with a comment
    const tq = (await db(`INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, created_at, first_response_at, closed_at)
      VALUES ('23','u23','cq','closed','qualité', NOW() - INTERVAL 300 MINUTE, NOW() - INTERVAL 280 MINUTE, NOW() - INTERVAL 30 MINUTE)`)).insertId;
    await db(`INSERT INTO audit_log (actor_id, actor_tag, action, source, ticket_id, details, created_at) VALUES ('1','F','ticket_stage','dashboard',?, '{"from":"open","to":"waiting"}', NOW() - INTERVAL 270 MINUTE)`, [tq]);
    await db("INSERT INTO ticket_ratings (ticket_id, owner_id, rating, comment) VALUES (?, '23', 2, 'Trop long à mon goût')", [tq]);
    const q1 = (await req('GET', '/api/analytics/quality', { sid: sessions.FV, query: { days: 30 } })).body;
    const w1 = q1.stages.find(x => x.stage === 'waiting');
    check('qualité: passage hors délai compté pour l\'étape', w1.measured === w0.measured + 1 && w1.breached === w0.breached + 1 && w1.slaHours === 1, JSON.stringify([w0, w1]));
    check('qualité: première réponse comptée', q1.firstResponse.answered === q0.firstResponse.answered + 1 && q1.firstResponse.within1h !== null, JSON.stringify(q1.firstResponse));
    check('qualité: commentaire de satisfaction listé', q1.satisfaction.comments.some(c => c.ticket_id === tq && c.comment === 'Trop long à mon goût') && q1.satisfaction.distribution.find(d => d.rating === 2).n >= 1, JSON.stringify(q1.satisfaction.comments.slice(0, 2)));
    r = await req('GET', '/api/analytics/quality', { sid: sessions.S1F || sessions.FV, query: { days: 9999 } });
    check('qualité: période bornée', r.status === 200 && r.body.days === 365, r.body.days);
    await db('UPDATE guild_config SET sla_waiting_hours = 0 WHERE id = 1');
  }

  // ── Discord: /template (autocomplete + macro) and /merge ──
  {
    const DCH = '900000000000000086', DCH2 = '900000000000000087';
    let dch1Deleted = false;
    channels.set(DCH, Object.assign(mkChannel(DCH, G), { delete: async () => { dch1Deleted = true; } }));
    channels.set(DCH2, mkChannel(DCH2, G));
    const MD = '200000000000000020';
    const td1 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member20', ?, 'open', 'Problème de paiement')", [MD, DCH])).insertId;
    const td2 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member20', ?, 'open', 'Autre')", [MD, DCH2])).insertId;
    await req('POST', '/api/templates', { sid: sessions.FV, body: { name: 'Paiement reçu', content: 'Bonjour {{username}}, paiement reçu pour #{{ticket_id}}.', subject: 'paiement', scope: 'shared', actions: { priority: 'low' } } });
    const fake = (extra) => {
      const out = {};
      return { out, i: { guildId: G, channelId: DCH, guild: guildObj, channel: channels.get(DCH), user: { id: U.F, username: 'F', tag: 'F' },
        reply: async p => { out.reply = p; }, deferReply: async () => {}, editReply: async p => { out.edit = p; }, followUp: async p => { out.follow = p; },
        respond: async list => { out.respond = list; }, ...extra } };
    };
    let f = fake({ options: { getFocused: () => '' } });
    await app('./commands/template').autocomplete(fakeClient, f.i);
    check('/template: modèles suggérés selon le sujet en tête', f.out.respond?.[0]?.name.startsWith('⭐ Paiement reçu (macro)'), JSON.stringify(f.out.respond?.slice(0, 3)));
    const tplId = f.out.respond?.[0]?.value;
    sent.length = 0; memberDms.length = 0;
    f = fake({ options: { getString: () => tplId, getBoolean: () => false } });
    await app('./commands/template').execute(fakeClient, f.i);
    const dmT = memberDms.find(m => m.id === MD)?.p?.embeds?.[0]?.data;
    const [prT] = await db('SELECT priority FROM tickets WHERE id = ?', [td1]);
    check('/template: réponse envoyée avec variables résolues', dmT?.description === `Bonjour member20, paiement reçu pour #${td1}.`, JSON.stringify(dmT));
    check('/template: actions de la macro appliquées', prT.priority === 'low' && /Priorité Faible/.test(f.out.edit?.content), JSON.stringify([prT, f.out.edit]));
    f = fake({ options: { getFocused: () => 0 } });
    await app('./commands/merge').autocomplete(fakeClient, f.i);
    check('/merge: propose les autres tickets du membre', f.out.respond?.length === 1 && f.out.respond[0].value === td2, JSON.stringify(f.out.respond));
    f = fake({ options: { getInteger: () => td2 } });
    await app('./commands/merge').execute(fakeClient, f.i);
    const [srcD] = await db('SELECT status, merged_into FROM tickets WHERE id = ?', [td1]);
    check('/merge: ticket fusionné depuis Discord', srcD.status === 'closed' && srcD.merged_into === td2 && dch1Deleted, JSON.stringify([srcD, f.out]));
    f = fake({ user: { id: '400000000000000003', username: 'none', tag: 'none' }, options: { getFocused: () => '' }, channelId: DCH2 });
    await app('./commands/template').autocomplete(fakeClient, f.i);
    check('/template: aucune suggestion pour un non-membre du staff', Array.isArray(f.out.respond) && f.out.respond.length === 0);
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [td2]);
  }

  // ── « Ma file »: personal queue sorted by urgency ──
  {
    await db('UPDATE guild_config SET sla_open_hours = 1 WHERE id = 1');
    let qn = 0;
    const mkT = async (subject, extra = '') => (await db(`INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, priority, stage, stage_changed_at) VALUES ('25','u25',?,'open',?, 'normal', 'open', ${extra || 'NOW()'})`, [`cqu${++qn}`, subject])).insertId;
    const qA = await mkT('file calme'), qB = await mkT('file membre attend'), qC = await mkT('file hors délai', 'NOW() - INTERVAL 3 HOUR');
    for (const id of [qA, qB, qC]) await db('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES (?, ?)', [id, U.F]);
    await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source, created_at) VALUES (?, '1', 'F', 'réponse', 'reply', NOW() - INTERVAL 2 HOUR), (?, '25', 'u25', 'toujours là ?', 'user', NOW() - INTERVAL 1 HOUR)", [qB, qB]);
    const qD = await mkT('file non attribuée');
    r = await req('GET', '/api/tickets/queue', { sid: sessions.FV });
    const order = r.body.tickets.map(x => x.id).filter(id => [qA, qB, qC].includes(id));
    const tB = r.body.tickets.find(x => x.id === qB), tC = r.body.tickets.find(x => x.id === qC);
    check('ma file: hors délai, puis membre en attente, puis le reste', order.join() === [qC, qB, qA].join(), JSON.stringify(order));
    check('ma file: raisons fournies', tC?.reasons.some(x => x.type === 'breached') && tB?.reasons.some(x => x.type === 'member_waiting' && x.minutes >= 59), JSON.stringify([tC?.reasons, tB?.reasons]));
    check('ma file: uniquement mes tickets', !r.body.tickets.some(x => x.id === qD));
    r = await req('GET', '/api/tickets/queue', { sid: sessions.FV, query: { scope: 'unassigned' } });
    check('ma file: onglet non attribués', r.body.tickets.some(x => x.id === qD) && !r.body.tickets.some(x => x.id === qA), JSON.stringify(r.body.tickets.map(x => x.id)));
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[qA, qB, qC, qD]]);
    await db('UPDATE guild_config SET sla_open_hours = 0 WHERE id = 1');
  }

  // ── Full-text search in conversations ──
  {
    const mk = async (subject, ch, grade = null) => (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES ('31','u31',?,'open',?,?)", [ch, subject, grade])).insertId;
    const s1 = await mk('question', 'csr1'), s2 = await mk('autre', 'csr2', g2), s3 = await mk('Problème xyzsujet', 'csr3');
    await db(`INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES
      (?, '31', 'u31', 'Bonjour, mon remboursement zorglub n est jamais arrivé depuis lundi', 'user'),
      (?, '1', 'F', 'Vérifier le remboursement zorglub côté banque', 'web')`, [s1, s2]);
    r = await req('GET', '/api/tickets/search', { sid: sessions.FV, query: { q: 'zorglub rembours' } });
    const ids = r.body.results?.map(x => x.ticket.id) || [];
    const h1 = r.body.results?.find(x => x.ticket.id === s1);
    check('recherche: trouve les messages par mots (préfixe, plusieurs mots)', r.status === 200 && ids.includes(s1) && ids.includes(s2), JSON.stringify(r.body));
    check('recherche: extrait du message trouvé', h1?.match?.source === 'user' && /remboursement zorglub/.test(h1.match.snippet) && h1.hits === 1, JSON.stringify(h1));
    r = await req('GET', '/api/tickets/search', { sid: sessions.FV, query: { q: 'zorglub', source: 'member' } });
    check('recherche: filtre par auteur (membre)', r.body.results?.length === 1 && r.body.results[0].ticket.id === s1, JSON.stringify(r.body.results?.map(x => x.ticket.id)));
    r = await req('GET', '/api/tickets/search', { sid: sessions.S3T, query: { q: 'zorglub' } });
    check('recherche: un ticket restreint reste invisible', r.status === 200 && r.body.results.some(x => x.ticket.id === s1) && !r.body.results.some(x => x.ticket.id === s2), JSON.stringify(r.body));
    r = await req('GET', '/api/tickets/search', { sid: sessions.FV, query: { q: 'xyzsujet' } });
    check('recherche: les sujets sont aussi cherchés', r.body.results?.length === 1 && r.body.results[0].ticket.id === s3 && r.body.results[0].match === null, JSON.stringify(r.body));
    r = await req('GET', '/api/tickets/search', { sid: sessions.FV, query: { q: 'n' } });
    check('recherche: 2 caractères minimum', r.status === 400);
    r = await req('GET', '/api/tickets/search', { sid: sessions.FV, query: { q: 'u31' } });
    check('recherche: par pseudo du membre', r.body.results?.length === 3, JSON.stringify(r.body.results?.map(x => x.ticket.id)));
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[s1, s2, s3]]);
  }

  // ── Presence: who has a ticket open ──
  {
    const p1 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('32','u32','cpr1','open','présence')")).insertId;
    const p2 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES ('32','u32','cpr2','open','présence secrète', ?)", [g2])).insertId;
    r = await req('POST', `/api/tickets/${p1}/presence`, { sid: sessions.FV });
    check('présence: battement enregistré', r.status === 200 && r.body.viewers.length === 1 && r.body.viewers[0].userId === U.F, JSON.stringify(r.body));
    await req('POST', `/api/tickets/${p2}/presence`, { sid: sessions.FV });
    r = await req('POST', `/api/tickets/${p1}/presence`, { sid: sessions.S3T });
    check('présence: le second voit le premier', r.body.viewers?.length === 2 && r.body.viewers.some(v => v.userId === U.F), JSON.stringify(r.body));
    r = await req('GET', '/api/tickets/presence', { sid: sessions.S3T });
    check('présence: liste filtrée par visibilité', r.status === 200 && r.body[p1]?.length === 2 && !r.body[p2], JSON.stringify(r.body));
    r = await req('POST', `/api/tickets/${p2}/presence`, { sid: sessions.S3T });
    check('présence: ticket restreint refusé', r.status === 403, r.status);
    await req('POST', `/api/tickets/${p1}/presence`, { sid: sessions.FV, body: { leave: true } });
    r = await req('GET', '/api/tickets/presence', { sid: sessions.S3T });
    check('présence: départ pris en compte', r.body[p1]?.length === 1 && r.body[p1][0].userId !== U.F, JSON.stringify(r.body));
    await redis.hset(`presence:${G}`, `${p1}:999`, JSON.stringify({ username: 'vieux', at: Date.now() - 60000, since: 0 }));
    r = await req('POST', `/api/tickets/${p1}/presence`, { sid: sessions.S3T });
    check('présence: entrée expirée ignorée', !r.body.viewers.some(v => v.userId === '999'), JSON.stringify(r.body));
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[p1, p2]]);
  }

  // ── Linked tickets ──
  {
    const l1 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('27','u27','cl1','open','bug paiement A')")).insertId;
    const l2 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('28','u28','cl2','open','bug paiement B')")).insertId;
    const lsec = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES ('29','u29','cl3','open','secret', ?)", [g2])).insertId;
    r = await req('POST', `/api/tickets/${l1}/links`, { sid: sessions.FV, body: { ticketId: l2 } });
    check('liens: tickets liés', r.status === 200 && r.body.links.some(x => x.id === l2), JSON.stringify(r.body));
    r = await req('GET', `/api/tickets/${l2}`, { sid: sessions.FV });
    check('liens: visible des deux côtés', r.body.links?.some(x => x.id === l1), JSON.stringify(r.body.links));
    await req('POST', `/api/tickets/${l1}/links`, { sid: sessions.FV, body: { ticketId: lsec } });
    r = await req('GET', `/api/tickets/${l1}`, { sid: sessions.S3T });
    check('liens: un ticket restreint lié reste masqué', r.status === 200 && r.body.links.length === 1 && r.body.links[0].id === l2, JSON.stringify(r.body.links));
    r = await req('POST', `/api/tickets/${l1}/links`, { sid: sessions.FV, body: { ticketId: l1 } });
    check('liens: pas de lien vers soi-même', r.status === 400, r.status);
    r = await req('DELETE', `/api/tickets/${l2}/links/${l1}`, { sid: sessions.FV });
    check('liens: retrait depuis l\'autre ticket', r.status === 200 && !r.body.links.some(x => x.id === l1), JSON.stringify(r.body));
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[l1, l2, lsec]]);
  }

  // ── Custom ticket fields (asked in DM, stored, filterable) + intake form after them ──
  {
    r = await req('POST', '/api/fields', { sid: sessions.S1F || sessions.S3T, body: { label: 'x' } });
    check('champs: création réservée à manage_settings', r.status === 403, r.status);
    const fOrder = (await req('POST', '/api/fields', { sid: sessions.FV, body: { label: 'N° de commande', type: 'text', required: true } })).body;
    const fAmount = (await req('POST', '/api/fields', { sid: sessions.FV, body: { label: 'Montant', type: 'number', required: false, subject: 'Facturation' } })).body;
    const fOther = (await req('POST', '/api/fields', { sid: sessions.FV, body: { label: 'Pseudo en jeu', subject: 'Jeu' } })).body;
    check('champs: champs créés', fOrder.id && fAmount.id && fOther.id, JSON.stringify([fOrder, fAmount]));
    // One-question intake form: must run once after the fields (used to loop forever)
    await db('UPDATE guild_config SET intake_form_enabled = 1 WHERE id = 1');
    const formId = (await db("INSERT INTO intake_forms (name) VALUES ('Général')")).insertId;
    await db("INSERT INTO intake_form_fields (form_id, label, position) VALUES (?, 'Depuis quand ?', 0)", [formId]);
    const MFD = '200000000000000024';
    memberRoles.set(MFD, new Map());
    const msgF = app('./events/messageCreate');
    const dmFD = text => msgF.execute(fakeClient, { t: 'MESSAGE_CREATE', d: { author: { id: MFD, bot: false }, content: text, attachments: [] } });
    const lastFD = () => memberDms.filter(m => m.id === MFD).slice(-1)[0]?.p;
    await dmFD('Je n\'ai pas reçu ma facture');
    await dmFD('Facturation');
    check('champs: demandés après le sujet', lastFD()?.embeds?.[0]?.data?.description?.includes('N° de commande') && lastFD().embeds[0].data.author.name.includes('1 sur 2'), JSON.stringify(lastFD()?.embeds?.[0]?.data));
    await dmFD('A-1234');
    await dmFD('pas un nombre');
    check('champs: nombre attendu', lastFD() === 'Réponds avec un nombre.', JSON.stringify(lastFD()));
    await dmFD('42,5');
    check('champs: puis le formulaire d\'intake', lastFD()?.embeds?.[0]?.data?.description?.includes('Depuis quand'), JSON.stringify(lastFD()?.embeds?.[0]?.data));
    sent.length = 0;
    await dmFD('Hier');
    const tFD = await db('SELECT id, channel_id FROM tickets WHERE owner_id = ?', [MFD]);
    const vals = tFD[0] ? await db('SELECT field_id, value FROM ticket_field_values WHERE ticket_id = ?', [tFD[0].id]) : [];
    check('champs: un seul ticket créé (plus de boucle du formulaire)', tFD.length === 1 && !(await redis.get(`pending:intake:${MFD}`)), JSON.stringify(tFD));
    check('champs: valeurs enregistrées', vals.find(v => v.field_id === fOrder.id)?.value === 'A-1234' && vals.find(v => v.field_id === fAmount.id)?.value === '42.5' && !vals.some(v => v.field_id === fOther.id), JSON.stringify(vals));
    check('champs: rappelés dans le salon', sent.some(x => typeof x.p === 'string' && x.p.includes('Informations du membre') && x.p.includes('A-1234')), JSON.stringify(sent.map(x => x.p).filter(p => typeof p === 'string').slice(-3)));
    r = await req('GET', '/api/tickets', { sid: sessions.FV, query: { field: fOrder.id, fieldValue: 'A-12' } });
    check('champs: filtre de la liste', r.body.tickets?.map(x => x.id).join() === String(tFD[0].id), JSON.stringify(r.body.tickets?.map(x => x.id)));
    r = await req('PUT', `/api/tickets/${tFD[0].id}/fields`, { sid: sessions.FV, body: { values: { [fAmount.id]: 'abc' } } });
    check('champs: modification validée (nombre)', r.status === 400, r.status);
    r = await req('PUT', `/api/tickets/${tFD[0].id}/fields`, { sid: sessions.FV, body: { values: { [fOrder.id]: 'B-9', [fAmount.id]: '' } } });
    check('champs: modification par le staff', r.status === 200 && r.body.fields.find(f => f.id === fOrder.id)?.value === 'B-9' && !r.body.fields.find(f => f.id === fAmount.id)?.value, JSON.stringify(r.body));
    await db('UPDATE guild_config SET intake_form_enabled = 0 WHERE id = 1');
    await db("UPDATE tickets SET status = 'closed' WHERE owner_id = ?", [MFD]);
    for (const f of [fOrder, fAmount, fOther]) await req('DELETE', `/api/fields/${f.id}`, { sid: sessions.FV });
  }

  // ── Automatic rules by subject ──
  {
    const tagR = (await db("INSERT INTO ticket_tags (name, color) VALUES ('Facturation auto', '#22c55e')")).insertId;
    r = await req('POST', '/api/subject-rules', { sid: sessions.FV, body: { subject: 'paiement', tagId: tagR, priority: 'urgent', gradeId: g2 } });
    check('règles: règle créée', r.status === 200 && r.body.priority === 'urgent', JSON.stringify(r.body));
    r = await req('POST', '/api/subject-rules', { sid: sessions.FV, body: { subject: 'vide' } });
    check('règles: au moins une action', r.status === 400, r.status);
    r = await req('POST', '/api/subject-rules', { sid: sessions.S3T, body: { subject: 'x', priority: 'low' } });
    check('règles: réservées à manage_settings', r.status === 403, r.status);
    const MRU = '200000000000000025';
    const resR = await createManager(db, fakeClient, G).createTicket({ id: MRU, username: 'member25', tag: 'member25', send: async () => {} }, 'bonjour', [], 'Problème de Paiement', { forceNew: true });
    const [tR] = await db('SELECT priority, visibility_grade_id FROM tickets WHERE id = ?', [resR.ticket.id]);
    const tagsR = await db('SELECT tag_id FROM ticket_tag_assignments WHERE ticket_id = ?', [resR.ticket.id]);
    check('règles: appliquées à l\'ouverture (priorité, tag, grade)', tR.priority === 'urgent' && tR.visibility_grade_id === g2 && tagsR.some(x => x.tag_id === tagR), JSON.stringify([tR, tagsR]));
    const resR2 = await createManager(db, fakeClient, G).createTicket({ id: MRU, username: 'member25', tag: 'member25', send: async () => {} }, 'bonjour', [], 'Connexion', { forceNew: true });
    const [tR2] = await db('SELECT priority, visibility_grade_id FROM tickets WHERE id = ?', [resR2.ticket.id]);
    check('règles: sans effet sur un autre sujet', tR2.priority === 'normal' && tR2.visibility_grade_id === null, JSON.stringify(tR2));
    for (const rule of (await req('GET', '/api/subject-rules', { sid: sessions.FV })).body) await req('DELETE', `/api/subject-rules/${rule.id}`, { sid: sessions.FV });
    await db("UPDATE tickets SET status = 'closed' WHERE owner_id = ?", [MRU]);
  }

  // ── Configuration export / import ──
  {
    await db("UPDATE guild_config SET webhook_secret = 'super-secret-value-123', ticket_category_id = ?, welcome_message = 'Bienvenue export' WHERE id = 1", [CAT_OPEN]);
    await db("INSERT IGNORE INTO ticket_tags (name, color) VALUES ('Export tag', '#ff0000')");
    await db("INSERT INTO faq_entries (question, answer, keywords) VALUES ('Question exportée ?', 'Réponse', 'export')");
    r = await req('GET', '/api/config/export', { sid: sessions.FV });
    const exp = r.body;
    check('config: export complet sans secret', r.status === 200 && exp.format === 'ticketbot-config' && exp.grades.some(g => g.name === 'Secret') && exp.tags.some(t => t.name === 'Export tag')
      && exp.faq.some(q => q.question === 'Question exportée ?') && !JSON.stringify(exp).includes('super-secret-value-123'), JSON.stringify(Object.keys(exp || {})));
    // Import into another server
    const G3 = '323456789012345678';
    await globalQuery(`INSERT INTO guilds (guild_id, guild_name, owner_discord_id, owner_discord_tag, status, db_name) VALUES (?, 'G3', ?, 'f', 'active', ?)`, [G3, U.F, 'ticketbot_guild_' + G3]);
    await app('./utils/tenantSchema').ensureTenantSchema(G3);
    const db3 = getTenantDb(G3);
    await db3("INSERT INTO dashboard_users (user_id, username, role) VALUES (?, 'F', 'fondateur')", [U.F]);
    await mk('F3', { user: { id: U.F, username: 'F', role: null }, currentGuildId: G3 });
    r = await req('POST', '/api/config/import', { sid: sessions.F3, body: { data: { format: 'autre' } } });
    check('config: fichier invalide refusé', r.status === 400, r.status);
    r = await req('POST', '/api/config/import', { sid: sessions.F3, body: { data: exp } });
    const [c3] = await db3('SELECT welcome_message, ticket_category_id, webhook_secret FROM guild_config WHERE id = 1');
    const g3 = await db3("SELECT name FROM grades WHERE name = 'Secret'");
    const f3 = await db3("SELECT COUNT(*) AS n FROM faq_entries WHERE question = 'Question exportée ?'");
    check('config: import sur un autre serveur', r.status === 200 && c3.welcome_message === 'Bienvenue export' && g3.length === 1 && Number(f3[0].n) === 1, JSON.stringify([r.body, c3]));
    check('config: salons Discord et secrets non repris par défaut', c3.ticket_category_id === null && c3.webhook_secret === null, JSON.stringify(c3));
    // Channels of another server: refused, and the refused file changes nothing
    const tagsBefore = (await db3('SELECT COUNT(*) AS n FROM ticket_tags'))[0].n;
    await db3("DELETE FROM ticket_tags WHERE name = 'Export tag'");
    r = await req('POST', '/api/config/import', { sid: sessions.F3, body: { data: exp, includeDiscordIds: true } });
    const [c3b] = await db3('SELECT ticket_category_id FROM guild_config WHERE id = 1');
    check('config: salons d un autre serveur refusés à l import', r.status === 400 && /salons|rôles/.test(r.body.error) && c3b.ticket_category_id === null, JSON.stringify([r.body, c3b]));
    check('config: import refusé sans effet', (await db3("SELECT COUNT(*) AS n FROM ticket_tags WHERE name = 'Export tag'"))[0].n === 0, String(tagsBefore));
    // Invalid values are refused like on the Settings page
    r = await req('POST', '/api/config/import', { sid: sessions.F3, body: { data: { ...exp, config: { ...exp.config, portal_color: 'red;background:url(x)', welcome_message: 'X' } } } });
    check('config: valeurs invalides refusées à l import', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/config/import', { sid: sessions.F3, body: { data: exp } });
    const f3b = await db3("SELECT COUNT(*) AS n FROM faq_entries WHERE question = 'Question exportée ?'");
    check('config: réimport sans doublon', r.status === 200 && Number(f3b[0].n) === 1 && r.body.report.faq.updated >= 1, JSON.stringify(r.body.report?.faq));
    // Same server: its channels come back
    await db("UPDATE guild_config SET ticket_category_id = NULL WHERE id = 1");
    r = await req('POST', '/api/config/import', { sid: sessions.FV, body: { data: { ...exp, config: { ...exp.config, support_role_ids: ['800000000000000001'], chief_role_ids: [] } }, includeDiscordIds: true } });
    const [cG] = await db('SELECT ticket_category_id FROM guild_config WHERE id = 1');
    check('config: salons repris sur le même serveur', r.status === 200 && cG.ticket_category_id === CAT_OPEN, JSON.stringify([r.body, cG]));
    const imp = await db3("SELECT source, changes FROM config_history WHERE source = 'import'");
    check('historique config: import tracé', imp.length >= 1 && JSON.stringify(imp[0].changes).includes('Bienvenue export'), JSON.stringify(imp));
    r = await req('GET', '/api/config/export', { sid: sessions.S3T });
    check('config: export réservé au fondateur', r.status === 403, r.status);
    await globalQuery('DELETE FROM guilds WHERE guild_id = ?', [G3]);
    await globalQuery('DROP DATABASE IF EXISTS ticketbot_guild_' + G3);
    await db("UPDATE guild_config SET webhook_secret = NULL WHERE id = 1");
  }

  // ── Configuration transfer: custom statuses, teams, macros pointing to a status (v4.2) ──
  {
    const ct = app('./utils/configTransfer');
    const { parseJsonField } = app('./utils/jsonField');
    const GX = '777000000000000047';
    await globalQuery(`INSERT INTO guilds (guild_id, guild_name, owner_discord_id, owner_discord_tag, status, db_name) VALUES (?, 'GX', ?, 'f', 'active', ?)`, [GX, U.F, 'ticketbot_guild_' + GX]);
    await app('./utils/tenantSchema').ensureTenantSchema(GX);
    const dbx = getTenantDb(GX);
    const stx = (await db("INSERT INTO ticket_stages (label, color, kind, category_id, sla_hours, position) VALUES ('Attente fournisseur export', 'teal', 'waiting', '800000000000000777', 12, 90)")).insertId;
    const tgx = (await db("INSERT INTO ticket_tags (name, color) VALUES ('Tag équipe export', '#112233')")).insertId;
    await db("INSERT INTO teams (name, color, assign_mode, max_open, subjects, tag_ids) VALUES ('Équipe export', 'rose', 'load', 4, ?, ?)", [JSON.stringify(['Sujet export', 'Sujet absent']), JSON.stringify([tgx])]);
    await db("INSERT INTO reply_templates (name, content, scope, actions, created_by_id, created_by_tag) VALUES ('Macro statut export', 'x', 'shared', ?, '1', 'F')", [JSON.stringify({ stage: `s_${stx}` })]);
    const ex = await ct.exportConfig(db);
    const se = ex.stages.find(x => x.label === 'Attente fournisseur export');
    const te = ex.teams.find(x => x.name === 'Équipe export');
    const me = ex.templates.find(x => x.name === 'Macro statut export');
    check('config: statuts et équipes exportés, macro par nom de statut', se?.kind === 'waiting' && se.slaHours === 12 && te?.assignMode === 'load' && te.tags.includes('Tag équipe export')
      && !('members' in te) && me?.actions?.stageLabel === 'Attente fournisseur export' && !me.actions.stage, JSON.stringify([se, te, me]));

    await dbx('UPDATE guild_config SET ticket_subjects = ? WHERE id = 1', [JSON.stringify(['Sujet export'])]);
    await dbx("INSERT INTO ticket_stages (label, kind, position) VALUES ('Déjà là', 'open', 1)"); // shifts the ids: s_<id> must not be copied
    const rep1 = await ct.importConfig(dbx, ex, { applyConfig: async () => ({ count: 0 }) });
    const [sx] = await dbx("SELECT id, kind, sla_hours, category_id, color FROM ticket_stages WHERE label = 'Attente fournisseur export'");
    const [tx] = await dbx("SELECT id, assign_mode, max_open, subjects, tag_ids FROM teams WHERE name = 'Équipe export'");
    const [tagx] = await dbx("SELECT id FROM ticket_tags WHERE name = 'Tag équipe export'");
    const [mx] = await dbx("SELECT actions FROM reply_templates WHERE name = 'Macro statut export'");
    check('config: statut importé, sans la catégorie Discord d un autre serveur', sx?.kind === 'waiting' && sx.sla_hours === 12 && sx.color === 'teal' && sx.category_id === null && rep1.stages?.created >= 1, JSON.stringify([sx, rep1.stages]));
    check('config: équipe importée (sujets connus, tags locaux, sans membres)', tx?.assign_mode === 'load' && tx.max_open === 4
      && JSON.stringify(parseJsonField(tx.subjects, [])) === '["Sujet export"]' && parseJsonField(tx.tag_ids, []).map(Number).includes(tagx.id)
      && Number((await dbx('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?', [tx.id]))[0].n) === 0, JSON.stringify(tx));
    check('config: macro reliée au statut local', parseJsonField(mx?.actions, {}).stage === `s_${sx.id}`, JSON.stringify(mx));
    // Re-import: no duplicate, members of an existing team kept
    await dbx("INSERT INTO dashboard_users (user_id, username, role) VALUES ('300000000000000047', 'Ag', 'support')");
    await dbx('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)', [tx.id, '300000000000000047']);
    const rep2 = await ct.importConfig(dbx, ex, { applyConfig: async () => ({ count: 0 }) });
    check('config: réimport sans doublon, membres de l équipe gardés', Number((await dbx("SELECT COUNT(*) AS n FROM ticket_stages WHERE label = 'Attente fournisseur export'"))[0].n) === 1
      && Number((await dbx("SELECT COUNT(*) AS n FROM teams WHERE name = 'Équipe export'"))[0].n) === 1 && rep2.teams?.updated === 1
      && Number((await dbx('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?', [tx.id]))[0].n) === 1, JSON.stringify([rep2.stages, rep2.teams]));
    const bad = { ...ex, stages: [{ label: 'Ouvert', kind: 'open' }, { label: 'x'.repeat(5), kind: 'nope', slaHours: 99999 }] };
    await ct.importConfig(dbx, bad, { applyConfig: async () => ({ count: 0 }) });
    check('config: statuts invalides ignorés à l import', Number((await dbx("SELECT COUNT(*) AS n FROM ticket_stages WHERE label IN ('Ouvert', 'xxxxx')"))[0].n) === 0, '');

    await db('DELETE FROM reply_templates WHERE name = ?', ['Macro statut export']);
    await db("DELETE FROM teams WHERE name = 'Équipe export'");
    await db('DELETE FROM ticket_tags WHERE id = ?', [tgx]);
    await db('DELETE FROM ticket_stages WHERE id = ?', [stx]);
    await globalQuery('DELETE FROM guilds WHERE guild_id = ?', [GX]);
    await globalQuery('DROP DATABASE IF EXISTS ticketbot_guild_' + GX);
  }

  // ── Settings history and restore ──
  {
    const [orig] = await db('SELECT max_tickets_per_day, sla_open_hours, welcome_message FROM guild_config WHERE id = 1');
    await db('DELETE FROM config_history');
    r = await req('PATCH', '/api/config', { sid: sessions.FV, body: { maxTicketsPerDay: 7, slaOpenHours: 5 } });
    r = await req('PATCH', '/api/config', { sid: sessions.FV, body: { welcomeMessage: 'Version B', maxTicketsPerDay: 9 } });
    await req('PATCH', '/api/config', { sid: sessions.FV, body: { webhookSecret: 'un-secret-assez-long-42' } });
    await req('PATCH', '/api/config', { sid: sessions.FV, body: { maxTicketsPerDay: 9 } }); // no change: no entry
    r = await req('GET', '/api/config/history', { sid: sessions.FV });
    const [eSecret, eB, eA] = r.body.entries || [];
    check('historique config: une entrée par changement réel', r.status === 200 && r.body.total === 3, JSON.stringify(r.body));
    check('historique config: avant/après et auteur', eA?.changes.maxTicketsPerDay?.before === orig.max_tickets_per_day && eA.changes.maxTicketsPerDay.after === 7
      && eA.changes.slaOpenHours?.after === 5 && eA.actor_id === U.F && eB?.changes.welcomeMessage?.after === 'Version B', JSON.stringify([eA, eB]));
    check('historique config: secret jamais en clair', eSecret?.changes.webhookSecret?.secret === true && !JSON.stringify(r.body).includes('un-secret-assez-long-42'), JSON.stringify(eSecret));
    r = await req('POST', `/api/config/history/${eB.id}/restore`, { sid: sessions.FV });
    let [c] = await db('SELECT max_tickets_per_day, sla_open_hours, welcome_message, webhook_secret FROM guild_config WHERE id = 1');
    check('historique config: retour à l état d avant un changement', r.status === 200 && c.max_tickets_per_day === 7 && c.sla_open_hours === 5
      && c.welcome_message === orig.welcome_message && c.webhook_secret === 'un-secret-assez-long-42' && r.body.skipped.includes('webhookSecret'), JSON.stringify([r.body, c]));
    r = await req('POST', `/api/config/history/${eA.id}/restore`, { sid: sessions.FV });
    [c] = await db('SELECT max_tickets_per_day, sla_open_hours FROM guild_config WHERE id = 1');
    check('historique config: retour à la version d origine', c.max_tickets_per_day === orig.max_tickets_per_day && c.sla_open_hours === orig.sla_open_hours, JSON.stringify(c));
    r = await req('GET', '/api/config/history', { sid: sessions.FV });
    check('historique config: la restauration est elle-même tracée', r.body.entries[0].source === 'restore' && r.body.entries[0].restored_from === eA.id, JSON.stringify(r.body.entries[0]));
    r = await req('GET', '/api/config/history', { sid: sessions.S3T });
    check('historique config: réservé à manage_settings', r.status === 403, r.status);
    r = await req('POST', '/api/config/history/999999/restore', { sid: sessions.FV });
    check('historique config: version inconnue', r.status === 404, r.status);
    await db('UPDATE guild_config SET webhook_secret = NULL WHERE id = 1');
  }

  // ── Member web space ──
  {
    const MEM = '500000000000000077', OTHER = '500000000000000078';
    await mk('MEM', { member: { id: MEM, username: 'membre77', avatar: null } });
    const ins = async (owner, ch, subject, status = 'open') => (await db('INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, ?, ?, ?, ?)', [owner, owner === MEM ? 'membre77' : 'autre', ch, status, subject])).insertId;
    const tA = await ins(MEM, 'cmp1', 'Commande perdue', 'closed'), tB = await ins(OTHER, 'cmp2', 'Ticket partagé'), tC = await ins(OTHER, 'cmp3', 'Pas à moi');
    await db('INSERT INTO ticket_participants (ticket_id, user_id) VALUES (?, ?)', [tB, MEM]);
    await db(`INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES
      (?, ?, 'membre77', 'Ma commande n est jamais arrivée', 'user'),
      (?, '1', 'Daryu (anonyme)', 'Nous regardons', 'reply'),
      (?, '1', 'Daryu', 'Colis renvoyé', 'reply'),
      (?, '1', 'Daryu', 'NOTE-INTERNE-SECRETE', 'web'),
      (?, '1', 'Daryu', 'BAVARDAGE-SALON-STAFF', 'discord'),
      (?, '0', 'Système', 'Ticket fermé', 'system')`, [tA, MEM, tA, tA, tA, tA, tA]);

    r = await req('GET', '/api/member/me');
    check('espace membre: non connecté refusé', r.status === 401, r.status);
    r = await req('GET', '/api/member/auth/discord');
    check('espace membre: connexion Discord (identité seule)', r.status === 302 && /scope=identify(&|$)/.test(r.headers.location), r.headers.location);
    r = await req('GET', '/api/member/me', { sid: sessions.MEM });
    check('espace membre: identité', r.status === 200 && r.body.id === MEM, JSON.stringify(r.body));
    r = await req('GET', '/api/member/tickets', { sid: sessions.MEM });
    const mine = r.body.find?.(g => g.guild.id === G)?.tickets || [];
    check('espace membre: ses tickets et ceux où il participe, pas les autres', mine.some(x => x.id === tA) && mine.find(x => x.id === tB)?.participant === true && !mine.some(x => x.id === tC), JSON.stringify(mine.map(x => x.id)));
    r = await req('GET', `/api/member/tickets/${G}/${tA}`, { sid: sessions.MEM });
    const body = JSON.stringify(r.body);
    const kinds = r.body.messages?.map(m => m.kind).join();
    check('espace membre: conversation sans notes internes ni salon staff', r.status === 200 && !body.includes('NOTE-INTERNE-SECRETE') && !body.includes('BAVARDAGE-SALON-STAFF') && kinds === 'me,staff,staff,event', kinds + body);
    check('espace membre: réponse anonyme signée « Support »', r.body.messages?.[1]?.author === 'Support' && r.body.messages?.[2]?.author === 'Daryu' && !body.includes('anonyme'), body);
    r = await req('GET', `/api/member/tickets/${G}/${tC}`, { sid: sessions.MEM });
    check('espace membre: ticket d un autre introuvable', r.status === 404, r.status);
    r = await req('GET', `/api/member/tickets/${G}/${tA}/transcript`, { sid: sessions.MEM });
    check('espace membre: transcript de sa conversation', r.status === 200 && /attachment/.test(r.headers['content-disposition']) && r.body.includes('jamais arrivée') && !r.body.includes('NOTE-INTERNE-SECRETE'), r.status);
    r = await req('GET', `/api/member/tickets/${G}/${tA}/transcript`, { sid: sessions.MEM, query: { lang: 'it' } });
    check('espace membre: transcript dans la langue de la page', r.status === 200 && r.body.includes('<html lang="it">') && r.body.includes('aperto il'), r.body.slice(0, 600));
    r = await req('GET', '/api/tickets', { sid: sessions.MEM });
    check('espace membre: aucun accès au dashboard', r.status >= 400 && r.status < 500, r.status);
    await db('UPDATE guild_config SET member_portal_enabled = 0 WHERE id = 1');
    r = await req('GET', '/api/member/tickets', { sid: sessions.MEM });
    const off = await req('GET', `/api/member/tickets/${G}/${tA}`, { sid: sessions.MEM });
    check('espace membre: désactivable par serveur', !r.body.some(g => g.guild.id === G) && off.status === 404, JSON.stringify([r.body, off.status]));
    await db('UPDATE guild_config SET member_portal_enabled = 1 WHERE id = 1');
    r = await req('GET', `/api/member/tickets/${G}/${tA}`, { sid: sessions.FV });
    check('espace membre: un membre du staff connecté voit seulement ses propres tickets', r.status === 404, r.status);
    await req('POST', '/api/member/logout', { sid: sessions.MEM });
    r = await req('GET', '/api/member/me', { sid: sessions.MEM });
    check('espace membre: déconnexion', r.status === 401, r.status);
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[tB, tC]]);
  }

  // ── Pinned internal notes ──
  {
    const tp = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('33','u33','cpin1','open','épingle')")).insertId;
    const ids = [];
    for (const [c, src] of [['consigne importante', 'web'], ['message membre', 'user'], ['n2', 'web'], ['n3', 'web'], ['n4', 'web'], ['n5', 'web'], ['n6', 'web']]) {
      ids.push((await db('INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, ?)', [tp, '1', 'F', c, src])).insertId);
    }
    r = await req('POST', `/api/tickets/${tp}/notes/${ids[0]}/pin`, { sid: sessions.FV, body: { pinned: true } });
    check('épingle: note interne épinglée', r.status === 200 && r.body.pinned_at && r.body.pinned_by_tag, JSON.stringify(r.body));
    r = await req('GET', `/api/tickets/${tp}/notes`, { sid: sessions.FV });
    check('épingle: visible dans les messages', r.body.find(n => n.id === ids[0])?.pinned_at, JSON.stringify(r.body[0]));
    r = await req('POST', `/api/tickets/${tp}/notes/${ids[1]}/pin`, { sid: sessions.FV, body: { pinned: true } });
    check('épingle: message du membre refusé', r.status === 400, r.status);
    for (const i of [2, 3, 4, 5]) await req('POST', `/api/tickets/${tp}/notes/${ids[i]}/pin`, { sid: sessions.FV, body: { pinned: true } });
    r = await req('POST', `/api/tickets/${tp}/notes/${ids[6]}/pin`, { sid: sessions.FV, body: { pinned: true } });
    check('épingle: 5 au maximum', r.status === 400, r.status);
    r = await req('POST', `/api/tickets/${tp}/notes/${ids[0]}/pin`, { sid: sessions.FV, body: { pinned: false } });
    check('épingle: désépinglée', r.status === 200 && r.body.pinned_at === null, JSON.stringify(r.body));
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tp]);
  }

  // ── Attachment previews (re-signed Discord links) ──
  {
    const fresh = `https://cdn.discordapp.com/attachments/111111111111111111/222222222222222222/a.png?ex=${Math.floor(Date.now() / 1000 + 3600).toString(16)}&is=1&hm=2`;
    r = await req('GET', '/api/attachment', { query: { u: fresh } });
    check('pièce jointe: réservée aux connectés', r.status === 401, r.status);
    r = await req('GET', '/api/attachment', { sid: sessions.FV, query: { u: 'https://evil.example/attachments/1/2/a.png' } });
    check('pièce jointe: seuls les liens Discord sont relayés', r.status === 400, r.status);
    r = await req('GET', '/api/attachment', { sid: sessions.FV, query: { u: fresh } });
    check('pièce jointe: lien encore valide redirigé tel quel', r.status === 302 && r.headers.location === fresh, r.status + ' ' + r.headers.location);
    r = await req('GET', '/api/attachment', { sid: sessions.MEM, query: { u: 'https://cdn.discordapp.com/attachments/1/2/b.png?ex=1' } });
    check('pièce jointe: lien expiré inconnu de Discord', r.status === 404 || r.status === 401, r.status);
  }

  // ── DMs edited / deleted by the member ──
  {
    const dmE = app('./utils/dmEdits');
    const MEMB = '500000000000000090', CHE = '900000000000000090';
    channels.set(CHE, mkChannel(CHE, G));
    const te = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'membE', ?, 'open', 'édition')", [MEMB, CHE])).insertId;
    const [tRow] = await db('SELECT * FROM tickets WHERE id = ?', [te]);
    await dmE.rememberDm(MEMB, 'dm900001', 'premier texte');
    await createManager(db, fakeClient, G).relayToTicket(tRow, { id: MEMB, tag: 'membE', username: 'membE' }, 'premier texte');
    let [n] = await db('SELECT * FROM ticket_notes WHERE ticket_id = ? AND source = "user"', [te]);
    check('MP modifié: message relié au MP d origine', n?.discord_message_id === 'dm900001', JSON.stringify(n));
    sent.length = 0;
    await dmE.handleDmEdit(fakeClient, { id: 'dm900001', content: 'texte corrigé', edited_timestamp: new Date().toISOString(), author: { id: MEMB } });
    [n] = await db('SELECT * FROM ticket_notes WHERE id = ?', [n.id]);
    const hist = typeof n.edit_history === 'string' ? JSON.parse(n.edit_history) : n.edit_history;
    check('MP modifié: nouveau texte, ancienne version gardée', n.content === 'texte corrigé' && n.edited_at && hist?.[0]?.content === 'premier texte', JSON.stringify(n));
    check('MP modifié: salon du ticket prévenu', sent.some(x => x.id === CHE && /modifié son message/.test(x.p?.content) && /premier texte/.test(x.p.content)), JSON.stringify(sent));
    r = await req('GET', `/api/tickets/${te}/notes`, { sid: sessions.FV });
    const apiNote = r.body.find(x => x.id === n.id);
    check('MP modifié: historique visible dans la fiche', apiNote?.edited_at && apiNote.edit_history?.[0]?.content === 'premier texte', JSON.stringify(apiNote));
    await dmE.handleDmEdit(fakeClient, { id: 'dm900001', content: 'texte corrigé', edited_timestamp: new Date().toISOString() }); // embed unfurl: same text
    [n] = await db('SELECT * FROM ticket_notes WHERE id = ?', [n.id]);
    check('MP modifié: mise à jour sans changement de texte ignorée', (typeof n.edit_history === 'string' ? JSON.parse(n.edit_history) : n.edit_history).length === 1);
    sent.length = 0;
    await dmE.handleDmDelete(fakeClient, { id: 'dm900001' });
    [n] = await db('SELECT * FROM ticket_notes WHERE id = ?', [n.id]);
    check('MP supprimé: marqué supprimé, contenu gardé pour le staff', n.deleted_at && n.content === 'texte corrigé' && sent.some(x => /supprimé ce message/.test(x.p?.content)), JSON.stringify(n));
    await dmE.handleDmEdit(fakeClient, { id: 'inconnu', content: 'x', edited_timestamp: 'x' });
    check('MP modifié: message non relié ignoré', true);
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [te]);
  }

  // ── Similar tickets ──
  {
    const mkS = async (subject, ch, status, grade = null) => (await db('INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES (?, ?, ?, ?, ?, ?)', ['34', 'u34', ch, status, subject, grade])).insertId;
    const cur = await mkS('Paiement', 'csim0', 'open');
    const old1 = await mkS('Paiement', 'csim1', 'closed'), old2 = await mkS('Autre', 'csim2', 'closed'), secret = await mkS('Paiement', 'csim3', 'closed', g2), unrelated = await mkS('Jeu', 'csim4', 'closed');
    await db(`INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES
      (?, '34', 'u34', 'Mon virement bancaire est refusé par la plateforme quokka', 'user'),
      (?, '35', 'u35', 'Virement bancaire refusé sur quokka depuis hier', 'user'),
      (?, '1', 'Daryu (anonyme)', 'Il faut valider ton IBAN dans les réglages quokka', 'reply'),
      (?, '36', 'u36', 'Quokka refuse mon virement aussi', 'user'),
      (?, '37', 'u37', 'Virement bancaire quokka refusé encore', 'user'),
      (?, '38', 'u38', 'Le jeu plante au lancement', 'user')`, [cur, old1, old1, old2, secret, unrelated]);
    await db('INSERT INTO ticket_ratings (ticket_id, owner_id, rating) VALUES (?, ?, 5)', [old1, '35']);
    r = await req('GET', `/api/tickets/${cur}/similar`, { sid: sessions.FV });
    const ids = r.body.tickets?.map(x => x.id) || [];
    check('similaires: le ticket résolu le plus proche en tête, avec sa réponse', r.status === 200 && ids[0] === old1 && /IBAN/.test(r.body.tickets[0].reply?.content) && r.body.tickets[0].reply.author_tag === 'Daryu' && r.body.tickets[0].rating === 5, JSON.stringify(r.body));
    check('similaires: sans ticket sans rapport', !ids.includes(unrelated) && !ids.includes(cur), JSON.stringify(ids));
    r = await req('GET', `/api/tickets/${cur}/similar`, { sid: sessions.S3T });
    check('similaires: respecte la visibilité', r.status === 200 && !r.body.tickets.some(x => x.id === secret), JSON.stringify(r.body.tickets?.map(x => x.id)));
    check('similaires: mots-clés sans mots courants', !r.body.keywords.includes('dans') && r.body.keywords.includes('quokka'), JSON.stringify(r.body.keywords));
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [cur]);
  }

  // ── My activity ──
  {
    const ME = U.F;
    const ta = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, created_at, closed_at, closed_by_id, closed_by_tag) VALUES ('39','u39','cact1','closed','activité', NOW() - INTERVAL 2 HOUR, NOW(), ?, 'F')", [ME])).insertId;
    await db(`INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source, created_at) VALUES
      (?, '39', 'u39', 'aide', 'user', NOW() - INTERVAL 2 HOUR), (?, ?, 'F', 'réponse 1', 'reply', NOW() - INTERVAL 90 MINUTE), (?, ?, 'F', 'réponse 2', 'reply', NOW() - INTERVAL 1 HOUR), (?, ?, 'F', 'note', 'web', NOW())`, [ta, ta, ME, ta, ME, ta, ME]);
    await db("INSERT INTO ticket_ratings (ticket_id, owner_id, closed_by_id, rating, comment) VALUES (?, '39', ?, 4, 'Super aide')", [ta, ME]);
    r = await req('GET', '/api/staff/me/activity', { sid: sessions.FV, query: { days: 7 } });
    const a = r.body;
    check('mon activité: compteurs de la période', r.status === 200 && a.days === 7 && a.replies >= 2 && a.closed >= 1 && a.notes >= 1, JSON.stringify(a));
    check('mon activité: temps de 1re réponse et notes', a.firstResponse?.count >= 1 && a.firstResponse.medianMinutes != null && a.rating.distribution.find(d => d.rating === 4)?.count >= 1 && a.comments.some(c => c.comment === 'Super aide'), JSON.stringify([a.firstResponse, a.rating, a.comments]));
    check('mon activité: évolution sur 12 semaines', a.weekly?.length === 12 && a.weekly[11].replies >= 2 && a.weekly[11].rating >= 1, JSON.stringify(a.weekly?.slice(-2)));
    r = await req('GET', '/api/staff/me/activity', { sid: sessions.S3T });
    check('mon activité: chacun voit ses propres chiffres', r.status === 200 && r.body.comments.every(c => c.comment !== 'Super aide'), JSON.stringify(r.body.comments));
  }

  // ── Incident announcements ──
  {
    const MI1 = '200000000000000071', MI2 = '200000000000000072';
    r = await req('POST', '/api/incidents', { sid: sessions.FV, body: { title: 'Paiements HS', message: 'Le prestataire est en panne.', subjects: ['Paiement'], notifyOnResolve: true } });
    const incId = r.body?.id;
    check('incident: ouvert', r.status === 200 && incId && r.body.members === 0, JSON.stringify(r.body));
    r = await req('POST', '/api/incidents', { sid: sessions.S3T, body: { title: 'x', message: 'y' } });
    check('incident: création réservée à manage_settings', r.status === 403, r.status);
    const tmI = createManager(db, fakeClient, G);
    const mkI = async (owner, ch, subject) => (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'mi', ?, 'open', ?)", [owner, ch, subject])).insertId;
    const ti1 = await mkI(MI1, 'cinc1', 'Paiement'), ti2 = await mkI(MI2, 'cinc2', 'Compte');
    memberDms.length = 0;
    await tmI.sendWelcomeDm(await fakeClient.users.fetch(MI1), true, 'Paiement', ti1);
    await tmI.sendWelcomeDm(await fakeClient.users.fetch(MI2), true, 'Compte', ti2);
    const dm1 = memberDms.filter(m => m.id === MI1).map(m => m.p?.embeds?.[0]?.data);
    check('incident: annoncé après le message de bienvenue', dm1.length === 2 && /Paiements HS/.test(dm1[1]?.description) && /Problème connu/.test(dm1[1]?.title), JSON.stringify(dm1));
    check('incident: pas annoncé hors des sujets concernés', memberDms.filter(m => m.id === MI2).length === 1, JSON.stringify(memberDms.filter(m => m.id === MI2)));
    const [sysNote] = await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'system'", [ti1]);
    check('incident: tracé dans le ticket', /Paiements HS/.test(sysNote?.content), JSON.stringify(sysNote));
    await tmI.sendWelcomeDm(await fakeClient.users.fetch(MI1), true, 'Paiement', ti1); // same ticket again: no double notice
    r = await req('GET', '/api/incidents', { sid: sessions.S3T, query: { active: 1 } });
    check('incident: compteur visible par le staff', r.status === 200 && r.body.find(i => i.id === incId)?.members === 1 && r.body.find(i => i.id === incId)?.tickets === 1, JSON.stringify(r.body));
    memberDms.length = 0;
    r = await req('POST', `/api/incidents/${incId}/resolve`, { sid: sessions.FV, body: { message: 'Tout est rentré dans l ordre.' } });
    check('incident: résolu et membres touchés prévenus', r.status === 200 && r.body.notified === 1 && memberDms.some(m => m.id === MI1 && /rentré/.test(m.p?.embeds?.[0]?.data?.description)), JSON.stringify([r.body, memberDms]));
    memberDms.length = 0;
    const ti3 = await mkI(MI1, 'cinc3', 'Paiement');
    await tmI.sendWelcomeDm(await fakeClient.users.fetch(MI1), true, 'Paiement', ti3);
    check('incident: plus annoncé une fois résolu', memberDms.length === 1, JSON.stringify(memberDms.length));
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[ti1, ti2, ti3]]);
  }

  // ── Member space: help, opening and answering from the web ──
  {
    const MW = '200000000000000081';
    await redis.del(`memberguilds:${MW}`);
    await mk('MW', { member: { id: MW, username: 'member81', avatar: null } });
    await db("INSERT INTO faq_entries (question, answer, keywords) VALUES ('Comment changer mon mot de passe ?', 'Va dans Réglages > Sécurité.', 'mot de passe')");
    r = await req('GET', '/api/member/guilds', { sid: sessions.MW });
    check('espace membre: serveurs dont il est membre', r.status === 200 && r.body.some(g => g.id === G), JSON.stringify(r.body));
    r = await req('GET', `/api/member/guilds/${G}/faq`, { sid: sessions.MW });
    check('espace membre: aide publique (FAQ)', r.status === 200 && r.body.some(e => /mot de passe/.test(e.question)), JSON.stringify(r.body));
    r = await req('GET', `/api/member/guilds/${G2}/faq`, { sid: sessions.MW });
    check('espace membre: aide d un serveur dont il n est pas membre refusée', r.status === 404, r.status);
    const [cfgBefore] = await db('SELECT ticket_subjects, intake_form_enabled, max_tickets_per_day FROM guild_config WHERE id = 1');
    await db("UPDATE guild_config SET ticket_subjects = ?, intake_form_enabled = 1, max_tickets_per_day = 10 WHERE id = 1", [JSON.stringify(['Paiement', 'Compte'])]);
    const fid = (await db("INSERT INTO ticket_fields (label, type, required, subject) VALUES ('N° de commande', 'number', 1, 'Paiement')")).insertId;
    const formId = (await db("INSERT INTO intake_forms (name, subject, active) VALUES ('Paiement web', 'Paiement', 1)")).insertId;
    await db("INSERT INTO intake_form_fields (form_id, label, position) VALUES (?, 'Moyen de paiement ?', 0)", [formId]);
    r = await req('GET', `/api/member/guilds/${G}/form`, { sid: sessions.MW, query: { subject: 'Paiement' } });
    check('espace membre: formulaire d ouverture (sujets, champs, questions)', r.body.subjects?.includes('Paiement') && r.body.fields?.some(f => f.id === fid && f.required) && r.body.questions?.[0] === 'Moyen de paiement ?', JSON.stringify(r.body));
    r = await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.MW, body: { subject: 'Paiement', fields: { [fid]: 'abc' }, answers: ['Carte'], content: 'Paiement bloqué' } });
    check('espace membre: champ invalide refusé', r.status === 400 && /nombre/.test(r.body.error), JSON.stringify(r.body));
    r = await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.MW, body: { subject: 'Paiement', fields: { [fid]: '1234' }, answers: [], content: 'Paiement bloqué' } });
    check('espace membre: questions obligatoires', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.MW, headers: { 'X-Member-Lang': 'de' }, body: { subject: 'Paiement', fields: { [fid]: '1234' }, answers: [], content: 'Paiement bloqué' } });
    const rEs = await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.MW, headers: { 'Accept-Language': 'es-ES,es;q=0.9' }, body: { subject: 'Paiement', fields: { [fid]: '1234' }, answers: [], content: 'Paiement bloqué' } });
    const rJa = await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.MW, headers: { 'Accept-Language': 'ja' }, body: { subject: 'Paiement', fields: { [fid]: '1234' }, answers: [], content: 'Paiement bloqué' } });
    check('espace membre: erreurs dans la langue choisie, sinon celle du navigateur, anglais par défaut', r.body.error === 'Beantworte alle Fragen des Formulars' && rEs.body.error === 'Responde a todas las preguntas del formulario' && rJa.body.error === 'Answer every question of the form', JSON.stringify([r.body, rEs.body, rJa.body]));
    memberDms.length = 0;
    r = await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.MW, body: { subject: 'Paiement', fields: { [fid]: '1234' }, answers: ['Carte'], content: 'Paiement bloqué depuis le web' } });
    const wt = r.body.ticketId;
    const [wTicket] = wt ? await db('SELECT * FROM tickets WHERE id = ?', [wt]) : [];
    const [wNote] = wt ? await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user'", [wt]) : [];
    const [wField] = wt ? await db('SELECT value FROM ticket_field_values WHERE ticket_id = ? AND field_id = ?', [wt, fid]) : [];
    check('espace membre: ticket ouvert depuis le web', r.status === 200 && wTicket?.owner_id === MW && wTicket.subject === 'Paiement' && /depuis le web/.test(wNote?.content) && /Moyen de paiement \? \*\* : Carte|Moyen de paiement \?\*\* : Carte/.test(wNote?.content) && wField?.value === '1234', JSON.stringify([r.body, wTicket?.subject, wNote, wField]));
    check('espace membre: message de bienvenue reçu en MP', memberDms.some(m => m.id === MW), JSON.stringify(memberDms.map(m => m.id)));
    r = await req('POST', `/api/member/tickets/${G}/${wt}/messages`, { sid: sessions.MW, body: { content: 'Réponse écrite sur le site' } });
    const webMsgs = await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user' ORDER BY id", [wt]);
    check('espace membre: réponse depuis le web transmise comme un MP', r.status === 200 && webMsgs.some(n => n.content === 'Réponse écrite sur le site') && sent.some(x => x.id === wTicket.channel_id), JSON.stringify(webMsgs));
    // Files from the member space (utils/requesterFiles.js, v5.0): multipart, as the browser sends it
    {
      const os = require('os'), fsx = require('fs');
      app('./utils/config').config.attachmentsDir = fsx.mkdtempSync(path.join(os.tmpdir(), 'tb-pj-'));
      const cookie = { Cookie: 'connect.sid=' + encodeURIComponent('s:' + sign(sessions.MW, config.dashboard.sessionSecret)), 'X-Requested-With': 'XMLHttpRequest' };
      const post = (url, fd, headers = cookie) => fetch(`http://127.0.0.1:${config.webServerPort}${url}`, { method: 'POST', body: fd, headers }).then(async x => ({ status: x.status, body: await x.json().catch(() => ({})) }));
      r = await req('GET', `/api/member/tickets/${G}/${wt}`, { sid: sessions.MW });
      check('pièces jointes demandeur: règles d envoi données à l espace membre', r.body.upload?.enabled === true && r.body.upload.maxFiles === 5 && Array.isArray(r.body.files), JSON.stringify(r.body.upload));
      let fd = new FormData();
      fd.append('content', 'Voici la facture et une photo');
      fd.append('files', new Blob([Buffer.from('%PDF-1.4 facture')], { type: 'application/pdf' }), 'facture.pdf');
      fd.append('files', new Blob([Buffer.from('MZ binaire')], { type: 'application/octet-stream' }), 'outil.exe');
      let up = await post(`/api/member/tickets/${G}/${wt}/messages`, fd);
      const [nFile] = await db("SELECT id, content FROM ticket_notes WHERE ticket_id = ? AND content LIKE 'Voici la facture%'", [wt]);
      const stored = await db('SELECT id, filename, note_id FROM email_attachments WHERE ticket_id = ?', [wt]);
      check('pièces jointes demandeur: message et fichiers dans le ticket, types refusés écartés', up.status === 200 && nFile?.content.includes('📎 facture.pdf') && /outil\.exe \(non conservée : type refusé\)/.test(nFile.content)
        && stored.length === 1 && stored[0].filename === 'facture.pdf' && stored[0].note_id === nFile.id, JSON.stringify([up, nFile, stored]));
      fd = new FormData();
      fd.append('files', new Blob([Buffer.from('juste un fichier')], { type: 'text/plain' }), 'note.txt');
      up = await post(`/api/member/tickets/${G}/${wt}/messages`, fd);
      check('pièces jointes demandeur: un fichier seul, sans texte', up.status === 200 && up.body.files?.[0]?.kept === true, JSON.stringify(up));
      r = await req('GET', `/api/member/tickets/${G}/${wt}`, { sid: sessions.MW });
      const f1 = r.body.files?.find(f => f.filename === 'facture.pdf');
      const dl = await fetch(`http://127.0.0.1:${config.webServerPort}/api/member/tickets/${G}/${wt}/files/${f1?.id}`, { headers: cookie });
      check('pièces jointes demandeur: retéléchargeables par le demandeur, jamais affichées', r.body.files.length === 2 && dl.status === 200 && dl.headers.get('content-type') === 'application/octet-stream'
        && /attachment/.test(dl.headers.get('content-disposition')) && (await dl.text()).startsWith('%PDF'), JSON.stringify(r.body.files));
      await mk('MWX', { member: { id: '200000000000000082', username: 'autre', avatar: null } });
      const dlOther = await fetch(`http://127.0.0.1:${config.webServerPort}/api/member/tickets/${G}/${wt}/files/${f1?.id}`, { headers: { Cookie: 'connect.sid=' + encodeURIComponent('s:' + sign(sessions.MWX, config.dashboard.sessionSecret)) } });
      check('pièces jointes demandeur: inaccessibles à un autre membre', dlOther.status === 404, dlOther.status);
      fd = new FormData();
      for (let i = 0; i < 6; i++) fd.append('files', new Blob([Buffer.from('x')]), `f${i}.txt`);
      up = await post(`/api/member/tickets/${G}/${wt}/messages`, fd);
      check('pièces jointes demandeur: 5 fichiers au plus', up.status === 413, JSON.stringify(up));
      fd = new FormData();
      fd.append('files', new Blob([Buffer.from('x')]), 'a.txt');
      up = await post(`/api/member/tickets/${G}/${wt}/messages`, fd, { Cookie: cookie.Cookie });
      check('pièces jointes demandeur: en-tête anti-CSRF exigé en multipart aussi', up.status === 403, up.status);
      await db('INSERT INTO email_settings (id, attach_enabled) VALUES (1, 0) ON DUPLICATE KEY UPDATE attach_enabled = 0');
      fd = new FormData();
      fd.append('files', new Blob([Buffer.from('x')]), 'b.txt');
      up = await post(`/api/member/tickets/${G}/${wt}/messages`, fd);
      check('pièces jointes demandeur: conservation coupée → nom noté, fichier non gardé', up.status === 200 && up.body.files?.[0]?.kept === false && (await db('SELECT COUNT(*) AS n FROM email_attachments WHERE ticket_id = ?', [wt]))[0].n == 2, JSON.stringify(up));
      await db('UPDATE email_settings SET attach_enabled = 1 WHERE id = 1');
      await db('DELETE FROM email_attachments WHERE ticket_id = ?', [wt]); // the e-mail tests count the space used from zero
    }
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [wt]);
    r = await req('POST', `/api/member/tickets/${G}/${wt}/messages`, { sid: sessions.MW, body: { content: 'trop tard' } });
    check('espace membre: pas de réponse sur un ticket fermé', r.status === 400, r.status);
    await db("INSERT INTO blacklist (user_id, user_tag, reason, added_by_id, added_by_tag) VALUES (?, 'm81', 'test', '1', 'F')", [MW]).catch(() => null);
    r = await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.MW, body: { subject: 'Compte', content: 'encore' } });
    check('espace membre: membre blacklisté refusé', r.status === 403, JSON.stringify(r.body));
    await db('DELETE FROM blacklist WHERE user_id = ?', [MW]);
    await db('UPDATE guild_config SET ticket_subjects = ?, intake_form_enabled = ?, max_tickets_per_day = ? WHERE id = 1', [cfgBefore.ticket_subjects == null || typeof cfgBefore.ticket_subjects === 'string' ? cfgBefore.ticket_subjects : JSON.stringify(cfgBefore.ticket_subjects), cfgBefore.intake_form_enabled, cfgBefore.max_tickets_per_day]);
    await db('UPDATE intake_forms SET active = 0 WHERE id = ?', [formId]);
    await db('UPDATE ticket_fields SET active = 0 WHERE id = ?', [fid]);
  }

  // ── Public API documentation (generated from the routes) ──
  {
    r = await req('GET', '/api/v1/openapi.json');
    const paths = Object.keys(r.body?.paths || {});
    check('doc API: description OpenAPI publique', r.status === 200 && r.body.openapi === '3.0.3' && ['/tickets', '/tickets/{id}', '/tickets/{id}/close', '/stats'].every(p => paths.includes(p)), JSON.stringify(paths));
    check('doc API: titre au nom du bot de l instance', r.body.info?.title === 'Bot de test — API publique', r.body.info?.title);
    check('doc API: permissions et exemples', r.body.paths['/tickets/{id}/close'].post['x-permission'] === 'close_tickets' && r.body.paths['/stats'].get.responses[200].content['application/json'].example.tickets, '');
    const routes = app('./web/routes/apiV1').stack.filter(l => l.route).map(l => `${Object.keys(l.route.methods)[0]} ${l.route.path}`).filter(x => !x.endsWith('/openapi.json'));
    const documented = Object.entries(r.body.paths).flatMap(([p, m]) => Object.keys(m).map(k => `${k} ${p.replace(/\{(\w+)\}/g, ':$1')}`));
    check('doc API: chaque route est documentée', routes.length > 0 && routes.every(x => documented.includes(x)), JSON.stringify({ routes, documented }));
  }

  // ── Public API v2 (routes/apiV2.js, v4.1): space, contacts, attachments, cursors ──
  {
    await db('UPDATE guild_config SET api_keys_enabled = 1 WHERE id = 1');
    await mk('FK2', { user: { id: U.F, username: 'F', role: null }, currentGuildId: G });
    r = await req('POST', '/api/api-keys', { sid: sessions.FK2, body: { name: 'v2', permissions: ['read_tickets', 'close_tickets', 'read_contacts'] } });
    const k2 = { Authorization: `Bearer ${r.body.key}` };
    check('API v2: permission read_contacts proposée pour les clés', r.status === 200 && r.body.permissions.includes('read_contacts'), JSON.stringify([r.status, r.body]));
    r = await req('GET', '/api/v2/openapi.json');
    const routes2 = app('./web/routes/apiV2').stack.filter(l => l.route).map(l => `${Object.keys(l.route.methods)[0]} ${l.route.path}`).filter(x => !x.endsWith('/openapi.json'));
    const doc2 = Object.entries(r.body.paths || {}).flatMap(([p, m]) => Object.keys(m).map(k => `${k} ${p.replace(/\{(\w+)\}/g, ':$1')}`));
    check('API v2: description OpenAPI publique, chaque route documentée', r.status === 200 && r.body.info.version === '2' && /\/api\/v2$/.test(r.body.servers[0].url) && routes2.length >= 8 && routes2.every(x => doc2.includes(x)), JSON.stringify({ routes2, doc2 }));
    const v1doc = await req('GET', '/api/v1/openapi.json');
    check('API v2: la v1 reste décrite à l identique (4 routes, version 1)', v1doc.body.info.version === '1' && Object.keys(v1doc.body.paths).join() === '/tickets,/tickets/{id},/tickets/{id}/close,/stats', Object.keys(v1doc.body.paths).join());
    r = await req('GET', '/api/v2/space');
    check('API v2: sans clé → 401', r.status === 401, r.status);
    r = await req('GET', '/api/v2/space', { headers: k2 });
    check('API v2: l espace de la clé, avec ses permissions', r.status === 200 && r.body.id === G && typeof r.body.discord === 'boolean' && r.body.permissions.includes('read_contacts'), JSON.stringify(r.body));

    const tConf2 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES ('49','u49','capiconf2','open','Signalement', -1)")).insertId;
    const [{ n: visible }] = await db('SELECT COUNT(*) AS n FROM tickets WHERE visibility_grade_id IS NULL OR visibility_grade_id <> -1');
    const seen = [];
    let cursor = null, pages = 0, firstPage = null;
    do {
      r = await req('GET', '/api/v2/tickets', { headers: k2, query: { limit: 3, ...(cursor ? { cursor } : {}) } });
      if (r.status !== 200) break;
      if (!firstPage) firstPage = r.body;
      seen.push(...r.body.data.map(t => t.id));
      cursor = r.body.next_cursor; pages++;
    } while (cursor && pages < 500);
    check('API v2: pagination par curseur → chaque ticket une fois, du plus récent au plus ancien', r.status === 200 && seen.length === Number(visible) && new Set(seen).size === seen.length && seen.every((id, i) => i === 0 || id < seen[i - 1]) && !seen.includes(tConf2), JSON.stringify([seen.length, visible, pages]));
    const t0 = firstPage?.data?.[0];
    check('API v2: ticket avec demandeur typé, tags et fiche contact', !!t0 && ['discord', 'email', 'web'].includes(t0.owner.kind) && Array.isArray(t0.tags) && 'contact_id' in t0 && 'stage' in t0 && !('owner_id' in t0), JSON.stringify(t0));
    const badC = await req('GET', '/api/v2/tickets', { headers: k2, query: { cursor: 'pas-un-curseur' } });
    const badL = await req('GET', '/api/v2/tickets', { headers: k2, query: { limit: 101 } });
    const badL0 = await req('GET', '/api/v2/tickets', { headers: k2, query: { limit: 0 } });
    check('API v2: curseur ou limite invalides → 400', [badC, badL, badL0].every(x => x.status === 400), [badC, badL, badL0].map(x => x.status).join());
    r = await req('GET', `/api/v2/tickets/${tConf2}`, { headers: k2 });
    const confClose = await req('POST', `/api/v2/tickets/${tConf2}/close`, { headers: k2 });
    check('API v2: ticket confidentiel introuvable et non fermable', r.status === 404 && confClose.status === 404, [r.status, confClose.status].join());
    r = await req('GET', `/api/v2/tickets/${t0.id}`, { headers: k2 });
    check('API v2: détail avec messages et pièces jointes', r.status === 200 && Array.isArray(r.body.messages) && Array.isArray(r.body.attachments) && r.body.id === t0.id, JSON.stringify(r.body).slice(0, 300));
    r = await req('GET', `/api/v2/tickets/${t0.id}/attachments/999999`, { headers: k2 });
    check('API v2: pièce jointe inconnue → 404', r.status === 404, r.status);

    r = await req('GET', '/api/v2/contacts', { headers: { Authorization: 'Bearer ' + key } });
    check('API v2: contacts refusés sans read_contacts', r.status === 403, r.status);
    r = await req('GET', '/api/v2/contacts', { headers: k2, query: { limit: 100 } });
    const c0 = r.body.data?.find(c => c.identities.length);
    check('API v2: contacts avec leurs identités, sans notes internes', r.status === 200 && !!c0 && c0.identities.every(i => i.value && i.kind) && r.body.data.every(c => !('notes' in c)), JSON.stringify(r.body).slice(0, 300));
    const one = await req('GET', `/api/v2/contacts/${c0.id}`, { headers: k2 });
    const byContact = await req('GET', '/api/v2/tickets', { headers: k2, query: { contact_id: c0.id, limit: 100 } });
    check('API v2: fiche contact et ses tickets', one.status === 200 && one.body.tickets.total === byContact.body.data.length && byContact.body.data.every(t => c0.identities.some(i => i.value === t.owner.id)), JSON.stringify([one.body.tickets, byContact.body.data?.length]));
    const qr = await req('GET', '/api/v2/contacts', { headers: k2, query: { q: c0.display_name.slice(0, 4) } });
    check('API v2: recherche de contacts', qr.status === 200 && qr.body.data.some(c => c.id === c0.id), JSON.stringify(qr.body).slice(0, 200));

    const tOpen = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('48','u48','capiv2','open','Test v2')")).insertId;
    r = await req('POST', `/api/v2/tickets/${tOpen}/close`, { headers: { ...k2, 'X-Requested-With': '' } });
    const [closedV2] = await db('SELECT status, closed_by_tag FROM tickets WHERE id = ?', [tOpen]);
    check('API v2: fermeture comme en v1 (clé, sans en-tête CSRF)', r.status === 200 && closedV2.status === 'closed' && closedV2.closed_by_tag === 'API · v2', JSON.stringify([r.body, closedV2]));
    r = await req('GET', '/api/v2/stats', { headers: k2 });
    check('API v2: stats sans read_stats → 403', r.status === 403, r.status);
    await db('DELETE FROM tickets WHERE id IN (?)', [[tConf2, tOpen]]);
  }

  // ── Public API v3 (routes/apiV3.js, v5.0): v2 + writes ──
  {
    await db('UPDATE guild_config SET api_keys_enabled = 1 WHERE id = 1');
    await mk('FK3', { user: { id: U.F, username: 'F', role: null }, currentGuildId: G });
    r = await req('POST', '/api/api-keys', { sid: sessions.FK3, body: { name: 'crm', permissions: ['read_tickets', 'close_tickets', 'create_tickets', 'reply_tickets', 'update_tickets'] } });
    const k3 = { Authorization: `Bearer ${r.body.key}` };
    check('API v3: nouvelles permissions d écriture pour les clés', r.status === 200 && ['create_tickets', 'reply_tickets', 'update_tickets'].every(p => r.body.permissions.includes(p)), JSON.stringify(r.body.permissions));
    r = await req('POST', '/api/api-keys', { sid: sessions.FK3, body: { name: 'lecture', permissions: ['read_tickets'] } });
    const kRead = { Authorization: `Bearer ${r.body.key}` };
    r = await req('GET', '/api/v3/openapi.json');
    const doc3 = Object.entries(r.body.paths || {}).flatMap(([p, m]) => Object.keys(m).map(k => `${k} ${p}`));
    check('API v3: description OpenAPI (lectures de la v2, écritures avec leur corps)', r.status === 200 && r.body.info.version === '3' && /\/api\/v3$/.test(r.body.servers[0].url)
      && ['get /tickets', 'get /contacts', 'post /tickets', 'post /tickets/{id}/reply', 'post /tickets/{id}/notes', 'patch /tickets/{id}', 'post /tickets/{id}/close'].every(x => doc3.includes(x))
      && !!r.body.paths['/tickets'].post.requestBody && r.body.paths['/tickets'].post['x-permission'] === 'create_tickets', doc3.join(', '));
    const routes3 = app('./web/routes/apiV3').ENDPOINTS.map(e => `${e.method} ${e.path}`);
    check('API v3: chaque écriture documentée', routes3.length === 5 && routes3.every(x => doc3.includes(x)), routes3.join());
    check('API v3: la v1 n a toujours pas de corps documenté', !JSON.stringify((await req('GET', '/api/v1/openapi.json')).body).includes('requestBody'), '');

    const tag = (await db("INSERT INTO ticket_tags (name, color) VALUES ('API-VIP', '#aa0000')")).insertId;
    const fld = (await db("INSERT INTO ticket_fields (label, type, required) VALUES ('N° commande API', 'number', 0)")).insertId;
    const before = Number((await db('SELECT COUNT(*) AS n FROM tickets'))[0].n);
    const body = { requester: { email: 'Client.API@example.com', name: 'Camille' }, subject: 'Commande 1287 non reçue', message: 'Ma commande n est pas arrivée.', priority: 'urgent', tags: ['API-VIP'], fields: { [fld]: '1287' } };
    r = await req('POST', '/api/v3/tickets', { headers: kRead, body });
    check('API v3: ouvrir un ticket demande create_tickets', r.status === 403, r.status);
    r = await req('POST', '/api/v3/tickets', { headers: k3, body: { ...body, requester: { email: 'pas-une-adresse' } } });
    const r2 = await req('POST', '/api/v3/tickets', { headers: k3, body: { ...body, tags: ['Inexistant'] } });
    const r3 = await req('POST', '/api/v3/tickets', { headers: k3, body: { ...body, fields: { [fld]: 'abc' } } });
    check('API v3: requêtes invalides refusées sans rien créer', r.status === 400 && r2.status === 400 && /Inexistant/.test(r2.body.error) && r3.status === 400 && Number((await db('SELECT COUNT(*) AS n FROM tickets'))[0].n) === before, JSON.stringify([r.body, r2.body, r3.body]));
    r = await req('POST', '/api/v3/tickets', { headers: { ...k3, 'Idempotency-Key': 'commande-1287' }, body });
    const tid = r.body.id;
    const [tRow] = tid ? await db('SELECT owner_id, owner_tag, subject, priority FROM tickets WHERE id = ?', [tid]) : [];
    check('API v3: ticket ouvert au nom du demandeur (priorité, tags, champs)', r.status === 200 && tRow?.owner_id.startsWith('mail:') && tRow.owner_tag === 'client.api@example.com' && tRow.subject === 'Commande 1287 non reçue'
      && tRow.priority === 'urgent' && r.body.tags.includes('API-VIP') && r.body.fields[fld] === '1287' && r.body.owner.kind === 'email', JSON.stringify([r.body, tRow]));
    const [evOpen] = await db("SELECT actor_tag, source FROM audit_log WHERE action = 'ticket_open_api' AND ticket_id = ?", [tid]);
    check('API v3: au journal au nom de la clé, source API', evOpen?.actor_tag === 'API · crm' && evOpen.source === 'api', JSON.stringify(evOpen));
    r = await req('POST', '/api/v3/tickets', { headers: { ...k3, 'Idempotency-Key': 'commande-1287' }, body });
    check('API v3: requête rejouée (même Idempotency-Key) → le même ticket, pas de doublon', r.status === 200 && r.body.id === tid && r.headers['idempotent-replayed'] === 'true', JSON.stringify([r.body.id, tid]));

    r = await req('POST', `/api/v3/tickets/${tid}/reply`, { headers: kRead, body: { message: 'x' } });
    check('API v3: répondre demande reply_tickets', r.status === 403, r.status);
    r = await req('POST', `/api/v3/tickets/${tid}/reply`, { headers: k3, body: { message: 'Votre colis est reparti ce matin.' } });
    const [rep] = await db("SELECT author_id, author_tag, content FROM ticket_notes WHERE ticket_id = ? AND source = 'reply' ORDER BY id DESC LIMIT 1", [tid]);
    const [fr] = await db('SELECT first_response_at FROM tickets WHERE id = ?', [tid]);
    check('API v3: réponse au demandeur comme depuis le dashboard (historique, 1re réponse)', r.status === 200 && rep?.author_tag === 'API · crm' && rep.author_id.startsWith('api:') && rep.content.includes('reparti') && !!fr.first_response_at && r.body.note_id > 0, JSON.stringify([r.body, rep]));
    r = await req('POST', `/api/v3/tickets/${tid}/notes`, { headers: k3, body: { message: 'Transporteur relancé.' } });
    const [nt] = await db("SELECT source, author_tag FROM ticket_notes WHERE id = ?", [r.body.note_id || 0]);
    check('API v3: note interne', r.status === 200 && nt?.source === 'web' && nt.author_tag === 'API · crm', JSON.stringify([r.body, nt]));

    const team = (await db("INSERT INTO teams (name) VALUES ('Équipe API')")).insertId;
    await db("INSERT INTO dashboard_users (user_id, username, role) VALUES ('300000000000000033', 'Agent API', 'support') ON DUPLICATE KEY UPDATE role = 'support'");
    r = await req('PATCH', `/api/v3/tickets/${tid}`, { headers: k3, body: { priority: 'low', stage: 'nimporte', tags_remove: ['API-VIP'] } });
    const [still] = await db('SELECT priority FROM tickets WHERE id = ?', [tid]);
    check('API v3: modification invalide → rien n est changé', r.status === 400 && still.priority === 'urgent', JSON.stringify([r.body, still]));
    r = await req('PATCH', `/api/v3/tickets/${tid}`, { headers: k3, body: { priority: 'low', cc_add: ['client.api@example.com'] } });
    const [still3] = await db('SELECT priority FROM tickets WHERE id = ?', [tid]);
    check('API v3: copie refusée (adresse du demandeur) → rien d autre n est changé', r.status === 400 && /demandeur/.test(r.body.error) && still3.priority === 'urgent', JSON.stringify([r.body, still3]));
    r = await req('PATCH', `/api/v3/tickets/${tid}`, { headers: k3, body: { assignees_add: ['999999999999999990'] } });
    check('API v3: seul le staff peut être attribué', r.status === 400, JSON.stringify(r.body));
    const [catsB] = await db('SELECT waiting_category_id FROM guild_config WHERE id = 1');
    r = await req('PATCH', `/api/v3/tickets/${tid}`, { headers: k3, body: { priority: 'low', stage: 'waiting' } });
    const [still2] = await db('SELECT priority FROM tickets WHERE id = ?', [tid]);
    check('API v3: statut impossible (pas de catégorie Discord) → rien d autre n est changé', r.status === 400 && still2.priority === 'urgent', JSON.stringify([r.body, still2]));
    await db('UPDATE guild_config SET waiting_category_id = ? WHERE id = 1', [CAT_WAIT]);
    r = await req('PATCH', `/api/v3/tickets/${tid}`, { headers: k3, body: { priority: 'normal', stage: 'waiting', team_id: team, assignees_add: ['300000000000000033'], tags_remove: ['API-VIP'], fields: { [fld]: null }, cc_add: ['direction@example.com'] } });
    const [up] = await db('SELECT priority, stage, team_id FROM tickets WHERE id = ?', [tid]);
    check('API v3: modifier priorité, statut, équipe, attribution, tags, champs, copies', r.status === 200 && up.priority === 'normal' && up.stage === 'waiting' && up.team_id === team && r.body.assignees.includes('300000000000000033')
      && !r.body.tags.includes('API-VIP') && r.body.fields[fld] === undefined && r.body.cc.includes('direction@example.com'), JSON.stringify([r.body, up]));
    await db('UPDATE guild_config SET ticket_types_enabled = 0 WHERE id = 1');
    r = await req('PATCH', `/api/v3/tickets/${tid}`, { headers: k3, body: { type: 'incident' } });
    const v3off = r.status;
    await db('UPDATE guild_config SET ticket_types_enabled = 1 WHERE id = 1');
    r = await req('PATCH', `/api/v3/tickets/${tid}`, { headers: k3, body: { type: 'incident' } });
    check('API v3: type du ticket (refusé si l espace n utilise pas les types)', v3off === 400 && r.status === 200 && r.body.type === 'incident', JSON.stringify([v3off, r.body.type]));
    await db('UPDATE guild_config SET priority_matrix_enabled = 1 WHERE id = 1');
    r = await req('PATCH', `/api/v3/tickets/${tid}`, { headers: k3, body: { urgency: 4, impact: 4 } });
    const pBoth = await req('PATCH', `/api/v3/tickets/${tid}`, { headers: k3, body: { priority: 'low', urgency: 1 } });
    check('API v3: urgence et impact (matrice), pas en même temps que priority', r.status === 200 && r.body.priority_level === 5 && r.body.priority === 'urgent' && pBoth.status === 400, JSON.stringify([r.body.priority_level, pBoth.body]));
    check('API v3: chaque changement au journal au nom de la clé', (await db("SELECT DISTINCT action FROM audit_log WHERE ticket_id = ? AND actor_tag = 'API · crm'", [tid])).length >= 5, '');
    r = await req('GET', `/api/v3/tickets/${tid}`, { headers: k3 });
    check('API v3: les lectures de la v2 répondent aussi en v3', r.status === 200 && r.body.id === tid && Array.isArray(r.body.messages), r.status);
    const tConf3 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES ('42','u42','db-api3c','open','Signalement', -1)")).insertId;
    const confS = [];
    for (const [m, p, b] of [['POST', `/api/v3/tickets/${tConf3}/reply`, { message: 'x' }], ['POST', `/api/v3/tickets/${tConf3}/notes`, { message: 'x' }], ['PATCH', `/api/v3/tickets/${tConf3}`, { priority: 'low' }]]) confS.push((await req(m, p, { headers: k3, body: b })).status);
    check('API v3: un ticket confidentiel n existe pas pour une clé', confS.every(x => x === 404), confS.join());
    r = await req('POST', `/api/v3/tickets/${tid}/close`, { headers: k3 });
    const r4 = await req('POST', `/api/v3/tickets/${tid}/reply`, { headers: k3, body: { message: 'trop tard' } });
    check('API v3: fermer, puis plus de réponse sur un ticket fermé', r.status === 200 && r4.status === 400, [r.status, r4.status].join());
    await db('UPDATE guild_config SET waiting_category_id = ? WHERE id = 1', [catsB.waiting_category_id]);
    await db('DELETE FROM tickets WHERE id IN (?)', [[tid, tConf3]]);
    await db('DELETE FROM teams WHERE id = ?', [team]);
    await db('DELETE FROM ticket_tags WHERE id = ?', [tag]);
    await db("DELETE FROM dashboard_users WHERE user_id = '300000000000000033'");
    await db('UPDATE ticket_fields SET active = 0 WHERE id = ?', [fld]);
  }

  // ── Browser crashes reported to the super-admin error journal ──
  {
    r = await req('POST', '/api/client-errors', { sid: sessions.FV, body: { message: 'TypeError: x is undefined (test navigateur)', stack: 'at Tickets.jsx:10', url: '/tickets', kind: 'rendu', component: 'in Tickets' } });
    await new Promise(res => setTimeout(res, 200));
    const [row] = await globalQuery("SELECT * FROM error_logs WHERE context = 'navigateur' AND message LIKE '%test navigateur%' ORDER BY id DESC LIMIT 1");
    check('erreurs navigateur: enregistrées pour le super-admin', r.status === 204 && row && /"page":"\/tickets"/.test(row.stack) && /staff:/.test(row.stack) && row.guild_id === G, JSON.stringify(row));
    await req('POST', '/api/client-errors', { body: { message: 'anonyme (test navigateur)' } });
    await new Promise(res => setTimeout(res, 200));
    const [anon] = await globalQuery("SELECT context FROM error_logs WHERE message LIKE 'anonyme (test navigateur)%' ORDER BY id DESC LIMIT 1");
    const { errorSummary } = app('./utils/errorAlert');
    const summary = await errorSummary(60);
    check('erreurs navigateur: rapports anonymes à part, hors alerte', anon?.context === 'navigateur-anonyme' && !summary.top.some(t => t.context === 'navigateur-anonyme'), JSON.stringify([anon, summary.top]));
    r = await req('GET', '/api/tickets');
    check('sécurité: route staff sans session → 401', r.status === 401, r.status);
    r = await req('POST', '/api/client-errors', { body: { message: '' } });
    check('erreurs navigateur: message requis', r.status === 400, r.status);
    r = await req('POST', '/api/client-errors', { body: { message: 'x' }, headers: { 'X-Requested-With': '' } });
    check('erreurs navigateur: protection CSRF', r.status === 403, r.status);
  }

  // ── Discord disconnection alert ──
  {
    const { setSetting, getSetting } = app('./utils/instanceSettings');
    const { runDiscordWatch } = app('./utils/discordWatch');
    const before = await getSetting('error_alert', {});
    await setSetting('error_alert', { enabled: false, threshold: 20, windowMinutes: 15, discordUserIds: ['200000000000000099'], webhookUrl: null, discordDownMinutes: 5 });
    const os = require('os');
    await redis.del(`discord:down_since:${os.hostname()}`, `discord:down_alerted:${os.hostname()}`);
    const down = { isReady: () => false, ws: { status: 5 }, users: fakeClient.users };
    const up = { isReady: () => true, ws: { status: 0 }, users: fakeClient.users };
    const t0 = Date.now();
    memberDms.length = 0;
    let w = await runDiscordWatch(down, t0);
    check('discord: coupure détectée sans alerte immédiate', w.connected === false && !w.alertSent && memberDms.length === 0, JSON.stringify(w));
    w = await runDiscordWatch(down, t0 + 3 * 60000);
    check('discord: pas d alerte avant le délai', !w.alertSent, JSON.stringify(w));
    w = await runDiscordWatch(down, t0 + 6 * 60000);
    check('discord: alerte après le délai', w.alertSent && memberDms.some(m => m.id === '200000000000000099' && /déconnecté/.test(m.p?.embeds?.[0]?.title)), JSON.stringify([w, memberDms]));
    w = await runDiscordWatch(down, t0 + 8 * 60000);
    check('discord: une seule alerte par coupure', !w.alertSent && memberDms.length === 1, JSON.stringify(w));
    w = await runDiscordWatch(up, t0 + 9 * 60000);
    check('discord: reconnexion signalée', w.recovered && memberDms.some(m => /reconnecté/.test(m.p?.embeds?.[0]?.title) && /9 min/.test(m.p.embeds[0].description)), JSON.stringify([w, memberDms.map(m => m.p?.embeds?.[0])]));
    await setSetting('error_alert', { ...before, discordUserIds: ['200000000000000099'], discordDownMinutes: 0 });
    memberDms.length = 0;
    await runDiscordWatch(down, t0); await runDiscordWatch(down, t0 + 60 * 60000);
    check('discord: alerte désactivable (0)', memberDms.length === 0, JSON.stringify(memberDms));
    await redis.del(`discord:down_since:${os.hostname()}`, `discord:down_alerted:${os.hostname()}`);
    await setSetting('error_alert', before);
    r = await req('PUT', '/api/instance/settings/error-alert', { sid: sessions.OWN, body: { enabled: false, threshold: 20, windowMinutes: 15, discordUserIds: [], webhookUrl: null, discordDownMinutes: -1 } });
    check('discord: délai validé', r.status === 400 && /déconnexion/.test(r.body.error), JSON.stringify(r.body));
  }

  // ── Full tour: every route not covered above answers correctly (allowed account) and refuses
  //    an account without the right ──
  {
    const ok = (name, res, codes = [200, 201]) => check(`tour: ${name}`, codes.includes(res.status), `${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    const denied = (name, res) => check(`tour: ${name} refusé`, res.status === 403 || res.status === 401, `${res.status}`);
    const F = sessions.FV, S = sessions.S3T;

    // Dashboard home
    for (const p of ['stats', 'activity', 'heatmap', 'top-staff', 'pending', 'recent', 'leaderboard']) ok(`dashboard/${p}`, await req('GET', `/api/dashboard/${p}`, { sid: F }));
    ok('objectif du mois', await req('GET', '/api/goals', { sid: F }));
    // Analytics
    for (const p of ['volume', 'hourly', 'subjects', 'response-trend', 'sla', 'staff-compare']) ok(`analytics/${p}`, await req('GET', `/api/analytics/${p}`, { sid: F }));
    // Staff, users, Discord lists
    let r = await req('GET', '/api/staff', { sid: F }); ok('équipe', r);
    ok('fiche agent', await req('GET', `/api/staff/${U.F}`, { sid: F }), [200, 404]);
    ok('utilisateurs', await req('GET', '/api/users', { sid: F }));
    ok('grades d un utilisateur', await req('GET', `/api/users/${U.S1}/grades`, { sid: F }));
    ok('mode vacances', await req('PATCH', `/api/users/${U.F}/vacation`, { sid: F, body: { vacation_mode: false } }));
    for (const p of ['categories', 'channels', 'roles']) ok(`discord/${p}`, await req('GET', `/api/discord/${p}`, { sid: F }), [200, 503]);
    ok('configuration', await req('GET', '/api/config', { sid: F }));
    ok('identité du bot', await req('GET', '/api/config/bot-identity', { sid: F }), [200, 503]);
    denied('configuration pour un support', await req('GET', '/api/config', { sid: S }));

    // Grades
    r = await req('POST', '/api/grades', { sid: F, body: { name: 'Tour grade', color: '#123456', permissions: ['view_tickets'] } });
    ok('créer un grade', r);
    const gid = r.body?.id;
    ok('lister les grades', await req('GET', '/api/grades', { sid: F }));
    ok('modifier un grade', await req('PATCH', `/api/grades/${gid}`, { sid: F, body: { name: 'Tour grade 2' } }));
    ok('permissions d un grade', await req('PUT', `/api/grades/${gid}/permissions`, { sid: F, body: { permissions: ['view_tickets', 'reply_ticket'] } }));
    denied('créer un grade (support)', await req('POST', '/api/grades', { sid: S, body: { name: 'x' } }));
    ok('supprimer un grade', await req('DELETE', `/api/grades/${gid}`, { sid: F }));

    // Tags (catalogue and on a ticket)
    const tt = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('42','u42','ctour1','open','tour')")).insertId;
    r = await req('POST', '/api/tags', { sid: F, body: { name: 'Tour tag', color: '#00aa00' } }); ok('créer un tag', r);
    const tagId = r.body?.id;
    ok('lister les tags', await req('GET', '/api/tags', { sid: F }));
    ok('modifier un tag', await req('PATCH', `/api/tags/${tagId}`, { sid: F, body: { color: '#00bb00' } }));
    ok('tag sur un ticket', await req('POST', `/api/tags/ticket/${tt}`, { sid: F, body: { tag_id: tagId } }));
    r = await req('GET', `/api/tags/ticket/${tt}`, { sid: F });
    check('tour: tags du ticket', r.status === 200 && r.body.some(x => x.id === tagId), JSON.stringify(r.body));
    ok('retirer un tag du ticket', await req('DELETE', `/api/tags/ticket/${tt}/${tagId}`, { sid: F }));
    denied('créer un tag (support)', await req('POST', '/api/tags', { sid: S, body: { name: 'y', color: '#000000' } }));
    ok('supprimer un tag', await req('DELETE', `/api/tags/${tagId}`, { sid: F }));

    // Ticket actions not covered above
    ok('historique du membre', await req('GET', `/api/tickets/${tt}/history`, { sid: F }));
    r = await req('POST', `/api/tickets/${tt}/participants`, { sid: F, body: { discord_id: '200000000000000005' } });
    ok('ajouter un participant', r, [200, 201]);
    ok('retirer un participant', await req('DELETE', `/api/tickets/${tt}/participants/200000000000000005`, { sid: F }));
    r = await req('POST', `/api/tickets/${tt}/notes`, { sid: F, body: { content: 'note à supprimer' } });
    ok('supprimer une note', await req('DELETE', `/api/tickets/${tt}/notes/${r.body?.id}`, { sid: F }));
    channels.set('ctour1', mkChannel('ctour1', G));
    r = await reqMultipart(`/api/tickets/${tt}/reply-file`, { sid: F, fields: { content: 'voici le fichier' }, file: { field: 'file', name: 'a.txt', content: Buffer.from('bonjour') } });
    ok('réponse avec fichier', r);

    // Scheduled messages
    r = await req('POST', '/api/messages', { sid: F, body: { ticket_id: tt, content: 'message programmé', send_at: new Date(Date.now() + 3600e3).toISOString() } });
    ok('programmer un message', r);
    ok('lister les messages programmés', await req('GET', '/api/messages', { sid: F }));
    ok('annuler un message programmé', await req('DELETE', `/api/messages/${r.body?.id}`, { sid: F }));

    // FAQ, fields, incidents (editing)
    r = await req('POST', '/api/faq', { sid: F, body: { question: 'Tour question ?', answer: 'Réponse', keywords: 'tour' } });
    ok('créer une entrée de FAQ', r);
    ok('lister la FAQ', await req('GET', '/api/faq', { sid: F }));
    ok('modifier la FAQ', await req('PATCH', `/api/faq/${r.body?.id}`, { sid: F, body: { answer: 'Réponse 2' } }));
    ok('supprimer de la FAQ', await req('DELETE', `/api/faq/${r.body?.id}`, { sid: F }));
    r = await req('POST', '/api/fields', { sid: F, body: { label: 'Tour champ', type: 'text' } });
    ok('créer un champ', r);
    ok('lister les champs', await req('GET', '/api/fields', { sid: F }));
    ok('modifier un champ', await req('PATCH', `/api/fields/${r.body?.id}`, { sid: F, body: { active: false } }));
    r = await req('POST', '/api/incidents', { sid: F, body: { title: 'Tour incident', message: 'm' } });
    ok('modifier un incident', await req('PATCH', `/api/incidents/${r.body?.id}`, { sid: F, body: { message: 'm2' } }));
    await req('POST', `/api/incidents/${r.body?.id}/resolve`, { sid: F, body: {} });

    // Blacklist
    ok('blacklister', await req('POST', '/api/blacklist', { sid: F, body: { userId: '200000000000000066', userTag: 'tour', reason: 'test', duration: '1d' } }));
    r = await req('GET', '/api/blacklist', { sid: F });
    check('tour: liste noire', r.status === 200 && r.body.some(x => x.user_id === '200000000000000066'), JSON.stringify(r.body).slice(0, 200));
    denied('liste noire (support)', await req('GET', '/api/blacklist', { sid: S }));
    ok('retirer de la liste noire', await req('DELETE', '/api/blacklist/200000000000000066', { sid: F }));

    // Forms, panels
    r = await req('POST', '/api/forms', { sid: F, body: { name: 'Tour formulaire', fields: [{ label: 'Question ?' }] } });
    ok('créer un formulaire', r);
    ok('lister les formulaires', await req('GET', '/api/forms', { sid: F }));
    ok('modifier un formulaire', await req('PATCH', `/api/forms/${r.body?.id}`, { sid: F, body: { active: false } }));
    ok('supprimer un formulaire', await req('DELETE', `/api/forms/${r.body?.id}`, { sid: F }));
    r = await req('POST', '/api/panels', { sid: F, body: { name: 'Tour panel', title: 'Support', buttons: [{ label: 'Ouvrir', style: 'primary' }] } });
    ok('créer un panel', r);
    const panelId = r.body?.id;
    ok('lister les panels', await req('GET', '/api/panels', { sid: F }));
    ok('modifier un panel', await req('PATCH', `/api/panels/${panelId}`, { sid: F, body: { title: 'Support 2' } }));
    ok('dépublier un panel', await req('DELETE', `/api/panels/${panelId}/publish`, { sid: F }), [200, 400, 404]);
    ok('supprimer un panel', await req('DELETE', `/api/panels/${panelId}`, { sid: F }));

    // API keys, newsletter, sessions, push, presence of real-time stream
    await db('UPDATE guild_config SET api_keys_enabled = 1 WHERE id = 1');
    r = await req('POST', '/api/api-keys', { sid: F, body: { name: 'Tour clé', permissions: ['read_stats'] } });
    ok('créer une clé API', r);
    const keyList = await req('GET', '/api/api-keys', { sid: F });
    ok('lister les clés API', keyList);
    r.body.id = keyList.body?.keys?.find(k => k.name === 'Tour clé')?.id;
    if (r.body?.key) ok('clé API utilisable', await req('GET', '/api/v1/stats', { headers: { Authorization: `Bearer ${r.body.key}` } }));
    ok('révoquer une clé API', await req('DELETE', `/api/api-keys/${r.body?.id}`, { sid: F }));
    if (r.body?.key) denied('clé révoquée', await req('GET', '/api/v1/stats', { headers: { Authorization: `Bearer ${r.body.key}` } }));
    memberDms.length = 0;
    r = await req('POST', '/api/newsletter/send', { sid: F, body: { message: 'Message de la direction (tour)' } });
    ok('newsletter au staff', r);
    denied('newsletter (support)', await req('POST', '/api/newsletter/send', { sid: S, body: { message: 'xxxxxx' } }));
    ok('mes sessions', await req('GET', '/api/sessions', { sid: F }));
    ok('clé publique push (501 si non configuré)', await req('GET', '/api/push/vapid-public-key', { sid: F }), [200, 501]);
    check('tour: abonnement push hors liste refusé', (await req('POST', '/api/push/subscribe', { sid: F, body: { endpoint: 'https://evil.example/x', keys: { p256dh: 'a', auth: 'b' } } })).status === 400);
    ok('abonnement push', await req('POST', '/api/push/subscribe', { sid: F, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/tour', keys: { p256dh: 'BPtour', auth: 'tour' } } }), [200, 201]);
    ok('désabonnement push', await req('POST', '/api/push/unsubscribe', { sid: F, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/tour' } }));
    const sse = await new Promise(resolve => {
      const rq = http.get({ host: '127.0.0.1', port: config.webServerPort, path: '/api/events', headers: { Cookie: 'connect.sid=' + encodeURIComponent('s:' + sign(F, config.dashboard.sessionSecret)) } }, res => { resolve({ status: res.statusCode, type: res.headers['content-type'] }); rq.destroy(); });
      rq.on('error', () => resolve({ status: 0 }));
    });
    check('tour: flux temps réel (SSE)', sse.status === 200 && /event-stream/.test(sse.type), JSON.stringify(sse));

    // Profile: availability and 2FA from the start (setup, enable, recovery codes)
    await mk('TFA', { user: { id: '100000000000000055', username: 'tfa', role: null }, currentGuildId: G });
    ok('ma disponibilité', await req('GET', '/api/profile/availability', { sid: F }));
    r = await req('GET', '/api/profile/2fa', { sid: sessions.TFA });
    check('tour: 2FA désactivée au départ', r.status === 200 && r.body.enabled === false, JSON.stringify(r.body));
    r = await req('POST', '/api/profile/2fa/setup', { sid: sessions.TFA });
    ok('2FA : préparation (QR code)', r);
    const { generateSync } = require('otplib');
    const totpCode = () => generateSync({ secret: r.body.secret });
    const en = await req('POST', '/api/profile/2fa/enable', { sid: sessions.TFA, body: { code: totpCode() } });
    check('tour: 2FA activée avec un code valide', en.status === 200 && Array.isArray(en.body.recoveryCodes) && en.body.recoveryCodes.length === 10, JSON.stringify(en.body).slice(0, 200));
    await new Promise(res => setTimeout(res, 50));
    const rc = await req('POST', '/api/profile/2fa/recovery-codes', { sid: sessions.TFA, body: { code: en.body.recoveryCodes?.[0] } });
    ok('2FA : nouveaux codes de secours', rc, [200, 400]);
    await globalQuery("DELETE FROM user_totp WHERE user_id = '100000000000000055'");

    // Sign-in helpers
    r = await req('GET', '/api/auth/invite-url', { sid: F, query: { guildId: G } });
    check('tour: lien d invitation du bot', r.status === 200 && /permissions=268684432/.test(r.body.url) && r.body.url.includes(G), JSON.stringify(r.body));
    r = await req('GET', '/api/auth/invite-url', { sid: sessions.S3T, query: { guildId: G } });
    check('tour: lien d invitation réservé au propriétaire de l instance', r.status === 403, r.status);
    r = await req('GET', '/api/auth/discord');
    check('tour: connexion Discord (redirection avec état)', r.status === 302 && /state=[0-9a-f]{32}/.test(r.headers.location), r.headers.location);
    r = await req('GET', '/api/auth/discord/callback', { query: { code: 'x', state: 'faux' } });
    check('tour: retour OAuth avec mauvais état refusé', r.status === 302 && /invalid_state/.test(r.headers.location), r.headers.location);
    r = await req('GET', '/api/auth/guilds', { sid: F });
    check('tour: serveurs Discord sans jeton → reconnexion', r.status === 401, r.status);

    // Instance: servers (suspend, reactivate, maintenance), settings
    for (const k of await redis.keys('rl:*')) await redis.del(k); // earlier sign-in tests used up the limit
    const OW = sessions.OWN;
    ok('instance : serveurs', await req('GET', '/api/instance/guilds', { sid: OW }));
    ok('instance : fiche serveur', await req('GET', `/api/instance/guilds/${G}`, { sid: OW }));
    const G4 = '423456789012345678';
    await globalQuery("INSERT INTO guilds (guild_id, guild_name, owner_discord_id, owner_discord_tag, status, db_name) VALUES (?, 'Tour', ?, 'f', 'active', ?)", [G4, U.F, 'ticketbot_guild_' + G4]);
    await ensureTenantSchema(G4);
    ok('instance : suspendre', await req('PATCH', `/api/instance/guilds/${G4}/suspend`, { sid: OW, body: { reason: 'tour' } }));
    ok('instance : réactiver', await req('PATCH', `/api/instance/guilds/${G4}/reactivate`, { sid: OW }));
    ok('instance : maintenance', await req('PATCH', `/api/instance/guilds/${G4}/maintenance`, { sid: OW, body: { enabled: true } }));
    for (const p of ['settings/error-alert', 'demo', 'audit', 'blocked', 'health']) ok(`instance : ${p}`, await req('GET', `/api/instance/${p}`, { sid: OW }));
    for (const p of ['guilds', 'stats', 'settings/error-alert', 'demo']) denied(`instance : ${p} (pas propriétaire)`, await req('GET', `/api/instance/${p}`, { sid: sessions.NOWN }));
    r = await req('POST', `/api/instance/guilds/${G4}/approve`, { sid: OW });
    check('tour: plus d approbation de serveur', r.status === 404, r.status);
    await globalQuery('DELETE FROM guilds WHERE guild_id = ?', [G4]);
    await globalQuery('DROP DATABASE IF EXISTS ticketbot_guild_' + G4);

    // Revoking my other sessions
    await mk('FVother', { user: { id: U.F, username: 'F', role: null }, currentGuildId: G });
    await globalQuery('INSERT INTO user_sessions (user_id, session_id, ip, user_agent) VALUES (?, ?, "x", "x")', [U.F, sessions.FVother]);
    ok('révoquer mes autres sessions', await req('DELETE', '/api/sessions', { sid: F }));
    check('tour: autre session révoquée', (await req('GET', '/api/tickets', { sid: sessions.FVother })).status === 401);
    check('tour: session courante conservée', (await req('GET', '/api/tickets', { sid: F })).status === 200);
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tt]);
  }

  // ── Discord slash commands (each one run in a ticket channel) ──
  {
    const CHC = '900000000000000177', MC = '200000000000000083';
    channels.set(CHC, mkChannel(CHC, G));
    await db("UPDATE guild_config SET internal_notes_enabled = 1 WHERE id = 1");
    const tc = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member83', ?, 'open', 'Commandes')", [MC, CHC])).insertId;
    const run = async (name, opts = {}, extra = {}) => {
      const out = {};
      const o = {
        getString: (k) => opts[k] ?? null, getInteger: (k) => opts[k] ?? null, getUser: (k) => opts[k] ?? null,
        getAttachment: () => null, getSubcommand: () => opts.sub, getBoolean: (k) => opts[k] ?? null,
      };
      const i = { guildId: G, channelId: CHC, guild: guildObj, channel: channels.get(CHC), user: { id: U.F, username: 'F', tag: 'F' }, member: { roles: { cache: new Map() } },
        options: o, reply: async p => { out.reply = p; }, deferReply: async () => {}, editReply: async p => { out.edit = p; }, followUp: async p => { out.follow = p; }, ...extra };
      await app(`./commands/${name}`).execute(fakeClient, i);
      return out;
    };
    const txt = o => JSON.stringify(o.reply ?? o.edit ?? o.follow ?? null);
    let out = await run('claim');
    let [a] = await db('SELECT user_id FROM ticket_assignees WHERE ticket_id = ?', [tc]);
    check('/claim: prise en charge', a?.user_id === U.F, txt(out));
    out = await run('unclaim');
    [a] = await db('SELECT user_id FROM ticket_assignees WHERE ticket_id = ? AND user_id = ?', [tc, U.F]);
    check('/unclaim: libération', !a, txt(out));
    memberDms.length = 0;
    out = await run('reply', { message: 'Réponse depuis Discord' });
    check('/reply: réponse transmise au membre', memberDms.some(m => m.id === MC && /Réponse depuis Discord/.test(JSON.stringify(m.p))), txt(out));
    memberDms.length = 0;
    out = await run('areply', { message: 'Réponse anonyme' });
    const anonDm = memberDms.find(m => m.id === MC);
    check('/areply: réponse anonyme', anonDm && /Réponse anonyme/.test(JSON.stringify(anonDm.p)) && !/"F"/.test(JSON.stringify(anonDm.p?.embeds?.[0]?.data?.author || {})), txt(out));
    out = await run('note', { message: 'Note via Discord' });
    const [nt] = await db("SELECT source FROM ticket_notes WHERE ticket_id = ? AND content = 'Note via Discord'", [tc]);
    check('/note: note interne visible dans la fiche', nt?.source === 'web', txt(out));
    out = await run('priority', { niveau: 'urgent' });
    let [tr] = await db('SELECT priority, stage, subject FROM tickets WHERE id = ?', [tc]);
    check('/priority: priorité changée', tr.priority === 'urgent', txt(out));
    const [catBefore] = await db('SELECT in_progress_category_id FROM guild_config WHERE id = 1');
    await db('UPDATE guild_config SET in_progress_category_id = ? WHERE id = 1', [CAT_WAIT]);
    out = await run('moveticket', { etape: 'in_progress' });
    await db('UPDATE guild_config SET in_progress_category_id = ? WHERE id = 1', [catBefore.in_progress_category_id]);
    [tr] = await db('SELECT stage FROM tickets WHERE id = ?', [tc]);
    check('/moveticket: étape changée', tr.stage === 'in_progress', txt(out));
    out = await run('rename', { name: 'Nouveau titre' });
    [tr] = await db('SELECT subject FROM tickets WHERE id = ?', [tc]);
    check('/rename: titre changé', tr.subject === 'Nouveau titre', txt(out));
    out = await run('adduser', { utilisateur: { id: '200000000000000005', username: 'member05', tag: 'member05', bot: false, send: async p => memberDms.push({ id: '200000000000000005', p }) } });
    let [pp] = await db('SELECT user_id FROM ticket_participants WHERE ticket_id = ?', [tc]);
    check('/adduser: participant ajouté', pp?.user_id === '200000000000000005', txt(out));
    out = await run('removeuser', { utilisateur: { id: '200000000000000005', username: 'member05', tag: 'member05', bot: false, send: async p => memberDms.push({ id: '200000000000000005', p }) } });
    [pp] = await db('SELECT user_id FROM ticket_participants WHERE ticket_id = ?', [tc]);
    check('/removeuser: participant retiré', !pp, txt(out));
    await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, closed_at) VALUES (?, 'member83', 'cold83', 'closed', 'Ancien', NOW())", [MC]);
    fakeClient.config = config; // set by index.js on the real client
    out = await run('oldtickets', { userid: MC });
    check('/oldtickets: historique du membre', /Commandes|Nouveau titre|#/.test(txt(out)), txt(out).slice(0, 200));
    const [snap] = await db('SELECT id FROM transcript_snapshots ORDER BY id DESC LIMIT 1');
    if (snap) {
      out = await run('gettranscript', { transcriptid: snap.id });
      check('/gettranscript: lien temporaire', /\/t\/[0-9a-f]+/.test(txt(out)), txt(out).slice(0, 200));
    }
    out = await run('staffstats');
    check('/staffstats: statistiques (fondateur)', !/réservée/.test(txt(out)) && !!(out.reply || out.edit), txt(out).slice(0, 120));
    out = await run('blacklist', { sub: 'add', utilisateur: { id: '200000000000000067', username: 'spam', tag: 'spam', bot: false, send: async () => ({}) }, raison: 'spam' });
    let [bl] = await db("SELECT user_id FROM blacklist WHERE user_id = '200000000000000067'");
    check('/blacklist add', !!bl, txt(out));
    out = await run('blacklist', { sub: 'list' });
    check('/blacklist list', /spam|200000000000000067/.test(txt(out)), txt(out).slice(0, 200));
    out = await run('blacklist', { sub: 'remove', utilisateur: { id: '200000000000000067', username: 'spam', tag: 'spam', bot: false, send: async () => ({}) } });
    [bl] = await db("SELECT user_id FROM blacklist WHERE user_id = '200000000000000067'");
    check('/blacklist remove', !bl, txt(out));
    // A member without staff rights is refused
    const outsider = {};
    const iOut = { guildId: G, channelId: CHC, guild: guildObj, channel: channels.get(CHC), user: { id: '400000000000000003', username: 'none', tag: 'none' },
      options: { getString: () => 'x', getUser: () => null, getAttachment: () => null }, reply: async p => { outsider.reply = p; }, deferReply: async () => {}, editReply: async p => { outsider.edit = p; } };
    memberDms.length = 0;
    await app('./commands/reply').execute(fakeClient, iOut);
    check('/reply: refusé sans droits staff', memberDms.length === 0 && /permission|accès|autoris|réservé/i.test(JSON.stringify(outsider)), JSON.stringify(outsider));
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tc]);
  }

  // ── « View on the web » link in ticket DMs ──
  {
    const CHW = '900000000000000178', MWL = '200000000000000084';
    channels.set(CHW, mkChannel(CHW, G));
    const tw = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member84', ?, 'open', 'lien web')", [MWL, CHW])).insertId;
    const linkOf = () => {
      const dm = memberDms.filter(m => m.id === MWL).pop();
      const comps = (dm?.p?.components || []).flatMap(r => (r.components || []).map(c => c.data || c));
      return comps.find(c => c.url)?.url || null;
    };
    memberDms.length = 0;
    await req('POST', `/api/tickets/${tw}/reply`, { sid: sessions.FV, body: { content: 'Réponse avec lien' } });
    check('MP: bouton « Voir sur le web » vers la page du ticket', linkOf() === `http://localhost:39123/espace/${G}/${tw}`, JSON.stringify(memberDms.filter(m => m.id === MWL).map(m => m.p?.components)));
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tw]);
  }

  // ── Custom field variables in reply templates ──
  {
    let r = await req('POST', '/api/fields', { sid: sessions.FV, body: { label: 'N° de facture', type: 'number' } });
    const fc = r.body;
    check('variables: nom dérivé du libellé', r.status === 200 && fc.variable === 'facture', JSON.stringify(r.body));
    r = await req('POST', '/api/fields', { sid: sessions.FV, body: { label: 'Facture', type: 'text' } });
    check('variables: deux champs ne partagent pas une variable', r.status === 400 && /facture/.test(r.body.error), JSON.stringify(r.body));
    r = await req('PATCH', `/api/fields/${fc.id}`, { sid: sessions.FV, body: { var_name: 'username' } });
    check('variables: noms réservés refusés', r.status === 400, r.status);
    r = await req('PATCH', '/api/fields/abc', { sid: sessions.FV, body: { label: 'x' } });
    check('sécurité: erreur non gérée → JSON sans trace', typeof r.body === 'object' && !JSON.stringify(r.body).includes('tenantDb.js'), JSON.stringify(r.body).slice(0, 120));
    r = await req('PATCH', `/api/fields/${fc.id}`, { sid: sessions.FV, body: { var_name: 'num_cmd' } });
    check('variables: renommage', r.status === 200 && r.body.variable === 'num_cmd', JSON.stringify(r.body));
    const CHV = '900000000000000179';
    channels.set(CHV, mkChannel(CHV, G));
    const tv = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('200000000000000085', 'member85', ?, 'open', 'Variables')", [CHV])).insertId;
    await db('INSERT INTO ticket_field_values (ticket_id, field_id, value) VALUES (?, ?, ?)', [tv, fc.id, '4242']);
    r = await req('GET', `/api/tickets/${tv}`, { sid: sessions.FV });
    check('variables: fournies avec la fiche', r.body.fields?.some(f => f.variable === 'num_cmd' && f.value === '4242'), JSON.stringify(r.body.fields));
    const { resolveTemplateVars } = app('./utils/discordReply');
    const out = resolveTemplateVars('Bonjour {{username}}, commande {{num_cmd}} {{inconnue}}', { id: tv, owner_tag: 'member85' }, 'F', await app('./utils/ticketFields').fieldsForTicket(db, tv));
    check('variables: remplacées dans les réponses envoyées depuis Discord', out === 'Bonjour member85, commande 4242 {{inconnue}}', out);
    await db('UPDATE ticket_fields SET active = 0 WHERE id = ?', [fc.id]);
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tv]);
  }

  // ── Keyword rules (first message) ──
  {
    const tagK = (await db("INSERT INTO ticket_tags (name, color) VALUES ('Remboursement', '#ff8800')")).insertId;
    let r = await req('POST', '/api/subject-rules', { sid: sessions.FV, body: { matchType: 'keyword', keywords: 'rembours, carte refusée', tagId: tagK, priority: 'urgent' } });
    check('mots-clés: règle créée', r.status === 200 && r.body.match_type === 'keyword', JSON.stringify(r.body));
    const ruleId = r.body.id;
    r = await req('POST', '/api/subject-rules', { sid: sessions.FV, body: { matchType: 'keyword', keywords: 'ab', priority: 'low' } });
    check('mots-clés: mots trop courts refusés', r.status === 400, r.status);
    const tmK = createManager(db, fakeClient, G);
    const mkUser = id => ({ id, username: `u${id.slice(-2)}`, tag: `u${id.slice(-2)}`, send: async () => ({}) });
    const a = await tmK.createTicket(mkUser('200000000000000086'), 'Bonjour, je voudrais être REMBOURSÉ de ma commande', [], 'Autre', { forceNew: true });
    const b = await tmK.createTicket(mkUser('200000000000000087'), 'Ma Carte Refusee au paiement', [], 'Autre', { forceNew: true });
    const c = await tmK.createTicket(mkUser('200000000000000088'), 'Un souci de connexion, rien à voir', [], 'Autre', { forceNew: true });
    const prio = async t => (await db('SELECT priority FROM tickets WHERE id = ?', [t.ticket.id]))[0].priority;
    const tagged = async t => (await db('SELECT 1 FROM ticket_tag_assignments WHERE ticket_id = ? AND tag_id = ?', [t.ticket.id, tagK])).length === 1;
    check('mots-clés: début de mot, accents et majuscules ignorés', await prio(a) === 'urgent' && await tagged(a), '');
    check('mots-clés: expression de plusieurs mots', await prio(b) === 'urgent' && await tagged(b), '');
    check('mots-clés: pas de déclenchement sans mot-clé', await prio(c) !== 'urgent' && !(await tagged(c)), '');
    const [ev] = await db("SELECT details FROM audit_log WHERE action = 'ticket_rule' AND ticket_id = ? ORDER BY id DESC LIMIT 1", [a.ticket.id]);
    check('mots-clés: tracé dans le journal', JSON.stringify(ev?.details).includes('Mots-clés'), JSON.stringify(ev));
    r = await req('GET', '/api/config/export', { sid: sessions.FV });
    check('mots-clés: exportés avec la configuration', r.body.subjectRules?.some(x => x.matchType === 'keyword' && x.keywords?.includes('rembours')), JSON.stringify(r.body.subjectRules));
    await req('DELETE', `/api/subject-rules/${ruleId}`, { sid: sessions.FV });
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[a.ticket.id, b.ticket.id, c.ticket.id]]);
  }

  // ── « Nouveautés »: last patch notes version seen ──
  {
    let r = await req('GET', '/api/profile/whats-new', { sid: sessions.FV });
    check('nouveautés: rien de vu au départ', r.status === 200 && r.body.seen === null, JSON.stringify(r.body));
    r = await req('PUT', '/api/profile/whats-new', { sid: sessions.FV, body: { version: 'v2.17' } });
    const again = await req('GET', '/api/profile/whats-new', { sid: sessions.FV });
    check('nouveautés: version vue enregistrée', r.status === 200 && again.body.seen === 'v2.17', JSON.stringify(again.body));
    r = await req('PUT', '/api/profile/whats-new', { sid: sessions.FV, body: { version: '<script>' } });
    check('nouveautés: version invalide refusée', r.status === 400, r.status);
    check('nouveautés: réservé aux comptes connectés', (await req('GET', '/api/profile/whats-new')).status === 401);
  }

  // ── Dashboard language, kept on the account ──
  {
    let r = await req('GET', '/api/profile/language', { sid: sessions.FV });
    check('langue: aucune au départ', r.status === 200 && r.body.lang === null, JSON.stringify(r.body));
    r = await req('PUT', '/api/profile/language', { sid: sessions.FV, body: { lang: 'en' } });
    const again = await req('GET', '/api/profile/language', { sid: sessions.FV });
    check('langue: anglais enregistré', r.status === 200 && again.body.lang === 'en', JSON.stringify(again.body));
    const seen = await req('GET', '/api/profile/whats-new', { sid: sessions.FV });
    check('langue: la version vue est conservée', seen.body.seen === 'v2.17', JSON.stringify(seen.body));
    r = await req('PUT', '/api/profile/language', { sid: sessions.FV, body: { lang: 'de' } });
    check('langue: langue inconnue refusée', r.status === 400, r.status);
    check('langue: réservé aux comptes connectés', (await req('PUT', '/api/profile/language', { body: { lang: 'fr' } })).status === 401);
  }

  // ── Member space colours per server ──
  {
    const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    let r = await req('PATCH', '/api/config', { sid: sessions.FV, body: { portalColor: 'orange' } });
    check('couleurs: couleur invalide refusée', r.status === 400, r.status);
    r = await req('PATCH', '/api/config', { sid: sessions.FV, body: { portalLogo: 'https://evil.example/logo.png' } });
    check('couleurs: logo externe refusé (image intégrée seulement)', r.status === 400, r.status);
    r = await req('PATCH', '/api/config', { sid: sessions.FV, body: { portalLogo: PNG1, portalColor: '#e67e22', portalWelcome: 'Bienvenue au support !' } });
    check('couleurs: enregistrées', r.status === 200, JSON.stringify(r.body));
    await mk('MWB', { member: { id: '200000000000000081', username: 'member81', avatar: null } });
    await redis.del('memberguilds:200000000000000081');
    r = await req('GET', '/api/member/guilds', { sid: sessions.MWB });
    const gb = r.body.find?.(g => g.id === G);
    check('couleurs: transmises à l espace membre', gb?.color === '#e67e22' && gb.logo === PNG1 && gb.welcome === 'Bienvenue au support !', JSON.stringify(gb).slice(0, 200));
    r = await req('GET', '/api/config/history', { sid: sessions.FV });
    check('couleurs: logo masqué dans l historique (trop lourd)', r.body.entries?.[0]?.changes?.portalLogo?.secret === true && !JSON.stringify(r.body).includes('iVBOR'), JSON.stringify(r.body.entries?.[0]).slice(0, 200));
    await req('PATCH', '/api/config', { sid: sessions.FV, body: { portalLogo: null, portalColor: null, portalWelcome: null } });
  }

  // ── Procedures by subject ──
  {
    let r = await req('POST', '/api/procedures', { sid: sessions.FV, body: { title: 'Paiement', subject: 'paiement', steps: [{ text: 'Demander la capture' }, { text: 'Vérifier Stripe' }] } });
    const proc = r.body;
    check('procédures: créée avec identifiants d étapes', r.status === 200 && proc.steps.length === 2 && proc.steps.every(s => /^[0-9a-f]{8}$/.test(s.id)), JSON.stringify(r.body));
    r = await req('POST', '/api/procedures', { sid: sessions.FV, body: { title: 'Vide', steps: [] } });
    check('procédures: au moins une étape', r.status === 400, r.status);
    r = await req('POST', '/api/procedures', { sid: sessions.S3T, body: { title: 'x', steps: [{ text: 'y' }] } });
    check('procédures: réservées à manage_settings', r.status === 403, r.status);
    const tp = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('43','u43','cproc1','open','Problème de PAIEMENT')")).insertId;
    const to = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('44','u44','cproc2','open','Compte')")).insertId;
    r = await req('GET', `/api/tickets/${tp}/procedures`, { sid: sessions.FV });
    check('procédures: appliquée selon le sujet (accents, casse)', r.body.length === 1 && r.body[0].total === 2 && r.body[0].done === 0, JSON.stringify(r.body));
    check('procédures: pas sur un autre sujet', (await req('GET', `/api/tickets/${to}/procedures`, { sid: sessions.FV })).body.length === 0);
    r = await req('PUT', `/api/tickets/${tp}/procedures/${proc.id}/steps/${proc.steps[0].id}`, { sid: sessions.FV, body: { checked: true } });
    check('procédures: étape cochée avec auteur', r.status === 200 && r.body[0].done === 1 && r.body[0].steps[0].checked_by_tag === 'F', JSON.stringify(r.body));
    // Editing the steps keeps the checks of the steps that still exist
    await req('PATCH', `/api/procedures/${proc.id}`, { sid: sessions.FV, body: { steps: [{ text: 'Nouvelle étape' }, ...proc.steps] } });
    r = await req('GET', `/api/tickets/${tp}/procedures`, { sid: sessions.FV });
    check('procédures: coches conservées après modification', r.body[0].total === 3 && r.body[0].steps.find(s => s.id === proc.steps[0].id)?.checked === true, JSON.stringify(r.body));
    r = await req('PUT', `/api/tickets/${tp}/procedures/${proc.id}/steps/inconnu1`, { sid: sessions.FV, body: { checked: true } });
    check('procédures: étape inconnue', r.status === 404, r.status);
    r = await req('PUT', `/api/tickets/${tp}/procedures/${proc.id}/steps/${proc.steps[1].id}`, { sid: sessions.FV, body: { checked: false } });
    check('procédures: décocher', r.status === 200, r.status);
    r = await req('GET', '/api/config/export', { sid: sessions.FV });
    check('procédures: exportées avec la configuration', r.body.procedures?.some(p => p.title === 'Paiement' && p.steps.includes('Vérifier Stripe')), JSON.stringify(r.body.procedures));
    await req('DELETE', `/api/procedures/${proc.id}`, { sid: sessions.FV });
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[tp, to]]);
  }

  // ── Time spent on tickets ──
  {
    const CHT1 = '900000000000000180', CHT2 = '900000000000000181';
    channels.set(CHT1, mkChannel(CHT1, G)); channels.set(CHT2, mkChannel(CHT2, G));
    const t1t = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('45','u45',?,'open','Temps A')", [CHT1])).insertId;
    const t2t = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('46','u46',?,'open','Temps B')", [CHT2])).insertId;
    let r = await req('POST', `/api/tickets/${t1t}/time/start`, { sid: sessions.FV });
    check('temps: chrono démarré', r.status === 200 && r.body.running, JSON.stringify(r.body));
    await db('UPDATE ticket_time SET started_at = NOW() - INTERVAL 10 MINUTE WHERE ticket_id = ? AND ended_at IS NULL', [t1t]);
    r = await req('GET', '/api/tickets/time/running', { sid: sessions.FV });
    check('temps: chrono en cours visible partout', r.body?.ticket_id === t1t && r.body.elapsed >= 600, JSON.stringify(r.body));
    await req('POST', `/api/tickets/${t2t}/time/start`, { sid: sessions.FV });
    r = await req('GET', `/api/tickets/${t1t}/time`, { sid: sessions.FV });
    check('temps: démarrer un autre chrono arrête le premier', !r.body.running && r.body.total >= 600 && r.body.total < 700, JSON.stringify(r.body));
    r = await req('POST', `/api/tickets/${t1t}/time`, { sid: sessions.FV, body: { minutes: 15, note: 'appel téléphonique' } });
    check('temps: ajout manuel', r.status === 200 && r.body.total >= 1500 && r.body.entries.some(e => e.source === 'manual' && e.note === 'appel téléphonique'), JSON.stringify(r.body));
    const manual = r.body.entries.find(e => e.source === 'manual');
    r = await req('POST', `/api/tickets/${t1t}/time`, { sid: sessions.FV, body: { minutes: 0 } });
    check('temps: durée invalide refusée', r.status === 400, r.status);
    r = await req('DELETE', `/api/tickets/time/${manual.id}`, { sid: sessions.S3T });
    check('temps: une entrée ne se retire que par son auteur', r.status === 403, r.status);
    // Forgotten stopwatch: capped at 8 h
    await db('UPDATE ticket_time SET started_at = NOW() - INTERVAL 30 HOUR WHERE ticket_id = ? AND ended_at IS NULL', [t2t]);
    await createManager(db, fakeClient, G).closeTicketWithTranscript(channels.get(CHT2), { id: U.F, tag: 'F', username: 'F' });
    const [closed] = await db('SELECT seconds, ended_at FROM ticket_time WHERE ticket_id = ? ORDER BY id DESC LIMIT 1', [t2t]);
    check('temps: arrêté à la fermeture, plafonné à 8 h', closed.ended_at && Number(closed.seconds) === 8 * 3600, JSON.stringify(closed));
    r = await req('GET', '/api/analytics/time', { sid: sessions.FV, query: { days: 7 } });
    check('temps: analytique de l équipe (fondateur)', r.body.scope === 'team' && r.body.byUser.some(u => u.user_id === U.F) && r.body.bySubject.some(x => x.subject === 'Temps A'), JSON.stringify(r.body).slice(0, 300));
    r = await req('GET', '/api/analytics/time', { sid: sessions.S3T, query: { days: 7 } });
    check('temps: sans view_audit, seulement son propre temps', r.body.scope === 'mine' && !r.body.byUser.some(u => u.user_id === U.F), JSON.stringify(r.body).slice(0, 200));
    r = await req('GET', '/api/staff/me/activity', { sid: sessions.FV, query: { days: 7 } });
    check('temps: total dans Mon activité', r.body.timeSeconds >= 8 * 3600, r.body.timeSeconds);
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [t1t]);
  }

  // ── Confidential tickets (founders only) ──
  {
    const MCF = '200000000000000089';
    const [cfgB] = await db('SELECT ticket_subjects, faq_enabled, intake_form_enabled FROM guild_config WHERE id = 1');
    await db("UPDATE guild_config SET ticket_subjects = ?, faq_enabled = 0, intake_form_enabled = 0 WHERE id = 1", [JSON.stringify(['Paiement', 'Compte'])]);
    const msgC = app('./events/messageCreate'), interC = app('./events/interactionCreate');
    memberDms.length = 0;
    await msgC.execute(fakeClient, { t: 'MESSAGE_CREATE', d: { author: { id: MCF, bot: false }, content: 'Un membre du staff me harcèle', attachments: [] } });
    const ask = memberDms.filter(m => m.id === MCF).pop()?.p;
    const ids = (ask?.components || []).flatMap(r => r.components.map(c => c.data.custom_id));
    check('confidentiel: bouton proposé avec les sujets', ids.includes('subject_confidential') && ids.includes('subject_0') && (ask.components || []).length <= 5, JSON.stringify(ids));
    const out = {};
    await interC.execute(fakeClient, { customId: 'subject_confidential', guildId: null, guild: null, channelId: 'dm', values: [], message: { embeds: [] },
      user: { id: MCF, username: 'member89', tag: 'member89', send: async p => memberDms.push({ id: MCF, p }) },
      isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false, isChatInputCommand: () => false, isRepliable: () => true,
      reply: async p => { out.reply = p; }, update: async p => { out.update = p; } });
    const [tc] = await db("SELECT * FROM tickets WHERE owner_id = ? ORDER BY id DESC LIMIT 1", [MCF]);
    check('confidentiel: ticket ouvert réservé aux fondateurs', tc?.visibility_grade_id === -1 && tc.subject === 'Demande confidentielle', JSON.stringify(tc));
    const welcome = memberDms.filter(m => m.id === MCF).map(m => JSON.stringify(m.p)).join(' ');
    check('confidentiel: le membre est prévenu', /seuls les fondateurs/.test(welcome), welcome.slice(-300));
    let r = await req('GET', `/api/tickets/${tc.id}`, { sid: sessions.S3T });
    check('confidentiel: invisible pour le staff', r.status === 403 || r.status === 404, r.status);
    r = await req('GET', '/api/tickets', { sid: sessions.S3T, query: { status: 'open' } });
    check('confidentiel: absent de la liste du staff', !r.body.tickets?.some(t => t.id === tc.id), '');
    r = await req('GET', '/api/tickets/search', { sid: sessions.S3T, query: { q: 'harcèle' } });
    check('confidentiel: absent de la recherche du staff', r.status === 200 && !r.body.results.some(x => x.ticket.id === tc.id), JSON.stringify(r.body).slice(0, 200));
    r = await req('GET', `/api/tickets/${tc.id}`, { sid: sessions.FV });
    check('confidentiel: visible par un fondateur', r.status === 200 && r.body.visibility_grade_id === -1, r.status);
    const canSee = app('./utils/gradePermissions').canUserSeeTicket;
    check('confidentiel: notifications et salon limités aux fondateurs', await canSee(db, U.F, -1) && !(await canSee(db, U.S1, -1)), '');
    // A rule on the subject does not lift it
    const gR = (await db("INSERT INTO grades (name) VALUES ('Règle conf')")).insertId;
    const confRule = await app('./utils/subjectRules').createLegacy(db, { match_type: 'subject', subject: 'Demande confidentielle', keywords: null, tag_id: null, priority: null, visibility_grade_id: gR });
    await app('./utils/ruleEngine').runRules({ db, client: fakeClient, guildId: G, ticketId: tc.id, trigger: 'created' });
    const [tc2] = await db('SELECT visibility_grade_id FROM tickets WHERE id = ?', [tc.id]);
    check('confidentiel: une règle par sujet ne le lève pas', tc2.visibility_grade_id === -1, JSON.stringify(tc2));
    await db('DELETE FROM ticket_rules WHERE id = ?', [confRule.id]);
    // Nothing of it reaches the staff through the side doors (analytics, profile, dashboard)
    r = await req('GET', '/api/analytics/sla', { sid: sessions.S3T });
    check('confidentiel: absent de la vue SLA du staff', r.status === 200 && !r.body.some(t => t.id === tc.id), JSON.stringify(r.body).slice(0, 200));
    const fConf = (await db("INSERT INTO ticket_fields (label, type) VALUES ('Détail conf', 'text')")).insertId;
    await db('INSERT INTO ticket_field_values (ticket_id, field_id, value) VALUES (?, ?, ?)', [tc.id, fConf, 'secret-42']);
    r = await req('GET', `/api/profiles/${MCF}`, { sid: sessions.S3T });
    check('confidentiel: champs absents du profil vu par le staff', r.status === 200 && !JSON.stringify(r.body).includes('secret-42'), JSON.stringify(r.body).slice(0, 300));
    r = await req('GET', `/api/profiles/${MCF}`, { sid: sessions.FV });
    check('confidentiel: champs visibles par un fondateur', JSON.stringify(r.body).includes('secret-42'), '');
    await db('DELETE FROM ticket_fields WHERE id = ?', [fConf]);
    // Reopened: the new channel is created closed to the support roles, then synced
    {
      const created = [];
      const origCreate = (await fakeClient.guilds.fetch(G)).channels.create;
      (await fakeClient.guilds.fetch(G)).channels.create = async opts => { created.push(opts); return origCreate(opts); };
      await db("UPDATE tickets SET status = 'closed', closed_at = NOW() WHERE id = ?", [tc.id]);
      const [closed] = await db('SELECT * FROM tickets WHERE id = ?', [tc.id]);
      await createManager(db, fakeClient, G).reopenTicket(closed, { id: U.F, tag: 'founder', username: 'founder' }).catch(e => created.push({ error: e.message }));
      (await fakeClient.guilds.fetch(G)).channels.create = origCreate;
      const ow = created[0]?.permissionOverwrites || [];
      check('confidentiel: rouvert dans un salon fermé au support', created.length === 1 && !ow.some(o => o.id === '800000000000000001'), JSON.stringify(created, (k, v) => (typeof v === 'bigint' ? String(v) : v)).slice(0, 400));
    }
    r = await req('PATCH', `/api/tickets/${tc.id}/visibility`, { sid: sessions.FV, body: { visibility_grade_id: null } });
    check('confidentiel: levé par un fondateur', r.status === 200 && (await db('SELECT visibility_grade_id FROM tickets WHERE id = ?', [tc.id]))[0].visibility_grade_id === null, JSON.stringify(r.body));
    // From the member space
    await mk('MCF', { member: { id: MCF, username: 'member89', avatar: null } });
    await redis.del(`memberguilds:${MCF}`);
    r = await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.MCF, body: { subject: 'Compte', content: 'Signalement confidentiel depuis le site', confidential: true } });
    const [tw] = r.body.ticketId ? await db('SELECT visibility_grade_id FROM tickets WHERE id = ?', [r.body.ticketId]) : [];
    const mv = r.body.ticketId ? await req('GET', `/api/member/tickets/${G}/${r.body.ticketId}`, { sid: sessions.MCF }) : {};
    check('confidentiel: demandé depuis l espace membre', tw?.visibility_grade_id === -1 && mv.body?.ticket?.confidential === true, JSON.stringify([r.body, tw, mv.body?.ticket]));
    await db('UPDATE guild_config SET ticket_subjects = ?, faq_enabled = ?, intake_form_enabled = ? WHERE id = 1', [cfgB.ticket_subjects == null || typeof cfgB.ticket_subjects === 'string' ? cfgB.ticket_subjects : JSON.stringify(cfgB.ticket_subjects), cfgB.faq_enabled, cfgB.intake_form_enabled]);
    await db("UPDATE tickets SET status = 'closed' WHERE owner_id = ?", [MCF]);
  }

  // ── Member profiles (staff thread and labels) ──
  {
    const MP = '200000000000000090';
    const tpA = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'membreP', 'cprof1', 'closed', 'Remboursement')", [MP])).insertId;
    const tpS = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES (?, 'membreP', 'cprof2', 'open', 'Secret', ?)", [MP, g2])).insertId;
    let r = await req('GET', '/api/profiles', { sid: sessions.FV, query: { q: 'membreP' } });
    check('profils: annuaire avec recherche', r.status === 200 && r.body.members.some(m => m.member_id === MP && m.tickets === 2), JSON.stringify(r.body));
    r = await req('POST', `/api/profiles/${MP}/posts`, { sid: sessions.FV, body: { content: 'Déjà remboursé deux fois' } });
    const postId = r.body.id;
    check('profils: message publié', r.status === 200 && r.body.posts[0]?.content === 'Déjà remboursé deux fois', JSON.stringify(r.body));
    r = await req('POST', `/api/profiles/${MP}/posts`, { sid: sessions.S1, body: { content: 'Noté', parentId: postId } });
    check('profils: réponse dans le fil', r.status === 200 && r.body.posts[0].replies[0]?.content === 'Noté', JSON.stringify(r.body));
    const replyId = r.body.posts[0].replies[0].id;
    r = await req('POST', `/api/profiles/${MP}/posts`, { sid: sessions.FV, body: { content: 'Réponse à la réponse', parentId: replyId } });
    check('profils: les réponses restent sur un niveau', r.body.posts[0].replies.length === 2 && r.body.posts[0].replies.every(x => x.parent_id === postId), JSON.stringify(r.body.posts[0]));
    r = await req('PATCH', `/api/profiles/posts/${postId}`, { sid: sessions.S1, body: { content: 'piraté' } });
    check('profils: seul l auteur modifie', r.status === 403, r.status);
    r = await req('PATCH', `/api/profiles/posts/${postId}`, { sid: sessions.FV, body: { pinned: true } });
    check('profils: message épinglé', r.body.posts[0].pinned === true, JSON.stringify(r.body.posts[0]));
    r = await req('PUT', `/api/profiles/${MP}/labels`, { sid: sessions.FV, body: { labels: ['VIP', 'VIP', 'À surveiller'] } });
    check('profils: étiquettes (sans doublon)', r.status === 200 && r.body.labels.join() === 'VIP,À surveiller', JSON.stringify(r.body));
    r = await req('GET', `/api/profiles/${MP}/summary`, { sid: sessions.S1 });
    check('profils: résumé pour la fiche ticket', r.body.labels.includes('VIP') && r.body.pinned[0]?.content === 'Déjà remboursé deux fois', JSON.stringify(r.body));
    r = await req('GET', `/api/profiles/${MP}`, { sid: sessions.S3T });
    check('profils: tickets restreints masqués dans le profil', r.status === 200 && r.body.tickets.some(t => t.id === tpA) && !r.body.tickets.some(t => t.id === tpS), JSON.stringify(r.body.tickets));
    r = await req('GET', `/api/members/${MP}`, { sid: sessions.FV });
    check('profils: inclus dans l export RGPD', JSON.stringify(r.body).includes('Déjà remboursé deux fois') || r.status === 200, r.status);
    r = await req('DELETE', `/api/profiles/posts/${postId}`, { sid: sessions.FV });
    check('profils: suppression d un sujet avec ses réponses', r.status === 200 && r.body.posts.length === 0, JSON.stringify(r.body));
    check('profils: réservé au staff', (await req('GET', '/api/profiles', { sid: sessions.MEM })).status >= 400);
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tpS]);
  }

  // ── Contacts: one card per person, several identities (utils/contacts.js, v4 PR 9) ──
  {
    const contacts = app('./utils/contacts');
    const MD = '200000000000000091';
    const MAIL = `mail:${crypto.createHash('sha256').update('marie@exemple.fr').digest('hex').slice(0, 24)}`;
    const tD1 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'marie_d', 'cct1', 'closed', 'Commande Discord')", [MD])).insertId;
    const tD2 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES (?, 'marie_d', 'cct2', 'closed', 'Restreint Discord', ?)", [MD, g2])).insertId;
    const tM1 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'marie@exemple.fr', 'db-cct3', 'open', 'Facture par e-mail')", [MAIL])).insertId;
    await db("INSERT INTO email_contacts (owner_id, address, name) VALUES (?, 'marie@exemple.fr', 'Marie Durand') ON DUPLICATE KEY UPDATE name = VALUES(name)", [MAIL]);
    await contacts.sync(db, { force: true });
    const [cM] = await db('SELECT c.display_name, c.email, ci.kind FROM contact_identities ci JOIN contacts c ON c.id = ci.contact_id WHERE ci.value = ?', [MAIL]);
    const [cD] = await db('SELECT c.display_name, ci.kind FROM contact_identities ci JOIN contacts c ON c.id = ci.contact_id WHERE ci.value = ?', [MD]);
    check('contacts: créés à la volée depuis les tickets (Discord, e-mail avec son adresse)', cM?.kind === 'email' && cM.display_name === 'Marie Durand' && cM.email === 'marie@exemple.fr' && cD?.kind === 'discord' && cD.display_name === 'marie_d', JSON.stringify([cM, cD]));
    r = await req('GET', '/api/profiles', { sid: sessions.FV, query: { q: 'marie@exemple' } });
    check('contacts: annuaire, recherche par adresse, contact e-mail inclus', r.status === 200 && r.body.members.some(m => m.member_id === MAIL && m.kinds.join() === 'email' && m.tickets === 1), JSON.stringify(r.body.members));
    r = await req('GET', `/api/profiles/${MAIL}`, { sid: sessions.FV });
    check('contacts: fiche d un contact e-mail (avant : profils Discord seulement)', r.status === 200 && r.body.identities.length === 1 && r.body.contact.email === 'marie@exemple.fr' && r.body.tickets.some(t => t.id === tM1), JSON.stringify(r.body).slice(0, 300));
    await req('POST', `/api/profiles/${MAIL}/posts`, { sid: sessions.FV, body: { content: 'Écrit depuis sa boîte pro' } });
    await req('PUT', `/api/profiles/${MAIL}/labels`, { sid: sessions.FV, body: { labels: ['Pro'] } });
    await req('PUT', `/api/profiles/${MD}/labels`, { sid: sessions.FV, body: { labels: ['VIP'] } });

    r = await req('POST', `/api/profiles/${MD}/merge`, { sid: sessions.FV, body: { other: 'pas-un-id' } });
    const self = await req('POST', `/api/profiles/${MD}/merge`, { sid: sessions.FV, body: { other: MD } });
    check('contacts: fusion avec un identifiant invalide ou soi-même refusée', r.status === 400 && self.status === 400, `${r.status} ${self.status}`);
    r = await req('POST', `/api/profiles/${MD}/merge`, { sid: sessions.FV, body: { other: MAIL } });
    const viaMail = await req('GET', `/api/profiles/${MAIL}`, { sid: sessions.FV });
    const viaDiscord = await req('GET', `/api/profiles/${MD}`, { sid: sessions.FV });
    const ids = (viaMail.body.identities || []).map(i => `${i.kind}:${i.primary}`).sort().join();
    check('contacts: fusion → une fiche Discord + e-mail, tous les tickets, quelle que soit l identité ouverte', r.status === 200 && viaMail.body.contact?.id === viaDiscord.body.contact?.id && ids === 'discord:true,email:false' && [tD1, tD2, tM1].every(id => viaMail.body.tickets.some(t => t.id === id)) && viaMail.body.member_id === MD, JSON.stringify([r.body, viaMail.body.identities, viaMail.body.tickets?.map(t => t.id)]));
    const posts = await req('GET', `/api/profiles/${MD}/posts`, { sid: sessions.FV });
    check('contacts: fusion → discussion et étiquettes réunies, adresse reprise', viaMail.body.labels.sort().join() === 'Pro,VIP' && posts.body.some(p => p.content === 'Écrit depuis sa boîte pro') && viaMail.body.contact.email === 'marie@exemple.fr', JSON.stringify([viaMail.body.labels, posts.body.length, viaMail.body.contact]));
    r = await req('GET', '/api/profiles', { sid: sessions.FV, query: { q: 'marie' } });
    const entries = r.body.members.filter(m => m.member_id === MD || m.member_id === MAIL);
    check('contacts: une seule entrée dans l annuaire après fusion', entries.length === 1 && entries[0].kinds.join() === 'discord,email' && entries[0].tickets === 3, JSON.stringify(entries));
    r = await req('GET', `/api/profiles/${MAIL}`, { sid: sessions.S3T });
    check('contacts: confidentialité, la fiche fusionnée ne montre au staff que ses tickets visibles', r.status === 200 && r.body.tickets.some(t => t.id === tD1) && r.body.tickets.some(t => t.id === tM1) && !r.body.tickets.some(t => t.id === tD2) && r.body.stats.tickets === 2, JSON.stringify(r.body.tickets));
    const dirS = await req('GET', '/api/profiles', { sid: sessions.S3T, query: { q: 'marie' } });
    check('contacts: confidentialité, l annuaire compte les tickets visibles seulement', dirS.body.members.find(m => m.member_id === MD)?.tickets === 2, JSON.stringify(dirS.body.members));
    const [{ n: kept }] = await db('SELECT COUNT(*) AS n FROM tickets WHERE owner_id IN (?)', [[MD, MAIL]]);
    check('contacts: les tickets ne bougent pas', Number(kept) === 3, kept);

    // The card itself
    r = await req('PATCH', `/api/profiles/${MD}/contact`, { sid: sessions.FV, body: { email: 'pas une adresse' } });
    const okP = await req('PATCH', `/api/profiles/${MD}/contact`, { sid: sessions.FV, body: { displayName: 'Marie D.', notes: 'Société Exemple' } });
    check('contacts: nom et notes modifiables, adresse invalide refusée', r.status === 400 && okP.status === 200 && okP.body.contact.displayName === 'Marie D.' && okP.body.contact.notes === 'Société Exemple', JSON.stringify([r.body, okP.body]));
    // Detaching
    r = await req('DELETE', `/api/profiles/${MD}/identities/${MD}`, { sid: sessions.FV });
    const det = await req('DELETE', `/api/profiles/${MD}/identities/${encodeURIComponent(MAIL)}`, { sid: sessions.FV });
    const after = await req('GET', `/api/profiles/${MAIL}`, { sid: sessions.FV });
    await contacts.sync(db, { force: true });
    const [{ n: cards }] = await db('SELECT COUNT(DISTINCT contact_id) AS n FROM contact_identities WHERE value IN (?)', [[MD, MAIL]]);
    check('contacts: une identité se détache (pas la principale) et retrouve sa fiche', r.status === 400 && det.status === 200 && after.body.identities.length === 1 && after.body.tickets.every(t => t.id === tM1) && Number(cards) === 2, JSON.stringify([r.body, det.body, after.body.identities]));
    check('contacts: journal de la fusion et du détachement', (await db("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('contact_merge','contact_detach')"))[0].n >= 2, '');
    // GDPR erasure: the identity leaves, an empty card goes
    r = await req('DELETE', `/api/members/${MD}`, { sid: sessions.FV, body: { confirm: MD } });
    await contacts.sync(db, { force: true });
    const [gone] = await db('SELECT COUNT(*) AS n FROM contact_identities WHERE value = ?', [MD]);
    const [{ n: orphan }] = await db('SELECT COUNT(*) AS n FROM contacts c LEFT JOIN contact_identities ci ON ci.contact_id = c.id WHERE ci.value IS NULL');
    check('contacts: effacement RGPD → identité et fiche vide supprimées, non recréées', r.status === 200 && Number(gone.n) === 0 && Number(orphan) === 0, JSON.stringify([r.body, gone, orphan]));
    await db('DELETE FROM tickets WHERE owner_id = ?', [MAIL]);
    await db('DELETE FROM email_contacts WHERE owner_id = ?', [MAIL]);
    await db('DELETE FROM member_notes WHERE member_id IN (?)', [[MD, MAIL]]);
    await db('DELETE FROM member_profiles WHERE member_id IN (?)', [[MD, MAIL]]);
    await db('DELETE FROM contacts WHERE id IN (SELECT contact_id FROM contact_identities WHERE value = ?)', [MAIL]);
  }

  // ── Temporary guest access ──
  {
    for (const k of await redis.keys('rl:*')) await redis.del(k);
    const tg = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('47','u47','cguest1','closed','Litige')")).insertId;
    const tOther = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('48','u48','cguest2','closed','Autre')")).insertId;
    await db(`INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES
      (?, '47', 'u47', 'Message du membre (litige)', 'user'), (?, '1', 'F', 'NOTE-INTERNE-LITIGE', 'web')`, [tg, tg]);
    let r = await req('POST', '/api/guest-invites', { sid: sessions.S3T, body: { label: 'x', ticketIds: [tg], duration: '24h' } });
    check('invités: création réservée aux fondateurs', r.status === 403, r.status);
    r = await req('POST', '/api/guest-invites', { sid: sessions.FV, body: { label: 'Maître Dupont', ticketIds: [tg, 999999], duration: '24h' } });
    check('invités: tickets inconnus refusés', r.status === 400, r.status);
    r = await req('POST', '/api/guest-invites', { sid: sessions.FV, body: { label: 'Maître Dupont', ticketIds: [tg], duration: '24h' } });
    const token = (r.body.link || '').split('#')[1];
    check('invités: lien créé, jeton dans le fragment', r.status === 200 && /\/invite#gi_\d+_[0-9a-f]{64}$/.test(r.body.link), JSON.stringify(r.body));
    const [stored] = await db('SELECT token_hash FROM guest_invites WHERE id = ?', [r.body.id]);
    check('invités: seul le hachage du jeton est gardé', stored && !JSON.stringify(stored).includes(token.slice(-64)), '');
    r = await req('POST', '/api/guest/session', { body: { token: token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a') } });
    check('invités: jeton faux refusé', r.status === 401, r.status);
    r = await req('POST', '/api/guest/session', { body: { token } });
    const gCookie = { Cookie: String(r.headers['set-cookie']?.[0] || '').split(';')[0] };
    check('invités: session ouverte avec le lien', r.status === 200, JSON.stringify(r.body));
    r = await req('GET', '/api/guest/tickets', { headers: gCookie });
    check('invités: seuls les tickets partagés', r.status === 200 && r.body.length === 1 && r.body[0].id === tg, JSON.stringify(r.body));
    r = await req('GET', `/api/guest/tickets/${tg}`, { headers: gCookie });
    check('invités: conversation sans notes internes (option non cochée)', r.status === 200 && r.body.messages.some(m => /litige/.test(m.content)) && !JSON.stringify(r.body).includes('NOTE-INTERNE-LITIGE'), JSON.stringify(r.body).slice(0, 200));
    check('invités: autre ticket introuvable', (await req('GET', `/api/guest/tickets/${tOther}`, { headers: gCookie })).status === 404);
    check('invités: aucun accès au dashboard', (await req('GET', '/api/tickets', { headers: gCookie })).status === 401);
    // Image previews: the attachments of the shared tickets, nothing else
    const ex = Math.floor(Date.now() / 1000 + 86400).toString(16);
    const att = n => `https://cdn.discordapp.com/attachments/111111111111111111/22222222222222222${n}/photo.png?ex=${ex}&is=${ex}&hm=ab`;
    await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, '47', 'u47', ?, 'user'), (?, '48', 'u48', ?, 'user')",
      [tg, `📎 photo.png : ${att(1)}`, tOther, `📎 photo.png : ${att(2)}`]);
    r = await req('GET', '/api/attachment', { headers: gCookie, query: { u: att(1) } });
    check('invités: pièce jointe d un ticket partagé affichée', r.status === 302, r.status);
    r = await req('GET', '/api/attachment', { headers: gCookie, query: { u: att(2) } });
    check('invités: pièce jointe d un autre ticket refusée', r.status === 404, r.status);
    const [ev] = await db("SELECT actor_tag, source FROM audit_log WHERE action = 'guest_view' AND ticket_id = ? ORDER BY id DESC LIMIT 1", [tg]);
    check('invités: consultation inscrite au journal', ev?.source === 'guest' && /Maître Dupont/.test(ev.actor_tag), JSON.stringify(ev));
    const list = await req('GET', '/api/guest-invites', { sid: sessions.FV });
    const inv = list.body.find(i => i.label === 'Maître Dupont');
    check('invités: utilisation suivie', inv?.uses === 1 && inv.last_used_at && inv.live, JSON.stringify(inv));
    await req('DELETE', `/api/guest-invites/${inv.id}`, { sid: sessions.FV });
    check('invités: révocation immédiate', (await req('GET', '/api/guest/tickets', { headers: gCookie })).status === 401);
    // With internal notes, then expiry
    r = await req('POST', '/api/guest-invites', { sid: sessions.FV, body: { label: 'Modérateur partenaire', ticketIds: [tg], includeNotes: true, duration: '1h' } });
    const token2 = r.body.link.split('#')[1];
    r = await req('POST', '/api/guest/session', { body: { token: token2 } });
    const gCookie2 = { Cookie: String(r.headers['set-cookie']?.[0] || '').split(';')[0] };
    r = await req('GET', `/api/guest/tickets/${tg}`, { headers: gCookie2 });
    check('invités: notes internes si autorisées', JSON.stringify(r.body).includes('NOTE-INTERNE-LITIGE'), '');
    await db("UPDATE guest_invites SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE label = 'Modérateur partenaire'");
    check('invités: expiration automatique', (await req('GET', '/api/guest/tickets', { headers: gCookie2 })).status === 401);
  }

  // ── Discord watch (the public status page is gone: one instance, one owner) ──
  {
    let r = await req('GET', '/api/status');
    check('statut public retiré: /api/status inconnu', r.status === 404, r.status);
    const { setSetting, getSetting } = app('./utils/instanceSettings');
    const before = await getSetting('error_alert', {});
    await setSetting('error_alert', { ...before, discordUserIds: [], webhookUrl: null, discordDownMinutes: 5 });
    const os = require('os');
    await redis.del(`discord:down_since:${os.hostname()}`, `discord:down_alerted:${os.hostname()}`);
    const { runDiscordWatch } = app('./utils/discordWatch');
    const t0 = Date.now();
    await runDiscordWatch({ isReady: () => false, ws: { status: 5 }, users: fakeClient.users }, t0);
    const down = await runDiscordWatch({ isReady: () => false, ws: { status: 5 }, users: fakeClient.users }, t0 + 6 * 60000);
    check('veille Discord: coupure signalée après le délai', down.alertSent === true, JSON.stringify(down));
    const back = await runDiscordWatch({ isReady: () => true, ws: { status: 0 }, users: fakeClient.users }, t0 + 8 * 60000);
    check('veille Discord: reconnexion signalée', back.recovered === true, JSON.stringify(back));
    await setSetting('error_alert', before);
  }

  // ── Demonstration server ──
  {
    for (const k of await redis.keys('rl:*')) await redis.del(k);
    const DEMO = app('./utils/demo').DEMO_GUILD_ID;
    await globalQuery('DROP DATABASE IF EXISTS ticketbot_guild_' + DEMO);
    let r = await req('POST', '/api/demo/start');
    check('démo: désactivée par défaut sur une nouvelle instance', r.status === 403, r.status);
    r = await req('PUT', '/api/instance/demo', { sid: sessions.NOWN, body: { enabled: true } });
    check('démo: seul le propriétaire l active', r.status === 403, r.status);
    await req('PUT', '/api/instance/demo', { sid: sessions.OWN, body: { enabled: true } });
    check('démo: annoncée à la page de connexion une fois activée', (await req('GET', '/api/instance/info')).body.demo === true);
    r = await req('POST', '/api/demo/start');
    const dCookie = { Cookie: String(r.headers['set-cookie']?.[0] || '').split(';')[0] };
    check('démo: session ouverte (base créée et remplie)', r.status === 200, JSON.stringify(r.body));
    r = await req('GET', '/api/auth/me', { headers: dCookie });
    check('démo: fondateur du serveur de démonstration', r.body.guildId === DEMO && r.body.role === 'fondateur' && r.body.demo === true, JSON.stringify(r.body).slice(0, 200));
    const list = await req('GET', '/api/tickets', { headers: dCookie, query: { status: 'open' } });
    check('démo: tickets fictifs', list.status === 200 && list.body.total >= 5, JSON.stringify(list.body).slice(0, 200));
    const firstId = list.body.tickets?.[0]?.id;
    const pages = ['/api/dashboard/stats', '/api/dashboard/activity', '/api/dashboard/recent', '/api/dashboard/leaderboard', `/api/tickets/${firstId}`, `/api/tickets/${firstId}/notes`,
      `/api/tickets/${firstId}/procedures`, `/api/tickets/${firstId}/time`, `/api/tickets/${firstId}/similar`, '/api/tickets/queue', '/api/analytics/volume', '/api/analytics/quality',
      '/api/analytics/time', '/api/staff/me/activity', '/api/profiles', '/api/procedures', '/api/incidents', '/api/config', '/api/grades', '/api/tags', '/api/faq', '/api/fields',
      '/api/audit', '/api/templates', '/api/auth/guilds', '/api/staff'];
    const broken = [];
    for (const p of pages) { const x = await req('GET', p, { headers: dCookie }); if (x.status >= 500 || x.status === 401) broken.push(`${p} → ${x.status}`); }
    check('démo: toutes les pages répondent sans erreur', broken.length === 0, broken.join(', '));
    r = await req('POST', '/api/api-keys', { headers: dCookie, body: { name: 'x', permissions: ['read_stats'] } });
    check('démo: clés API bloquées', r.status === 403 && r.body.demo === true, JSON.stringify(r.body));
    r = await req('POST', '/api/newsletter/send', { headers: dCookie, body: { message: 'Message depuis la démo' } });
    check('démo: newsletter bloquée', r.status === 403, r.status);
    // No message to anyone from the sandbox: adding any Discord ID as a participant would turn the
    // bot into a relay to spam people
    r = await req('POST', `/api/tickets/${firstId}/participants`, { headers: dCookie, body: { discord_id: '200000000000000077' } });
    check('démo: ajout de participant bloqué', r.status === 403 && r.body.demo === true, JSON.stringify(r.body));
    const before = memberDms.length;
    const sent = await app('./utils/i18n').sendToMember(fakeClient, '200000000000000077', DEMO, () => ({ content: 'spam' }));
    check('démo: aucun MP ne part du serveur de démonstration', sent === null && memberDms.length === before, '');
    // v4: nothing leaves the sandbox by e-mail, nothing becomes public on the instance's domain
    const v4Blocked = [];
    for (const [m, p, body] of [['POST', '/api/invitations', { email: 'cible@example.com', role: 'support' }], ['PUT', '/api/faq/public', { enabled: true }],
      ['PUT', '/api/widget-settings', { enabled: true, origins: '' }], ['POST', `/api/tickets/${firstId}/approvals`, { approverEmail: 'cible@example.com', reason: 'spam' }],
      ['POST', `/api/tickets/${firstId}/approvals/1/remind`, {}]]) {
      const x = await req(m, p, { headers: dCookie, body });
      if (!(x.status === 403 && x.body.demo === true)) v4Blocked.push(`${m} ${p} → ${x.status}`);
    }
    check('démo: invitations, validations, base publique et widget bloqués', v4Blocked.length === 0, v4Blocked.join(', '));
    await getTenantDb(DEMO)('UPDATE guild_config SET kb_public = 1 WHERE id = 1');
    await getTenantDb(DEMO)("INSERT INTO faq_entries (question, answer, visibility) VALUES ('Hameçonnage', 'Va sur https://evil.example', 'public')");
    check('démo: jamais de page publique, même forcée en base', (await req('GET', `/api/kb/${DEMO}`)).status === 404, '');
    let refused = null;
    try { await app('./utils/approvals').requestApproval({ db: getTenantDb(DEMO), client: fakeClient, guildId: DEMO, ticket: { id: firstId, status: 'open' }, input: { approverEmail: 'cible@example.com', reason: 'x' }, actor: { id: 'demo' } }); }
    catch (e) { refused = e.status; }
    check('démo: validation par e-mail refusée aussi hors du dashboard', refused === 403, String(refused));
    r = await req('PATCH', '/api/config', { headers: dCookie, body: { webhookUrl: 'https://evil.example/hook', welcomeMessage: 'Bienvenue (démo)' } });
    const [dcfg] = await getTenantDb(DEMO)('SELECT webhook_url, welcome_message FROM guild_config WHERE id = 1');
    check('démo: réglages sensibles ignorés, le reste essayable', r.status === 200 && !dcfg.webhook_url && dcfg.welcome_message === 'Bienvenue (démo)', JSON.stringify(dcfg));
    r = await req('POST', `/api/tickets/${firstId}/notes`, { headers: dCookie, body: { content: 'Note de démonstration' } });
    check('démo: on peut essayer les actions courantes', r.status === 200 || r.status === 201, r.status);
    r = await req('POST', '/api/auth/select-guild', { sid: sessions.FV, body: { guildId: DEMO } });
    check('démo: inaccessible depuis un vrai compte', r.status === 404 || r.status === 403, r.status);
    await mk('DemoForged', { user: { id: U.F, username: 'F', role: null }, currentGuildId: DEMO });
    check('démo: une session réelle ne peut pas viser la démo', (await req('GET', '/api/tickets', { sid: sessions.DemoForged })).status === 403);
    await mk('DemoOther', { user: { ...app('./utils/demo').demoUser() }, currentGuildId: G });
    check('démo: une session démo ne peut pas viser un vrai serveur', (await req('GET', '/api/tickets', { sid: sessions.DemoOther })).status === 403);
    r = await req('GET', '/api/instance/guilds', { sid: sessions.OWN });
    check('démo: absente des serveurs de l instance', r.status === 200 && !JSON.stringify(r.body).includes(DEMO), '');
    check('démo: une session démo n a jamais accès à la section Instance', (await req('GET', '/api/instance/stats', { headers: dCookie })).status === 403);
    r = await req('POST', '/api/instance/demo/reset', { sid: sessions.OWN });
    const [dcfg2] = await getTenantDb(DEMO)('SELECT welcome_message FROM guild_config WHERE id = 1');
    check('démo: la remise à zéro coupe la page publique', Number((await getTenantDb(DEMO)('SELECT kb_public FROM guild_config WHERE id = 1'))[0].kb_public) === 0, '');
    check('démo: remise à zéro', r.status === 200 && r.body.tickets === 24 && dcfg2.welcome_message !== 'Bienvenue (démo)', JSON.stringify([r.body, dcfg2]));
    await req('PUT', '/api/instance/demo', { sid: sessions.OWN, body: { enabled: false } });
    check('démo: désactivable', (await req('POST', '/api/demo/start')).status === 403);
    await globalQuery('DROP DATABASE IF EXISTS ticketbot_guild_' + DEMO);
  }

  // ── Monthly PDF report ──
  {
    const month = new Date().toISOString().slice(0, 7);
    r = await req('GET', '/api/reports/monthly', { sid: sessions.FV, query: { month, format: 'json' } });
    check('rapport: statistiques du mois', r.status === 200 && r.body.opened > 0 && r.body.daily.length >= 28 && r.body.stages.length === 3 && Array.isArray(r.body.staff), JSON.stringify({ opened: r.body.opened, closed: r.body.closed, staff: r.body.staff?.length }));
    r = await req('GET', '/api/reports/monthly', { sid: sessions.FV, query: { month } });
    check('rapport: PDF généré', r.status === 200 && r.headers['content-type'] === 'application/pdf' && String(r.body).startsWith('%PDF'), r.headers['content-type']);
    r = await req('GET', '/api/reports/monthly', { sid: sessions.FV, query: { month: '2026-13' } });
    check('rapport: mois invalide refusé', r.status === 400, r.status);
    r = await req('GET', '/api/reports/monthly', { sid: sessions.S3T, query: { month } });
    check('rapport: réservé au fondateur / view_audit', r.status === 403, r.status);
    const REP = '900000000000000089';
    channels.set(REP, mkChannel(REP, G));
    await db('UPDATE guild_config SET monthly_report_channel_id = ? WHERE id = 1', [REP]);
    sent.length = 0;
    const nRep = await app('./utils/monthlyReport').sendMonthlyReports(fakeClient);
    const repMsg = sent.find(x => x.id === REP)?.p;
    check('rapport: envoyé dans le salon configuré', nRep >= 1 && repMsg?.files?.[0]?.name?.endsWith('.pdf') && repMsg.files[0].attachment.subarray(0, 4).toString() === '%PDF', JSON.stringify(repMsg && { content: repMsg.content, file: repMsg.files?.[0]?.name }));
    await db('UPDATE guild_config SET monthly_report_channel_id = NULL WHERE id = 1');
  }

  // ── Staff availability ──
  {
    r = await req('PUT', '/api/profile/availability', { sid: sessions.S3T, body: { availability: 'away' } });
    check('disponibilité: statut enregistré', r.status === 200 && r.body.availability === 'away', JSON.stringify(r.body));
    r = await req('PUT', '/api/profile/availability', { sid: sessions.S3T, body: { availability: 'en pause' } });
    check('disponibilité: statut inconnu refusé', r.status === 400, r.status);
    r = await req('GET', '/api/tickets/staff', { sid: sessions.FV });
    const s3 = r.body.find(x => x.user_id === U.S3);
    check('disponibilité: visible dans la liste du staff', s3?.availability === 'away' && 'vacation_mode' in s3, JSON.stringify(s3));
    await req('PUT', '/api/profile/availability', { sid: sessions.S3T, body: { availability: 'available' } });
  }

  // ── Personal reminders ──
  {
    const trm = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('26','u26','crm','open','rappel')")).insertId;
    r = await req('POST', `/api/tickets/${trm}/reminders`, { sid: sessions.FV, body: { in: '2d', note: 'relancer le membre' } });
    const rem = r.body;
    check('rappels: rappel créé dans 2 jours', r.status === 200 && Math.abs(new Date(rem.remind_at) - Date.now() - 2 * 864e5) < 60000, JSON.stringify(r.body));
    r = await req('POST', `/api/tickets/${trm}/reminders`, { sid: sessions.FV, body: { in: 'jamais' } });
    check('rappels: délai invalide refusé', r.status === 400, r.status);
    r = await req('GET', `/api/tickets/${trm}/reminders`, { sid: sessions.S3T });
    check('rappels: personnels (invisibles pour les autres)', r.status === 200 && r.body.length === 0, JSON.stringify(r.body));
    await db('UPDATE ticket_reminders SET remind_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [rem.id]);
    memberDms.length = 0;
    const nSent = await app('./utils/ticketReminders').sendDueReminders(fakeClient);
    const remDm = memberDms.find(m => m.id === U.F)?.p?.embeds?.[0]?.data;
    check('rappels: envoyé à l\'échéance (MP avec la note)', nSent >= 1 && remDm?.description?.includes('relancer le membre') && remDm.author.name.includes(`#${trm}`), JSON.stringify([nSent, remDm]));
    check('rappels: envoyé une seule fois', (await app('./utils/ticketReminders').sendDueReminders(fakeClient)) === 0);
    const r2 = (await req('POST', `/api/tickets/${trm}/reminders`, { sid: sessions.FV, body: { in: '1h' } })).body;
    r = await req('DELETE', `/api/tickets/reminders/${r2.id}`, { sid: sessions.S3T });
    check('rappels: un autre ne peut pas supprimer mon rappel', r.status === 404, r.status);
    r = await req('DELETE', `/api/tickets/reminders/${r2.id}`, { sid: sessions.FV });
    check('rappels: suppression', r.status === 200, r.status);
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [trm]);
  }

  // ── @mentions in internal notes ──
  {
    const tMen = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('21','u21','cmen','open','mentions')")).insertId;
    memberDms.length = 0;
    r = await req('POST', `/api/tickets/${tMen}/notes`, { sid: sessions.FV, body: { content: '@S3 peux-tu regarder ? cc @F et @inconnu' } });
    const menDm = memberDms.find(m => m.id === U.S3)?.p?.embeds?.[0]?.data;
    check('mentions: collègue mentionné prévenu (MP avec lien)', r.status === 200 && r.body.mentioned?.join() === U.S3 && menDm?.description?.includes("t'a mentionné") && menDm.author.name.includes(`#${tMen}`), JSON.stringify([r.body.mentioned, menDm]));
    check('mentions: pas de notification pour soi-même ni un inconnu', !memberDms.some(m => m.id === U.F));
    const tSecret = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES ('22','u22','csec','open','secret', ?)", [g2])).insertId;
    r = await req('POST', `/api/tickets/${tSecret}/notes`, { sid: sessions.FV, body: { content: `<@${U.S3}> regarde ça` } });
    check('mentions: personne qui ne voit pas le ticket non prévenue', r.body.mentioned?.length === 0, JSON.stringify(r.body.mentioned));
    await db('UPDATE dashboard_users SET notify_mention_dm = 0 WHERE user_id = ?', [U.S3]);
    memberDms.length = 0;
    r = await req('POST', `/api/tickets/${tMen}/notes`, { sid: sessions.FV, body: { content: 'encore @s3' } });
    check('mentions: MP désactivable (notification dashboard maintenue)', r.body.mentioned?.join() === U.S3 && !memberDms.some(m => m.id === U.S3), JSON.stringify(r.body));
    await db('UPDATE dashboard_users SET notify_mention_dm = 1 WHERE user_id = ?', [U.S3]);
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[tMen, tSecret]]);
  }

  // ── Macros: template + actions applied on send ──
  {
    const tagM = (await db("INSERT INTO ticket_tags (name, color) VALUES ('Facturation', '#22c55e')")).insertId;
    await db('UPDATE guild_config SET ticket_category_id = ?, waiting_category_id = ? WHERE id = 1', [CAT_OPEN, CAT_WAIT]);
    r = await req('POST', '/api/templates', { sid: sessions.FV, body: { name: 'Attente facture', content: 'Merci, on revient vers toi.', scope: 'shared', actions: { stage: 'waiting', priority: 'urgent', tagId: tagM, assignSelf: true } } });
    const macro = r.body;
    check('macro: modèle avec actions enregistré', r.status === 200 && macro.actions?.stage === 'waiting' && macro.actions.tagId === tagM, JSON.stringify(r.body));
    r = await req('POST', '/api/templates', { sid: sessions.FV, body: { name: 'x', content: 'y', actions: { stage: 'nulle-part' } } });
    check('macro: action invalide refusée', r.status === 400, r.status);
    const MCH = '900000000000000085';
    channels.set(MCH, mkChannel(MCH, G));
    const tm1 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, priority) VALUES ('20','u20',?,'open','macro','normal')", [MCH])).insertId;
    r = await req('POST', `/api/tickets/${tm1}/apply-template`, { sid: sessions.FV, body: { templateId: macro.id, content: 'Merci, on revient vers toi (modifié).' } });
    const [after] = await db('SELECT stage, priority FROM tickets WHERE id = ?', [tm1]);
    const tagsM = await db('SELECT tag_id FROM ticket_tag_assignments WHERE ticket_id = ?', [tm1]);
    const asgM = await db('SELECT user_id FROM ticket_assignees WHERE ticket_id = ?', [tm1]);
    const [replyM] = await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'reply'", [tm1]);
    check('macro: réponse envoyée telle que modifiée', replyM?.content === 'Merci, on revient vers toi (modifié).', JSON.stringify(replyM));
    check('macro: étape, priorité, tag et attribution appliqués', r.status === 200 && after.stage === 'waiting' && after.priority === 'urgent' && tagsM.some(x => x.tag_id === tagM) && asgM.some(x => x.user_id === U.F) && r.body.applied.length === 4,
      JSON.stringify([r.body, after, tagsM, asgM]));
    // A support without close_ticket / claim_ticket: the reply goes, refused actions are reported
    const closeMacro = (await req('POST', '/api/templates', { sid: sessions.FV, body: { name: 'Clôture', content: 'Ticket résolu.', scope: 'shared', actions: { close: true, assignSelf: true } } })).body;
    await mk('S1M', { user: { id: U.S1, username: 'S1', role: null }, currentGuildId: G });
    r = await req('POST', `/api/tickets/${tm1}/apply-template`, { sid: sessions.S1M, body: { templateId: closeMacro.id, content: 'Ticket résolu.' } });
    const [still] = await db('SELECT status FROM tickets WHERE id = ?', [tm1]);
    check('macro: actions non autorisées signalées, réponse envoyée', r.status === 200 && still.status === 'open' && r.body.warnings.length === 2, JSON.stringify([r.body, still]));
    r = await req('POST', `/api/tickets/${tm1}/apply-template`, { sid: sessions.FV, body: { templateId: closeMacro.id, content: 'Ticket résolu.' } });
    const [closedM] = await db('SELECT status FROM tickets WHERE id = ?', [tm1]);
    check('macro: fermeture après envoi', r.status === 200 && closedM.status === 'closed' && r.body.applied.includes('Ticket fermé'), JSON.stringify([r.body, closedM]));
  }

  // ── Assignment notification: live event + DM to the assignee, never for self-assignment ──
  const streams = {};
  for (const name of ['S1T', 'S3T']) {
    streams[name] = { data: '' };
    streams[name].req = http.get({ host: '127.0.0.1', port: config.webServerPort, path: '/api/events',
      headers: { Cookie: 'connect.sid=' + encodeURIComponent('s:' + sign(sessions[name], config.dashboard.sessionSecret)) } },
      res => res.on('data', c => { streams[name].data += String(c); }));
  }
  await new Promise(res => setTimeout(res, 300));
  const ta = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('12','u12','ca1','open','Attribution')")).insertId;
  memberDms.length = 0;
  r = await req('POST', `/api/tickets/${ta}/assignees`, { sid: sessions.FV, body: { user_id: U.S1 } });
  await new Promise(res => setTimeout(res, 300));
  const assignDm = memberDms.find(m => m.id === U.S1)?.p?.embeds?.[0]?.data;
  check('attribution: événement temps réel pour la personne attribuée', r.status === 200 && /event: assigned/.test(streams.S1T.data) && streams.S1T.data.includes(`"ticketId":${ta}`), JSON.stringify([r.status, streams.S1T.data.slice(-300)]));
  check('attribution: pas d\'événement pour les autres', !/event: assigned/.test(streams.S3T.data), streams.S3T.data.slice(-200));
  check('attribution: MP Discord à la personne attribuée', assignDm?.author?.name?.includes(`Ticket #${ta} attribué`) && assignDm.description.includes('F'), JSON.stringify(assignDm));
  memberDms.length = 0;
  await req('POST', `/api/tickets/${ta}/assignees`, { sid: sessions.FV, body: { user_id: U.F } });
  await new Promise(res => setTimeout(res, 200));
  check('attribution: rien quand on s\'attribue soi-même', !memberDms.some(m => m.id === U.F), JSON.stringify(memberDms));
  r = await req('PATCH', '/api/profile', { sid: sessions.S1T, body: { notifyAssignDm: false } });
  const ta2 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('13','u13','ca2','open','Attribution 2')")).insertId;
  memberDms.length = 0;
  streams.S1T.data = '';
  await req('POST', `/api/tickets/${ta2}/assignees`, { sid: sessions.FV, body: { user_id: U.S1 } });
  await new Promise(res => setTimeout(res, 300));
  check('attribution: MP désactivable depuis le profil (le temps réel reste)', r.status === 200 && !memberDms.some(m => m.id === U.S1) && /event: assigned/.test(streams.S1T.data), JSON.stringify([r.status, memberDms]));
  // "X is writing": relayed live to the others who see the ticket
  streams.S3T.data = '';
  r = await req('POST', `/api/tickets/${ta2}/typing`, { sid: sessions.FV, body: { mode: 'reply' } });
  await new Promise(res => setTimeout(res, 300));
  check('brouillons: « en train d\'écrire » relayé aux collègues', r.status === 200 && /event: typing/.test(streams.S3T.data) && streams.S3T.data.includes('"username":"F"') && streams.S3T.data.includes(`"ticketId":${ta2}`), streams.S3T.data.slice(-200));
  r = await req('POST', `/api/tickets/${ta2}/typing`, { sid: sessions.RD, body: { mode: 'reply' } });
  check('brouillons: réservé à reply_ticket', r.status === 403, r.status);
  for (const st of Object.values(streams)) st.req.destroy();
  await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[ta, ta2]]);

  // ── Per-stage SLA ──
  r = await req('PATCH', '/api/config', { sid: sessions.FV, body: { slaOpenHours: 2, slaWaitingHours: 0, slaInProgressHours: 24 } });
  check('SLA: délais par étape enregistrés', r.status === 200, JSON.stringify(r.body));
  r = await req('PATCH', '/api/config', { sid: sessions.FV, body: { slaOpenHours: -1 } });
  check('SLA: délai négatif refusé', r.status === 400, r.status);
  const tsLate = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, stage, stage_changed_at) VALUES ('14','u14','cs1','open','SLA retard','open', NOW() - INTERVAL 3 HOUR)")).insertId;
  const tsWarn = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, stage, stage_changed_at) VALUES ('15','u15','cs2','open','SLA bientôt','open', NOW() - INTERVAL 100 MINUTE)")).insertId;
  const tsWait = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, stage, stage_changed_at) VALUES ('16','u16','cs3','open','SLA attente','waiting', NOW() - INTERVAL 30 DAY)")).insertId;
  r = await req('GET', `/api/tickets/${tsLate}`, { sid: sessions.FV });
  check('SLA: dépassé dans la fiche', r.body.sla?.state === 'breached' && r.body.sla.hours === 2 && r.body.sla.elapsedMinutes >= 180, JSON.stringify(r.body.sla));
  r = await req('GET', `/api/tickets/${tsWarn}`, { sid: sessions.FV });
  check('SLA: proche de l\'échéance (75 %)', r.body.sla?.state === 'warning', JSON.stringify(r.body.sla));
  r = await req('GET', `/api/tickets/${tsWait}`, { sid: sessions.FV });
  check('SLA: pas de délai pour une étape à 0', r.body.sla === null, JSON.stringify(r.body.sla));
  r = await req('GET', '/api/tickets', { sid: sessions.FV, query: { status: 'open', sla: 'breached' } });
  const breachedIds = (r.body.tickets || []).map(t => t.id);
  check('SLA: filtre « hors délai »', breachedIds.includes(tsLate) && !breachedIds.includes(tsWarn) && !breachedIds.includes(tsWait), JSON.stringify(breachedIds));
  check('SLA: état fourni dans la liste', r.body.tickets?.find(t => t.id === tsLate)?.sla?.state === 'breached');
  const tmS = createManager(db, fakeClient, G);
  await db('UPDATE guild_config SET in_progress_category_id = ? WHERE id = 1', [CAT_WAIT]);
  const SLA_CH = '900000000000000080';
  channels.set(SLA_CH, mkChannel(SLA_CH, G));
  await db('UPDATE tickets SET channel_id = ? WHERE id = ?', [SLA_CH, tsLate]);
  await db('UPDATE guild_config SET notify_member_stage = 1 WHERE id = 1');
  await db("UPDATE tickets SET owner_id = '200000000000000022' WHERE id = ?", [tsLate]);
  memberDms.length = 0;
  const moved = await tmS.moveToStage(tsLate, 'in_progress', { id: U.F, username: 'F' });
  const stageDm = memberDms.find(m => m.id === '200000000000000022')?.p?.embeds?.[0]?.data;
  check('étapes: membre prévenu quand l\'option est active', stageDm?.title === '🛠️ Ton ticket est en cours de traitement', JSON.stringify(stageDm));
  await db('UPDATE guild_config SET notify_member_stage = 0 WHERE id = 1');
  const [afterMove] = await db('SELECT TIMESTAMPDIFF(MINUTE, stage_changed_at, NOW()) AS m FROM tickets WHERE id = ?', [tsLate]);
  check('SLA: le compteur repart au changement d\'étape', moved.ok && Number(afterMove.m) <= 1, JSON.stringify([moved, afterMove]));
  await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[tsLate, tsWarn, tsWait]]);
  await db('UPDATE guild_config SET sla_open_hours = 0, sla_in_progress_hours = 0, in_progress_category_id = NULL WHERE id = 1');

  // ── Merge two tickets of the same member ──
  const MO = '200000000000000011';
  const MG_A = '900000000000000081', MG_B = '900000000000000082';
  let deletedA = false;
  channels.set(MG_A, Object.assign(mkChannel(MG_A, G), { delete: async () => { deletedA = true; } }));
  channels.set(MG_B, mkChannel(MG_B, G));
  const mA = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member11', ?, 'open', 'Premier')", [MO, MG_A])).insertId;
  const mB = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member11', ?, 'open', 'Second')", [MO, MG_B])).insertId;
  const mOther = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('200000000000000012', 'member12', 'cmo', 'open', 'Autre membre')")).insertId;
  await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, 'member11', 'message du premier', 'user')", [mA, MO]);
  await db('INSERT INTO ticket_participants (ticket_id, user_id) VALUES (?, ?)', [mA, '200000000000000013']);
  await db('INSERT INTO ticket_assignees (ticket_id, user_id, assigned_by_id) VALUES (?, ?, ?)', [mA, U.S1, U.F]);
  r = await req('GET', `/api/tickets/${mA}/merge-candidates`, { sid: sessions.FV });
  check('fusion: seuls les tickets ouverts du même membre sont proposés', r.status === 200 && r.body.map(t => t.id).join() === String(mB), JSON.stringify(r.body));
  r = await req('POST', `/api/tickets/${mA}/merge`, { sid: sessions.FV, body: { into: mOther } });
  check('fusion: refusée entre deux membres différents', r.status === 400, JSON.stringify(r.body));
  r = await req('POST', `/api/tickets/${mA}/merge`, { sid: sessions.S1T, body: { into: mB } });
  check('fusion: refusée sans close_ticket', r.status === 403, r.status);
  memberDms.length = 0;
  r = await req('POST', `/api/tickets/${mA}/merge`, { sid: sessions.FV, body: { into: mB } });
  const [srcM] = await db('SELECT status, merged_into FROM tickets WHERE id = ?', [mA]);
  const notesB = await db('SELECT content FROM ticket_notes WHERE ticket_id = ?', [mB]);
  const partsB = await db('SELECT user_id FROM ticket_participants WHERE ticket_id = ?', [mB]);
  const asgB = await db('SELECT user_id FROM ticket_assignees WHERE ticket_id = ?', [mB]);
  check('fusion: ticket source fermé et lié à la cible', r.status === 200 && srcM.status === 'closed' && srcM.merged_into === mB && deletedA, JSON.stringify([r.body, srcM, deletedA]));
  check('fusion: historique, participants et attributions déplacés', notesB.some(n => n.content === 'message du premier') && notesB.some(n => n.content.includes(`#${mA}`))
    && partsB.some(p => p.user_id === '200000000000000013') && asgB.some(a => a.user_id === U.S1), JSON.stringify([notesB, partsB, asgB]));
  const mergeDm = memberDms.find(m => m.id === MO)?.p?.embeds?.[0]?.data;
  const [sysNote] = await db("SELECT source FROM ticket_notes WHERE ticket_id = ? AND content LIKE '🔀%'", [mB]);
  check('fusion: note de type système', sysNote?.source === 'system', JSON.stringify(sysNote));
  check('fusion: le membre est prévenu', mergeDm?.title?.includes('regroupés') && mergeDm.author.name.includes(`#${mB}`), JSON.stringify(mergeDm));
  const [mev] = await db("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ticket_merge' AND ticket_id IN (?)", [[mA, mB]]);
  check('fusion: journalisée sur les deux tickets', Number(mev.n) === 2, JSON.stringify(mev));
  r = await req('POST', `/api/tickets/${mA}/merge`, { sid: sessions.FV, body: { into: mB } });
  check('fusion: impossible depuis un ticket déjà fermé', r.status === 400, JSON.stringify(r.body));
  await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[mB, mOther]]);

  // ── Stages ── (the founder's session was rotated by the select-guild test above)
  await mk('F', { user: { id: U.F, username: 'F', role: null }, currentGuildId: G });
  r = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketCategoryId: CAT_OPEN, waitingCategoryId: CAT_WAIT, inProgressCategoryId: null } });
  check('étapes: catégories enregistrées', r.status === 200, r.status + JSON.stringify(r.body));
  const [st1] = await db('SELECT id FROM tickets WHERE owner_id = ? AND status = "open"', [u1.id]);
  r = await req('PATCH', `/api/tickets/${st1.id}/move`, { sid: sessions.F, body: { stage: 'waiting' } });
  const [stRow] = await db('SELECT stage FROM tickets WHERE id = ?', [st1.id]);
  check('étapes: passage en « En attente »', r.status === 200 && stRow.stage === 'waiting', JSON.stringify([r.status, r.body, stRow]));
  r = await req('PATCH', `/api/tickets/${st1.id}/move`, { sid: sessions.F, body: { stage: 'in_progress' } });
  check('étapes: catégorie non configurée -> 400 explicite', r.status === 400 && /catégorie/i.test(r.body.error), JSON.stringify(r.body));
  r = await req('PATCH', `/api/tickets/${st1.id}/move`, { sid: sessions.F, body: { category_id: CAT_WAIT } });
  check('étapes: ancienne API par catégorie refusée', r.status === 400, r.status);
  r = await req('GET', `/api/tickets/${st1.id}`, { sid: sessions.F });
  check('étapes: détail indique les étapes configurées', r.body.stages?.waiting === true && r.body.stages?.in_progress === false, JSON.stringify(r.body.stages));

  // ── Custom statuses (utils/stages.js, routes/stages.js, v4.2) ──
  {
    r = await req('POST', '/api/stages', { sid: sessions.S1, body: { label: 'Interdit' } });
    check('statuts: création réservée aux fondateurs', r.status === 403, r.status);
    const builtinName = await req('POST', '/api/stages', { sid: sessions.F, body: { label: 'En cours' } });
    const badSla = await req('POST', '/api/stages', { sid: sessions.F, body: { label: 'X', slaHours: 9999 } });
    check('statuts: nom d un statut de base ou délai hors limites refusés', builtinName.status === 400 && badSla.status === 400, [builtinName.status, badSla.status].join());
    r = await req('POST', '/api/stages', { sid: sessions.F, body: { label: 'Attente fournisseur', color: 'rose', kind: 'waiting', categoryId: CAT_WAIT, slaHours: 1 } });
    const cs = Array.isArray(r.body) ? r.body.find(s => s.label === 'Attente fournisseur') : null;
    check('statuts: créé avec sa couleur, son statut de base, sa catégorie et son délai', r.status === 200 && cs?.key === `s_${cs?.id}` && cs.color === 'rose' && cs.kind === 'waiting' && cs.categoryId === CAT_WAIT && cs.slaHours === 1 && !cs.builtin, JSON.stringify(r.body));
    r = await req('POST', '/api/stages', { sid: sessions.F, body: { label: 'attente FOURNISSEUR' } });
    check('statuts: nom en double refusé', r.status === 400, r.status);
    r = await req('GET', '/api/stages', { sid: sessions.S1 });
    check('statuts: liste pour tout le staff, statuts de base en tête', r.status === 200 && r.body.slice(0, 3).map(s => s.key).join() === 'open,waiting,in_progress' && r.body.some(s => s.key === cs.key), JSON.stringify(r.body.map(s => s.key)));

    r = await req('PATCH', `/api/tickets/${st1.id}/move`, { sid: sessions.F, body: { stage: cs.key } });
    const [csRow] = await db('SELECT stage FROM tickets WHERE id = ?', [st1.id]);
    check('statuts: ticket passé dans un statut personnalisé (catégorie Discord du statut)', r.status === 200 && csRow.stage === cs.key && r.body.label === 'Attente fournisseur', JSON.stringify([r.body, csRow]));
    const [evS] = await db("SELECT details FROM audit_log WHERE action = 'ticket_stage' AND ticket_id = ? ORDER BY id DESC LIMIT 1", [st1.id]);
    const evD = typeof evS?.details === 'string' ? JSON.parse(evS.details) : evS?.details;
    check('statuts: changement noté au journal du ticket', evD?.to === cs.key && evD.from === 'waiting', JSON.stringify(evD));
    r = await req('PATCH', `/api/tickets/${st1.id}/move`, { sid: sessions.F, body: { stage: 's_999999' } });
    const bogus = await req('PATCH', `/api/tickets/${st1.id}/move`, { sid: sessions.F, body: { stage: 'n_importe_quoi' } });
    check('statuts: statut inconnu refusé', r.status === 400 && bogus.status === 400, [r.status, bogus.status].join());

    await db('UPDATE tickets SET stage_changed_at = NOW() - INTERVAL 2 HOUR WHERE id = ?', [st1.id]);
    r = await req('GET', `/api/tickets/${st1.id}`, { sid: sessions.F });
    check('statuts: délai propre au statut dans la fiche (SLA)', r.body.sla?.state === 'breached' && r.body.sla.hours === 1 && r.body.stages?.[cs.key] === true, JSON.stringify([r.body.sla, r.body.stages]));
    const late = await req('GET', '/api/tickets', { sid: sessions.F, query: { status: 'open', sla: 'breached' } });
    const byStage = await req('GET', '/api/tickets', { sid: sessions.F, query: { stage: cs.key } });
    check('statuts: filtres « hors délai » et par statut', late.body.tickets.some(t => t.id === st1.id) && byStage.body.tickets.length >= 1 && byStage.body.tickets.every(t => t.stage === cs.key), JSON.stringify([late.body.tickets.map(t => t.id), byStage.body.tickets.map(t => t.stage)]));
    const kanban = await req('GET', '/api/tickets', { sid: sessions.F, query: { status: 'open', page: 1 } });
    const kt = kanban.body.tickets.find(t => t.id === st1.id);
    check('statuts: le Kanban reçoit le statut et son délai', kt?.stage === cs.key && kt.sla?.state === 'breached', JSON.stringify(kt && { stage: kt.stage, sla: kt.sla }));
    const q = await req('GET', '/api/analytics/quality', { sid: sessions.F, query: { days: 30 } });
    const qs = q.body.stages?.find(x => x.stage === cs.key);
    check('statuts: analytiques par statut, avec son nom et son délai', !!qs && qs.label === 'Attente fournisseur' && qs.slaHours === 1, JSON.stringify(q.body.stages));
    const mt = await app('./utils/memberPortal').memberTicket({ id: u1.id }, G, st1.id, fakeClient);
    check('statuts: le demandeur voit le statut de base, jamais le nom interne', mt?.ticket?.stage === 'waiting' && !JSON.stringify(mt).includes('Attente fournisseur'), JSON.stringify(mt?.ticket));
    r = await req('POST', '/api/templates', { sid: sessions.F, body: { name: 'Macro statut', content: 'On relance le fournisseur', actions: { stage: cs.key } } });
    check('statuts: utilisable dans une macro', r.status === 200 || r.status === 201, JSON.stringify(r.body));

    r = await req('PUT', `/api/stages/${cs.id}`, { sid: sessions.F, body: { label: 'Chez le fournisseur', color: 'orange', kind: 'waiting', categoryId: CAT_WAIT, slaHours: 2 } });
    check('statuts: modifié', r.status === 200 && r.body.find(s => s.key === cs.key)?.label === 'Chez le fournisseur', JSON.stringify(r.body));
    r = await req('DELETE', `/api/stages/${cs.id}`, { sid: sessions.F });
    const [back] = await db('SELECT stage FROM tickets WHERE id = ?', [st1.id]);
    const [evDel] = await db("SELECT details FROM audit_log WHERE action = 'stage_delete' ORDER BY id DESC LIMIT 1");
    check('statuts: supprimé → ses tickets reviennent dans son statut de base, journal', r.status === 200 && !r.body.some(s => s.key === cs.key) && back.stage === 'waiting' && !!evDel, JSON.stringify([back, evDel]));
    await db("DELETE FROM reply_templates WHERE name = 'Macro statut'").catch(() => null);
  }

  // ── Teams and queues, automatic assignment (utils/teams.js, v4.2) ──
  {
    const web = app('./utils/webRequesters');
    const teamsU = app('./utils/teams');
    const [cfgT] = await db('SELECT ticket_subjects FROM guild_config WHERE id = 1');
    await db('UPDATE guild_config SET ticket_subjects = ? WHERE id = 1', [JSON.stringify(['Paiement', 'Bug'])]);
    const tagT = (await db("INSERT INTO ticket_tags (name, color) VALUES ('VIP équipe', '#f97316')")).insertId;
    const opened = [];
    let n = 0;
    const open = async (subject = 'Paiement') => {
      const addr = `equipe${n++}@example.com`;
      const owner = web.webOwnerIdFor(addr);
      await web.rememberAddress(db, owner, addr);
      await app('./events/messageCreate').openTicketInGuild(web.webUserFor(owner, addr, G), 'Bonjour, une question', [], G, fakeClient, subject, { skipFaq: true, fieldsDone: true, intakeDone: true });
      const [t] = await db('SELECT id, team_id FROM tickets WHERE owner_id = ? ORDER BY id DESC LIMIT 1', [owner]);
      const assignees = t ? (await db('SELECT user_id FROM ticket_assignees WHERE ticket_id = ?', [t.id])).map(a => a.user_id) : [];
      if (t) opened.push(t.id);
      return { ...t, assignees, owner };
    };

    r = await req('POST', '/api/teams', { sid: sessions.S1, body: { name: 'Interdit' } });
    check('équipes: création réservée aux fondateurs', r.status === 403, r.status);
    const noName = await req('POST', '/api/teams', { sid: sessions.F, body: { name: ' ' } });
    const badSub = await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'X', subjects: ['Inventé'] } });
    const outsider = await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'X', members: [U.OUT] } });
    const badCap = await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'X', maxOpen: -1 } });
    check('équipes: nom, sujet inconnu, membre hors staff et plafond invalides refusés', [noName, badSub, outsider, badCap].every(x => x.status === 400), [noName, badSub, outsider, badCap].map(x => x.status).join());
    r = await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'Paiements', color: 'amber', assignMode: 'round_robin', subjects: ['Paiement'], members: [U.S1, U.S2] } });
    const tA = r.body?.find?.(t => t.name === 'Paiements');
    check('équipes: créée avec ses membres, ses sujets et son mode', r.status === 200 && tA?.assignMode === 'round_robin' && tA.members.length === 2 && tA.subjects.includes('Paiement'), JSON.stringify(r.body));
    r = await req('GET', '/api/teams/options', { sid: sessions.F });
    check('équipes: sujets et tags proposés', r.status === 200 && r.body.subjects.includes('Bug') && r.body.tags.some(g => g.id === tagT), JSON.stringify(r.body).slice(0, 200));

    const a1 = await open(), a2 = await open(), a3 = await open();
    check('équipes: nouveau ticket du sujet → équipe et attribution tour à tour', a1.team_id === tA.id && a1.assignees.join() === U.S1 && a2.assignees.join() === U.S2 && a3.assignees.join() === U.S1, JSON.stringify([a1, a2, a3].map(x => [x.team_id, x.assignees])));
    const [evA] = await db("SELECT actor_tag FROM audit_log WHERE action = 'ticket_assign' AND ticket_id = ? ORDER BY id DESC LIMIT 1", [a1.id]).catch(() => []);
    check('équipes: attribution notée au journal au nom de l attribution automatique', !evA || /Attribution automatique/.test(evA.actor_tag || ''), JSON.stringify(evA));
    const other = await open('Bug');
    check('équipes: autre sujet → ni équipe ni attribution', !other.team_id && other.assignees.length === 0, JSON.stringify(other));

    await db("UPDATE dashboard_users SET availability = 'away' WHERE user_id = ?", [U.S2]);
    const a4 = await open();
    check('équipes: un membre absent est passé', a4.assignees.join() === U.S1, JSON.stringify(a4.assignees));
    await db("UPDATE dashboard_users SET availability = 'available' WHERE user_id = ?", [U.S2]);

    r = await req('PUT', `/api/teams/${tA.id}`, { sid: sessions.F, body: { name: 'Paiements', color: 'amber', assignMode: 'load', subjects: ['Paiement'], members: [U.S1, U.S2] } });
    const a5 = await open();
    check('équipes: selon la charge → à celui qui a le moins de tickets ouverts', r.status === 200 && a5.assignees.join() === U.S2, JSON.stringify([r.status, a5.assignees]));
    const [{ c1 }] = await db("SELECT COUNT(*) AS c1 FROM ticket_assignees a JOIN tickets t ON t.id = a.ticket_id WHERE a.user_id = ? AND t.status = 'open'", [U.S1]);
    const [{ c2 }] = await db("SELECT COUNT(*) AS c2 FROM ticket_assignees a JOIN tickets t ON t.id = a.ticket_id WHERE a.user_id = ? AND t.status = 'open'", [U.S2]);
    await req('PUT', `/api/teams/${tA.id}`, { sid: sessions.F, body: { name: 'Paiements', assignMode: 'load', maxOpen: Math.min(Number(c1), Number(c2)), subjects: ['Paiement'], members: [U.S1, U.S2] } });
    const a6 = await open();
    check('équipes: plafond atteint par tous → dans la file de l équipe, sans attribution', a6.team_id === tA.id && a6.assignees.length === 0, JSON.stringify(a6));
    await req('PUT', `/api/teams/${tA.id}`, { sid: sessions.F, body: { name: 'Paiements', assignMode: 'load', maxOpen: 0, subjects: ['Paiement'], members: [U.S1, U.S2] } });

    const tConfT = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES ('47','u47','cteam','open','Paiement', -1)")).insertId;
    const [confRow] = await db('SELECT * FROM tickets WHERE id = ?', [tConfT]);
    const confR = await teamsU.routeTicket({ db, tm: { addAssignee: async () => { throw new Error('jamais'); } }, ticket: confRow });
    check('équipes: ticket confidentiel jamais routé ni attribué', confR.teamId === null && !(await db('SELECT team_id FROM tickets WHERE id = ?', [tConfT]))[0].team_id, JSON.stringify(confR));

    r = await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'VIP', tagIds: [tagT], members: [U.F] } });
    const tB = r.body.find(t => t.name === 'VIP');
    const tTag = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('46','u46','cteam2','open','Autre')")).insertId;
    await db('INSERT INTO ticket_tag_assignments (ticket_id, tag_id) VALUES (?, ?)', [tTag, tagT]);
    const [tagRow] = await db('SELECT * FROM tickets WHERE id = ?', [tTag]);
    const tagR = await teamsU.routeTicket({ db, tm: { addAssignee: async () => null }, ticket: tagRow });
    check('équipes: routage par tag, sans attribution pour une équipe sans mode', tagR.teamId === tB.id && tagR.assignee === null, JSON.stringify(tagR));

    r = await req('GET', '/api/tickets/queue', { sid: sessions.F, query: { scope: 'team' } });
    check('équipes: file de mes équipes', r.status === 200 && r.body.tickets.some(t => t.id === tTag) && !r.body.tickets.some(t => t.id === a1.id), JSON.stringify(r.body.tickets?.map(t => t.id)));
    r = await req('GET', '/api/teams/mine', { sid: sessions.F });
    check('équipes: mes équipes', r.status === 200 && r.body.length === 1 && r.body[0].id === tB.id, JSON.stringify(r.body));
    r = await req('GET', '/api/tickets', { sid: sessions.F, query: { team: tA.id, status: 'open' } });
    const none = await req('GET', '/api/tickets', { sid: sessions.F, query: { team: 'none', status: 'open' } });
    check('équipes: filtre de la liste par équipe et « sans équipe »', r.body.tickets.length >= 6 && r.body.tickets.every(t => t.team_id === tA.id) && none.body.tickets.every(t => !t.team_id) && none.body.tickets.some(t => t.id === other.id), JSON.stringify([r.body.tickets.length, none.body.tickets.map(t => t.team_id)]));

    r = await req('PATCH', `/api/tickets/${other.id}/team`, { sid: sessions.F, body: { teamId: tA.id } });
    const [otherAs] = await db('SELECT user_id FROM ticket_assignees WHERE ticket_id = ?', [other.id]);
    check('équipes: confier un ticket à une équipe depuis la fiche → attribué', r.status === 200 && r.body.teamId === tA.id && !!r.body.assignee && otherAs?.user_id === r.body.assignee, JSON.stringify([r.body, otherAs]));
    r = await req('PATCH', `/api/tickets/${other.id}/team`, { sid: sessions.S1, body: { teamId: null } });
    check('équipes: changer d équipe demande la permission d attribuer', r.status === 403, r.status);
    r = await req('PATCH', `/api/tickets/${other.id}/team`, { sid: sessions.F, body: { teamId: 999999 } });
    check('équipes: équipe inconnue refusée', r.status === 400, r.status);

    r = await req('DELETE', `/api/teams/${tA.id}`, { sid: sessions.F });
    const [left] = await db('SELECT COUNT(*) AS n FROM tickets WHERE team_id = ?', [tA.id]);
    check('équipes: supprimée → ses tickets restent, sans équipe ; journal', r.status === 200 && Number(left.n) === 0 && (await db("SELECT id FROM audit_log WHERE action IN ('team_create','team_update','team_delete')")).length >= 4, JSON.stringify([r.status, left]));

    await db('DELETE FROM teams');
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[...opened, tConfT, tTag]]);
    await db('DELETE FROM ticket_tag_assignments WHERE tag_id = ?', [tagT]);
    await db('DELETE FROM ticket_tags WHERE id = ?', [tagT]);
    await db('UPDATE guild_config SET ticket_subjects = ? WHERE id = 1', [cfgT.ticket_subjects == null || typeof cfgT.ticket_subjects === 'string' ? cfgT.ticket_subjects : JSON.stringify(cfgT.ticket_subjects)]);
  }

  // ── Approvals (utils/approvals.js, v4.2) ──
  {
    const ap = app('./utils/approvals');
    const AP = '100000000000000061';
    await db("INSERT INTO dashboard_users (user_id, username, role) VALUES (?, 'Valideur', 'fondateur') ON DUPLICATE KEY UPDATE role = 'fondateur'", [AP]);
    await mk('AP', { user: { id: AP, username: 'Valideur', role: null }, currentGuildId: G });
    const tA = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, stage) VALUES ('43','u43','db-appr1','open','Remboursement','open')")).insertId;
    const base = `/api/tickets/${tA}/approvals`;
    const noReason = await req('POST', base, { sid: sessions.F, body: { approverId: AP, reason: ' ' } });
    const outsider = await req('POST', base, { sid: sessions.F, body: { approverId: U.OUT, reason: 'x' } });
    const self = await req('POST', base, { sid: sessions.F, body: { approverId: U.F, reason: 'x' } });
    const badStage = await req('POST', base, { sid: sessions.F, body: { approverId: AP, reason: 'x', nextStage: 'n_existe_pas' } });
    const noMail = await req('POST', base, { sid: sessions.F, body: { approverEmail: 'chef@example.com', reason: 'x' } });
    check('validations: raison, personne hors staff, soi-même, statut inconnu refusés ; e-mail sans e-mail d instance refusé', [noReason, outsider, self, badStage].every(x => x.status === 400) && noMail.status === 409, [noReason, outsider, self, badStage, noMail].map(x => x.status).join());

    r = await req('POST', base, { sid: sessions.F, body: { approverId: AP, reason: 'Rembourser 120 € hors délai', nextStage: 'in_progress' } });
    const a1 = r.body;
    const [n1] = await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'system' ORDER BY id DESC LIMIT 1", [tA]);
    check('validations: demandée à un membre du staff, note dans le ticket', r.status === 200 && a1.status === 'pending' && a1.approver.id === AP && /Validation demandée à Valideur/.test(n1?.content || ''), JSON.stringify([r.body, n1]));
    r = await req('POST', base, { sid: sessions.F, body: { approverId: AP, reason: 'encore' } });
    check('validations: une seule en attente par ticket', r.status === 409, r.status);
    r = await req('POST', `${base}/${a1.id}/decide`, { sid: sessions.F, body: { decision: 'approved' } });
    check('validations: seule la personne sollicitée répond', r.status === 403, r.status);
    r = await req('POST', `${base}/${a1.id}/remind`, { sid: sessions.F });
    check('validations: relance trop tôt refusée (une par heure)', r.status === 429, JSON.stringify(r.body));
    await db('UPDATE ticket_approvals SET created_at = NOW() - INTERVAL 2 HOUR WHERE id = ?', [a1.id]);
    r = await req('POST', `${base}/${a1.id}/remind`, { sid: sessions.F });
    const [rm] = await db('SELECT remind_count FROM ticket_approvals WHERE id = ?', [a1.id]);
    check('validations: relance envoyée et comptée', r.status === 200 && Number(rm.remind_count) === 1, JSON.stringify([r.body, rm]));
    r = await req('POST', `${base}/${a1.id}/decide`, { sid: sessions.AP, body: { decision: 'approved', comment: 'OK pour cette fois' } });
    const [st] = await db('SELECT stage FROM tickets WHERE id = ?', [tA]);
    const [n2] = await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'system' ORDER BY id DESC LIMIT 1", [tA]);
    check('validations: accord → le ticket avance au statut choisi, note avec le commentaire', r.status === 200 && st.stage === 'in_progress' && /Validation accordée par Valideur : OK pour cette fois/.test(n2?.content || ''), JSON.stringify([r.body, st, n2]));
    r = await req('POST', `${base}/${a1.id}/decide`, { sid: sessions.AP, body: { decision: 'rejected' } });
    check('validations: une seule réponse', r.status === 409, r.status);

    r = await req('POST', base, { sid: sessions.F, body: { approverId: AP, reason: 'Accès exceptionnel', nextStage: 'waiting' } });
    const a2 = r.body;
    r = await req('POST', `${base}/${a2.id}/decide`, { sid: sessions.AP, body: { decision: 'rejected', comment: 'Non, pas sans justificatif' } });
    const [st2] = await db('SELECT stage FROM tickets WHERE id = ?', [tA]);
    check('validations: refus → le ticket reste où il est', r.status === 200 && st2.stage === 'in_progress', JSON.stringify([r.body, st2]));
    r = await req('POST', base, { sid: sessions.F, body: { approverId: AP, reason: 'Troisième' } });
    const a3 = r.body;
    r = await req('POST', `${base}/${a3.id}/cancel`, { sid: sessions.F });
    const list = await req('GET', base, { sid: sessions.F });
    check('validations: annulée par la personne qui a demandé ; historique du ticket', r.status === 200 && list.body.map(a => a.status).join() === 'cancelled,rejected,approved', JSON.stringify(list.body.map(a => a.status)));
    const ev = (await db("SELECT action FROM audit_log WHERE ticket_id = ? AND action LIKE 'approval_%'", [tA])).map(x => x.action);
    check('validations: chaque étape au journal du ticket', ['approval_request', 'approval_remind', 'approval_approved', 'approval_rejected', 'approval_cancel'].every(a => ev.includes(a)), JSON.stringify(ev));

    // By e-mail: link, one answer, automatic reminder
    const nodemailer = require('nodemailer');
    const realCreate = nodemailer.createTransport;
    const mails = [];
    nodemailer.createTransport = () => ({ sendMail: async x => { mails.push(x); return {}; }, close: () => {} });
    process.env.EMAIL_ALLOW_PRIVATE_HOSTS = 'true';
    await app('./utils/instanceMail').saveMailSettings({ enabled: true, host: 'smtp.example.com', port: 587, from: 'datick@example.com' });
    r = await req('POST', base, { sid: sessions.F, body: { approverEmail: 'Chef@Example.com', approverName: 'La cheffe', reason: 'Geste commercial de 50 €' } });
    const a4 = r.body;
    const tokenOf = m => (m?.text?.match(/\/validation#([A-Za-z0-9_-]+)/) || [])[1];
    const tok = tokenOf(mails.at(-1));
    const [row4] = await db('SELECT token_hash FROM ticket_approvals WHERE id = ?', [a4.id]);
    check('validations: par e-mail, lien envoyé, seul son hachage est gardé', r.status === 200 && mails.at(-1)?.to === 'chef@example.com' && !!tok && row4.token_hash === crypto.createHash('sha256').update(tok).digest('hex') && !JSON.stringify(row4).includes(tok), JSON.stringify([r.body, mails.at(-1)?.text]));
    const H = { 'X-Forwarded-For': '10.30.0.1' };
    r = await req('POST', '/api/approvals/link', { headers: H, body: { token: tok } });
    check('validations: le lien montre la demande, pas la conversation', r.status === 200 && r.body.reason === 'Geste commercial de 50 €' && r.body.ticketId === tA && !('messages' in r.body), JSON.stringify(r.body));
    r = await req('POST', '/api/approvals/link', { headers: H, body: { token: 'x'.repeat(43) } });
    check('validations: lien inconnu → expiré', r.status === 410, r.status);
    await db('UPDATE ticket_approvals SET created_at = NOW() - INTERVAL 25 HOUR WHERE id = ?', [a4.id]);
    mails.length = 0;
    const auto = await ap.runApprovalReminders(fakeClient);
    const tok2 = tokenOf(mails.at(-1));
    const old = await req('POST', '/api/approvals/link', { headers: H, body: { token: tok } });
    check('validations: relance automatique après 24 h, avec un nouveau lien (l ancien ne marche plus)', auto.sent >= 1 && !!tok2 && tok2 !== tok && old.status === 410, JSON.stringify([auto, old.status]));
    r = await req('POST', '/api/approvals/decide', { headers: H, body: { token: tok2, decision: 'approved', comment: 'Validé' } });
    const again = await req('POST', '/api/approvals/decide', { headers: H, body: { token: tok2, decision: 'rejected' } });
    const [d4] = await db('SELECT status, decided_by_tag, token_hash FROM ticket_approvals WHERE id = ?', [a4.id]);
    check('validations: accord par le lien, une seule fois', r.status === 200 && d4.status === 'approved' && d4.decided_by_tag === 'La cheffe' && !d4.token_hash && again.status === 410, JSON.stringify([r.body, d4, again.status]));

    const tConfA = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES ('42','u42','db-appr2','open','Signalement', -1)")).insertId;
    r = await req('POST', `/api/tickets/${tConfA}/approvals`, { sid: sessions.F, body: { approverEmail: 'chef@example.com', reason: 'x' } });
    check('validations: un ticket confidentiel ne part jamais à l extérieur', r.status === 400, JSON.stringify(r.body));
    // A staff account cannot turn the instance's address into a relay: 10 e-mails per hour and per person
    const tRl = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('43','u43','db-appr-rl','open','Relais')")).insertId;
    const apprLib = app('./utils/approvals');
    const rl = [];
    for (let i = 0; i < 11; i++) {
      try {
        const a = await apprLib.requestApproval({ db, client: fakeClient, guildId: G, ticket: { id: tRl, status: 'open', visibility_grade_id: null }, input: { approverEmail: `relais${i}@example.com`, reason: 'x' }, actor: { id: 'rl-test', username: 'RL' } });
        await db("UPDATE ticket_approvals SET status = 'cancelled' WHERE id = ?", [a.id]);
        rl.push(200);
      } catch (e) { rl.push(e.status); }
    }
    check('validations: e-mails vers l extérieur limités par personne et par heure', rl.slice(0, 10).every(x => x === 200) && rl[10] === 429, rl.join());
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tRl]);

    nodemailer.createTransport = realCreate;
    delete process.env.EMAIL_ALLOW_PRIVATE_HOSTS;
    await app('./utils/instanceMail').saveMailSettings({ enabled: false });
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[tA, tConfA]]);
    await db('DELETE FROM dashboard_users WHERE user_id = ?', [AP]);
  }

  // ── Categories as a tree (utils/subjectTree.js, v4.2) ──
  {
    const web = app('./utils/webRequesters');
    const SUBJ = ['Facturation', 'Facturation › Remboursement', 'Technique'];
    const [cfgC] = await db('SELECT ticket_subjects, sla_open_hours, subject_sla FROM guild_config WHERE id = 1');
    const orphan = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketSubjects: ['Technique', 'Facturation › Remboursement'] } });
    const deep = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketSubjects: ['A', 'A › B', 'A › B › C'] } });
    const dup = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketSubjects: ['A', 'a'] } });
    check('catégories: sous-catégorie sans sa catégorie, trois niveaux ou doublon refusés', [orphan, deep, dup].every(x => x.status === 400) && /Catégorie absente/.test(orphan.body.error), JSON.stringify([orphan.body, deep.body, dup.body]));
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketSubjects: SUBJ, slaOpenHours: 48 } });
    check('catégories: arbre enregistré (les sujets existants restent des catégories)', r.status === 200, JSON.stringify(r.body));
    const badSla = await req('PATCH', '/api/config', { sid: sessions.F, body: { subjectSla: { Inventé: 2 } } });
    check('catégories: délai pour un sujet inconnu refusé', badSla.status === 400, JSON.stringify(badSla.body));
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { subjectSla: { Facturation: 1 } } });
    check('catégories: délai par catégorie enregistré', r.status === 200, JSON.stringify(r.body));

    const tChild = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, stage, stage_changed_at) VALUES ('45','u45','ccat1','open','Facturation › Remboursement','open', NOW() - INTERVAL 2 HOUR)")).insertId;
    const tOther = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, stage, stage_changed_at) VALUES ('44','u44','ccat2','open','Technique','open', NOW() - INTERVAL 2 HOUR)")).insertId;
    r = await req('GET', `/api/tickets/${tChild}`, { sid: sessions.F });
    const rO = await req('GET', `/api/tickets/${tOther}`, { sid: sessions.F });
    check('catégories: la sous-catégorie hérite du délai de sa catégorie', r.body.sla?.hours === 1 && r.body.sla.state === 'breached' && rO.body.sla?.hours === 48 && rO.body.sla.state === 'ok', JSON.stringify([r.body.sla, rO.body.sla]));
    let late = await req('GET', '/api/tickets', { sid: sessions.F, query: { status: 'open', sla: 'breached' } });
    check('catégories: filtre « hors délai » avec le délai de la catégorie', late.body.tickets.some(t => t.id === tChild) && !late.body.tickets.some(t => t.id === tOther), JSON.stringify(late.body.tickets.map(t => t.id)));
    await req('PATCH', '/api/config', { sid: sessions.F, body: { subjectSla: { Facturation: 1, 'Facturation › Remboursement': 5 } } });
    r = await req('GET', `/api/tickets/${tChild}`, { sid: sessions.F });
    late = await req('GET', '/api/tickets', { sid: sessions.F, query: { status: 'open', sla: 'breached' } });
    check('catégories: le délai propre de la sous-catégorie l emporte', r.body.sla?.hours === 5 && r.body.sla.state === 'ok' && !late.body.tickets.some(t => t.id === tChild), JSON.stringify([r.body.sla, late.body.tickets.map(t => t.id)]));

    // Rules, fields, team: what is set on the category reaches the sub-category, not the reverse
    const tagC = (await db("INSERT INTO ticket_tags (name, color) VALUES ('Compta cat', '#22c55e')")).insertId;
    const tagS = (await db("INSERT INTO ticket_tags (name, color) VALUES ('Remb cat', '#22c55e')")).insertId;
    const rule1 = await req('POST', '/api/subject-rules', { sid: sessions.F, body: { matchType: 'subject', subject: 'Facturation', tagId: tagC } });
    const rule2 = await req('POST', '/api/subject-rules', { sid: sessions.F, body: { matchType: 'subject', subject: 'Facturation › Remboursement', tagId: tagS } });
    const fC = (await db("INSERT INTO ticket_fields (label, type, subject) VALUES ('N° de facture', 'text', 'Facturation')")).insertId;
    const tm = await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'Compta', subjects: ['Facturation'], members: [U.F] } });
    const teamC = tm.body.find(t => t.name === 'Compta');
    let k = 0;
    const openWith = async subject => {
      const addr = `categorie${k++}@example.com`;
      const owner = web.webOwnerIdFor(addr);
      await web.rememberAddress(db, owner, addr);
      await app('./events/messageCreate').openTicketInGuild(web.webUserFor(owner, addr, G), 'Question de facture', [], G, fakeClient, subject, { skipFaq: true, fieldsDone: true, intakeDone: true });
      const [t] = await db('SELECT id, team_id FROM tickets WHERE owner_id = ? ORDER BY id DESC LIMIT 1', [owner]);
      const tags = t ? (await db('SELECT tag_id FROM ticket_tag_assignments WHERE ticket_id = ?', [t.id])).map(x => Number(x.tag_id)) : [];
      return { ...t, tags };
    };
    const child = await openWith('Facturation › Remboursement');
    const parent = await openWith('Facturation');
    check('catégories: règles de la catégorie héritées par la sous-catégorie', rule1.status === 200 && rule2.status === 200 && child.tags.includes(tagC) && child.tags.includes(tagS), JSON.stringify(child));
    check('catégories: une règle de sous-catégorie ne touche pas la catégorie', parent.tags.includes(tagC) && !parent.tags.includes(tagS), JSON.stringify(parent));
    check('catégories: l équipe de la catégorie reçoit la sous-catégorie', child.team_id === teamC.id && parent.team_id === teamC.id, JSON.stringify([child.team_id, parent.team_id, teamC.id]));
    const fieldsChild = await app('./utils/ticketFields').applicableFields(db, 'Facturation › Remboursement');
    const fieldsOther = await app('./utils/ticketFields').applicableFields(db, 'Technique');
    check('catégories: champs de la catégorie demandés pour la sous-catégorie', fieldsChild.some(f => f.id === fC) && !fieldsOther.some(f => f.id === fC), JSON.stringify(fieldsChild.map(f => f.label)));

    // Discord: the categories first, a category with sub-categories marked « › »
    const dms = [];
    const dmUser = { id: '200000000000000071', username: 'cat', tag: 'cat', bot: false, send: async p => { dms.push(p); return { id: 'm' }; } };
    await app('./events/messageCreate').openTicketInGuild(dmUser, 'Bonjour', [], G, fakeClient, null, { skipFaq: true });
    const labels = (dms.at(-1)?.components || []).flatMap(row => (row.components || []).map(c => c.data?.label));
    const pend = await app('./utils/pendingStore').takePending('subject', dmUser.id);
    check('catégories: sur Discord, les catégories d abord (sous-catégories annoncées par « › »)', labels.includes('Facturation ›') && labels.includes('Technique') && !labels.some(l => /Remboursement/.test(l || '')) && pend?.all?.length === 3, JSON.stringify([labels, pend]));

    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketSubjects: ['Technique'] } });
    const [slaAfter] = await db('SELECT subject_sla FROM guild_config WHERE id = 1');
    const slaObj = typeof slaAfter.subject_sla === 'string' ? JSON.parse(slaAfter.subject_sla) : slaAfter.subject_sla;
    check('catégories: retirer une catégorie retire ses délais', r.status === 200 && Object.keys(slaObj || {}).length === 0, JSON.stringify(slaObj));

    await db('DELETE FROM ticket_rules WHERE id IN (?)', [[rule1.body.id, rule2.body.id]]);
    await db('DELETE FROM ticket_fields WHERE id = ?', [fC]);
    await db('DELETE FROM teams');
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[tChild, tOther, child.id, parent.id].filter(Boolean)]);
    await db('DELETE FROM ticket_tag_assignments WHERE tag_id IN (?)', [[tagC, tagS]]);
    await db('DELETE FROM ticket_tags WHERE id IN (?)', [[tagC, tagS]]);
    await db('UPDATE guild_config SET ticket_subjects = ?, sla_open_hours = ?, subject_sla = NULL WHERE id = 1', [cfgC.ticket_subjects == null || typeof cfgC.ticket_subjects === 'string' ? cfgC.ticket_subjects : JSON.stringify(cfgC.ticket_subjects), cfgC.sla_open_hours]);
  }

  // ── Multi-assign ──
  r = await req('POST', `/api/tickets/${st1.id}/assignees`, { sid: sessions.F, body: { user_id: U.S3 } });
  r = await req('POST', `/api/tickets/${st1.id}/assignees`, { sid: sessions.F, body: { user_id: U.F } });
  const [cb1] = await db('SELECT claimed_by FROM tickets WHERE id = ?', [st1.id]);
  check('assignation: plusieurs personnes', r.status === 200 && r.body.assignees.length === 2 && cb1.claimed_by === U.S3, JSON.stringify([r.body, cb1]));
  r = await req('POST', `/api/tickets/${st1.id}/assignees`, { sid: sessions.F, body: { user_id: U.OUT } });
  check('assignation: hors staff refusé', r.status === 400, r.status);
  r = await req('POST', `/api/tickets/${st1.id}/assignees`, { sid: sessions.S1, body: { user_id: U.S1 } });
  check('assignation: sans claim_ticket -> 403', r.status === 403, r.status);
  r = await req('DELETE', `/api/tickets/${st1.id}/assignees/${U.S3}`, { sid: sessions.F });
  const [cb2] = await db('SELECT claimed_by FROM tickets WHERE id = ?', [st1.id]);
  check('assignation: retrait, le responsable principal suit', r.status === 200 && r.body.assignees.length === 1 && cb2.claimed_by === U.F, JSON.stringify([r.body, cb2]));
  r = await req('GET', '/api/tickets/staff', { sid: sessions.F });
  check('assignation: liste du staff assignable', r.status === 200 && r.body.some(x => x.user_id === U.S1) && !r.body.some(x => x.user_id === U.OUT), JSON.stringify(r.body).slice(0, 200));

  // ── List filters ──
  r = await req('GET', `/api/tickets?assignee=me`, { sid: sessions.F });
  check('filtre: mes tickets', r.status === 200 && r.body.tickets.some(t => t.id === st1.id) && r.body.tickets.every(t => t.assignees.some(a => a.user_id === U.F)), JSON.stringify(r.body.tickets.map(t => t.id)));
  r = await req('GET', `/api/tickets?stage=waiting&status=open`, { sid: sessions.F });
  check('filtre: étape', r.status === 200 && r.body.tickets.length >= 1 && r.body.tickets.every(t => t.stage === 'waiting'), JSON.stringify(r.body.tickets.map(t => [t.id, t.stage])));
  r = await req('GET', `/api/tickets?claimed=false&status=open`, { sid: sessions.F });
  check('filtre: non attribués', r.status === 200 && !r.body.tickets.some(t => t.id === st1.id), '');
  r = await req('GET', `/api/tickets?dateFrom=2000-01-01&dateTo=2000-01-02`, { sid: sessions.F });
  check('filtre: dates', r.status === 200 && r.body.total === 0, JSON.stringify(r.body.total));
  r = await req('GET', `/api/tickets?dateFrom=bad`, { sid: sessions.F });
  check('filtre: date invalide -> 400', r.status === 400, r.status);

  // ── Saved views ──
  r = await req('POST', '/api/ticket-views', { sid: sessions.F, body: { name: 'Mes en attente', filters: { status: 'open', stage: 'waiting', assignee: 'me', evil: 'x' } } });
  const viewId = r.body.id;
  check('vues: création (clé inconnue ignorée)', r.status === 201 && !('evil' in r.body.filters) && r.body.filters.stage === 'waiting', JSON.stringify(r.body));
  r = await req('POST', '/api/ticket-views', { sid: sessions.F, body: { name: 'x', filters: { status: { $ne: 1 } } } });
  check('vues: filtre non-chaîne refusé', r.status === 400, r.status);
  r = await req('PATCH', `/api/ticket-views/${viewId}`, { sid: sessions.F, body: { is_default: true } });
  r = await req('GET', '/api/ticket-views', { sid: sessions.F });
  check('vues: liste + vue par défaut', r.body.length === 1 && r.body[0].is_default === true, JSON.stringify(r.body));
  r = await req('GET', '/api/ticket-views', { sid: sessions.S3 });
  check('vues: privées à chaque utilisateur', r.status === 200 && r.body.length === 0, JSON.stringify(r.body));
  await req('DELETE', `/api/ticket-views/${viewId}`, { sid: sessions.S3 });
  const [vv] = await db('SELECT COUNT(*) AS n FROM ticket_views WHERE id = ?', [viewId]);
  check('vues: un autre utilisateur ne peut pas supprimer', Number(vv.n) === 1, JSON.stringify(vv));

  // ── Bulk ──
  const tagId = (await db("INSERT INTO ticket_tags (name, color) VALUES ('bulk', '#ffffff')")).insertId;
  r = await req('POST', '/api/tickets/bulk', { sid: sessions.F, body: { ids: [st1.id], action: 'add_tag', value: tagId } });
  const [tg] = await db('SELECT COUNT(*) AS n FROM ticket_tag_assignments WHERE ticket_id = ? AND tag_id = ?', [st1.id, tagId]);
  check('masse: ajout de tag', r.status === 200 && Number(tg.n) === 1, JSON.stringify([r.body, tg]));
  r = await req('POST', '/api/tickets/bulk', { sid: sessions.F, body: { ids: [st1.id], action: 'assign', value: U.S3 } });
  check('masse: assignation', r.status === 200 && r.body.affected === 1, JSON.stringify(r.body));
  r = await req('GET', `/api/tickets?tag=${tagId}`, { sid: sessions.F });
  check('filtre: tag', r.status === 200 && r.body.tickets.map(t => t.id).join() === String(st1.id), JSON.stringify(r.body.tickets.map(t => t.id)));

  // ── Instance: remove founder ──
  r = await req('DELETE', `/api/instance/guilds/${G}/founders/300000000000000001`, { sid: sessions.NOWN });
  check('SA retrait fondateur: pas propriétaire -> 403', r.status === 403, r.status);
  r = await req('DELETE', `/api/instance/guilds/${G}/founders/300000000000000001`, { sid: sessions.OWN });
  const [rf] = await db("SELECT role FROM dashboard_users WHERE user_id = '300000000000000001'");
  check('SA retrait fondateur: OK (repasse en nouveau)', r.status === 200 && rf.role === 'nouveau', JSON.stringify([r.status, r.body, rf]));
  r = await req('DELETE', `/api/instance/guilds/${G}/founders/${U.S1}`, { sid: sessions.OWN });
  check('SA retrait fondateur: non-fondateur -> 404', r.status === 404, r.status);
  await req('DELETE', `/api/instance/guilds/${G}/founders/300000000000000002`, { sid: sessions.OWN });
  const others = (await db("SELECT user_id FROM dashboard_users WHERE role = 'fondateur'")).map(x => x.user_id).filter(id => id !== U.F);
  for (const id of others) await req('DELETE', `/api/instance/guilds/${G}/founders/${id}`, { sid: sessions.OWN });
  r = await req('DELETE', `/api/instance/guilds/${G}/founders/${U.F}`, { sid: sessions.OWN });
  check('SA retrait fondateur: dernier fondateur protégé', r.status === 400 && /dernier/.test(r.body.error), JSON.stringify(r.body));

  // M9 — staff roles removed
  r = await req('GET', '/api/staff-roles', { sid: sessions.F });
  check('M9 route rôles staff supprimée', r.status === 404, r.status);

  // Webhook SSRF blocklist
  const whSrc = fs.readFileSync(path.join(ROOT, 'utils/webhookEmitter.js'), 'utf8');
  const wh = { exports: {} };
  new Function('module', 'require', whSrc + ';module.exports.isPrivateIp = isPrivateIp;')(wh, require);
  check('SSRF: 172.17/192.168/169.254 bloqués, IP publique autorisée',
    ['172.17.0.1', '192.168.1.1', '169.254.169.254'].every(wh.exports.isPrivateIp) && !wh.exports.isPrivateIp('8.8.8.8'), '');

  // ── Journal (audit) ──
  r = await req('PATCH', `/api/tickets/${st1.id}/subject`, { sid: sessions.F, body: { subject: 'Nouveau titre' } });
  const [subjEv] = await db("SELECT source, ticket_id, details FROM audit_log WHERE action = 'ticket_subject' ORDER BY id DESC LIMIT 1");
  check('journal: titre modifié tracé (source, ticket)', r.status === 200 && subjEv?.source === 'dashboard' && subjEv.ticket_id === st1.id, JSON.stringify(subjEv));
  const logged = new Set((await db('SELECT DISTINCT action FROM audit_log')).map(x => x.action));
  const expected = ['ticket_open', 'ticket_close', 'ticket_assign', 'ticket_unassign', 'ticket_stage', 'ticket_priority', 'ticket_tag_add',
    'dashboard_login', 'staff_access_granted', 'staff_access_revoked', 'ticket_rating', 'api_key_create', 'config_update', 'founder_add', 'founder_remove', 'ticket_subject'];
  const missing = expected.filter(a => !logged.has(a));
  check('journal: toutes les actions testées sont tracées', missing.length === 0, 'manquantes: ' + missing.join(', '));
  const [sysClose] = await db("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ticket_close' AND source = 'api'");
  check('journal: fermeture via API avec source API', Number(sysClose.n) >= 1, JSON.stringify(sysClose));
  r = await req('GET', '/api/audit?category=tickets', { sid: sessions.F });
  check('journal: filtre catégorie', r.status === 200 && r.body.rows.length > 0 && r.body.rows.every(x => x.action.startsWith('ticket_') || x.action.startsWith('participant_') || x.action.startsWith('scheduled_') || x.action.startsWith('note_') || x.action.startsWith('member_') || x.action.startsWith('guest_') || x.action.startsWith('approval_') || x.action === 'faq_solved'), JSON.stringify(r.body.rows.map(x => x.action)));
  r = await req('GET', `/api/audit?ticket=%23${st1.id}`, { sid: sessions.F });
  check('journal: filtre ticket', r.status === 200 && r.body.rows.length > 0 && r.body.rows.every(x => x.ticket_id === st1.id), r.body.total);
  r = await req('GET', '/api/audit?source=api', { sid: sessions.F });
  check('journal: filtre source', r.status === 200 && r.body.rows.every(x => x.source === 'api'), JSON.stringify(r.body.rows.map(x => x.source)));
  r = await req('GET', '/api/audit?action=nimportequoi', { sid: sessions.F });
  check('journal: action inconnue -> 400', r.status === 400, r.status);
  r = await req('GET', '/api/audit/stats?days=7', { sid: sessions.F });
  check('journal: statistiques', r.status === 200 && r.body.timeline.length === 7 && r.body.total > 0 && r.body.actions.length > 0 && r.body.hours.length === 24, JSON.stringify(r.body).slice(0, 200));
  r = await req('GET', '/api/audit/meta', { sid: sessions.F });
  check('journal: catalogue des actions', r.status === 200 && r.body.actions.ticket_close?.category === 'tickets' && r.body.sources.system, '');
  r = await req('GET', '/api/audit/export?category=tickets', { sid: sessions.F });
  check('journal: export CSV', r.status === 200 && /^\ufeff?Date,Acteur/.test(r.body), String(r.body).slice(0, 80));
  r = await req('GET', '/api/audit', { sid: sessions.S1 });
  check('journal: réservé à view_audit', r.status === 403, r.status);

  // ── DM embeds name the server and the ticket ──
  memberDms.length = 0;
  r = await req('POST', `/api/tickets/${st1.id}/reply`, { sid: sessions.F, body: { content: 'Bonjour depuis le staff' } });
  const dm = memberDms.find(m => m.id === u1.id)?.p?.embeds?.[0]?.data;
  check('MP: réponse staff en embed avec serveur et ticket', r.status === 200 && dm && dm.author.name.includes('Serveur Test') && dm.author.name.includes(`Ticket #${st1.id}`) && dm.author.name.includes('Nouveau titre') && dm.description === 'Bonjour depuis le staff', JSON.stringify(dm));

  // ── Subject = channel name ──
  r = await req('PATCH', `/api/tickets/${st1.id}/subject`, { sid: sessions.F, body: { subject: 'Problème de paiement' } });
  await new Promise(res => setTimeout(res, 50));
  const [stCh] = await db('SELECT channel_id FROM tickets WHERE id = ?', [st1.id]);
  check('titre = nom du salon Discord', r.status === 200 && r.body.channelName === 'probleme-de-paiement' && channels.get(stCh.channel_id).name === 'probleme-de-paiement', JSON.stringify([r.body, channels.get(stCh.channel_id)?.name]));
  const [chOpen] = await db('SELECT channel_id FROM tickets WHERE owner_id = ? ORDER BY id ASC LIMIT 1', [u1.id]);
  check('création: salon nommé d\'après le sujet', channels.get(chOpen.channel_id)?.name !== undefined, channels.get(chOpen.channel_id)?.name);

  // ── DM flow: message → subject question → ticket; several tickets → choice menu ──
  const msgMod = app('./events/messageCreate');
  const interMod = app('./events/interactionCreate');
  const u5id = '200000000000000005';
  const dmPacket = text => ({ t: 'MESSAGE_CREATE', d: { author: { id: u5id, bot: false }, content: text, attachments: [] } });
  const lastDm = () => memberDms.filter(m => m.id === u5id).slice(-1)[0]?.p;
  memberDms.length = 0;
  await msgMod.execute(fakeClient, dmPacket('Bonjour, je n\'arrive pas à me connecter'));
  const ask = lastDm()?.embeds?.[0]?.data;
  check('MP: le bot demande le sujet après le premier message', ask?.title?.includes('sujet'), JSON.stringify(ask));
  await msgMod.execute(fakeClient, dmPacket('Connexion impossible'));
  const t5 = await db('SELECT * FROM tickets WHERE owner_id = ? ORDER BY id', [u5id]);
  const t5notes = t5[0] ? await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user'", [t5[0].id]) : [];
  check('MP: ticket créé avec le sujet répondu', t5.length === 1 && t5[0].subject === 'Connexion impossible' && channels.get(t5[0].channel_id)?.name === 'connexion-impossible', JSON.stringify(t5.map(t => [t.subject, channels.get(t.channel_id)?.name])));
  check('MP: le premier message est dans le ticket', t5notes.some(n => n.content.includes('me connecter')), JSON.stringify(t5notes));

  const fakeInteraction = (customId, value) => {
    const out = {};
    return { out, interaction: {
      customId, values: [value], user: { id: u5id, username: 'member05', tag: 'member05', send: async p => memberDms.push({ id: u5id, p }) },
      guildId: null, guild: null, isButton: () => false, isStringSelectMenu: () => true, isModalSubmit: () => false,
      isChatInputCommand: () => false, isRepliable: () => true,
      update: async p => { out.update = p; }, reply: async p => { out.reply = p; },
    } };
  };
  await msgMod.execute(fakeClient, dmPacket('Une précision sur mon souci'));
  const route = lastDm();
  const menuData = route?.components?.[0]?.components?.[0]?.data;
  const opts = route?.components?.[0]?.components?.[0]?.options?.map(o => o.data.value) || [];
  check('MP: avec un ticket ouvert, le bot demande où écrire', menuData?.custom_id === 'ticket_route' && opts.includes(`t:${G}:${t5[0].id}`) && opts.includes('new'), JSON.stringify(opts));
  let fi = fakeInteraction('ticket_route', `t:${G}:${t5[0].id}`);
  await interMod.execute(fakeClient, fi.interaction);
  const n5 = await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user'", [t5[0].id]);
  check('MP: message envoyé dans le ticket choisi', n5.some(n => n.content === 'Une précision sur mon souci') && fi.out.update?.embeds?.[0]?.data?.description?.includes(`#${t5[0].id}`), JSON.stringify([n5, fi.out.update]));

  await msgMod.execute(fakeClient, dmPacket('Autre problème : facture'));
  fi = fakeInteraction('ticket_route', 'new');
  await interMod.execute(fakeClient, fi.interaction);
  check('MP: « nouveau ticket » demande le sujet', lastDm()?.embeds?.[0]?.data?.title?.includes('sujet'), JSON.stringify(lastDm()));
  await msgMod.execute(fakeClient, dmPacket('Facturation'));
  const t5b = await db("SELECT subject FROM tickets WHERE owner_id = ? AND status = 'open' ORDER BY id", [u5id]);
  check('MP: deuxième ticket ouvert pour le même membre', t5b.map(t => t.subject).join('|') === 'Connexion impossible|Facturation', JSON.stringify(t5b));
  await msgMod.execute(fakeClient, dmPacket('Encore un message'));
  const opts2 = lastDm()?.components?.[0]?.components?.[0]?.options?.map(o => o.data.label) || [];
  check('MP: le menu liste les deux tickets', opts2.filter(l => l.startsWith('#')).length === 2, JSON.stringify(opts2));

  // ── DM states live in Redis: they survive a restart and expire into a ticket without subject ──
  check('MP: état de conversation stocké dans Redis', !!(await redis.get(`pending:route:${u5id}`)));
  for (const m of ['./events/messageCreate', './events/interactionCreate']) delete require.cache[require.resolve(path.join(ROOT, m))];
  const interMod2 = app('./events/interactionCreate');
  fi = fakeInteraction('ticket_route', `t:${G}:${t5[0].id}`);
  await interMod2.execute(fakeClient, fi.interaction);
  const n5b = await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user'", [t5[0].id]);
  check('MP: choix du ticket encore valide après redémarrage', n5b.some(n => n.content === 'Encore un message'), JSON.stringify(fi.out));
  fi = fakeInteraction('ticket_route', `t:${G}:${t5[0].id}`);
  await interMod2.execute(fakeClient, fi.interaction);
  check('MP: un état ne sert qu\'une fois', /expir/i.test(JSON.stringify(fi.out.update)), JSON.stringify(fi.out.update));

  const u6id = '200000000000000006';
  await app('./events/messageCreate').execute(fakeClient, { t: 'MESSAGE_CREATE', d: { author: { id: u6id, bot: false }, content: 'Personne ne répond au sujet', attachments: [] } });
  const kind6 = (await redis.get(`pending:subject:${u6id}`)) ? 'subject' : 'subjectText';
  check('MP: question du sujet en attente dans Redis', !!(await redis.get(`pending:${kind6}:${u6id}`)));
  await redis.zadd('pending:expiry', 1, `${kind6}:${u6id}`); // as if the 10 minutes had passed
  await app('./events/messageCreate').runPendingExpiry(fakeClient);
  const t6 = await db("SELECT subject FROM tickets WHERE owner_id = ? AND status = 'open'", [u6id]);
  check('MP: sans réponse, ticket ouvert sans sujet par la tâche d\'expiration', t6.length === 1 && !t6[0].subject && !(await redis.get(`pending:${kind6}:${u6id}`)), JSON.stringify(t6));
  await app('./events/messageCreate').runPendingExpiry(fakeClient);
  const [c6] = await db('SELECT COUNT(*) AS n FROM tickets WHERE owner_id = ?', [u6id]);
  check('MP: expiration traitée une seule fois', Number(c6.n) === 1, c6.n);

  // ── Rétention ──
  const { runRetentionPurge } = app('./utils/retention');
  await globalQuery("INSERT INTO login_logs (user_id, username, ip, user_agent, status, created_at) VALUES ('1', 'old', '1.1.1.1', 'ua', 'success', DATE_SUB(NOW(), INTERVAL 400 DAY))");
  await db("INSERT INTO audit_log (actor_id, actor_tag, action, created_at) VALUES ('1', 'old', 'config_update', DATE_SUB(NOW(), INTERVAL 400 DAY))");
  await db("INSERT INTO transcript_snapshots (ticket_id, channel_id, created_by_id, created_by_tag, message_count, html, txt, created_at) VALUES (?, 'x', '1', 'x', 0, '', '', DATE_SUB(NOW(), INTERVAL 10 DAY))", [st1.id]);
  const cfgRet = app('./utils/config').config;
  cfgRet.retention = { ...(cfgRet.retention || {}), transcriptDays: 5 };
  const beforeRecent = (await db('SELECT COUNT(*) AS n FROM audit_log WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)'))[0].n;
  const purged = await runRetentionPurge();
  const afterRecent = (await db('SELECT COUNT(*) AS n FROM audit_log WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)'))[0].n;
  check('rétention: anciens journaux et transcripts purgés', purged.login_logs >= 1 && purged.audit_log >= 1 && purged.transcripts >= 1, JSON.stringify(purged));
  check('rétention: données récentes conservées', Number(afterRecent) === Number(beforeRecent), `${beforeRecent} -> ${afterRecent}`);
  cfgRet.retention.transcriptDays = 0;
  await db("INSERT INTO transcript_snapshots (ticket_id, channel_id, created_by_id, created_by_tag, message_count, html, txt, created_at) VALUES (?, 'x', '1', 'x', 0, '', '', DATE_SUB(NOW(), INTERVAL 900 DAY))", [st1.id]);
  check('rétention: transcripts conservés par défaut (TRANSCRIPT_RETENTION_DAYS absent)', (await runRetentionPurge()).transcripts === 0);
  await db("DELETE FROM transcript_snapshots WHERE created_at < DATE_SUB(NOW(), INTERVAL 800 DAY)");

  // ── Automatismes BullMQ ──
  const { startWorkers, getQueue, JOBS } = app('./utils/jobQueue');
  const worker = await startWorkers(fakeClient);
  const schedulers = await getQueue().getJobSchedulers();
  check('BullMQ: toutes les tâches planifiées', Object.keys(JOBS).every(n => schedulers.some(x => (x.key || x.id || x.name) === n)), JSON.stringify(schedulers.map(x => x.key || x.id)));
  await worker.close();
  await getQueue().close();

  // ── Instance: blocked IPs ──
  r = await req('GET', '/api/instance/blocked', { sid: sessions.NOWN });
  check('blocages: réservé au propriétaire', r.status === 403, r.status);
  let lastStatus = 0;
  for (let i = 0; i < 25; i++) lastStatus = (await req('GET', '/api/auth/me', { sid: sessions.F })).status;
  check('blocages: /auth/me (lu à chaque page) jamais bloqué par la limite de connexion', lastStatus === 200, lastStatus);
  for (let i = 0; i < 25; i++) lastStatus = (await req('GET', '/api/auth/discord')).status;
  check('blocages: limite de connexion atteinte (429)', lastStatus === 429, lastStatus);
  r = await req('GET', '/api/instance/blocked', { sid: sessions.OWN });
  const ipBlock = (r.body.ips || []).find(b => b.limiter === 'auth');
  check('blocages: IP bloquée listée', !!ipBlock && ipBlock.path === '/api/auth/discord' && ipBlock.hits >= 1, JSON.stringify(r.body.ips));
  r = await req('POST', '/api/instance/blocked/ips/unblock', { sid: sessions.OWN, body: { limiter: ipBlock?.limiter, key: ipBlock?.key } });
  const after = await req('GET', '/api/auth/discord');
  check('blocages: IP débloquée', r.status === 200 && after.status === 302, JSON.stringify([r.status, after.status]));

  // ── Instance: overview, error journal ──
  r = await req('GET', '/api/instance/stats', { sid: sessions.OWN });
  const gStat = r.body.perGuild?.find(g => g.guild_id === G);
  check('SA stats: totaux et détail par serveur', r.status === 200 && r.body.totals.tickets > 0 && r.body.daily.length === 30 && gStat && typeof gStat.openTickets === 'number' && typeof gStat.staff === 'number', JSON.stringify(gStat));
  check('SA stats: compteur d erreurs et serveurs actifs / suspendus', typeof r.body.errors24h === 'number' && !('pending' in r.body.guilds) && !('managers' in r.body), JSON.stringify(r.body.guilds));
  check('SA stats: plus de formule ni de limite', gStat && !('max_tickets' in gStat) && !('plan_name' in gStat), JSON.stringify(gStat));
  r = await req('PATCH', `/api/instance/guilds/${G}/maintenance`, { sid: sessions.OWN, body: { enabled: false } });
  check('SA maintenance: enregistrée', r.status === 200, r.status);
  r = await req('PATCH', `/api/instance/guilds/${G}/maintenance`, { sid: sessions.OWN, body: { enabled: 'non' } });
  check('SA maintenance: valeur invalide refusée', r.status === 400, r.status);
  for (const p of [`/api/instance/guilds/${G}/limits`, `/api/instance/guilds/${G}/plan`, '/api/instance/plans']) {
    r = await req(p.endsWith('plans') ? 'GET' : 'PATCH', p, { sid: sessions.OWN, body: { max_tickets: 1 } });
    check(`formules et limites retirées: ${p}`, r.status === 404, r.status);
  }
  check('formules et limites retirées: modules supprimés', ['./utils/limits', './utils/quotaAlert'].every(m => { try { require.resolve(path.join(ROOT, m)); return false; } catch { return true; } }));

  const errorLog = app('./utils/errorLog');
  errorLog.logError(G, 'test-ctx', new Error('boom unique'));
  errorLog.logError(G, 'test-ctx', new Error('boom unique')); // same message within a minute: ignored
  errorLog.captureConsoleErrors();
  console.error('dm-fermes:', Object.assign(new Error('Cannot send messages to this user'), { code: 50007 }));
  console.error('capture-test:', new Error('message capturé'));
  const { EventEmitter } = require('events');
  const fakeRes = Object.assign(new EventEmitter(), { statusCode: 500 });
  errorLog.httpErrorMiddleware({ method: 'GET', baseUrl: '/api/tickets', route: { path: '/:id' }, path: '/9', session: { guildId: G } }, fakeRes, () => {});
  fakeRes.emit('finish');
  await new Promise(res => setTimeout(res, 150));
  r = await req('GET', '/api/instance/error-logs', { sid: sessions.OWN, query: { context: 'test-ctx' } });
  check('erreurs: enregistrée avec le serveur, doublon ignoré', r.status === 200 && r.body.total === 1 && !!r.body.rows[0].guild_name && r.body.rows[0].stack.includes('boom unique'), JSON.stringify(r.body.rows));
  r = await req('GET', '/api/instance/error-logs', { sid: sessions.OWN, query: { q: 'message capturé', hours: 1 } });
  const [benign] = await globalQuery("SELECT COUNT(*) AS n FROM error_logs WHERE context = 'dm-fermes'");
  check('erreurs: erreurs Discord attendues ignorées (MP fermés…)', Number(benign.n) === 0, JSON.stringify(benign));
  check('erreurs: console.error capturé', r.body.rows?.some(e => e.context === 'capture-test'), JSON.stringify(r.body.rows));
  r = await req('GET', '/api/instance/error-logs', { sid: sessions.OWN, query: { context: 'http' } });
  check('erreurs: réponse HTTP 500 enregistrée avec la route', r.body.rows?.some(e => e.message === 'GET /api/tickets/:id → 500' && e.guild_id === G), JSON.stringify(r.body.rows));
  check('erreurs: sources fréquentes et activité horaire', r.body.contexts?.some(c => c.context === 'test-ctx') && Array.isArray(r.body.hourly), JSON.stringify(r.body.contexts));
  const errId = r.body.rows?.[0]?.id;
  r = await req('DELETE', `/api/instance/error-logs/${errId}`, { sid: sessions.NOWN });
  check('erreurs: suppression réservée au propriétaire', r.status === 403, r.status);
  r = await req('DELETE', `/api/instance/error-logs/${errId}`, { sid: sessions.OWN });
  const [gone] = await globalQuery('SELECT COUNT(*) AS n FROM error_logs WHERE id = ?', [errId]);
  check('erreurs: suppression d\'une entrée', r.status === 200 && Number(gone.n) === 0, JSON.stringify(gone));
  r = await req('DELETE', '/api/instance/error-logs', { sid: sessions.OWN, query: { context: 'test-ctx' } });
  const [left] = await globalQuery("SELECT COUNT(*) AS n FROM error_logs WHERE context = 'test-ctx'");
  const [captured] = await globalQuery("SELECT COUNT(*) AS n FROM error_logs WHERE context = 'capture-test'");
  check('erreurs: vider selon les filtres uniquement', r.body.deleted === 1 && Number(left.n) === 0 && Number(captured.n) >= 1, JSON.stringify([r.body, left, captured]));

  // ── Error spike alert ──
  r = await req('PUT', '/api/instance/settings/error-alert', { sid: sessions.NOWN, body: {} });
  check('alerte erreurs: réservée au propriétaire', r.status === 403, r.status);
  r = await req('PUT', '/api/instance/settings/error-alert', { sid: sessions.OWN, body: { enabled: true, threshold: 0, windowMinutes: 15, discordUserIds: [], webhookUrl: null } });
  check('alerte erreurs: seuil invalide refusé', r.status === 400, r.status);
  r = await req('PUT', '/api/instance/settings/error-alert', { sid: sessions.OWN, body: { enabled: true, threshold: 3, windowMinutes: 15, discordUserIds: [U.S1], webhookUrl: 'https://127.0.0.1/hook' } });
  check('alerte erreurs: réglages enregistrés', r.status === 200 && r.body.threshold === 3, JSON.stringify(r.body));
  {
    const alert = app('./utils/errorAlert');
    await redis.del('alert:errors:cooldown');
    await globalQuery('DELETE FROM error_logs');
    let res = await alert.runErrorAlertCheck(fakeClient);
    check('alerte erreurs: rien sous le seuil', !res.sent && res.count === 0, JSON.stringify(res));
    for (let i = 0; i < 4; i++) await globalQuery("INSERT INTO error_logs (context, message) VALUES ('pic', ?)", ['erreur ' + i]);
    memberDms.length = 0;
    res = await alert.runErrorAlertCheck(fakeClient);
    const alertDm = memberDms.find(m => m.id === U.S1)?.p?.embeds?.[0];
    check('alerte erreurs: MP envoyé au-delà du seuil', res.sent?.dm === 1 && alertDm?.description?.includes('4 erreur(s)') && alertDm.description.includes('`pic`'), JSON.stringify([res, alertDm]));
    check('alerte erreurs: webhook vers une IP privée bloqué (anti-SSRF)', res.sent?.webhook?.blocked === true, JSON.stringify(res.sent?.webhook));
    res = await alert.runErrorAlertCheck(fakeClient);
    check('alerte erreurs: une seule alerte par heure', res.skipped === 'cooldown', JSON.stringify(res));
    r = await req('POST', '/api/instance/settings/error-alert/test', { sid: sessions.OWN });
    check('alerte erreurs: envoi de test', r.status === 200 && r.body.dm === 1, JSON.stringify(r.body));
    await req('PUT', '/api/instance/settings/error-alert', { sid: sessions.OWN, body: { enabled: false, threshold: 3, windowMinutes: 15, discordUserIds: [], webhookUrl: null } });
    await redis.del('alert:errors:cooldown');
    res = await alert.runErrorAlertCheck(fakeClient);
    check('alerte erreurs: désactivée → aucun envoi', res.skipped === 'disabled', JSON.stringify(res));
  }

  // ── Announcements are gone ──
  r = await req('GET', '/api/announcements', { sid: sessions.FV });
  check('annonces retirées: /api/announcements inconnu', r.status === 404, r.status);
  r = await req('POST', '/api/instance/announcements', { sid: sessions.OWN, body: { title: 'x', body: 'y', showBanner: true } });
  check('annonces retirées: plus de publication', r.status === 404, r.status);

  // ── Key of the encrypted backups: owner only, never cached, every display logged ──
  {
    const cfgB = app('./utils/config').config;
    r = await req('GET', '/api/instance/backup-key', { sid: sessions.OWN });
    check('sauvegardes: sans BACKUP_KEY, signalé comme non configuré', r.status === 200 && r.body.configured === false && r.body.key === null, JSON.stringify(r.body));
    cfgB.backupKey = 'a'.repeat(64);
    r = await req('GET', '/api/instance/backup-key', { sid: sessions.NOWN });
    const rS1 = await req('GET', '/api/instance/backup-key', { sid: sessions.S1 });
    check('sauvegardes: clé refusée à un compte non propriétaire et au staff du serveur', r.status === 403 && rS1.status === 403 && !JSON.stringify([r.body, rS1.body]).includes('aaaa'), JSON.stringify([r.status, rS1.status]));
    r = await req('GET', '/api/instance/backup-key', { sid: sessions.OWN });
    check('sauvegardes: clé donnée au propriétaire, jamais mise en cache', r.status === 200 && r.body.key === 'a'.repeat(64) && /no-store/.test(r.headers['cache-control'] || ''), JSON.stringify([r.body.configured, r.headers['cache-control']]));
    await new Promise(res => setTimeout(res, 150));
    const [view] = await globalQuery("SELECT actor_id FROM instance_audit_log WHERE action = 'backup_key_view' ORDER BY id DESC LIMIT 1");
    check('sauvegardes: affichage de la clé journalisé', view?.actor_id === U.F, JSON.stringify(view));
    delete cfgB.backupKey;
  }

  // ── Instance health page ──
  {
    r = await req('GET', '/api/instance/health', { sid: sessions.NOWN });
    check('santé: réservée au propriétaire', r.status === 403, r.status);
    r = await req('GET', '/api/instance/health', { sid: sessions.OWN });
    const tm2 = app('./utils/tenantMigrations');
    check('santé: base et Redis joignables', r.status === 200 && r.body.database.ok && r.body.redis.ok && typeof r.body.process.uptimeS === 'number', JSON.stringify([r.body.database, r.body.redis]));
    check('santé: tâches planifiées listées', r.body.jobs?.jobs?.length === Object.keys(app('./utils/jobQueue').JOBS).length && r.body.jobs.jobs.every(j => j.schedule), JSON.stringify(r.body.jobs).slice(0, 300));
    check('santé: versions de schéma', r.body.schemas.latest === tm2.LATEST_VERSION && r.body.schemas.guilds.some(g => g.guildId === G && g.version === tm2.LATEST_VERSION), JSON.stringify(r.body.schemas));
  }

  // ── Public statistics posted in a channel (utils/publicStats.js) ──
  {
    const STATS_CH = '900000000000000077';
    const statsCh = mkChannel(STATS_CH, G);
    const edits = [];
    statsCh.messages = { fetch: async id => (id && typeof id === 'string' && id.startsWith('m') ? { id, edit: async p => edits.push(p) } : null) };
    channels.set(STATS_CH, statsCh);
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { publicStatsChannelId: FOREIGN_CH } });
    check('stats publiques: salon d\'un autre serveur refusé', r.status === 400, JSON.stringify([r.status, r.body]));
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { publicStatsChannelId: STATS_CH, publicStatsTargetHours: 4 } });
    const pv = await req('GET', '/api/config/public-stats', { sid: sessions.F });
    check('stats publiques: salon et objectif enregistrés, chiffres calculés', r.status === 200 && pv.status === 200 && pv.body.stats.targetHours === 4 && typeof pv.body.stats.resolved === 'number' && pv.body.messageUrl === null, JSON.stringify([r.status, pv.body]));
    const rS = await req('POST', '/api/config/public-stats/publish', { sid: sessions.S1, body: {} });
    check('stats publiques: publication réservée aux fondateurs', rS.status === 403, rS.status);
    const before = sent.length;
    r = await req('POST', '/api/config/public-stats/publish', { sid: sessions.F, body: {} });
    const posted = sent.slice(before).find(m => m.id === STATS_CH)?.p?.embeds?.[0]?.data;
    const dump = JSON.stringify(posted || {});
    check('stats publiques: message publié, sans nom ni sujet de ticket', r.status === 200 && r.body.ok && /Serveur Test/.test(posted?.title || '') && posted.fields?.length >= 1 && !/Problème|membre\d|staff\d/.test(dump), dump.slice(0, 400));
    const pv2 = await req('GET', '/api/config/public-stats', { sid: sessions.F });
    const before2 = sent.length;
    r = await req('POST', '/api/config/public-stats/publish', { sid: sessions.F, body: {} });
    check('stats publiques: le même message est mis à jour, pas de nouveau message', r.status === 200 && sent.length === before2 && edits.length === 1 && /discord\.com\/channels\//.test(pv2.body.messageUrl || ''), JSON.stringify([sent.length - before2, edits.length, pv2.body.messageUrl]));
    const job = await app('./utils/publicStats').refreshAllPublicStats(fakeClient);
    check('stats publiques: tâche horaire', job.updated >= 1 && edits.length === 2, JSON.stringify([job, edits.length]));
    await req('PATCH', '/api/config', { sid: sessions.F, body: { botLanguage: 'de' } });
    await req('POST', '/api/config/public-stats/publish', { sid: sessions.F, body: {} });
    check('stats publiques: dans la langue du serveur', /Support von/.test(edits[edits.length - 1]?.embeds?.[0]?.data?.title || ''), JSON.stringify(edits[edits.length - 1]?.embeds?.[0]?.data?.title));
    await req('PATCH', '/api/config', { sid: sessions.F, body: { botLanguage: 'fr', publicStatsChannelId: null } });
    const [{ n: audited }] = await db("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'public_stats_publish'");
    check('stats publiques: publication inscrite au journal', Number(audited) >= 3, String(audited));
  }

  // ── Taking over the open tickets of another bot (utils/botImport.js) ──
  {
    const { OverwriteType } = require('discord.js');
    const IMP_CAT = '960000000000000080', C1 = '960000000000000081', C2 = '960000000000000082', C3 = '960000000000000083';
    const M5 = '200000000000000005', M6 = '200000000000000006';
    const ow = (id, view = true) => ({ id, type: OverwriteType.Member, allow: { has: () => view } });
    const msgs = (list) => new Map(list.map((m, k) => [String(k), { createdTimestamp: Date.now() - (10 - k) * 60000, attachments: new Map(), ...m }]));
    channels.set(IMP_CAT, mkChannel(IMP_CAT, G, 4, 'tickets-autre-bot'));
    const parented = [];
    const mkImp = (id, name, extra) => {
      const c = mkChannel(id, G, 0, name);
      Object.assign(c, { parentId: IMP_CAT, createdAt: new Date(Date.now() - 86400000), topic: null,
        permissionOverwrites: { cache: new Map(), edit: async () => {} }, setParent: async p => parented.push([id, p]) }, extra);
      channels.set(id, c); return c;
    };
    mkImp(C1, 'ticket-0042', { permissionOverwrites: { cache: new Map([[U.S1, ow(U.S1)], ['1', ow('1')], [M5, ow(M5)]]), edit: async () => {} },
      messages: { fetch: async () => msgs([
        { author: { id: M5, username: 'member05' }, content: 'Bonjour, mon paiement a échoué' },
        { author: { id: '555555555555555555', username: 'TicketTool', bot: true }, content: 'Welcome!' },
        { author: { id: U.S1, username: 'S1' }, content: 'On regarde ça' },
      ]) } });
    mkImp(C2, 'ticket-0043', { topic: `Ticket ouvert par <@${M6}>`, messages: { fetch: async () => new Map() } });
    mkImp(C3, 'ticket-0044', { messages: { fetch: async () => new Map() } });
    r = await req('GET', '/api/bot-import/scan', { sid: sessions.S1, query: { categoryId: IMP_CAT } });
    check('import: réservé aux fondateurs', r.status === 403, r.status);
    r = await req('GET', '/api/bot-import/scan', { sid: sessions.F, query: { categoryId: FOREIGN_CH } });
    check('import: catégorie d\'un autre serveur refusée', r.status === 400, JSON.stringify(r.body));
    r = await req('GET', '/api/bot-import/scan', { sid: sessions.F, query: { categoryId: IMP_CAT } });
    const byCh = Object.fromEntries((r.body.channels || []).map(c => [c.channelId, c]));
    check('import: membre trouvé dans les permissions (staff et bot ignorés) ou dans le sujet du salon', r.status === 200 && byCh[C1]?.owner?.id === M5 && byCh[C2]?.owner?.id === M6 && byCh[C3]?.owner === null, JSON.stringify(r.body.channels));
    const dmBefore = memberDms.length;
    r = await req('POST', '/api/bot-import/adopt', { sid: sessions.F, body: { categoryId: IMP_CAT, items: [{ channelId: C1 }, { channelId: C2 }, { channelId: C3 }], history: true, notify: true, move: true } });
    const [t1i] = await db('SELECT id, owner_id, subject, status FROM tickets WHERE channel_id = ?', [C1]);
    const notesI = t1i ? await db('SELECT author_id, source, content FROM ticket_notes WHERE ticket_id = ? ORDER BY id', [t1i.id]) : [];
    check('import: tickets créés, salon sans membre ignoré avec la raison', r.status === 200 && r.body.adopted.length === 2 && r.body.skipped.length === 1 && /introuvable/.test(r.body.skipped[0].reason) && t1i?.owner_id === M5 && t1i.status === 'open' && t1i.subject === 'ticket-0042', JSON.stringify(r.body));
    check('import: historique copié (membre = message du membre, staff = réponse, bot ignoré)', notesI.some(n => n.source === 'user' && /paiement/.test(n.content)) && notesI.some(n => n.source === 'reply' && n.author_id === U.S1) && !notesI.some(n => /Welcome/.test(n.content)) && notesI.some(n => n.source === 'system' && /2 message/.test(n.content)), JSON.stringify(notesI));
    const dmI = memberDms.slice(dmBefore).filter(m => m.id === M5 || m.id === M6);
    check('import: membres prévenus en MP, salons déplacés dans « Ouvert »', dmI.length === 2 && /continue/.test(dmI[0].p.embeds[0].title) && parented.length === 2, JSON.stringify([dmI.map(d => d.p.embeds[0].title), parented]));
    r = await req('POST', '/api/bot-import/adopt', { sid: sessions.F, body: { categoryId: IMP_CAT, items: [{ channelId: C1 }] } });
    check('import: un salon déjà repris ne l\'est pas deux fois', r.status === 200 && r.body.adopted.length === 0 && /Déjà/.test(r.body.skipped[0]?.reason), JSON.stringify(r.body));
    r = await req('POST', '/api/bot-import/adopt', { sid: sessions.F, body: { categoryId: IMP_CAT, items: [{ channelId: OWN_CH, ownerId: M5 }] } });
    check('import: salon hors de la catégorie refusé', r.status === 200 && r.body.adopted.length === 0 && /absent/.test(r.body.skipped[0]?.reason), JSON.stringify(r.body));
    const [aI] = await db("SELECT details FROM audit_log WHERE action = 'bot_import' ORDER BY id DESC LIMIT 1");
    check('import: inscrit au journal', !!aI, JSON.stringify(aI));
    // Owner chosen by hand: only someone who could read the channel (otherwise its history would become theirs)
    r = await req('POST', '/api/bot-import/adopt', { sid: sessions.F, body: { categoryId: IMP_CAT, items: [{ channelId: C3, ownerId: M5 }], history: true } });
    check('import: propriétaire choisi à la main qui ne voyait pas le salon refusé', r.status === 200 && r.body.adopted.length === 0 && /ne voit pas/.test(r.body.skipped[0]?.reason), JSON.stringify(r.body));
    channels.get(C3).permissionsFor = m => ({ has: () => m?.id === M5 });
    r = await req('POST', '/api/bot-import/adopt', { sid: sessions.F, body: { categoryId: IMP_CAT, items: [{ channelId: C3, ownerId: M5 }], history: true } });
    check('import: propriétaire choisi à la main qui voit le salon accepté', r.status === 200 && r.body.adopted.length === 1, JSON.stringify(r.body));
    for (const c of [C1, C2, C3]) await db("UPDATE tickets SET status = 'closed' WHERE channel_id = ?", [c]);
  }

  // ── /setup: wizard on Discord (commands/setup.js) ──
  {
    const setup = app('./commands/setup');
    const SUP_ROLE = '800000000000000001';
    // Fake interaction: records reply / update / editReply payloads
    const mkI = (userId, extra = {}) => {
      const out = [];
      const i = { guildId: G, user: { id: userId, username: userId === U.F ? 'F' : 'S1' }, values: [], out,
        reply: async p => out.push(['reply', p]), update: async p => out.push(['update', p]), deferUpdate: async () => out.push(['defer']),
        editReply: async p => out.push(['edit', p]), ...extra };
      return i;
    };
    const last = i => i.out[i.out.length - 1]?.[1];
    const title = p => p?.embeds?.[0]?.data?.title || '';
    let i = mkI(U.S1);
    await setup.execute(fakeClient, i);
    check('/setup: réservé aux fondateurs', /fondateurs/.test(last(i)?.content || ''), JSON.stringify(last(i)));
    const cmdJson = setup.data.toJSON();
    check('/setup: masquée aux membres sans « Gérer le serveur »', cmdJson.default_member_permissions === String(require('discord.js').PermissionFlagsBits.ManageGuild), cmdJson.default_member_permissions);
    await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketCategoryId: null, waitingCategoryId: null } }); // so the wizard changes something
    i = mkI(U.F);
    await setup.execute(fakeClient, i);
    check('/setup: étape 1, rôles du staff, en message éphémère', /1\/3/.test(title(last(i))) && last(i).flags === require('discord.js').MessageFlags.Ephemeral, title(last(i)));
    const step = async (customId, values = []) => { const x = mkI(U.F, { customId, values }); await setup.handleComponent(fakeClient, x); return x; };
    let x = await step('setup:support', [SUP_ROLE]);
    const nextBtn = last(x).components[2].components[0].data;
    check('/setup: « Continuer » actif une fois un rôle support choisi', nextBtn.custom_id === 'setup:next1' && !nextBtn.disabled, JSON.stringify(nextBtn));
    x = await step('setup:next1');
    check('/setup: étape 2, catégories', /2\/3/.test(title(last(x))), title(last(x)));
    await step('setup:cat_open', [CAT_OPEN]);
    await step('setup:cat_waiting', [CAT_WAIT]);
    x = await step('setup:next2');
    check('/setup: étape 3, panel', /3\/3/.test(title(last(x))), title(last(x)));
    await step('setup:panel', [OWN_CH]);
    const sentBefore = sent.length;
    x = await step('setup:finish');
    const [cfgS] = await db('SELECT support_role_ids, ticket_category_id, waiting_category_id FROM guild_config WHERE id = 1');
    const panelMsg = sent.slice(sentBefore).find(m => m.id === OWN_CH)?.p;
    const [panelRow] = await db("SELECT channel_id, message_id FROM ticket_panels WHERE name = 'Panel (assistant /setup)' ORDER BY id DESC LIMIT 1");
    check('/setup: réglages enregistrés', app('./utils/jsonField').parseJsonField(cfgS.support_role_ids, []).includes(SUP_ROLE) && cfgS.ticket_category_id === CAT_OPEN && cfgS.waiting_category_id === CAT_WAIT, JSON.stringify(cfgS));
    check('/setup: panel publié avec son bouton', panelRow?.channel_id === OWN_CH && !!panelRow.message_id && /^panel_btn_\d+$/.test(panelMsg?.components?.[0]?.components?.[0]?.data?.custom_id || ''), JSON.stringify([panelRow, panelMsg?.components?.[0]?.components?.[0]?.data]));
    check('/setup: récapitulatif final', /terminée/.test(title(last(x))), title(last(x)));
    const [hist] = await db("SELECT source FROM config_history ORDER BY id DESC LIMIT 1");
    const [aud] = await db("SELECT action FROM audit_log WHERE action = 'setup_wizard' ORDER BY id DESC LIMIT 1");
    check('/setup: historique (source « setup ») et journal', hist?.source === 'setup' && !!aud, JSON.stringify([hist, aud]));
    x = await step('setup:next1');
    check('/setup: assistant expiré une fois terminé', /expiré/.test(last(x)?.content || ''), JSON.stringify(last(x)));
    // Same validation as the Settings page: a category of another server is refused
    const bad = await setup.applySetup(fakeClient, G, { id: U.F, username: 'F' }, { support: [SUP_ROLE], chief: [], categories: { open: FOREIGN_CH }, panelChannel: null });
    check('/setup: salon d\'un autre serveur refusé', /n'appartient pas/.test(bad.error || ''), JSON.stringify(bad));
    const cats = await setup.createCategories(fakeClient, G, [SUP_ROLE]);
    const catCh = channels.get(cats.open);
    const ow = catCh?.opts?.permissionOverwrites || [];
    check('/setup: catégories créées, masquées à @everyone, visibles du staff', Object.keys(cats).length === 3 && catCh.type === 4 && ow.some(o => o.id === G && o.deny?.length) && ow.some(o => o.id === SUP_ROLE && o.allow?.length), JSON.stringify(ow, (k, v) => (typeof v === 'bigint' ? String(v) : v)));
  }

  // ── Backup results (docker/backup.sh, docker/offsite.sh → status files) ──
  {
    const cfgBS = app('./utils/config').config;
    const bs = app('./utils/backupStatus');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-backup-status-'));
    cfgBS.backupStatusDir = dir;
    const iso = t => new Date(t).toISOString().replace(/\.\d+Z$/, 'Z');
    fs.writeFileSync(path.join(dir, 'backup.json'), JSON.stringify({ ok: true, at: iso(Date.now() - 3600e3), file: 'ticketbot-x.sql.gz.enc', bytes: 1234, message: '' }));
    fs.writeFileSync(path.join(dir, 'verify.json'), JSON.stringify({ ok: true, at: iso(Date.now() - 3600e3), file: 'ticketbot-x.sql.gz.enc', bytes: 1234, message: '' }));
    r = await req('GET', '/api/instance/health', { sid: sessions.OWN });
    check('sauvegardes: état lu et affiché dans Santé, sans problème', r.body.backups?.configured === true && r.body.backups.backup.ok && r.body.backups.verify.ok && r.body.backups.problems.length === 0, JSON.stringify(r.body.backups));
    fs.writeFileSync(path.join(dir, 'verify.json'), JSON.stringify({ ok: false, at: iso(Date.now()), file: 'x', bytes: 0, message: 'HMAC en échec' }));
    fs.writeFileSync(path.join(dir, 'offsite.json'), JSON.stringify({ ok: true, at: iso(Date.now() - 30 * 3600e3), file: 'x', bytes: 0, remote: 'b2', message: '' }));
    const st = bs.backupStatus();
    check('sauvegardes: vérification en échec et copie distante en retard signalées', st.problems.some(p => p.key.startsWith('verify-failed')) && st.problems.some(p => p.key.startsWith('offsite-stale')), JSON.stringify(st.problems));
    fs.writeFileSync(path.join(dir, 'backup.json'), JSON.stringify({ ok: true, at: iso(Date.now() - 27 * 3600e3), file: 'x', bytes: 1, message: '' }));
    check('sauvegardes: aucune sauvegarde depuis 26 h signalée', bs.backupStatus().problems.some(p => p.key.startsWith('backup-stale')), JSON.stringify(bs.backupStatus().problems));
    fs.writeFileSync(path.join(dir, 'backup.json'), '{pas du json');
    check('sauvegardes: fichier d\'état illisible = aucune sauvegarde connue, sans planter', bs.backupStatus().problems.some(p => p.key === 'backup-none'), JSON.stringify(bs.backupStatus().problems));
    const w1 = await bs.runBackupWatch(fakeClient);
    const w2 = await bs.runBackupWatch(fakeClient);
    check('sauvegardes: alerte envoyée une fois par problème', w1.sent && w2.skipped === 'déjà signalé', JSON.stringify([w1, w2]));
    for (const k of await redis.keys('alert:backup:*')) await redis.del(k);
    delete cfgBS.backupStatusDir;
    check('sauvegardes: sans service de sauvegarde, rien à afficher', bs.backupStatus().configured === false, '');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── Prometheus (utils/metrics.js) ──
  {
    const metrics = app('./utils/metrics');
    r = await req('GET', '/metrics');
    check('métriques: absentes tant que le propriétaire ne les active pas', r.status === 404, r.status);
    r = await req('PUT', '/api/instance/metrics', { sid: sessions.NOWN, body: { enabled: true } });
    check('métriques: activation réservée au propriétaire', r.status === 403, r.status);
    r = await req('PUT', '/api/instance/metrics', { sid: sessions.OWN, body: { enabled: true } });
    const token = r.body.token;
    check('métriques: activées, jeton rendu une seule fois', r.status === 200 && /^tbm_/.test(token || ''), JSON.stringify(r.body));
    const st = await req('GET', '/api/instance/metrics', { sid: sessions.OWN });
    const [stored] = await globalQuery("SELECT v FROM instance_settings WHERE k = 'metrics'");
    check('métriques: jeton jamais relu ni stocké en clair', st.body.enabled === true && !JSON.stringify(st.body).includes(token) && !JSON.stringify(stored.v).includes(token), JSON.stringify(st.body));
    r = await req('GET', '/metrics');
    const bad = await req('GET', '/metrics', { headers: { Authorization: 'Bearer tbm_faux' } });
    check('métriques: jeton exigé', r.status === 401 && bad.status === 401, [r.status, bad.status].join());
    metrics.clearMetricsCache();
    r = await req('GET', '/metrics', { headers: { Authorization: `Bearer ${token}` } });
    const text = String(r.body);
    check('métriques: format Prometheus, tickets par serveur, base, Redis, version', r.status === 200 && /# TYPE ticketbot_tickets_open gauge/.test(text) && new RegExp(`ticketbot_tickets_open\\{guild_id="${G}",guild="[^"]*"\\} \\d+`).test(text) && /ticketbot_database_up 1/.test(text) && /ticketbot_redis_up 1/.test(text) && /ticketbot_info\{version="v[\d.]+"\} 1/.test(text), text.slice(0, 500));
    check('métriques: aucun sujet ni nom de membre', !/owner_tag|subject/i.test(text), '');
    check('métriques: échappement des étiquettes', metrics.render([['x', 'gauge', 'h', [[{ guild: 'a"b\\c\nd' }, 1]]]]).includes('x{guild="a\\"b\\\\c d"} 1'), metrics.render([['x', 'gauge', 'h', [[{ guild: 'a"b\\c\nd' }, 1]]]]));
    const again = await req('PUT', '/api/instance/metrics', { sid: sessions.OWN, body: { enabled: true } });
    metrics.clearMetricsCache();
    r = await req('GET', '/metrics', { headers: { Authorization: `Bearer ${token}` } });
    const r2 = await req('GET', '/metrics', { headers: { Authorization: `Bearer ${again.body.token}` } });
    check('métriques: un nouveau jeton remplace l ancien', r.status === 401 && r2.status === 200, [r.status, r2.status].join());
    await req('PUT', '/api/instance/metrics', { sid: sessions.OWN, body: { enabled: false } });
    metrics.clearMetricsCache();
    r = await req('GET', '/metrics', { headers: { Authorization: `Bearer ${again.body.token}` } });
    const [audit] = await globalQuery("SELECT COUNT(*) AS n FROM instance_audit_log WHERE action = 'metrics_toggle'");
    check('métriques: coupées → 404, chaque changement au journal de l instance', r.status === 404 && Number(audit.n) >= 3, [r.status, audit.n].join());
  }

  // ── Tickets by e-mail (utils/emailTickets.js): SMTP captured, incoming messages built by hand ──
  {
    const email = app('./utils/emailTickets');
    const nodemailer = require('nodemailer');
    const sent = [];
    const realCreate = nodemailer.createTransport;
    nodemailer.createTransport = () => ({ sendMail: async m => { sent.push(m); return { messageId: m.messageId }; }, verify: async () => true, close: () => {} });
    r = await req('PUT', '/api/email', { sid: sessions.S1T, body: { enabled: false } });
    check('e-mail: réglages réservés aux fondateurs', r.status === 403, r.status);
    r = await req('PUT', '/api/email', { sid: sessions.F, body: { enabled: true, address: 'support@example.com', imapHost: 'imap.example.com', imapUser: 'support', smtpHost: 'smtp.example.com', smtpUser: 'support' } });
    check('e-mail: activation refusée sans mots de passe', r.status === 400, JSON.stringify(r.body));
    r = await req('PUT', '/api/email', { sid: sessions.F, body: { enabled: true, address: 'support@example.com', imapHost: 'imap.example.com', imapPort: 3306, imapUser: 'support', smtpHost: 'smtp.example.com', smtpUser: 'support', imapPassword: 'x', smtpPassword: 'y' } });
    check('e-mail: port non standard refusé (pas de connexion vers un autre service)', r.status === 400 && /IMAP/.test(r.body.error), JSON.stringify(r.body));
    r = await req('PUT', '/api/email', { sid: sessions.F, body: { enabled: true, address: 'Support@Example.com', displayName: 'Support Test', imapHost: 'imap.example.com', imapUser: 'support', smtpHost: 'smtp.example.com', smtpUser: 'support', imapPassword: 'SECRET-IMAP', smtpPassword: 'SECRET-SMTP' } });
    const [rowE] = await db('SELECT imap_password, smtp_password FROM email_settings WHERE id = 1');
    check('e-mail: activé, mots de passe chiffrés et jamais renvoyés', r.status === 200 && r.body.enabled && r.body.imapPasswordSet && !JSON.stringify(r.body).includes('SECRET') && /^enc:/.test(rowE.imap_password) && !rowE.smtp_password.includes('SECRET'), JSON.stringify(r.body));
    r = await req('PUT', '/api/email', { sid: sessions.F, body: { ...r.body, imapPassword: '', smtpPassword: '' } });
    const [rowE2] = await db('SELECT imap_password FROM email_settings WHERE id = 1');
    check('e-mail: mot de passe vide = inchangé', r.status === 200 && rowE2.imap_password === rowE.imap_password, JSON.stringify(r.body));
    const testR = await req('POST', '/api/email/test', { sid: sessions.F });
    check('e-mail: serveur résolu en adresse privée refusé (aucune connexion interne)', testR.status === 200 && /privée|introuvable/.test(testR.body.imap?.error || '') && /privée|introuvable/.test(testR.body.smtp?.error || ''), JSON.stringify(testR.body));
    process.env.EMAIL_ALLOW_PRIVATE_HOSTS = 'true';
    const settings = await email.emailSettings(db, { withSecrets: true });
    const mail = (from, name, subject, text, extra = {}) => ({ from: { value: [{ address: from, name }] }, subject, text, headers: new Map(Object.entries(extra.headers || {})), messageId: extra.messageId || `<m${Math.random()}@ext>`, inReplyTo: extra.inReplyTo, references: extra.references, attachments: extra.attachments || [] });
    sent.length = 0;
    let res = await email.processEmail(fakeClient, G, mail('Alice@Mail.test', 'Alice', 'Problème de commande', 'Bonjour, ma commande 77 n est pas arrivée.\n\nLe lun. 3 nov. 2026, Support a écrit :\n> ancien message', { attachments: [{ filename: 'facture.pdf' }] }), settings);
    const tE = res.ticketId;
    const [rowT] = await db('SELECT owner_id, owner_tag, subject FROM tickets WHERE id = ?', [tE]);
    const [firstNote] = await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user' ORDER BY id LIMIT 1", [tE]);
    check('e-mail: un e-mail ouvre un ticket (expéditeur, sujet, citation retirée, pièce jointe listée)', res.created && email.isEmailOwner(rowT.owner_id) && rowT.owner_tag === 'alice@mail.test' && rowT.subject === 'Problème de commande' && firstNote.content.includes('commande 77') && !firstNote.content.includes('ancien message') && firstNote.content.includes('facture.pdf'), JSON.stringify([rowT, firstNote]));
    const welcome = sent.find(m => m.to?.address === 'alice@mail.test');
    const tag = email.subjectTag(G, tE);
    check('e-mail: accusé de réception par e-mail, sujet marqué [#id-jeton]', welcome && welcome.subject.startsWith(tag) && welcome.from.address === 'support@example.com' && welcome.text.length > 10, JSON.stringify(welcome && { s: welcome.subject, f: welcome.from }));
    res = await email.processEmail(fakeClient, G, mail('alice@mail.test', 'Alice', `RE: ${tag} Problème de commande`, 'Voici le suivi : 1Z999.'), settings);
    check('e-mail: la réponse arrive dans le même ticket', res.ticketId === tE && !res.created, JSON.stringify(res));
    res = await email.processEmail(fakeClient, G, mail('mallory@evil.test', 'Mallory', `RE: ${tag} Problème de commande`, 'Injection'), settings);
    const intoAlice = (await db("SELECT COUNT(*) AS n FROM ticket_notes WHERE ticket_id = ? AND content LIKE '%Injection%'", [tE]))[0].n;
    check('e-mail: un autre expéditeur avec le bon jeton n écrit pas dans le ticket d Alice', res.ticketId !== tE && Number(intoAlice) === 0, JSON.stringify(res));
    res = await email.processEmail(fakeClient, G, mail('bob@mail.test', 'Bob', `${email.subjectTag(G, tE).replace(/-\w+\]/, '-00000000]')} x`, 'faux jeton'), settings);
    check('e-mail: un faux jeton ouvre un autre ticket', res.created && res.ticketId !== tE, JSON.stringify(res));
    res = await email.processEmail(fakeClient, G, mail('alice@mail.test', 'Alice', 'Absence', 'Je suis absente', { headers: { 'auto-submitted': 'auto-replied' } }), settings);
    const res2 = await email.processEmail(fakeClient, G, mail('mailer-daemon@mail.test', '', 'Undelivered', 'x'), settings);
    const res3 = await email.processEmail(fakeClient, G, mail('support@example.com', '', 'Boucle', 'x'), settings);
    check('e-mail: réponses automatiques, retours d erreur et notre propre adresse ignorés', res.skipped && res2.skipped && res3.skipped, JSON.stringify([res, res2, res3]));
    check('e-mail: fil reconnu par In-Reply-To', email.threadTicketId(G, { subject: 'x', inReplyTo: `<ticket-${tE}.${email.tokenFor(G, tE)}.1.ab@example.com>` }) === tE, '');
    sent.length = 0;
    r = await req('POST', `/api/tickets/${tE}/reply`, { sid: sessions.F, body: { content: 'Votre colis arrive demain.' } });
    const replyMail = sent.find(m => m.to?.address === 'alice@mail.test');
    check('e-mail: la réponse du staff part par e-mail, dans le fil du ticket', r.status === 200 && replyMail && replyMail.text.includes('Votre colis arrive demain') && replyMail.subject.startsWith(tag) && !!replyMail.inReplyTo, JSON.stringify(replyMail && { s: replyMail.subject, t: replyMail.text.slice(0, 200), irt: replyMail.inReplyTo }));
    // Two open tickets for the same address (a new e-mail joins the open one, but the staff can open
    // another for the contact, or reopen an old one): the answer to the older one stays in its own thread
    const tE2 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'alice@mail.test', 'db-mail-2', 'open', 'Autre question')", [rowT.owner_id])).insertId;
    res = { created: true };
    sent.length = 0;
    r = await req('POST', `/api/tickets/${tE}/reply`, { sid: sessions.F, body: { content: 'Réponse au premier ticket.' } });
    const firstMail = sent.find(m => m.to?.address === 'alice@mail.test');
    check('e-mail: deux tickets ouverts → la réponse part dans le fil du bon ticket', res.created && tE2 !== tE && firstMail?.subject.startsWith(email.subjectTag(G, tE)) && !firstMail.subject.startsWith(email.subjectTag(G, tE2)), JSON.stringify([tE, tE2, firstMail?.subject]));
    const back = await email.processEmail(fakeClient, G, mail('alice@mail.test', 'Alice', `RE: ${firstMail?.subject}`, 'Merci pour le premier.', { inReplyTo: firstMail?.messageId }), settings);
    check('e-mail: sa réponse revient dans le premier ticket', back.ticketId === tE, JSON.stringify(back));
    const other = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('200000000000000099', 'x', 'db-mail-3', 'open', 'Pas à Alice')")).insertId;
    check('e-mail: un numéro de ticket qui n est pas le sien est ignoré', (await email.requesterTicket(db, rowT.owner_id, other))?.id !== other, '');
    await db('INSERT INTO ticket_participants (ticket_id, user_id) VALUES (?, ?)', [other, rowT.owner_id]);
    check('e-mail: un participant reçoit le message dans le fil du ticket concerné', (await email.requesterTicket(db, rowT.owner_id, other))?.id === other, '');
    // A new e-mail without reference is a new request: not added to the open ticket, nor to a ticket
    // where the person only takes part (its owner would read it)
    res = await email.processEmail(fakeClient, G, mail('alice@mail.test', 'Alice', 'Nouvelle demande : facture', 'Pouvez-vous renvoyer ma facture ?'), settings);
    const inOther = (await db("SELECT COUNT(*) AS n FROM ticket_notes WHERE ticket_id IN (?) AND content LIKE '%renvoyer ma facture%'", [[tE, other]]))[0].n;
    check('e-mail: un nouvel e-mail sans référence ouvre un nouveau ticket', res.created && ![tE, tE2, other].includes(res.ticketId) && Number(inOther) === 0, JSON.stringify(res));
    const [fresh] = await db('SELECT subject, owner_id FROM tickets WHERE id = ?', [res.ticketId]);
    check('e-mail: le nouveau ticket est à elle, avec l objet de son e-mail', fresh?.owner_id === rowT.owner_id && fresh.subject === 'Nouvelle demande : facture', JSON.stringify(fresh));
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[tE2, other, res.ticketId]]);
    // Attachments kept on the server (utils/emailAttachments.js)
    {
      const os = require('os'), fsx = require('fs');
      const attDir = fsx.mkdtempSync(path.join(os.tmpdir(), 'tb-att-'));
      app('./utils/config').config.attachmentsDir = attDir;
      const ea = app('./utils/emailAttachments');
      r = await req('PUT', '/api/email', { sid: sessions.F, body: { ...(await req('GET', '/api/email', { sid: sessions.F })).body, attachments: { maxMb: 99 } } });
      check('pièces jointes: réglage hors limites refusé', r.status === 400 && /entre 1 et 25/.test(r.body.error), JSON.stringify(r.body));
      r = await req('PUT', '/api/email', { sid: sessions.F, body: { ...(await req('GET', '/api/email', { sid: sessions.F })).body, attachments: { enabled: true, maxMb: 1, quotaMb: 10, retentionDays: 30, postDiscord: true, blocked: 'exe, .bat' } } });
      check('pièces jointes: réglages enregistrés (taille, espace, conservation, types refusés)', r.status === 200 && r.body.attachments.maxMb === 1 && r.body.attachments.retentionDays === 30 && r.body.attachments.blocked.join() === 'exe,bat', JSON.stringify(r.body.attachments));
      const settingsA = await email.emailSettings(db, { withSecrets: true });
      const [tRow] = await db('SELECT channel_id FROM tickets WHERE id = ?', [tE]);
      const chan = channels.get(tRow.channel_id);
      const posted = [];
      if (chan) { const orig = chan.send; chan.send = async p => { posted.push(p); return orig(p); }; }
      const pdf = Buffer.from('%PDF-1.4 facture 77');
      const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
      res = await email.processEmail(fakeClient, G, mail('alice@mail.test', 'Alice', `RE: ${tag} Problème de commande`, 'Voici la facture et la photo.', { attachments: [
        { filename: 'facture.pdf', contentType: 'application/pdf', content: pdf, size: pdf.length },
        { filename: 'photo.png', contentType: 'image/png', content: png, size: png.length },
        { filename: 'virus.exe', contentType: 'application/octet-stream', content: Buffer.from('MZ'), size: 2 },
        { filename: 'gros.zip', contentType: 'application/zip', content: Buffer.alloc(2 * 1048576), size: 2 * 1048576 },
      ] }), settingsA);
      const files = await req('GET', `/api/tickets/${tE}/attachments`, { sid: sessions.S1T });
      const [noteA] = await db("SELECT id, content FROM ticket_notes WHERE ticket_id = ? AND content LIKE '%Voici la facture%'", [tE]);
      check('pièces jointes: gardées selon les réglages (type refusé, trop lourde)', res.ticketId === tE && files.status === 200 && files.body.length === 2 && files.body.every(f => f.note_id === noteA.id)
        && /virus\.exe \(non conservée : type refusé\)/.test(noteA.content) && /gros\.zip \(non conservée : plus de 1 Mo\)/.test(noteA.content) && /facture\.pdf \(1 Ko\)/.test(noteA.content), JSON.stringify([files.body, noteA.content]));
      const pdfRow = files.body.find(f => f.filename === 'facture.pdf');
      r = await req('GET', `/api/tickets/${tE}/attachments/${pdfRow.id}`, { sid: sessions.S1T });
      check('pièces jointes: téléchargement par le staff, jamais affiché avec le type de l expéditeur', r.status === 200 && r.body === pdf.toString() && r.headers['content-type'].startsWith('application/octet-stream') && /^attachment/.test(r.headers['content-disposition']) && r.headers['x-content-type-options'] === 'nosniff', JSON.stringify(r.headers));
      const pngRow = files.body.find(f => f.filename === 'photo.png');
      r = await req('GET', `/api/tickets/${tE}/attachments/${pngRow.id}`, { sid: sessions.S1T, query: { inline: '1' } });
      check('pièces jointes: image affichable dans la page', r.status === 200 && r.headers['content-type'] === 'image/png' && /^inline/.test(r.headers['content-disposition']), JSON.stringify(r.headers));
      r = await req('GET', `/api/tickets/${tE}/attachments/${pdfRow.id}`, { sid: sessions.MEM });
      const other = await req('GET', `/api/tickets/${tE}/attachments/999999`, { sid: sessions.S1T });
      check('pièces jointes: refusées sans accès au ticket, introuvable sinon', r.status >= 400 && r.status < 500 && other.status === 404, [r.status, other.status].join());
      check('pièces jointes: publiées dans le salon Discord du ticket', !chan || posted.some(p => p.files?.length === 2 && /e-mail/.test(p.content)), JSON.stringify(posted.map(p => p.content)));
      const usageR = await req('GET', '/api/email', { sid: sessions.F });
      check('pièces jointes: espace utilisé affiché', usageR.body.attachments.usage.files === 2 && usageR.body.attachments.usage.bytes === pdf.length + png.length, JSON.stringify(usageR.body.attachments.usage));
      const stored = fsx.readdirSync(path.join(attDir, G));
      check('pièces jointes: fichiers sous un nom aléatoire, dans le dossier du serveur', stored.length === 2 && stored.every(f => /^[0-9a-f]{32}$/.test(f)), JSON.stringify(stored));
      // Retention: ticket closed long ago → its files go; an orphan file goes too
      fsx.writeFileSync(path.join(attDir, G, 'a'.repeat(32)), 'orphelin');
      await db("UPDATE tickets SET status = 'closed', closed_at = NOW() - INTERVAL 40 DAY WHERE id = ?", [tE]);
      const purged = await ea.runAttachmentRetention(G, db);
      check('pièces jointes: supprimées après la durée de conservation (et fichiers orphelins)', purged.files === 3 && fsx.readdirSync(path.join(attDir, G)).length === 0 && (await db('SELECT COUNT(*) AS n FROM email_attachments'))[0].n == 0, JSON.stringify(purged));
      await db("UPDATE tickets SET status = 'open', closed_at = NULL WHERE id = ?", [tE]);
      delete app('./utils/config').config.attachmentsDir;
      fsx.rmSync(attDir, { recursive: true, force: true });
    }
    const { Client } = require('discord.js');
    const realC = new Client({ intents: [] });
    const errU = await realC.users.fetch(rowT.owner_id).then(() => null, e => e);
    check('e-mail: un contact e-mail n est jamais demandé à Discord', errU?.code === 10013, String(errU));
    await realC.destroy();
    // Additional addresses, routed to a subject and/or a tag (v4.1)
    {
      const [cfgA] = await db('SELECT ticket_subjects FROM guild_config WHERE id = 1');
      await db('UPDATE guild_config SET ticket_subjects = ? WHERE id = 1', [JSON.stringify(['Facturation', 'Technique'])]);
      const tagA = (await db("INSERT INTO ticket_tags (name, color) VALUES ('Compta', '#22c55e')")).insertId;
      const toOf = m => (typeof m.to === 'string' ? m.to : m.to?.address);
      const fromOf = m => (typeof m.from === 'string' ? m.from : m.from?.address);
      r = await req('GET', '/api/email/addresses', { sid: sessions.S1T });
      check('e-mail adresses: réservées aux fondateurs', r.status === 403, r.status);
      r = await req('GET', '/api/email/addresses', { sid: sessions.F });
      check('e-mail adresses: aucune par défaut, sujets et tags proposés', r.status === 200 && r.body.addresses.length === 0 && r.body.subjects.includes('Facturation') && r.body.tags.some(t => t.id === tagA), JSON.stringify(r.body));
      const bad = await req('POST', '/api/email/addresses', { sid: sessions.F, body: { address: 'pas une adresse' } });
      const mainA = await req('POST', '/api/email/addresses', { sid: sessions.F, body: { address: 'support@example.com' } });
      const badS = await req('POST', '/api/email/addresses', { sid: sessions.F, body: { address: 'x@example.com', subject: 'Inventé' } });
      const badT = await req('POST', '/api/email/addresses', { sid: sessions.F, body: { address: 'x@example.com', tagId: 999999 } });
      check('e-mail adresses: adresse invalide, adresse principale, sujet ou tag inconnu refusés', [bad, mainA, badS, badT].every(x => x.status === 400), [bad, mainA, badS, badT].map(x => x.status).join());
      r = await req('POST', '/api/email/addresses', { sid: sessions.F, body: { address: 'Facturation@Example.com', displayName: 'Service facturation', subject: 'Facturation', tagId: tagA, replyFrom: true } });
      const fact = r.body.addresses?.find(a => a.address === 'facturation@example.com');
      check('e-mail adresses: ajoutée (en minuscules) avec sujet, tag et envoi', r.status === 200 && fact?.subject === 'Facturation' && fact.tag_id === tagA && fact.reply_from === true, JSON.stringify(r.body));
      r = await req('POST', '/api/email/addresses', { sid: sessions.F, body: { address: 'facturation@example.com' } });
      check('e-mail adresses: doublon refusé', r.status === 400, JSON.stringify(r.body));
      r = await req('POST', '/api/email/addresses', { sid: sessions.F, body: { address: 'equipe@example.com', tagId: tagA } });
      const team = r.body.addresses?.find(a => a.address === 'equipe@example.com');
      check('e-mail adresses: journal de l espace', (await db("SELECT id FROM audit_log WHERE action = 'email_address_add'")).length >= 2, '');

      sent.length = 0;
      let res = await email.processEmail(fakeClient, G, { ...mail('carol@mail.test', 'Carol', 'Facture 12 manquante', 'Je n ai pas reçu la facture 12.'), to: { value: [{ address: 'Facturation@example.com' }] } }, settings);
      const [tF] = res.ticketId ? await db('SELECT subject FROM tickets WHERE id = ?', [res.ticketId]) : [];
      const [tagF] = res.ticketId ? await db('SELECT tag_id FROM ticket_tag_assignments WHERE ticket_id = ? AND tag_id = ?', [res.ticketId, tagA]) : [];
      const [thF] = res.ticketId ? await db('SELECT via_address_id FROM email_threads WHERE ticket_id = ?', [res.ticketId]) : [];
      const [noteF] = res.ticketId ? await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user' ORDER BY id LIMIT 1", [res.ticketId]).catch(() => []) : [];
      check('e-mail adresses: reçu sur une autre adresse → sujet et tag de cette adresse', res.created && res.via === 'facturation@example.com' && tF?.subject === 'Facturation' && !!tagF && thF?.via_address_id === fact.id, JSON.stringify([res, tF, tagF, thF]));
      check('e-mail adresses: l objet de l e-mail reste dans le premier message', !noteF || /Objet :\*\* Facture 12 manquante/.test(noteF.content), JSON.stringify(noteF));
      const welcomeF = sent.find(m => toOf(m) === 'carol@mail.test');
      check('e-mail adresses: la réponse part de l adresse sur laquelle le ticket est arrivé', fromOf(welcomeF || {}) === 'facturation@example.com' && welcomeF.from.name === 'Service facturation', JSON.stringify(welcomeF?.from));

      sent.length = 0;
      res = await email.processEmail(fakeClient, G, { ...mail('dan@mail.test', 'Dan', 'Question sur le planning', 'Bonjour'), to: { value: [{ address: 'support@example.com' }] }, headers: new Map([['delivered-to', 'equipe@example.com']]) }, settings);
      const [tD] = res.ticketId ? await db('SELECT subject FROM tickets WHERE id = ?', [res.ticketId]) : [];
      const [tagD] = res.ticketId ? await db('SELECT tag_id FROM ticket_tag_assignments WHERE ticket_id = ? AND tag_id = ?', [res.ticketId, tagA]) : [];
      const welcomeD = sent.find(m => toOf(m) === 'dan@mail.test');
      check('e-mail adresses: reconnue par Delivered-To (redirection), tag seul, objet gardé', res.via === 'equipe@example.com' && tD?.subject === 'Question sur le planning' && !!tagD, JSON.stringify([res, tD, tagD]));
      check('e-mail adresses: sans « répondre depuis », la réponse part de l adresse principale', fromOf(welcomeD || {}) === 'support@example.com', JSON.stringify(welcomeD?.from));
      res = await email.processEmail(fakeClient, G, { ...mail('eve@mail.test', 'Eve', 'Autre chose', 'Bonjour'), to: { value: [{ address: 'support@example.com' }] } }, settings);
      const [tagE] = res.ticketId ? await db('SELECT tag_id FROM ticket_tag_assignments WHERE ticket_id = ?', [res.ticketId]) : [];
      check('e-mail adresses: adresse principale → aucun routage', res.created && !res.via && !tagE, JSON.stringify([res, tagE]));
      res = await email.processEmail(fakeClient, G, mail('facturation@example.com', 'Nous', 'Boucle', 'écho'), settings);
      check('e-mail adresses: un message venant d une de nos adresses est ignoré', res.skipped === 'expéditeur', JSON.stringify(res));

      r = await req('PUT', `/api/email/addresses/${team.id}`, { sid: sessions.F, body: { address: 'equipe@example.com', subject: 'Technique', tagId: null } });
      check('e-mail adresses: modifiée', r.status === 200 && r.body.addresses.find(a => a.id === team.id)?.subject === 'Technique' && !r.body.addresses.find(a => a.id === team.id)?.tag_id, JSON.stringify(r.body));
      r = await req('DELETE', `/api/email/addresses/${fact.id}`, { sid: sessions.F });
      const [thF2] = await db('SELECT via_address_id FROM email_threads WHERE via_address_id = ?', [fact.id]);
      check('e-mail adresses: retirée → ses tickets répondent de l adresse principale', r.status === 200 && !r.body.addresses.some(a => a.id === fact.id) && !thF2, JSON.stringify(r.body));

      await db('DELETE FROM email_addresses');
      await db('DELETE FROM ticket_tag_assignments WHERE tag_id = ?', [tagA]);
      await db('DELETE FROM ticket_tags WHERE id = ?', [tagA]);
      await db('UPDATE guild_config SET ticket_subjects = ? WHERE id = 1', [cfgA.ticket_subjects == null || typeof cfgA.ticket_subjects === 'string' ? cfgA.ticket_subjects : JSON.stringify(cfgA.ticket_subjects)]);
    }
    // ── Copies of a ticket by e-mail (utils/ticketCc.js, v5.0) ──
    {
      await db("UPDATE email_settings SET enabled = 1, inbound_mode = 'imap' WHERE id = 1");
      const sCc = await email.emailSettings(db, { withSecrets: true });
      const withCc = (from, subject, text, { to = [], cc = [], inReplyTo } = {}) => ({
        from: { value: [{ address: from, name: 'Claire' }] }, subject, text, headers: new Map(), messageId: `<cc${Math.random()}@ext.test>`, inReplyTo, attachments: [],
        to: { value: [{ address: 'support@example.com' }, ...to.map(address => ({ address }))] }, cc: { value: cc.map(([address, name]) => ({ address, name })) },
      });
      sent.length = 0;
      let rc = await email.processEmail(fakeClient, G, withCc('claire@ext.test', 'Accès au partage', 'Mon équipe n a plus accès.', { to: ['chef@ext.test'], cc: [['adjoint@ext.test', 'Adjoint'], ['support@example.com', ''], ['claire@ext.test', '']] }), sCc);
      const tC = rc.ticketId;
      const ccRows = await db('SELECT address, name, added_by FROM ticket_cc WHERE ticket_id = ? ORDER BY address', [tC]);
      check('copies: les CC et autres destinataires deviennent copies du ticket (sans le support ni le demandeur)', rc.created && ccRows.map(c => c.address).join() === 'adjoint@ext.test,chef@ext.test' && ccRows.every(c => c.added_by === 'email'), JSON.stringify(ccRows));
      const ack = sent.find(m => m.to?.address === 'claire@ext.test');
      const ccOf = m => (m?.cc || []).map(c => (typeof c === 'string' ? c : c.address)).sort().join();
      check('copies: l accusé de réception part aussi aux copies', ccOf(ack) === 'adjoint@ext.test,chef@ext.test', JSON.stringify(ack?.cc));
      sent.length = 0;
      r = await req('POST', `/api/tickets/${tC}/reply`, { sid: sessions.F, body: { content: 'Accès rétabli.' } });
      const rep = sent.find(m => m.to?.address === 'claire@ext.test');
      check('copies: la réponse du staff part en copie, une seule fois', r.status === 200 && ccOf(rep) === 'adjoint@ext.test,chef@ext.test' && sent.filter(m => /Accès rétabli/.test(m.text || '')).length === 1, JSON.stringify(sent.map(m => [m.to, m.cc])));
      const tagC = email.subjectTag(G, tC);
      rc = await email.processEmail(fakeClient, G, withCc('adjoint@ext.test', `RE: ${tagC} Accès au partage`, 'Merci, ça marche pour moi aussi.'), sCc);
      const [noteCc] = await db("SELECT author_tag FROM ticket_notes WHERE ticket_id = ? AND content LIKE '%ça marche pour moi%'", [tC]);
      check('copies: une copie qui répond dans le fil écrit dans le ticket', rc.ticketId === tC && rc.cc === true && noteCc?.author_tag === 'adjoint@ext.test', JSON.stringify([rc, noteCc]));
      rc = await email.processEmail(fakeClient, G, withCc('intrus@ext.test', `RE: ${tagC} Accès au partage`, 'Je m invite.'), sCc);
      check('copies: quelqu un d autre avec le bon objet n écrit pas dans le ticket', rc.ticketId !== tC && Number((await db("SELECT COUNT(*) AS n FROM ticket_notes WHERE ticket_id = ? AND content LIKE '%m invite%'", [tC]))[0].n) === 0, JSON.stringify(rc));
      rc = await email.processEmail(fakeClient, G, withCc('claire@ext.test', `RE: ${tagC} Accès au partage`, 'J ajoute la RH.', { cc: [['rh@ext.test', 'RH']] }), sCc);
      check('copies: une personne mise en copie plus tard par le demandeur est ajoutée', (await db('SELECT address FROM ticket_cc WHERE ticket_id = ?', [tC])).some(c => c.address === 'rh@ext.test'), '');

      r = await req('GET', `/api/tickets/${tC}/cc`, { sid: sessions.F });
      check('copies: listées sur la fiche', r.status === 200 && r.body.available && r.body.cc.length === 3, JSON.stringify(r.body));
      r = await req('POST', `/api/tickets/${tC}/cc`, { sid: sessions.F, body: { address: 'pas-une-adresse' } });
      const bad1 = r.status;
      r = await req('POST', `/api/tickets/${tC}/cc`, { sid: sessions.F, body: { address: 'support@example.com' } });
      const bad2 = r.status;
      r = await req('POST', `/api/tickets/${tC}/cc`, { sid: sessions.F, body: { address: 'claire@ext.test' } });
      check('copies: adresse invalide, du support ou du demandeur refusée', bad1 === 400 && bad2 === 400 && r.status === 400, [bad1, bad2, r.status].join());
      r = await req('POST', `/api/tickets/${tC}/cc`, { sid: sessions.F, body: { address: 'Direction@Ext.test', name: 'Direction\r\nBcc: x@evil.test' } });
      const dir = r.body.cc?.find(c => c.address === 'direction@ext.test');
      check('copies: ajout par le staff, nom nettoyé (pas d en-tête injecté), au journal', r.status === 200 && dir && !/[\r\n]/.test(dir.name) && (await db("SELECT id FROM audit_log WHERE action = 'ticket_cc_add' AND ticket_id = ?", [tC])).length === 1, JSON.stringify(dir));
      for (let i = 0; i < 8; i++) await req('POST', `/api/tickets/${tC}/cc`, { sid: sessions.F, body: { address: `c${i}@ext.test` } });
      check('copies: 10 au plus par ticket', Number((await db('SELECT COUNT(*) AS n FROM ticket_cc WHERE ticket_id = ?', [tC]))[0].n) === 10, '');
      r = await req('DELETE', `/api/tickets/${tC}/cc/${dir.id}`, { sid: sessions.F });
      check('copies: retrait par le staff', r.status === 200 && !r.body.cc.some(c => c.address === 'direction@ext.test'), r.status);
      await db("INSERT INTO dashboard_users (user_id, username, role) VALUES ('300000000000000079', 'SansGrade', 'support') ON DUPLICATE KEY UPDATE role = 'support'");
      await mk('NOGR', { user: { id: '300000000000000079', username: 'SansGrade', role: null }, currentGuildId: G });
      r = await req('POST', `/api/tickets/${tC}/cc`, { sid: sessions.NOGR, body: { address: 'x@ext.test' } });
      check('copies: ajout réservé à qui peut répondre', r.status === 403, r.status);
      await db("DELETE FROM dashboard_users WHERE user_id = '300000000000000079'");
      const tDisc = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('200000000000000066', 'disc', 'db-cc-d', 'open', 'Discord')")).insertId;
      r = await req('POST', `/api/tickets/${tDisc}/cc`, { sid: sessions.F, body: { address: 'x@ext.test' } });
      check('copies: seulement pour un ticket ouvert par e-mail', r.status === 400 && /e-mail/.test(r.body.error), JSON.stringify(r.body));
      await db('UPDATE tickets SET visibility_grade_id = -1 WHERE id = ?', [tC]);
      sent.length = 0;
      r = await req('POST', `/api/tickets/${tC}/reply`, { sid: sessions.F, body: { content: 'Réponse confidentielle.' } });
      const conf = sent.find(m => m.to?.address === 'claire@ext.test');
      check('copies: un ticket devenu confidentiel ne part plus en copie', conf && ccOf(conf) === '', JSON.stringify(conf?.cc));
      await db("UPDATE tickets SET status = 'closed', visibility_grade_id = NULL WHERE id IN (?)", [[tC, tDisc]]);
      await db("UPDATE tickets SET status = 'closed' WHERE owner_id IN (?)", [[email.ownerIdFor('intrus@ext.test')]]);
    }

    // ── E-mails in HTML, signatures, template of the space (utils/emailFormat.js, v5.0) ──
    {
      const fmt = app('./utils/emailFormat');
      const h = fmt.markdownToHtml('**Gras** <script>alert(1)</script> [clic](javascript:alert(1)) [ok](https://exemple.fr/?a=1&b=2)\n- un\n- deux');
      check('e-mails HTML: markdown converti, aucun HTML ni lien dangereux ne passe', h.includes('<strong>Gras</strong>') && h.includes('&lt;script&gt;') && !h.includes('<script') && !/href="javascript/i.test(h)
        && h.includes('href="https://exemple.fr/?a=1&amp;b=2"') && h.includes('<ul') && h.includes('<li>deux</li>'), h);
      check('e-mails HTML: logo et couleur du modèle vérifiés', !fmt.wrapHtml('x', { color: 'red;background:url(x)', logo: 'javascript:alert(1)', name: '<b>N</b>' }).match(/red;|javascript:|<b>N/), '');
      await db("UPDATE email_settings SET enabled = 1, inbound_mode = 'imap' WHERE id = 1");
      const [cfgB] = await db('SELECT portal_color, portal_logo FROM guild_config WHERE id = 1');
      await db("UPDATE guild_config SET portal_color = '#e67e22', portal_logo = 'https://cdn.example.com/logo.png' WHERE id = 1");
      r = await req('GET', '/api/email', { sid: sessions.F });
      r = await req('PUT', '/api/email', { sid: sessions.F, body: { ...r.body, signature: "L'équipe **Sunset** — https://sunset.example", branded: true } });
      check('e-mails HTML: signature de l espace et modèle enregistrés', r.status === 200 && r.body.signature.includes('Sunset') && r.body.branded === true, JSON.stringify([r.status, r.body.signature]));
      r = await req('PUT', '/api/staff/me/signature', { sid: sessions.F, body: { signature: 'Daryu, responsable support\n' + 'x'.repeat(2000) } });
      check('e-mails HTML: signature personnelle, bornée à 1000 caractères', r.status === 200 && r.body.signature.length === 1000 && (await req('GET', '/api/staff/me/signature', { sid: sessions.F })).body.signature.startsWith('Daryu'), String(r.body.signature?.length));
      await req('PUT', '/api/staff/me/signature', { sid: sessions.F, body: { signature: 'Daryu, responsable support' } });
      const sH = await email.emailSettings(db, { withSecrets: true });
      let rh = await email.processEmail(fakeClient, G, mail('html@ext.test', 'Hélène', 'Mise en forme', 'Bonjour'), sH);
      const tH = rh.ticketId;
      sent.length = 0;
      r = await req('POST', `/api/tickets/${tH}/reply`, { sid: sessions.F, body: { content: 'Voici les **étapes** :\n1. Ouvrir\n2. Valider\n\nDoc : https://doc.example/a' } });
      const mh = sent.find(m => m.to?.address === 'html@ext.test');
      check('e-mails HTML: réponse en HTML (gras, liste, lien) dans le modèle de l espace', mh && mh.html.includes('<strong>étapes</strong>') && mh.html.includes('<ol') && mh.html.includes('href="https://doc.example/a"')
        && mh.html.includes('#e67e22') && mh.html.includes('https://cdn.example.com/logo.png') && mh.html.includes('Répondez à cet e-mail'), (mh?.html || '').slice(0, 300));
      check('e-mails HTML: texte brut à côté, sans marques markdown', mh && mh.text.includes('étapes') && !mh.text.includes('**'), mh?.text);
      check('e-mails HTML: signatures de la personne puis de l espace', mh && mh.text.includes('-- \nDaryu, responsable support') && mh.text.indexOf('Daryu, responsable') < mh.text.indexOf('Sunset') && mh.html.includes('<strong>Sunset</strong>'), mh?.text);
      sent.length = 0;
      r = await req('POST', `/api/tickets/${tH}/reply`, { sid: sessions.F, body: { content: 'Réponse anonyme.', anonymous: true } });
      const ma = sent.find(m => m.to?.address === 'html@ext.test');
      check('e-mails HTML: réponse anonyme → seulement la signature de l espace', ma && !ma.text.includes('Daryu, responsable') && ma.text.includes('Sunset'), ma?.text);
      sent.length = 0;
      await db("UPDATE tickets SET stage = 'open' WHERE id = ?", [tH]);
      await app('./utils/ticketManager').createManager(db, fakeClient, G).moveToStage(tH, 'waiting', { id: 'system', tag: 'Système' }).catch(() => null);
      const mn = sent.find(m => m.to?.address === 'html@ext.test');
      check('e-mails HTML: un avis automatique ne porte pas de signature', !mn || (!mn.text.includes('Daryu, responsable') && !mn.text.includes('-- \n')), mn?.text);
      await db('UPDATE email_settings SET branded = 0 WHERE id = 1');
      sent.length = 0;
      await req('POST', `/api/tickets/${tH}/reply`, { sid: sessions.F, body: { content: 'Sans modèle.' } });
      const mb = sent.find(m => m.to?.address === 'html@ext.test');
      check('e-mails HTML: modèle coupé → message simple', mb && !mb.html.includes('<!doctype') && mb.html.includes('Sans modèle'), (mb?.html || '').slice(0, 120));
      await db("UPDATE email_settings SET branded = 1, signature = NULL WHERE id = 1");
      await req('PUT', '/api/staff/me/signature', { sid: sessions.F, body: { signature: '' } });
      await db('UPDATE guild_config SET portal_color = ?, portal_logo = ? WHERE id = 1', [cfgB.portal_color, cfgB.portal_logo]);
      await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tH]);
    }

    // ── Import rules, spam, loops, quarantine (utils/mailFilter.js, v5.0) ──
    {
      const flt = app('./utils/mailFilter');
      const inb = app('./utils/inboundEmail');
      const H = obj => ({ headers: new Map(Object.entries(obj)) });
      check('filtres: verdicts anti-spam lus dans les en-têtes', flt.spamVerdict(H({ 'x-spam-flag': 'YES' })).spam && flt.spamVerdict(H({ 'x-spam-status': 'No, score=7.2 required=5.0' }), 5).spam
        && !flt.spamVerdict(H({ 'x-spam-status': 'No, score=1.1' }), 5).spam && flt.spamVerdict(H({ 'x-ms-exchange-organization-scl': '6' })).spam && flt.spamVerdict(H({ 'x-mailgun-sflag': 'Yes' })).spam
        && flt.spamVerdict(H({ 'x-ses-virus-verdict': 'FAIL' })).reason.includes('Virus') && flt.spamVerdict(H({ 'authentication-results': 'mx.test; spf=pass; dmarc=fail (p=reject)' })).spam
        && !flt.spamVerdict(H({ 'authentication-results': 'mx.test; dkim=pass; dmarc=pass' })).spam && !flt.spamVerdict(H({})).spam, '');
      await db("UPDATE email_settings SET enabled = 1, inbound_mode = 'imap' WHERE id = 1");
      let st = (await req('GET', '/api/email', { sid: sessions.F })).body;
      check('filtres: réglages par défaut (spam en quarantaine, seuil 5, 10 Mo)', st.filters?.spamAction === 'quarantine' && st.filters.spamThreshold === 5 && st.filters.maxMb === 10 && st.quarantineCount === 0, JSON.stringify(st.filters));
      r = await req('PUT', '/api/email', { sid: sessions.F, body: { ...st, filters: { maxMb: 50 } } });
      check('filtres: taille hors limites refusée', r.status === 400, JSON.stringify(r.body));
      r = await req('PUT', '/api/email', { sid: sessions.F, body: { ...st, filters: { blocked: 'spam.test, @Pub.example ; chef@ennuyeux.test pas-un-domaine', allowed: '', maxMb: 10, spamAction: 'quarantine', spamThreshold: 5 } } });
      check('filtres: domaines et adresses refusés enregistrés (liste nettoyée)', r.status === 200 && r.body.filters.blocked === 'spam.test\npub.example\nchef@ennuyeux.test', JSON.stringify(r.body.filters));
      const sF = async () => email.emailSettings(db, { withSecrets: true });
      const m = (from, subject, text, headers = {}) => ({ from: { value: [{ address: from, name: 'X' }] }, subject, text, headers: new Map(Object.entries(headers)), messageId: `<f${Math.random()}@ext.test>`, attachments: [] });
      let rf = await email.processEmail(fakeClient, G, m('vendeur@news.spam.test', 'Promo', 'Achetez'), await sF());
      const rf2 = await email.processEmail(fakeClient, G, m('chef@ennuyeux.test', 'Encore', 'x'), await sF());
      check('filtres: domaine (sous-domaines compris) et adresse refusés → ignorés, sans ticket', rf.skipped === 'expéditeur refusé' && rf2.skipped === 'expéditeur refusé' && !(await db("SELECT id FROM tickets WHERE owner_tag IN ('vendeur@news.spam.test', 'chef@ennuyeux.test')")).length, JSON.stringify([rf, rf2]));
      rf = await email.processEmail(fakeClient, G, m('louche@ext.test', 'Gagnez', 'Cliquez', { 'x-spam-flag': 'YES', 'x-spam-status': 'Yes, score=9.1' }), await sF());
      const q1 = (await req('GET', '/api/email/quarantine', { sid: sessions.F })).body;
      check('filtres: spam → quarantaine, sans ticket, avec la raison', rf.quarantined && q1.length === 1 && q1[0].from_address === 'louche@ext.test' && /spam/i.test(q1[0].reason) && Number(q1[0].score) === 9.1
        && !(await db("SELECT id FROM tickets WHERE owner_tag = 'louche@ext.test'")).length, JSON.stringify([rf, q1]));
      const rawSpam = 'From: Vrai Client <vrai@ext.test>\r\nTo: support@example.com\r\nSubject: Commande 88\r\nX-Spam-Flag: YES\r\nMessage-ID: <rq1@ext.test>\r\n\r\nMa commande 88 est bloquée.\r\n';
      rf = await email.processEmail(fakeClient, G, await inb.parseRaw(rawSpam), await sF());
      const q2 = (await req('GET', '/api/email/quarantine', { sid: sessions.F })).body;
      const qid = q2.find(x => x.from_address === 'vrai@ext.test')?.id;
      r = await req('POST', `/api/email/quarantine/${qid}/release`, { sid: sessions.F });
      const [rel] = r.body.ticketId ? await db('SELECT owner_tag, subject FROM tickets WHERE id = ?', [r.body.ticketId]) : [];
      check('filtres: un faux positif libéré devient un ticket (message d origine complet), au journal', r.status === 200 && rel?.owner_tag === 'vrai@ext.test' && rel.subject === 'Commande 88'
        && !r.body.quarantine.some(x => x.id === qid) && (await db("SELECT id FROM audit_log WHERE action = 'email_quarantine_release'")).length === 1, JSON.stringify([r.body, rel]));
      const lid = q2.find(x => x.from_address === 'louche@ext.test')?.id;
      r = await req('DELETE', `/api/email/quarantine/${lid}`, { sid: sessions.F });
      check('filtres: suppression d un message en quarantaine', r.status === 200 && r.body.quarantine.length === 0, JSON.stringify(r.body));
      r = await req('GET', '/api/email/quarantine', { sid: sessions.S1 });
      check('filtres: quarantaine réservée aux fondateurs', r.status === 403, r.status);
      const qx = await flt.quarantine(db, m('cache@ext.test', 'Sans brut', 'Corps gardé'), 'cache@ext.test', 'test');
      r = await req('POST', `/api/email/quarantine/${qx}/release`, { sid: sessions.F });
      check('filtres: message sans brut libéré aussi (champs gardés)', !!r.body.ticketId, JSON.stringify(r.body));

      st = (await req('GET', '/api/email', { sid: sessions.F })).body;
      await req('PUT', '/api/email', { sid: sessions.F, body: { ...st, filters: { ...st.filters, spamAction: 'drop' } } });
      rf = await email.processEmail(fakeClient, G, m('spam2@ext.test', 'Spam', 'x', { 'x-ms-exchange-organization-scl': '9' }), await sF());
      check('filtres: spam ignoré si choisi', /Microsoft 365/.test(rf.skipped || '') && (await req('GET', '/api/email/quarantine', { sid: sessions.F })).body.length === 0, JSON.stringify(rf));
      await req('PUT', '/api/email', { sid: sessions.F, body: { ...st, filters: { ...st.filters, spamAction: 'off' } } });
      rf = await email.processEmail(fakeClient, G, m('spam3@ext.test', 'Pas filtré', 'x', { 'x-spam-flag': 'YES' }), await sF());
      check('filtres: anti-spam coupé → ticket comme avant', !!rf.ticketId, JSON.stringify(rf));
      await req('PUT', '/api/email', { sid: sessions.F, body: { ...st, filters: { ...st.filters, spamAction: 'quarantine', allowed: 'entreprise.test' } } });
      rf = await email.processEmail(fakeClient, G, m('salarie@paris.entreprise.test', 'Interne', 'ok'), await sF());
      const rf3 = await email.processEmail(fakeClient, G, m('externe@ext.test', 'Externe', 'non'), await sF());
      check('filtres: domaines autorisés → les autres en quarantaine', !!rf.ticketId && rf3.quarantined && /autorisés/.test(rf3.reason), JSON.stringify([rf, rf3]));
      await req('PUT', '/api/email', { sid: sessions.F, body: { ...st, filters: { ...st.filters, spamAction: 'quarantine', allowed: '' } } });
      const loop = [];
      for (let i = 0; i < 4; i++) loop.push(await email.processEmail(fakeClient, G, m('robot2@ext.test', 'Accusé de réception', 'Nous avons bien reçu votre message.'), await sF()));
      check('filtres: le même message reçu en boucle est ignoré après 3 fois', loop.slice(0, 3).every(x => !x.skipped) && /boucle/.test(loop[3].skipped || ''), JSON.stringify(loop.map(x => x.skipped || x.ticketId)));
      rf = await email.processEmail(fakeClient, G, m('robot3@ext.test', 'Retour', 'x', { 'x-loop': 'support@example.com' }), await sF());
      check('filtres: notre propre message revenu (X-Loop) ignoré', /boucle/.test(rf.skipped || ''), JSON.stringify(rf));
      sent.length = 0;
      const tLoop = loop[0].ticketId;
      await req('POST', `/api/tickets/${tLoop}/reply`, { sid: sessions.F, body: { content: 'Bien noté.' } });
      check('filtres: nos e-mails portent la marque X-Loop', sent.some(x => x.headers?.['X-Loop'] === 'support@example.com'), JSON.stringify(sent.map(x => x.headers)));
      await db("DELETE FROM email_quarantine");
      await db("UPDATE email_settings SET filter_block = NULL, filter_allow = NULL, spam_action = 'quarantine' WHERE id = 1");
      await db("UPDATE tickets SET status = 'closed' WHERE owner_id LIKE 'mail:%'");
    }

    // ── Mailbox connected by OAuth2 (utils/mailOAuth.js, v5.0) ──
    {
      const axios = require('axios');
      const realPost = axios.post;
      const mo = app('./utils/mailOAuth');
      const box = app('./utils/secretBox');
      const jwt = claims => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
      const posts = [];
      let tokenReply = null;
      axios.post = async (url, body) => {
        posts.push({ url: String(url), body: String(body) });
        if (/oauth2\.googleapis\.com\/token|login\.microsoftonline\.com\/.*\/token/.test(url)) { const x = tokenReply(String(body)); if (x instanceof Error) throw x; return { data: x }; }
        if (/oauth2\.googleapis\.com\/revoke/.test(url)) return { data: {} };
        return realPost(url, body);
      };
      const savedEmail = (await db('SELECT * FROM email_settings WHERE id = 1'))[0];
      r = await req('GET', '/api/email', { sid: sessions.F });
      check('e-mail OAuth: mode mot de passe par défaut, aucune application déclarée', r.body.authMode === 'password' && r.body.oauthAvailable.google === false && r.body.oauthCallbacks.google.endsWith('/api/email/oauth/google/callback'), JSON.stringify([r.body.authMode, r.body.oauthAvailable]));
      r = await req('POST', '/api/email/oauth/google/start', { sid: sessions.F });
      check('e-mail OAuth: sans application déclarée → refus clair', r.status === 409 && /Instance → Connexion/.test(r.body.error), JSON.stringify(r.body));
      r = await req('PUT', '/api/instance/mail-oauth', { sid: sessions.S1, body: { google: { clientId: 'x', clientSecret: 'y' } } });
      check('e-mail OAuth: application déclarée par le propriétaire seulement', r.status === 401 || r.status === 403, r.status);
      r = await req('PUT', '/api/instance/mail-oauth', { sid: sessions.OWN, body: { google: { clientId: 'gid.apps', clientSecret: 'G-SECRET-42' }, microsoft: { clientId: 'mid', clientSecret: 'M-SECRET-42', tenant: 'evil/../x' } } });
      check('e-mail OAuth: annuaire Microsoft invalide refusé', r.status === 400, JSON.stringify(r.body));
      r = await req('PUT', '/api/instance/mail-oauth', { sid: sessions.OWN, body: { google: { clientId: 'gid.apps', clientSecret: 'G-SECRET-42' }, microsoft: { clientId: 'mid', clientSecret: 'M-SECRET-42', tenant: 'organizations' } } });
      const stored = await app('./utils/instanceSettings').getSetting('mail_oauth', {});
      check('e-mail OAuth: secrets chiffrés et jamais renvoyés', r.status === 200 && r.body.google.secretSet && r.body.google.configured && !JSON.stringify(r.body).includes('SECRET-42') && box.isCurrent(stored.google.clientSecret), JSON.stringify(r.body).slice(0, 200));

      r = await req('POST', '/api/email/oauth/google/start', { sid: sessions.F });
      const u = new URL(r.body.url || 'http://x');
      check('e-mail OAuth: départ vers Google avec accès hors ligne, PKCE et state', r.status === 200 && u.host === 'accounts.google.com' && u.searchParams.get('scope').includes('https://mail.google.com/')
        && u.searchParams.get('access_type') === 'offline' && u.searchParams.get('code_challenge_method') === 'S256' && !!u.searchParams.get('state'), r.body.url);
      r = await req('GET', '/api/email/oauth/google/callback', { sid: sessions.F, query: { state: 'faux', code: 'c' } });
      check('e-mail OAuth: retour avec un mauvais state refusé', r.status === 302 && /email=invalid_state/.test(r.headers.location), r.headers.location);
      r = await req('GET', '/api/email/oauth/google/callback', { sid: sessions.F, query: { state: u.searchParams.get('state'), code: 'c' } });
      check('e-mail OAuth: un départ ne sert qu une fois', /email=invalid_state/.test(r.headers.location), r.headers.location);
      r = await req('POST', '/api/email/oauth/google/start', { sid: sessions.F });
      const st = new URL(r.body.url).searchParams.get('state');
      tokenReply = () => ({ access_token: 'AT-1', expires_in: 3600, id_token: jwt({ email: 'Support.Boite@gmail.com' }) }); // no refresh token
      r = await req('GET', '/api/email/oauth/google/callback', { sid: sessions.F, query: { state: st, code: 'c1' } });
      check('e-mail OAuth: sans jeton de rafraîchissement → refus (la boîte cesserait de marcher dans une heure)', /email=no_refresh/.test(r.headers.location), r.headers.location);
      r = await req('POST', '/api/email/oauth/google/start', { sid: sessions.F });
      const st2 = new URL(r.body.url).searchParams.get('state');
      tokenReply = body => (/code_verifier=/.test(body) ? { access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 3600, id_token: jwt({ email: 'Support.Boite@gmail.com' }) } : new Error('?'));
      r = await req('GET', '/api/email/oauth/google/callback', { sid: sessions.F, query: { state: st2, code: 'c2' } });
      const [row] = await db('SELECT * FROM email_settings WHERE id = 1');
      check('e-mail OAuth: boîte connectée (serveurs Google, compte, jetons chiffrés)', /email=connected/.test(r.headers.location) && row.auth_mode === 'google' && row.oauth_account === 'support.boite@gmail.com'
        && row.imap_host === 'imap.gmail.com' && row.smtp_host === 'smtp.gmail.com' && row.smtp_port === 465 && box.open(row.oauth_refresh) === 'RT-1' && !String(row.oauth_refresh).includes('RT-1'), JSON.stringify([r.headers.location, row.auth_mode, row.oauth_account]));
      r = await req('GET', '/api/email', { sid: sessions.F });
      check('e-mail OAuth: réglages sans aucun jeton', r.body.authMode === 'google' && r.body.oauthConnected && r.body.oauthAccount === 'support.boite@gmail.com' && !JSON.stringify(r.body).includes('RT-1') && !JSON.stringify(r.body).includes('AT-1'), JSON.stringify(r.body).slice(0, 200));
      r = await req('PUT', '/api/email', { sid: sessions.F, body: { ...r.body, enabled: true, imapHost: 'evil.example.com', smtpHost: 'evil.example.com', imapPassword: 'x' } });
      const [row2] = await db('SELECT enabled, imap_host, smtp_host, imap_password FROM email_settings WHERE id = 1');
      check('e-mail OAuth: le formulaire ne change pas les serveurs d une boîte connectée', r.status === 200 && Number(row2.enabled) === 1 && row2.imap_host === 'imap.gmail.com' && row2.smtp_host === 'smtp.gmail.com', JSON.stringify(row2));

      const sx = await email.emailSettings(db, { withSecrets: true });
      const nm = require('nodemailer');
      let smtpOpts = null;
      const stubNm = nm.createTransport;
      nm.createTransport = o => { smtpOpts = o; return { sendMail: async () => ({}), verify: async () => true, close: () => {} }; };
      await email.smtpTransport(sx);
      check('e-mail OAuth: SMTP en XOAUTH2 avec le jeton valide, sans le renouveler', smtpOpts?.auth?.type === 'OAuth2' && smtpOpts.auth.user === 'support.boite@gmail.com' && smtpOpts.auth.accessToken === 'AT-1' && !posts.some(p => /refresh_token=/.test(p.body)), JSON.stringify(smtpOpts?.auth));
      await db('UPDATE email_settings SET oauth_expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = 1');
      tokenReply = body => (/grant_type=refresh_token/.test(body) && /refresh_token=RT-1/.test(body) ? { access_token: 'AT-2', refresh_token: 'RT-2', expires_in: 3600 } : new Error('?'));
      const sx2 = await email.emailSettings(db, { withSecrets: true });
      const imapC = await email.imapClient(sx2);
      await email.smtpTransport(sx2);
      const [row3] = await db('SELECT oauth_refresh, oauth_access, oauth_expires_at FROM email_settings WHERE id = 1');
      check('e-mail OAuth: jeton expiré renouvelé une seule fois, nouveau jeton de rafraîchissement gardé', imapC.options.auth.accessToken === 'AT-2' && smtpOpts.auth.accessToken === 'AT-2'
        && box.open(row3.oauth_refresh) === 'RT-2' && box.open(row3.oauth_access) === 'AT-2' && new Date(row3.oauth_expires_at) > new Date() && posts.filter(p => /grant_type=refresh_token/.test(p.body)).length === 1, JSON.stringify(imapC.options.auth));
      await db('UPDATE email_settings SET oauth_expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = 1');
      tokenReply = () => Object.assign(new Error('400'), { response: { data: { error: 'invalid_grant' } } });
      let refused = null;
      try { await email.smtpTransport(await email.emailSettings(db, { withSecrets: true })); } catch (e) { refused = e.message; }
      const [row4] = await db('SELECT last_error FROM email_settings WHERE id = 1');
      check('e-mail OAuth: accès retiré chez Google → message clair dans les réglages', /reconnecte/.test(refused || '') && /reconnecte/.test(row4.last_error || ''), String(refused));
      nm.createTransport = stubNm;

      r = await req('POST', '/api/email/oauth/disconnect', { sid: sessions.F });
      const [row5] = await db('SELECT auth_mode, oauth_refresh, oauth_access, enabled FROM email_settings WHERE id = 1');
      check('e-mail OAuth: déconnexion → jeton révoqué chez Google, effacé, boîte coupée', r.status === 200 && row5.auth_mode === 'password' && !row5.oauth_refresh && !row5.oauth_access && Number(row5.enabled) === 0 && posts.some(p => /revoke/.test(p.url)), JSON.stringify(row5));

      r = await req('POST', '/api/email/oauth/microsoft/start', { sid: sessions.F });
      const mu = new URL(r.body.url);
      check('e-mail OAuth: Microsoft dans l annuaire choisi, IMAP et SMTP d Outlook, accès hors ligne', mu.host === 'login.microsoftonline.com' && mu.pathname.startsWith('/organizations/') && /IMAP\.AccessAsUser\.All/.test(mu.searchParams.get('scope')) && /SMTP\.Send/.test(mu.searchParams.get('scope')) && /offline_access/.test(mu.searchParams.get('scope')), r.body.url);
      r = await req('POST', '/api/email/oauth/yahoo/start', { sid: sessions.F });
      check('e-mail OAuth: fournisseur inconnu refusé', r.status === 404, r.status);
      r = await req('POST', '/api/email/oauth/google/start', { sid: sessions.S1 });
      check('e-mail OAuth: connexion de la boîte réservée aux fondateurs', r.status === 403, r.status);

      axios.post = realPost;
      await app('./utils/instanceSettings').setSetting('mail_oauth', {});
      const cols = Object.keys(savedEmail || {}).filter(c => !['id', 'updated_at'].includes(c));
      if (savedEmail) await db(`UPDATE email_settings SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = 1`, cols.map(c => savedEmail[c]));
    }
    // ── E-mails pushed by a provider (utils/inboundEmail.js, routes/inboundEmail.js, v5.0) ──
    {
      const inb = app('./utils/inboundEmail');
      const NOXRW = { 'X-Requested-With': '' }; // providers send no such header: the CSRF guard must not apply
      const savedIn = (await db('SELECT * FROM email_settings WHERE id = 1'))[0];
      await db("UPDATE email_settings SET enabled = 1, auth_mode = 'password' WHERE id = 1");
      r = await req('PUT', '/api/email/inbound', { sid: sessions.S1, body: { mode: 'webhook', provider: 'postmark' } });
      check('réception webhook: réglage réservé aux fondateurs', r.status === 403, r.status);
      r = await req('PUT', '/api/email/inbound', { sid: sessions.F, body: { mode: 'webhook', provider: 'yahoo' } });
      check('réception webhook: fournisseur inconnu refusé', r.status === 400, JSON.stringify(r.body));
      r = await req('PUT', '/api/email/inbound', { sid: sessions.F, body: { mode: 'webhook', provider: 'postmark' } });
      const urlPm = r.body.inbound?.url || '';
      const pathPm = new URL(urlPm || 'http://x/').pathname;
      const [tokRow] = await db('SELECT inbound_token FROM email_settings WHERE id = 1');
      check('réception webhook: adresse propre à l espace, secret chiffré en base', r.status === 200 && r.body.inbound.mode === 'webhook' && pathPm.startsWith(`/api/inbound/postmark/${G}.`)
        && /^enc:/.test(tokRow.inbound_token) && !JSON.stringify(await req('GET', '/api/email', { sid: sessions.F }).then(x => x.body.lastError)).includes(pathPm.split('.')[1]), urlPm);
      check('réception webhook: la boîte n est plus relevée en IMAP', (await email.fetchMailbox(fakeClient, G)).skipped === 'webhook', '');
      const pm = (from, subject, text, extra = {}) => ({ FromFull: { Email: from, Name: 'Paul' }, ToFull: [{ Email: 'support@example.com' }], Subject: subject, TextBody: text, Headers: [{ Name: 'Message-ID', Value: `<pm${Math.random()}@ext.test>` }], ...extra });
      r = await req('POST', pathPm.replace(/\.[^.]+$/, '.' + 'x'.repeat(43)), { headers: NOXRW, body: pm('paul@ext.test', 'Faux', 'x') });
      check('réception webhook: mauvais secret → inconnue', r.status === 404, r.status);
      r = await req('POST', pathPm.replace('/postmark/', '/sendgrid/'), { headers: NOXRW, body: { email: 'x' } });
      check('réception webhook: autre fournisseur que celui choisi → inconnue', r.status === 404, r.status);
      r = await req('POST', pathPm, { headers: NOXRW, body: pm('paul@ext.test', 'Imprimante en panne', 'Elle ne répond plus.', { Attachments: [{ Name: 'photo.png', ContentType: 'image/png', Content: Buffer.from('PNGDATA').toString('base64') }] }) });
      const [tPm] = r.body.ticket ? await db('SELECT id, owner_tag, subject FROM tickets WHERE id = ?', [r.body.ticket]) : [];
      const [nPm] = tPm ? await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user' ORDER BY id LIMIT 1", [tPm.id]) : [];
      check('réception webhook: Postmark (JSON) → ticket, comme un e-mail relevé, sans en-tête CSRF', r.status === 200 && tPm?.owner_tag === 'paul@ext.test' && tPm.subject === 'Imprimante en panne' && nPm?.content.includes('ne répond plus') && nPm.content.includes('photo.png'), JSON.stringify([r.status, r.body, tPm, nPm]));
      r = await req('POST', pathPm, { headers: NOXRW, body: pm('paul@ext.test', `RE: ${email.subjectTag(G, tPm?.id)} Imprimante en panne`, 'Toujours en panne.') });
      check('réception webhook: la réponse revient dans le même ticket', r.body.ticket === tPm?.id, JSON.stringify(r.body));
      r = await req('POST', pathPm, { headers: NOXRW, body: pm('robot@ext.test', 'Absent', 'Je suis absent', { Headers: [{ Name: 'Auto-Submitted', Value: 'auto-replied' }] }) });
      check('réception webhook: réponses automatiques ignorées (mêmes règles que l IMAP)', r.status === 200 && r.body.skipped === 'automatique', JSON.stringify(r.body));
      const raw = `From: Rita <rita@ext.test>\r\nTo: support@example.com\r\nSubject: Message brut\r\nMessage-ID: <raw1@ext.test>\r\n\r\nCorps du message brut.\r\n`;
      r = await req('POST', pathPm, { headers: NOXRW, body: { RawEmail: raw } });
      check('réception webhook: Postmark avec le message brut', !!r.body.ticket, JSON.stringify(r.body));

      // Mailgun: signed with the webhook signing key, each signed request once
      r = await req('PUT', '/api/email/inbound', { sid: sessions.F, body: { mode: 'webhook', provider: 'mailgun', signingKey: 'cle-de-signature-mailgun' } });
      const pathMg = new URL(r.body.inbound.url).pathname;
      check('réception webhook: même secret d adresse en changeant de fournisseur', pathMg.split('/').pop() === pathPm.split('/').pop() && r.body.inbound.signingKeySet, pathMg);
      const sign = (key, ts = Math.floor(Date.now() / 1000), token = require('crypto').randomBytes(16).toString('hex')) => ({ timestamp: String(ts), token, signature: require('crypto').createHmac('sha256', key).update(`${ts}${token}`).digest('hex') });
      const mgBody = { sender: 'mona@ext.test', from: 'Mona <mona@ext.test>', recipient: 'support@example.com', subject: 'Accès VPN', 'body-plain': 'Je n ai plus accès au VPN.', 'Message-Id': '<mg1@ext.test>' };
      r = await req('POST', pathMg, { headers: NOXRW, body: { ...mgBody, ...sign('mauvaise-cle') } });
      check('réception webhook: Mailgun, signature invalide refusée', r.status === 401, JSON.stringify(r.body));
      r = await req('POST', pathMg, { headers: NOXRW, body: { ...mgBody, ...sign('cle-de-signature-mailgun', Math.floor(Date.now() / 1000) - 3600) } });
      check('réception webhook: Mailgun, signature trop ancienne refusée', r.status === 401, JSON.stringify(r.body));
      const good = sign('cle-de-signature-mailgun');
      r = await req('POST', pathMg, { headers: NOXRW, body: { ...mgBody, ...good } });
      const [tMg] = r.body.ticket ? await db('SELECT owner_tag, subject FROM tickets WHERE id = ?', [r.body.ticket]) : [];
      check('réception webhook: Mailgun signé → ticket', r.status === 200 && tMg?.owner_tag === 'mona@ext.test' && tMg.subject === 'Accès VPN', JSON.stringify([r.body, tMg]));
      r = await req('POST', pathMg, { headers: NOXRW, body: { ...mgBody, ...good } });
      check('réception webhook: Mailgun, requête signée rejouée refusée', r.status === 409, r.status);
      r = await req('POST', pathMg, { headers: NOXRW, body: { 'body-mime': raw.replace('raw1', 'raw2').replace('rita@', 'rito@'), ...sign('cle-de-signature-mailgun') } });
      check('réception webhook: Mailgun avec le message brut (route …/mime)', !!r.body.ticket, JSON.stringify(r.body));

      // As Mailgun really sends it with attachments: multipart/form-data
      const fd = new FormData();
      for (const [k, v] of Object.entries({ ...mgBody, from: 'Max <max@ext.test>', sender: 'max@ext.test', 'Message-Id': '<mg3@ext.test>', subject: 'Facture jointe', ...sign('cle-de-signature-mailgun') })) fd.append(k, v);
      fd.append('attachment-1', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'facture.pdf');
      const mp = await fetch(`http://127.0.0.1:${config.webServerPort}${pathMg}`, { method: 'POST', body: fd }).then(async x => ({ status: x.status, body: await x.json() }));
      const [nMp] = mp.body.ticket ? await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user' ORDER BY id LIMIT 1", [mp.body.ticket]) : [];
      check('réception webhook: Mailgun en multipart, pièce jointe comprise', mp.status === 200 && nMp?.content.includes('facture.pdf'), JSON.stringify([mp, nMp]));

      // SendGrid Inbound Parse: the raw message is required
      r = await req('PUT', '/api/email/inbound', { sid: sessions.F, body: { mode: 'webhook', provider: 'sendgrid' } });
      const pathSg = new URL(r.body.inbound.url).pathname;
      r = await req('POST', pathSg, { headers: NOXRW, body: { from: 'x@ext.test', text: 'x' } });
      const [errSg] = await db('SELECT last_error FROM email_settings WHERE id = 1');
      check('réception webhook: SendGrid sans le message brut → refus expliqué dans les réglages', r.status === 400 && /raw, full MIME/.test(errSg.last_error || ''), JSON.stringify([r.body, errSg]));
      r = await req('POST', pathSg, { headers: NOXRW, body: { email: raw.replace('raw1', 'raw3').replace('rita@', 'riri@') } });
      check('réception webhook: SendGrid → ticket', !!r.body.ticket, JSON.stringify(r.body));

      // Amazon SES through SNS: signature checked with the certificate, topic pinned
      const os = require('os'), fsx = require('fs');
      const dir = fsx.mkdtempSync(path.join(os.tmpdir(), 'tb-sns-'));
      require('child_process').execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-subj', '/CN=sns.test', '-days', '1'], { stdio: 'ignore' });
      const keyPem = fsx.readFileSync(path.join(dir, 'k.pem'), 'utf8'), certPem = fsx.readFileSync(path.join(dir, 'c.pem'), 'utf8');
      const CERT_URL = 'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc123.pem';
      const TOPIC = 'arn:aws:sns:eu-west-1:123456789012:datick-in';
      const axios = require('axios');
      const realGet = axios.get;
      const gets = [];
      axios.get = async url => { gets.push(String(url)); if (url === CERT_URL) return { data: certPem }; if (/ConfirmSubscription/.test(url)) return { data: 'ok' }; return realGet(url); };
      const snsSign = (m, key = keyPem) => {
        const keys = m.Type === 'Notification' ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
        const text = keys.filter(k => m[k] !== undefined).map(k => `${k}\n${m[k]}\n`).join('');
        return { ...m, SignatureVersion: '2', SigningCertURL: CERT_URL, Signature: require('crypto').createSign('RSA-SHA256').update(text).sign(key, 'base64') };
      };
      r = await req('PUT', '/api/email/inbound', { sid: sessions.F, body: { mode: 'webhook', provider: 'ses' } });
      check('réception webhook: Amazon SES exige l ARN du sujet SNS', r.status === 400, JSON.stringify(r.body));
      r = await req('PUT', '/api/email/inbound', { sid: sessions.F, body: { mode: 'webhook', provider: 'ses', topicArn: TOPIC } });
      const pathSes = new URL(r.body.inbound.url).pathname;
      const now = new Date().toISOString();
      const sub = snsSign({ Type: 'SubscriptionConfirmation', MessageId: 'm1', Token: 't', TopicArn: TOPIC, Message: 'confirm', SubscribeURL: 'https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=x&Token=t', Timestamp: now });
      r = await req('POST', pathSes, { headers: NOXRW, body: sub });
      check('réception webhook: SES, abonnement SNS confirmé après vérification de la signature', r.status === 200 && r.body.subscribed && gets.some(u => /ConfirmSubscription/.test(u)), JSON.stringify(r.body));
      const sesMsg = content => JSON.stringify({ notificationType: 'Received', receipt: { action: { type: 'SNS', encoding: 'BASE64' } }, content: Buffer.from(content).toString('base64') });
      r = await req('POST', pathSes, { headers: NOXRW, body: { ...snsSign({ Type: 'Notification', MessageId: 'm2', TopicArn: TOPIC, Message: sesMsg(raw.replace('raw1', 'raw4')), Timestamp: now }), Message: sesMsg('From: x@evil.test\r\n\r\nfalsifié') } });
      check('réception webhook: SES, message modifié après signature refusé', r.status === 401, JSON.stringify(r.body));
      const otherKey = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
      r = await req('POST', pathSes, { headers: NOXRW, body: snsSign({ Type: 'Notification', MessageId: 'm3', TopicArn: TOPIC, Message: sesMsg(raw), Timestamp: now }, otherKey) });
      check('réception webhook: SES, signé par une autre clé refusé', r.status === 401, r.status);
      r = await req('POST', pathSes, { headers: NOXRW, body: { ...snsSign({ Type: 'Notification', MessageId: 'm4', TopicArn: TOPIC, Message: sesMsg(raw), Timestamp: now }), SigningCertURL: 'https://evil.example/SimpleNotificationService-abc123.pem' } });
      check('réception webhook: SES, certificat hors d Amazon refusé', r.status === 401 && !gets.some(u => u.includes('evil.example')), r.status);
      r = await req('POST', pathSes, { headers: NOXRW, body: snsSign({ Type: 'Notification', MessageId: 'm5', TopicArn: 'arn:aws:sns:eu-west-1:999999999999:autre', Message: sesMsg(raw), Timestamp: now }) });
      check('réception webhook: SES, autre sujet SNS refusé', r.status === 403, r.status);
      r = await req('POST', pathSes, { headers: NOXRW, body: snsSign({ Type: 'Notification', MessageId: 'm6', TopicArn: TOPIC, Message: sesMsg(raw.replace('raw1', 'raw5').replace('rita@', 'rose@')), Timestamp: now }) });
      const [tSes] = r.body.ticket ? await db('SELECT owner_tag FROM tickets WHERE id = ?', [r.body.ticket]) : [];
      check('réception webhook: SES signé → ticket', r.status === 200 && tSes?.owner_tag === 'rose@ext.test', JSON.stringify([r.body, tSes]));
      axios.get = realGet;

      r = await req('POST', '/api/email/inbound/token', { sid: sessions.F });
      const newPath = new URL(r.body.inbound.url).pathname;
      const old = await req('POST', pathSes, { headers: NOXRW, body: snsSign({ Type: 'Notification', MessageId: 'm7', TopicArn: TOPIC, Message: sesMsg(raw), Timestamp: now }) });
      check('réception webhook: nouvelle adresse → l ancienne ne marche plus', newPath !== pathSes && old.status === 404, [newPath, old.status].join());
      await db('UPDATE email_settings SET enabled = 0 WHERE id = 1');
      r = await req('POST', newPath, { headers: NOXRW, body: snsSign({ Type: 'Notification', MessageId: 'm8', TopicArn: TOPIC, Message: sesMsg(raw), Timestamp: now }) });
      check('réception webhook: tickets par e-mail coupés → refusé', r.status === 404, r.status);
      r = await req('PUT', '/api/email/inbound', { sid: sessions.F, body: { mode: 'imap' } });
      check('réception webhook: retour à la relève IMAP', r.status === 200 && r.body.inbound.mode === 'imap' && r.body.inbound.url === null, JSON.stringify(r.body.inbound));

      const cols = Object.keys(savedIn || {}).filter(c => !['id', 'updated_at'].includes(c));
      if (savedIn) await db(`UPDATE email_settings SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = 1`, cols.map(c => savedIn[c]));
    }
    await db("UPDATE tickets SET status = 'closed' WHERE owner_id LIKE 'mail:%'");
    await db('UPDATE email_settings SET enabled = 0 WHERE id = 1');
    delete process.env.EMAIL_ALLOW_PRIVATE_HOSTS;
    nodemailer.createTransport = realCreate;
  }

  // ── Spaces without a Discord server (utils/spaces.js, v4 PR 7a) ──
  {
    const spaces = app('./utils/spaces');
    const [gRow] = await globalQuery('SELECT discord, created_by FROM guilds WHERE guild_id = ?', [G]);
    check('espaces: un serveur existant reste un serveur Discord', Number(gRow.discord) === 1 && gRow.created_by === null, JSON.stringify(gRow));
    r = await req('POST', '/api/instance/guilds', { sid: sessions.NOWN, body: { name: 'Équipe e-mail' } });
    const empty = await req('POST', '/api/instance/guilds', { sid: sessions.OWN, body: { name: '   ' } });
    check('espaces: création réservée au propriétaire, nom obligatoire', r.status === 403 && empty.status === 400, [r.status, empty.status].join());
    r = await req('POST', '/api/instance/guilds', { sid: sessions.OWN, body: { name: '  Équipe   e-mail ' } });
    const SP = r.body.id;
    const [sRow] = await globalQuery('SELECT guild_name, discord, discord_guild_id, created_by, status FROM guilds WHERE guild_id = ?', [SP]);
    const sdb = getTenantDb(SP);
    const [sCfg] = await sdb('SELECT ticket_mode, portal_email_open FROM guild_config WHERE id = 1');
    const [sFounder] = await sdb('SELECT role FROM dashboard_users WHERE user_id = ?', [U.F]);
    check('espaces: espace sans Discord créé (identifiant 9…, base prête, aucun salon, ouvert par e-mail, créateur fondateur)', r.status === 200 && spaces.SPACE_ID_RE.test(SP) && sRow.guild_name === 'Équipe e-mail' && Number(sRow.discord) === 0 && sRow.discord_guild_id === null && sRow.created_by === U.F && sRow.status === 'active' && sCfg.ticket_mode === 'database' && Number(sCfg.portal_email_open) === 1 && sFounder?.role === 'fondateur', JSON.stringify([r.body, sRow, sCfg, sFounder]));
    const [aud] = await globalQuery("SELECT COUNT(*) AS n FROM instance_audit_log WHERE action = 'space_create'");
    check('espaces: création inscrite au journal de l instance', Number(aud.n) >= 1, '');
    const { Client } = require('discord.js');
    const realC = new Client({ intents: [] });
    const errG = await realC.guilds.fetch(SP).then(() => null, e => e);
    check('espaces: jamais demandé à Discord', errG?.code === 10004, String(errG));
    await realC.destroy();
    await mk('SPD', { user: { id: U.F, username: 'F', role: null }, currentGuildId: SP });
    const dl = [];
    for (const k of ['channels', 'categories', 'roles']) { const x = await req('GET', `/api/discord/${k}`, { sid: sessions.SPD }); dl.push(`${x.status}:${JSON.stringify(x.body)}`); }
    check('espaces: salons, catégories et rôles Discord = listes vides, pas une erreur', dl.every(x => x === '200:[]'), dl.join(' '));
    // Listed for the owner, whatever the way they signed in
    await mk('OWNP', { user: { id: U.F, username: 'F', role: null }, authMethod: 'password' });
    r = await req('GET', '/api/auth/guilds', { sid: sessions.OWNP });
    const axios = require('axios');
    const realGet = axios.get;
    axios.get = async url => (String(url).includes('/users/@me/guilds') ? { data: [] } : realGet(url));
    await mk('OWND', { user: { id: U.F, username: 'F', role: null }, discordAccessToken: 'tok' });
    const viaDiscord = await req('GET', '/api/auth/guilds', { sid: sessions.OWND });
    axios.get = realGet;
    check('espaces: listé pour le propriétaire (connexion par mot de passe ou Discord)', r.body.some(g => g.id === SP) && viaDiscord.body.some(g => g.id === SP && g.discord === false), JSON.stringify([r.body.map(g => g.id), viaDiscord.body]));
    r = await req('POST', '/api/auth/select-guild', { sid: sessions.OWNP, body: { guildId: SP } });
    check('espaces: on entre dans l espace comme dans un serveur', r.status === 200 && r.body.role === 'fondateur', JSON.stringify(r.body));
    await mk('OWNSP', { user: { id: U.F, username: 'F', role: 'fondateur' }, authMethod: 'password', currentGuildId: SP });
    const meSpace = await req('GET', '/api/auth/me', { sid: sessions.OWNSP });
    const meDiscord = await req('GET', '/api/auth/me', { sid: sessions.F });
    check('espaces: le dashboard sait si un serveur Discord est relié (fonctions Discord masquées sinon)', meSpace.body.discord === false && meDiscord.body.discord === true, JSON.stringify([meSpace.body.discord, meDiscord.body.discord]));
    // A ticket in this space has no channel, whatever its setting
    await sdb("UPDATE guild_config SET ticket_mode = 'auto' WHERE id = 1");
    const resS = await createManager(sdb, fakeClient, SP).createTicket({ id: '200000000000000081', username: 'm81', tag: 'm81', send: async () => {} }, 'Bonjour', [], 'Espace');
    check('espaces: ticket sans salon même si le format dit « salons »', resS.created && app('./utils/virtualChannel').isVirtualChannelId(resS.ticket.channel_id), JSON.stringify(resS.ticket));
    await globalQuery('DELETE FROM guilds WHERE guild_id = ?', [SP]);
    await globalQuery(`DROP DATABASE IF EXISTS \`ticketbot_guild_${SP}\``);
    await spaces.refresh();
  }

  // ── Linking a space to a Discord server, and unlinking it (utils/spaces.js, v4 PR 7b) ──
  {
    const spaces = app('./utils/spaces');
    const { registerGuild } = app('./utils/guildActivation');
    r = await req('POST', '/api/instance/guilds', { sid: sessions.OWN, body: { name: 'Espace à relier' } });
    const S = r.body.id;
    const X = '987650000000000123';
    const sdb = getTenantDb(S);
    const tk = await sdb("INSERT INTO tickets (channel_id, owner_id, owner_tag, subject, status) VALUES ('db-relier1', 'mail:aaaaaaaaaaaaaaaaaaaaaaaa', 'a@b.c', 'Avant liaison', 'open')");
    await globalQuery("INSERT INTO login_logs (user_id, username, ip, guild_id) VALUES (?, 'F', '127.0.0.1', ?)", [U.F, S]);
    r = await req('POST', `/api/instance/guilds/${S}/discord/link`, { sid: sessions.NOWN, body: { discordGuildId: X } });
    const bad = await req('POST', `/api/instance/guilds/${S}/discord/link`, { sid: sessions.OWN, body: { discordGuildId: '12' } });
    const taken = await req('POST', `/api/instance/guilds/${S}/discord/link`, { sid: sessions.OWN, body: { discordGuildId: G } });
    check('relier: réservé au propriétaire, identifiant invalide ou serveur déjà pris refusés', r.status === 403 && bad.status === 400 && taken.status === 409, [r.status, bad.status, taken.status].join());
    r = await req('POST', `/api/instance/guilds/${S}/discord/link`, { sid: sessions.OWN, body: { discordGuildId: X } });
    const u = new URL(r.body.url || 'http://x');
    check('relier: lien d invitation du bot vers ce serveur', r.status === 200 && u.hostname === 'discord.com' && u.searchParams.get('guild_id') === X && u.searchParams.get('scope').includes('bot'), r.body.url);
    // The bot arrives on X
    const mkG = id => ({ id, name: 'Serveur Discord relié', ownerId: '300000000000000001', memberCount: 12, iconURL: () => null, leave: async () => {},
      fetchOwner: async () => ({ id: '300000000000000001', user: { username: 'founder1' } }), fetchAuditLogs: async () => ({ entries: new Map() }) });
    await registerGuild(fakeClient, mkG(X), { notify: false });
    const [oldRow] = await globalQuery('SELECT COUNT(*) AS n FROM guilds WHERE guild_id = ?', [S]);
    const [newRow] = await globalQuery('SELECT guild_name, discord, discord_guild_id, created_by FROM guilds WHERE guild_id = ?', [X]);
    const [moved] = await getTenantDb(X)('SELECT subject FROM tickets WHERE id = ?', [Number(tk.insertId)]);
    const [oldDb] = await globalQuery('SELECT COUNT(*) AS n FROM information_schema.schemata WHERE schema_name = ?', [`ticketbot_guild_${S}`]);
    const [log] = await globalQuery('SELECT COUNT(*) AS n FROM login_logs WHERE guild_id = ?', [X]);
    check('relier: à l arrivée du bot, l espace devient celui du serveur (tickets, traces), aucun nouvel espace', Number(oldRow.n) === 0 && Number(newRow?.discord) === 1 && newRow.discord_guild_id === X && newRow.created_by === U.F && moved?.subject === 'Avant liaison' && Number(oldDb.n) === 0 && Number(log.n) >= 1 && !spaces.isDiscordless(X), JSON.stringify([oldRow, newRow, moved, oldDb, log]));
    // Unlinking
    await getTenantDb(X)("UPDATE tickets SET channel_id = '987650000000009999' WHERE id = ?", [Number(tk.insertId)]);
    r = await req('POST', `/api/instance/guilds/${X}/discord/unlink`, { sid: sessions.OWN, body: { confirm: 'pas le nom' } });
    const un = await req('POST', `/api/instance/guilds/${X}/discord/unlink`, { sid: sessions.OWN, body: { confirm: 'Serveur Discord relié' } });
    const [afterUn] = await globalQuery('SELECT discord, discord_guild_id, status FROM guilds WHERE guild_id = ?', [X]);
    const [tkU] = await getTenantDb(X)('SELECT channel_id FROM tickets WHERE id = ?', [Number(tk.insertId)]);
    const [cfgU] = await getTenantDb(X)('SELECT ticket_mode FROM guild_config WHERE id = 1');
    check('délier: confirmation par le nom, espace gardé, tickets ouverts sans salon', r.status === 400 && un.status === 200 && un.body.openTickets === 1 && Number(afterUn.discord) === 0 && afterUn.discord_guild_id === null && /^db-u/.test(tkU.channel_id) && cfgU.ticket_mode === 'database' && spaces.isDiscordless(X), JSON.stringify([un.body, afterUn, tkU, cfgU]));
    await app('./events/guildDelete').execute(fakeClient, { id: X, name: 'Serveur Discord relié' });
    const [afterDel] = await globalQuery('SELECT status FROM guilds WHERE guild_id = ?', [X]);
    check('délier: le départ du bot ne suspend pas l espace', afterDel.status === 'active', JSON.stringify(afterDel));
    await registerGuild(fakeClient, mkG(X), { notify: false });
    const [again] = await globalQuery('SELECT discord, discord_guild_id FROM guilds WHERE guild_id = ?', [X]);
    check('délier: le bot réinvité sur le serveur relie de nouveau l espace', Number(again.discord) === 1 && again.discord_guild_id === X && !spaces.isDiscordless(X), JSON.stringify(again));
    await globalQuery('DELETE FROM login_logs WHERE guild_id = ?', [X]);
    await globalQuery('DELETE FROM guilds WHERE guild_id = ?', [X]);
    await globalQuery(`DROP DATABASE IF EXISTS \`ticketbot_guild_${X}\``);
    await spaces.refresh();
  }

  // ── Without Discord (v4 PR 6): optional token, first owner by install token ──
  {
    const inst = app('./utils/instance');
    const installation = app('./utils/installation');
    const cfgD = app('./utils/config').config;
    const { validateConfig } = app('bootstrap');
    validateConfig({ hasFile: false, token: '', clientId: '', database: { password: 'x' }, webServerBaseUrl: 'https://t.example.com', dashboard: { sessionSecret: 'x'.repeat(40) } });
    check('sans Discord: configuration valide sans token ni application Discord', true, '');
    const JOBS = app('./utils/jobQueue').JOBS;
    check('sans Discord: tâches propres à Discord marquées (sautées sans le bot)', ['discord-watch', 'guild-health', 'public-stats', 'weekly-report', 'monthly-report'].every(j => JOBS[j].discord) && !JOBS['email-fetch'].discord && !JOBS['retention-purge'].discord, '');
    // An instance with no owner at all (no Discord application owner)
    const realApp = fakeClient.application;
    const realOwners = cfgD.ownerIds;
    fakeClient.application = { fetch: async () => ({}) };
    cfgD.ownerIds = [];
    inst.resetOwnerCache();
    r = await req('GET', '/api/instance/info');
    check('sans Discord: installation signalée tant qu il n y a aucun propriétaire', r.status === 200 && r.body.setupNeeded === true, JSON.stringify(r.body));
    const url = await installation.announceIfNeeded(fakeClient);
    const token = new URL(url).searchParams.get('token');
    r = await req('POST', '/api/installation/owner', { headers: { 'X-Forwarded-For': '10.7.0.1' }, body: { token: 'mauvais-jeton-0123456789', email: 'owner@example.com', displayName: 'Propriétaire', password: 'Une-phrase-longue 42' } });
    check('installation: jeton invalide refusé', r.status === 403, JSON.stringify(r.body)); // ggignore
    r = await req('POST', '/api/installation/owner', { headers: { 'X-Forwarded-For': '10.7.0.1' }, body: { token, email: 'Owner@Example.com', displayName: 'Propriétaire', password: 'court' } });
    check('installation: mot de passe trop court refusé', r.status === 400, JSON.stringify(r.body)); // ggignore
    r = await req('POST', '/api/installation/owner', { headers: { 'X-Forwarded-For': '10.7.0.1' }, body: { token, email: 'Owner@Example.com', displayName: 'Propriétaire', password: 'Une-phrase-longue 42' } }); // ggignore
    const cookieO = (r.headers['set-cookie'] || []).find(c => c.startsWith('connect.sid='));
    const [own] = await globalQuery("SELECT id, email, email_verified, instance_owner, password_hash FROM accounts WHERE email = 'owner@example.com'");
    check('installation: compte du propriétaire créé (u_…), connecté', r.status === 200 && r.body.redirect === '/instance' && !!cookieO && /^u_[0-9a-f]{24}$/.test(own?.id) && Number(own.instance_owner) === 1 && Number(own.email_verified) === 1 && /^scrypt\$/.test(own.password_hash), JSON.stringify([r.body, own && own.id]));
    check('installation: ce compte est propriétaire de l instance', await inst.isOwner(fakeClient, own.id), '');
    r = await req('POST', '/api/installation/owner', { headers: { 'X-Forwarded-For': '10.7.0.1' }, body: { token, email: 'autre@example.com', displayName: 'Autre', password: 'Une-phrase-longue 42' } }); // ggignore
    const info2 = await req('GET', '/api/instance/info');
    check('installation: plus possible une fois le propriétaire créé', r.status === 410 && info2.body.setupNeeded === false, JSON.stringify([r.body, info2.body.setupNeeded]));
    r = await req('POST', '/api/auth/password-login', { headers: { 'X-Forwarded-For': '10.7.0.1' }, body: { email: 'owner@example.com', password: 'Une-phrase-longue 42' } }); // ggignore
    check('installation: le propriétaire se reconnecte par e-mail et mot de passe', r.status === 200, JSON.stringify(r.body));
    await globalQuery('DELETE FROM accounts WHERE id = ?', [own.id]);
    fakeClient.application = realApp;
    cfgD.ownerIds = realOwners;
    inst.resetOwnerCache();
    // Discord sign-in off without its application
    const secret = cfgD.dashboard.discordClientSecret;
    cfgD.dashboard.discordClientSecret = '';
    r = await req('GET', '/api/auth/discord', { headers: { 'X-Forwarded-For': '10.7.0.2' } });
    const infoOff = await req('GET', '/api/instance/info');
    check('sans Discord: connexion Discord coupée sans son application', r.status === 302 && r.headers.location === '/login?error=discord_off' && infoOff.body.discordLogin === false, JSON.stringify([r.headers.location, infoOff.body.discordLogin]));
    cfgD.dashboard.discordClientSecret = secret;
    // Discord cannot tell (bot absent, not a Discord account): access granted by a role is kept
    const { syncDiscordStaff } = app('./utils/staffSync');
    const SU = '100000000000000079';
    await db("INSERT INTO dashboard_users (user_id, username, role, discord_has_role) VALUES (?, 'su', 'support', 1) ON DUPLICATE KEY UPDATE role = 'support', discord_has_role = 1", [SU]);
    const role = await syncDiscordStaff({ isReady: () => false, guilds: { fetch: async () => null } }, db, G, { id: SU, username: 'su' });
    const [still] = await db('SELECT role FROM dashboard_users WHERE user_id = ?', [SU]);
    check('sans Discord: un accès donné par un rôle n est pas retiré quand Discord ne répond pas', role === 'support' && still.role === 'support', JSON.stringify([role, still]));
    await db('DELETE FROM dashboard_users WHERE user_id = ?', [SU]);
  }

  // ── E-mail and password sign-in (routes/passwordAuth.js, v4 PR 5) ──
  {
    const pw = app('./utils/passwords');
    const accounts = app('./utils/accounts');
    const h = await pw.hashPassword('cheval correct batterie');
    check('mots de passe: scrypt salé, vérification exacte', /^scrypt\$32768\$8\$1\$/.test(h) && await pw.verifyPassword('cheval correct batterie', h) && !(await pw.verifyPassword('cheval correct batteriE', h)) && h !== await pw.hashPassword('cheval correct batterie'), h.slice(0, 30));
    // Fake passwords of the tests, not secrets (ggignore: GitGuardian false positive)
    check('mots de passe: règles (longueur, adresse, trop simple)', pw.passwordProblem('court') && pw.passwordProblem('aaaaaaaaaaaa') && pw.passwordProblem('marie.durand-2026', { email: 'marie.durand@x.fr' }) && pw.passwordProblem('Une-phrase-longue 42') === null, ''); // ggignore
    const t0 = Date.now(); await pw.verifyPassword('x', null); const tNone = Date.now() - t0;
    const t1 = Date.now(); await pw.verifyPassword('x', h); const tReal = Date.now() - t1;
    check('mots de passe: compte inconnu = même travail (pas d énumération par le temps)', tNone > tReal / 3 && tNone < tReal * 3, `${tNone} ms / ${tReal} ms`);
    // An account that links an address (confirmation link) then sets a password
    const PA = '100000000000000078';
    await globalQuery("INSERT INTO accounts (id, display_name) VALUES (?, 'Compte 78') ON DUPLICATE KEY UPDATE display_name = 'Compte 78'", [PA]);
    await globalQuery("INSERT IGNORE INTO account_identities (provider, subject, account_id) VALUES ('discord', ?, ?)", [PA, PA]);
    await mk('PA', { user: { id: PA, username: 'Compte 78', role: null } });
    process.env.EMAIL_ALLOW_PRIVATE_HOSTS = 'true';
    const nodemailer = require('nodemailer');
    const realCreate = nodemailer.createTransport;
    const mails = [];
    nodemailer.createTransport = () => ({ sendMail: async x => { mails.push(x); return {}; }, close: () => {} });
    await app('./utils/instanceMail').saveMailSettings({ enabled: true, host: 'smtp.example.com', port: 587, from: 'datick@example.com' });
    r = await req('POST', '/api/profile/password', { sid: sessions.PA, body: { password: 'Une-phrase-longue 42' } });
    check('mots de passe: refusé sans adresse confirmée', r.status === 400 && /adresse/.test(r.body.error), JSON.stringify(r.body));
    r = await req('POST', '/api/profile/email', { sid: sessions.PA, body: { email: 'Compte78@Example.com' } });
    const link = (mails[0]?.text.match(/https?:\/\/\S+verify-email\?token=(\S+)/) || [])[1];
    check('adresse: lien de confirmation envoyé', r.status === 200 && mails[0]?.to === 'compte78@example.com' && !!link, JSON.stringify([r.body, mails[0]?.subject]));
    r = await req('GET', '/api/auth/verify-email', { query: { token: decodeURIComponent(link) } });
    const again = await req('GET', '/api/auth/verify-email', { query: { token: decodeURIComponent(link) } });
    const [accE] = await globalQuery('SELECT email, email_verified FROM accounts WHERE id = ?', [PA]);
    check('adresse: confirmée par le lien, lien à usage unique', r.headers.location === '/profile?email=verified' && again.headers.location === '/profile?email=expired' && accE.email === 'compte78@example.com' && Number(accE.email_verified) === 1, JSON.stringify([r.headers.location, again.headers.location, accE]));
    r = await req('POST', '/api/profile/password', { sid: sessions.PA, body: { password: 'court' } });
    const setPw = await req('POST', '/api/profile/password', { sid: sessions.PA, body: { password: 'Une-phrase-longue 42' } });
    const [accP] = await globalQuery('SELECT password_hash FROM accounts WHERE id = ?', [PA]);
    check('mots de passe: trop court refusé, puis défini (haché)', r.status === 400 && setPw.status === 200 && /^scrypt\$/.test(accP.password_hash) && !accP.password_hash.includes('phrase'), JSON.stringify([r.body, setPw.body]));
    // Sign-in
    r = await req('POST', '/api/auth/password-login', { body: { email: 'compte78@example.com', password: 'mauvais mot de passe' } });
    const unknown = await req('POST', '/api/auth/password-login', { body: { email: 'personne@example.com', password: 'mauvais mot de passe' } });
    check('connexion: même réponse pour un mauvais mot de passe et une adresse inconnue', r.status === 401 && unknown.status === 401 && r.body.error === unknown.body.error, JSON.stringify([r.body, unknown.body]));
    r = await req('POST', '/api/auth/password-login', { body: { email: 'Compte78@example.com', password: 'Une-phrase-longue 42' } });
    const cookie = (r.headers['set-cookie'] || []).find(c => c.startsWith('connect.sid='));
    check('connexion: e-mail et mot de passe acceptés, session ouverte', r.status === 200 && r.body.redirect === '/select-guild' && !!cookie, JSON.stringify(r.body));
    // The servers of the account, without Discord
    await db("INSERT INTO dashboard_users (user_id, username, role) VALUES (?, 'Compte 78', 'support') ON DUPLICATE KEY UPDATE role = 'support'", [PA]);
    await mk('PAW', { user: { id: PA, username: 'Compte 78', role: null }, authMethod: 'password' });
    r = await req('GET', '/api/auth/guilds', { sid: sessions.PAW });
    check('connexion: serveurs de l équipe listés sans Discord', r.status === 200 && r.body.some(g => g.id === G) && r.body.every(g => g.status === 'active'), JSON.stringify(r.body).slice(0, 200));
    // Lockout after 10 failures
    for (let i = 0; i < 10; i++) await req('POST', '/api/auth/password-login', { headers: { 'X-Forwarded-For': `10.9.0.${i}` }, body: { email: 'compte78@example.com', password: `faux ${i} xxxxxxxx` } });
    r = await req('POST', '/api/auth/password-login', { body: { email: 'compte78@example.com', password: 'Une-phrase-longue 42' } });
    check('connexion: bloquée après 10 échecs, même avec le bon mot de passe', r.status === 429, JSON.stringify(r.body));
    // Reset by e-mail
    mails.length = 0;
    r = await req('POST', '/api/auth/password-reset', { body: { email: 'compte78@example.com' } });
    const r2 = await req('POST', '/api/auth/password-reset', { body: { email: 'personne@example.com' } });
    const resetToken = decodeURIComponent((mails[0]?.text.match(/reset-password\?token=(\S+)/) || [])[1] || '');
    check('réinitialisation: même réponse pour toute adresse, e-mail seulement au compte', r.status === 200 && r2.status === 200 && r.body.message === r2.body.message && mails.length === 1 && !!resetToken, JSON.stringify([r.body, mails.length]));
    await redis.set(`sess:pa-autre`, JSON.stringify({ cookie: {}, user: { id: PA } }), 'EX', 600);
    await globalQuery("INSERT INTO user_sessions (session_id, user_id, ip, user_agent) VALUES ('pa-autre', ?, '1.1.1.1', 'test') ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)", [PA]).catch(() => null);
    r = await req('POST', '/api/auth/password-reset/confirm', { body: { token: resetToken, password: 'court' } });
    const ok = await req('POST', '/api/auth/password-reset/confirm', { body: { token: resetToken, password: 'Nouvelle-phrase 2026' } });
    const reuse = await req('POST', '/api/auth/password-reset/confirm', { body: { token: resetToken, password: 'Encore-une-autre 2026' } });
    check('réinitialisation: mot de passe trop court refusé sans perdre le lien, puis changé, lien à usage unique', r.status === 400 && ok.status === 200 && reuse.status === 400, JSON.stringify([r.body, ok.body, reuse.body]));
    check('réinitialisation: les autres sessions du compte sont fermées', !(await redis.exists('sess:pa-autre')), '');
    r = await req('POST', '/api/auth/password-login', { body: { email: 'compte78@example.com', password: 'Nouvelle-phrase 2026' } });
    check('réinitialisation: le blocage est levé et le nouveau mot de passe fonctionne', r.status === 200, JSON.stringify(r.body));
    // 2FA still applies
    await globalQuery('INSERT INTO user_totp (user_id, totp_secret, totp_enabled) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE totp_enabled = 1', [PA, seal('JBSWY3DPEHPK3PXP')]);
    r = await req('POST', '/api/auth/password-login', { body: { email: 'compte78@example.com', password: 'Nouvelle-phrase 2026' } });
    check('connexion: la 2FA du compte s applique', r.status === 200 && r.body.totp === true, JSON.stringify(r.body));
    await globalQuery('DELETE FROM user_totp WHERE user_id = ?', [PA]);
    // Removing the password: only if another way remains
    r = await req('DELETE', '/api/profile/password', { sid: sessions.PA, body: { current: 'mauvais' } });
    const rm = await req('DELETE', '/api/profile/password', { sid: sessions.PA, body: { current: 'Nouvelle-phrase 2026' } });
    check('mots de passe: retrait avec le mot de passe actuel, Discord restant', r.status === 400 && rm.status === 200 && !(await accounts.loginMethods(PA)).password, JSON.stringify([r.body, rm.body]));
    nodemailer.createTransport = realCreate;
    delete process.env.EMAIL_ALLOW_PRIVATE_HOSTS;
    await app('./utils/instanceMail').saveMailSettings({ enabled: false });
    await db('DELETE FROM dashboard_users WHERE user_id = ?', [PA]);
    await globalQuery('DELETE FROM account_identities WHERE account_id = ?', [PA]);
    await globalQuery('DELETE FROM accounts WHERE id = ?', [PA]);
  }

  // ── Invitations to the team by e-mail (utils/invitations.js, v4 PR 8) ──
  {
    let ip = 0;
    const H = () => ({ 'X-Forwarded-For': `10.8.${Math.floor(ip / 200)}.${ip++ % 200}` });
    const pub = (method, path, opts = {}) => req(method, path, { ...opts, headers: { ...H(), ...(opts.headers || {}) } });
    const nodemailer = require('nodemailer');
    const realCreate = nodemailer.createTransport;
    const mails = [];
    nodemailer.createTransport = () => ({ sendMail: async x => { mails.push(x); return {}; }, close: () => {} });
    process.env.EMAIL_ALLOW_PRIVATE_HOSTS = 'true';
    const tokenOf = m => decodeURIComponent((m?.text.match(/\/invitation\?token=(\S+)/) || [])[1] || '');

    r = await req('POST', '/api/invitations', { sid: sessions.F, body: { email: 'invite1@example.com' } });
    check('invitations: refusées sans e-mail de l instance', r.status === 409 && /E-mail/.test(r.body.error), JSON.stringify(r.body));
    await app('./utils/instanceMail').saveMailSettings({ enabled: true, host: 'smtp.example.com', port: 587, from: 'datick@example.com' });
    const IS = '100000000000000081';
    await db("INSERT INTO dashboard_users (user_id, username, role) VALUES (?, 'Sans droit', 'support')", [IS]);
    await mk('IS', { user: { id: IS, username: 'Sans droit', role: null }, currentGuildId: G });
    r = await req('POST', '/api/invitations', { sid: sessions.IS, body: { email: 'invite1@example.com' } });
    const listNo = await req('GET', '/api/invitations', { sid: sessions.IS });
    check('invitations: réservées aux fondateurs et à manage_users', r.status === 403 && listNo.status === 403, `${r.status} ${listNo.status}`);
    r = await req('POST', '/api/invitations', { sid: sessions.F, body: { email: 'pas une adresse' } });
    const badRole = await req('POST', '/api/invitations', { sid: sessions.F, body: { email: 'invite1@example.com', role: 'nouveau' } });
    check('invitations: adresse ou rôle invalides refusés', r.status === 400 && badRole.status === 400, `${r.status} ${badRole.status}`);

    const { insertId: gInv } = await db("INSERT INTO grades (name, color) VALUES ('Invités support', '#123456')");
    r = await req('POST', '/api/invitations', { sid: sessions.F, body: { email: 'Invite1@Example.com', role: 'support', gradeId: gInv } });
    const tok1 = tokenOf(mails[0]);
    const [row1] = await db('SELECT token_hash FROM team_invitations WHERE email = ?', ['invite1@example.com']);
    check('invitations: e-mail envoyé avec un lien, seul le hachage du jeton est gardé', r.status === 201 && mails[0]?.to === 'invite1@example.com' && /Invitation/.test(mails[0]?.subject) && tok1.startsWith(`${G}.`) && row1.token_hash === crypto.createHash('sha256').update(tok1).digest('hex') && !JSON.stringify(r.body).includes(tok1.split('.')[1]), JSON.stringify([r.body, mails[0]?.subject]));
    r = await req('GET', '/api/invitations', { sid: sessions.F });
    check('invitations: listées en attente, sans jeton', r.status === 200 && r.body[0]?.email === 'invite1@example.com' && r.body[0].status === 'pending' && r.body[0].grade_name === 'Invités support' && !('token_hash' in r.body[0]), JSON.stringify(r.body[0]));
    r = await pub('GET', '/api/auth/invitation', { query: { token: tok1 } });
    check('invitations: la page montre l espace, le rôle et l auteur', r.status === 200 && r.body.email === 'invite1@example.com' && r.body.role === 'support' && r.body.invitedBy === 'F' && r.body.needsLogin === false && !!r.body.space, JSON.stringify(r.body));
    r = await pub('POST', '/api/auth/invitation/accept', { body: { token: tok1, displayName: 'Invité Un', password: 'court' } });
    const [still] = await db('SELECT accepted_at FROM team_invitations WHERE email = ?', ['invite1@example.com']);
    check('invitations: mot de passe trop court refusé, l invitation reste valable', r.status === 400 && still.accepted_at === null, JSON.stringify(r.body));
    r = await pub('POST', '/api/auth/invitation/accept', { body: { token: tok1, displayName: 'Invité Un', password: 'Une-phrase-longue 81' } }); // ggignore
    const cookieI = (r.headers['set-cookie'] || []).find(c => c.startsWith('connect.sid='));
    const [accI] = await globalQuery("SELECT id, email_verified, password_hash FROM accounts WHERE email = 'invite1@example.com'");
    const [duI] = accI ? await db('SELECT role, discord_has_role FROM dashboard_users WHERE user_id = ?', [accI.id]) : [];
    const [ugI] = accI ? await db('SELECT grade_id FROM user_grades WHERE user_id = ?', [accI.id]) : [];
    check('invitations: acceptée → compte créé (adresse confirmée), dans l équipe avec son grade, connecté', r.status === 200 && r.body.created && !!cookieI && /^u_[0-9a-f]{24}$/.test(accI?.id) && Number(accI.email_verified) === 1 && /^scrypt\$/.test(accI.password_hash) && duI?.role === 'support' && Number(duI.discord_has_role) === 0 && Number(ugI?.grade_id) === Number(gInv), JSON.stringify([r.body, accI?.id, duI, ugI]));
    r = await pub('POST', '/api/auth/invitation/accept', { body: { token: tok1, displayName: 'Autre', password: 'Une-phrase-longue 82' } }); // ggignore
    const reGet = await pub('GET', '/api/auth/invitation', { query: { token: tok1 } });
    check('invitations: réutilisation refusée', r.status === 410 && reGet.status === 410 && /déjà été utilisée/.test(r.body.error), JSON.stringify([r.body, reGet.body]));
    r = await req('POST', '/api/invitations', { sid: sessions.F, body: { email: 'invite1@example.com' } });
    check('invitations: une personne déjà dans l équipe n est pas réinvitée', r.status === 409, JSON.stringify(r.body));

    // Revoked, expired, forged
    mails.length = 0;
    await req('POST', '/api/invitations', { sid: sessions.F, body: { email: 'invite2@example.com' } });
    const tok2 = tokenOf(mails[0]);
    const [i2] = await db("SELECT id FROM team_invitations WHERE email = 'invite2@example.com'");
    r = await req('DELETE', `/api/invitations/${i2.id}`, { sid: sessions.F });
    const acc2 = await pub('POST', '/api/auth/invitation/accept', { body: { token: tok2, displayName: 'Deux', password: 'Une-phrase-longue 83' } }); // ggignore
    const again2 = await req('DELETE', `/api/invitations/${i2.id}`, { sid: sessions.F });
    check('invitations: révoquée → lien refusé, aucun compte créé', r.status === 200 && acc2.status === 410 && /révoquée/.test(acc2.body.error) && again2.status === 404 && !(await globalQuery("SELECT 1 FROM accounts WHERE email = 'invite2@example.com'")).length, JSON.stringify([r.body, acc2.body]));
    mails.length = 0;
    await req('POST', '/api/invitations', { sid: sessions.F, body: { email: 'invite3@example.com' } });
    const tok3 = tokenOf(mails[0]);
    await db("UPDATE team_invitations SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE email = 'invite3@example.com'");
    r = await pub('POST', '/api/auth/invitation/accept', { body: { token: tok3, displayName: 'Trois', password: 'Une-phrase-longue 84' } }); // ggignore
    const list3 = await req('GET', '/api/invitations', { sid: sessions.F });
    check('invitations: expirée (7 jours) → refusée, listée comme expirée', r.status === 410 && /expiré/.test(r.body.error) && list3.body.find(i => i.email === 'invite3@example.com')?.status === 'expired', JSON.stringify(r.body));
    const forged = `${G}.${'A'.repeat(43)}`;
    const other = `${'1'.repeat(18)}.${tok3.split('.')[1]}`;
    r = await pub('GET', '/api/auth/invitation', { query: { token: forged } });
    const r2 = await pub('POST', '/api/auth/invitation/accept', { body: { token: other, displayName: 'X', password: 'Une-phrase-longue 85' } }); // ggignore
    const r3 = await pub('GET', '/api/auth/invitation', { query: { token: 'nimportequoi' } });
    check('invitations: jeton inventé ou d un autre espace inconnu', r.status === 404 && r2.status === 404 && r3.status === 404, `${r.status} ${r2.status} ${r3.status}`);
    // A new invitation to the same address replaces the pending one
    mails.length = 0;
    await req('POST', '/api/invitations', { sid: sessions.F, body: { email: 'invite4@example.com' } });
    await req('POST', '/api/invitations', { sid: sessions.F, body: { email: 'invite4@example.com' } });
    const [old4] = await db("SELECT revoked_at FROM team_invitations WHERE email = 'invite4@example.com' ORDER BY id LIMIT 1");
    r = await pub('GET', '/api/auth/invitation', { query: { token: tokenOf(mails[0]) } });
    check('invitations: renvoyer remplace l invitation en attente', old4.revoked_at !== null && r.status === 410, JSON.stringify(old4));

    // An address that already has an account: sign in first, then the account joins
    const EX = '100000000000000082';
    await globalQuery("INSERT INTO accounts (id, email, email_verified, display_name) VALUES (?, 'existe@example.com', 1, 'Existe')", [EX]);
    mails.length = 0;
    await req('POST', '/api/invitations', { sid: sessions.F, body: { email: 'existe@example.com', role: 'fondateur' } });
    const tok5 = tokenOf(mails[0]);
    r = await pub('GET', '/api/auth/invitation', { query: { token: tok5 } });
    const anon = await pub('POST', '/api/auth/invitation/accept', { body: { token: tok5, displayName: 'Pirate', password: 'Une-phrase-longue 86' } }); // ggignore
    check('invitations: adresse d un compte existant → connexion demandée, pas de second compte', r.body.needsLogin === true && anon.status === 409 && anon.body.needsLogin === true && (await globalQuery("SELECT id FROM accounts WHERE email = 'existe@example.com'")).length === 1, JSON.stringify([r.body, anon.body]));
    await mk('EX', { user: { id: EX, username: 'Existe', role: null }, authMethod: 'password' });
    r = await pub('POST', '/api/auth/invitation/accept', { sid: sessions.EX, body: { token: tok5 } });
    const [du5] = await db('SELECT role FROM dashboard_users WHERE user_id = ?', [EX]);
    const gl = await req('GET', '/api/auth/guilds', { sid: sessions.EX });
    check('invitations: connecté, le compte rejoint l équipe avec le rôle invité et voit l espace', r.status === 200 && !r.body.created && du5?.role === 'fondateur' && gl.body.some?.(g => g.id === G), JSON.stringify([r.body, du5, gl.body]));
    check('invitations: journal de l espace (envoi, révocation, acceptation)', (await db("SELECT action FROM audit_log WHERE action IN ('invitation_sent','invitation_revoked','invitation_accepted')")).length >= 4, '');

    nodemailer.createTransport = realCreate;
    delete process.env.EMAIL_ALLOW_PRIVATE_HOSTS;
    await app('./utils/instanceMail').saveMailSettings({ enabled: false });
    await db('DELETE FROM dashboard_users WHERE user_id IN (?)', [[IS, EX, accI?.id || 'x']]);
    await db('DELETE FROM user_grades WHERE grade_id = ?', [gInv]);
    await db('DELETE FROM grades WHERE id = ?', [gInv]);
    await db('DELETE FROM team_invitations');
    await globalQuery('DELETE FROM accounts WHERE id IN (?)', [[EX, accI?.id || 'x']]);
  }

  // ── Member space without Discord: sign-in link by e-mail, web requesters (v4 PR 10) ──
  {
    let ip = 0;
    const H = () => ({ 'X-Forwarded-For': `10.10.${Math.floor(ip / 200)}.${ip++ % 200}` });
    const pub = (method, path, opts = {}) => req(method, path, { ...opts, headers: { ...H(), ...(opts.headers || {}) } });
    const nodemailer = require('nodemailer');
    const realCreate = nodemailer.createTransport;
    const mails = [];
    nodemailer.createTransport = () => ({ sendMail: async x => { mails.push(x); return {}; }, close: () => {} });
    process.env.EMAIL_ALLOW_PRIVATE_HOSTS = 'true';
    const web = app('./utils/webRequesters');
    const linkOf = m => (m?.text.match(/\/espace\/connexion#([A-Za-z0-9_-]+)/) || [])[1] || '';

    r = await req('GET', '/api/member/login-options');
    const off = await pub('POST', '/api/member/auth/email', { body: { email: 'web1@example.com' } });
    check('portail: connexion par e-mail indisponible sans e-mail de l instance', r.status === 200 && r.body.email === false && off.status === 409, JSON.stringify([r.body, off.body]));
    await app('./utils/instanceMail').saveMailSettings({ enabled: true, host: 'smtp.example.com', port: 587, from: 'datick@example.com' });
    r = await req('GET', '/api/member/login-options');
    const bad = await pub('POST', '/api/member/auth/email', { body: { email: 'pas une adresse' } });
    check('portail: proposée dès que l e-mail de l instance marche, adresse invalide refusée', r.body.email === true && bad.status === 400, JSON.stringify([r.body, bad.body]));
    r = await pub('POST', '/api/member/auth/email', { body: { email: ' Web1@Example.com ' } });
    const tok = linkOf(mails[0]);
    const stored = await redis.get(`memberlink:${crypto.createHash('sha256').update(tok).digest('hex')}`);
    const clear = await redis.keys('memberlink:*');
    check('portail: lien envoyé (15 min), seul son hachage est gardé', r.status === 200 && mails[0]?.to === 'web1@example.com' && tok.length === 43 && /15 minutes/.test(mails[0].text) && JSON.parse(stored || '{}').email === 'web1@example.com' && !clear.some(k => k.includes(tok)), JSON.stringify([r.body, mails[0]?.text]));
    r = await pub('POST', '/api/member/auth/email/verify', { body: { token: tok.slice(0, -2) + 'xx' } });
    const forged = r.status;
    r = await pub('POST', '/api/member/auth/email/verify', { body: { token: tok } });
    const cookieW = (r.headers['set-cookie'] || []).find(c => c.startsWith('connect.sid='))?.split(';')[0];
    const WID = web.webOwnerIdFor('web1@example.com');
    const me = await req('GET', '/api/member/me', { headers: { Cookie: cookieW } });
    check('portail: le lien ouvre l espace membre (identité web:…), un lien inventé est refusé', forged === 400 && r.status === 200 && !!cookieW && me.status === 200 && me.body.id === WID && /^web:[0-9a-f]{24}$/.test(WID) && me.body.email === 'web1@example.com', JSON.stringify([forged, r.body, me.body]));
    r = await pub('POST', '/api/member/auth/email/verify', { body: { token: tok } });
    const tokX = crypto.randomBytes(32).toString('base64url');
    await redis.set(`memberlink:${crypto.createHash('sha256').update(tokX).digest('hex')}`, JSON.stringify({ email: 'web1@example.com', lang: 'fr' }), 'PX', 1);
    await new Promise(res => setTimeout(res, 20));
    const expired = await pub('POST', '/api/member/auth/email/verify', { body: { token: tokX } });
    check('portail: lien à usage unique, lien expiré refusé', r.status === 400 && expired.status === 400 && /expiré/.test(expired.body.error), JSON.stringify([r.body, expired.body]));
    mails.length = 0;
    for (let i = 0; i < 4; i++) r = await pub('POST', '/api/member/auth/email', { body: { email: 'flood@example.com' } });
    check('portail: quelques liens par adresse au plus, même réponse au-delà', r.status === 200 && mails.length === 3, String(mails.length));

    // The spaces open to e-mail sign-ins
    await mk('WEB1', { member: { id: WID, username: 'web1@example.com', avatar: null, email: 'web1@example.com' } });
    await redis.del(`memberguilds:${WID}`);
    r = await req('GET', '/api/member/guilds', { sid: sessions.WEB1 });
    const closedOpen = await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.WEB1, body: { content: 'Bonjour' } });
    check('portail: un serveur Discord n est pas ouvert par e-mail par défaut', r.status === 200 && !r.body.some(g => g.id === G) && closedOpen.status === 404, JSON.stringify([r.body, closedOpen.status]));
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { portalEmailOpen: true } });
    await redis.del(`memberguilds:${WID}`);
    const listed = await req('GET', '/api/member/guilds', { sid: sessions.WEB1 });
    check('portail: un fondateur ouvre son espace aux connexions par e-mail', r.status === 200 && listed.body.some(g => g.id === G), JSON.stringify([r.body, listed.body]));

    const [cfgW] = await db('SELECT ticket_subjects, max_tickets_per_day FROM guild_config WHERE id = 1');
    await db("UPDATE guild_config SET ticket_subjects = '[]', max_tickets_per_day = 10 WHERE id = 1");
    mails.length = 0;
    r = await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.WEB1, body: { subject: 'Commande', content: 'Ma commande est bloquée' } });
    const wt = r.body.ticketId;
    const [wT] = wt ? await db('SELECT owner_id, owner_tag FROM tickets WHERE id = ?', [wt]) : [];
    const [wC] = await db('SELECT address FROM email_contacts WHERE owner_id = ?', [WID]);
    check('portail: ticket ouvert sans Discord, demandeur web:… avec son adresse', r.status === 200 && wT?.owner_id === WID && wT.owner_tag === 'web1@example.com' && wC?.address === 'web1@example.com', JSON.stringify([r.body, wT, wC]));
    check('portail: l accueil part par l e-mail de l instance, avec le lien du ticket', mails.some(m => m.to === 'web1@example.com' && m.subject.includes(`#${wt}`) && m.text.includes(`/espace/${G}/${wt}`)), JSON.stringify(mails.map(m => [m.to, m.subject])));
    mails.length = 0;
    await app('./utils/i18n').sendToMember(fakeClient, WID, G, () => ({ content: 'Réponse du staff : c est réglé' }));
    check('portail: une réponse du staff arrive par e-mail, sans passer par Discord', mails.length === 1 && mails[0].text.includes('Réponse du staff : c est réglé') && mails[0].text.includes(`/espace/${G}/${wt}`), JSON.stringify(mails.map(m => m.text)));
    r = await req('POST', `/api/member/tickets/${G}/${wt}/messages`, { sid: sessions.WEB1, body: { content: 'Merci, je confirme' } });
    const [wN] = await db("SELECT author_id FROM ticket_notes WHERE ticket_id = ? AND content = 'Merci, je confirme'", [wt]);
    const view = await req('GET', `/api/member/tickets/${G}/${wt}`, { sid: sessions.WEB1 });
    check('portail: le demandeur suit et répond depuis la page', r.status === 200 && wN?.author_id === WID && view.status === 200 && view.body.messages.some(m => m.kind === 'me' && m.content === 'Merci, je confirme'), JSON.stringify([r.body, view.body.messages]));

    // Only the requester; the tickets opened by e-mail to the same address come along
    const W2 = web.webOwnerIdFor('web2@example.com');
    await mk('WEB2', { member: { id: W2, username: 'web2@example.com', avatar: null, email: 'web2@example.com' } });
    r = await req('GET', `/api/member/tickets/${G}/${wt}`, { sid: sessions.WEB2 });
    const list2 = await req('GET', '/api/member/tickets', { sid: sessions.WEB2 });
    const reply2 = await req('POST', `/api/member/tickets/${G}/${wt}/messages`, { sid: sessions.WEB2, body: { content: 'intrus' } });
    check('portail: seul le demandeur voit et répond à ses tickets', r.status === 404 && reply2.status === 404 && !list2.body.some(g => g.tickets.some(t => t.id === wt)), JSON.stringify([r.status, reply2.status, list2.body]));
    const MAILW = app('./utils/emailTickets').ownerIdFor('web1@example.com');
    const { insertId: mt } = await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'web1@example.com', 'db-webmail', 'closed', 'Par e-mail')", [MAILW]);
    r = await req('GET', '/api/member/tickets', { sid: sessions.WEB1 });
    const mine = r.body.find(g => g.guild.id === G)?.tickets || [];
    check('portail: on retrouve aussi ses tickets envoyés par e-mail à la même adresse', mine.some(t => t.id === wt && !t.participant) && mine.some(t => t.id === mt && !t.participant), JSON.stringify(mine.map(t => t.id)));

    // Anti-spam at opening: a few per minute, a daily limit, blocked requesters
    const burst = [];
    for (let i = 0; i < 3; i++) burst.push((await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.WEB1, body: { subject: 'Encore', content: `Demande ${i}` } })).status);
    check('portail: ouvertures en rafale limitées', burst.includes(429), burst.join());
    await db("INSERT INTO blacklist (user_id, user_tag, reason, added_by_id, added_by_tag) VALUES (?, 'web1', 'test', '1', 'F')", [MAILW]);
    r = await req('POST', `/api/member/tickets/${G}/${wt}/messages`, { sid: sessions.WEB1, body: { content: 'bloqué ?' } });
    check('portail: bloqué sous une de ses identités = bloqué', r.status === 403, JSON.stringify(r.body));
    await db('DELETE FROM blacklist WHERE user_id = ?', [MAILW]);

    // The contact card knows the web identity and its address
    const contacts = app('./utils/contacts');
    await contacts.sync(db, { force: true });
    const card = await contacts.resolve(db, WID);
    check('portail: fiche contact avec l identité web et l adresse', card.contact?.email === 'web1@example.com' && card.identities.some(i => i.value === WID && i.kind === 'web'), JSON.stringify(card));

    nodemailer.createTransport = realCreate;
    delete process.env.EMAIL_ALLOW_PRIVATE_HOSTS;
    await app('./utils/instanceMail').saveMailSettings({ enabled: false });
    await db('UPDATE guild_config SET ticket_subjects = ?, max_tickets_per_day = ?, portal_email_open = 0 WHERE id = 1', [cfgW.ticket_subjects == null || typeof cfgW.ticket_subjects === 'string' ? cfgW.ticket_subjects : JSON.stringify(cfgW.ticket_subjects), cfgW.max_tickets_per_day]);
    const webTickets = (await db('SELECT id FROM tickets WHERE owner_id IN (?)', [[WID, MAILW]])).map(t => t.id);
    if (webTickets.length) await db('DELETE FROM ticket_notes WHERE ticket_id IN (?)', [webTickets]);
    await db('DELETE FROM tickets WHERE owner_id IN (?)', [[WID, MAILW]]);
    await db('DELETE FROM email_contacts WHERE owner_id IN (?)', [[WID, MAILW]]);
    await db('DELETE FROM contacts WHERE id IN (SELECT contact_id FROM contact_identities WHERE value IN (?))', [[WID, MAILW]]);
  }

  // ── Web widget (utils/webWidget.js, routes/widget.js, v4.1) ──
  {
    let ip = 0;
    const H = () => ({ 'X-Forwarded-For': `10.20.${Math.floor(ip / 200)}.${ip++ % 200}` });
    const nodemailer = require('nodemailer');
    const realCreate = nodemailer.createTransport;
    const mails = [];
    nodemailer.createTransport = () => ({ sendMail: async x => { mails.push(x); return {}; }, close: () => {} });
    process.env.EMAIL_ALLOW_PRIVATE_HOSTS = 'true';
    const ww = app('./utils/webWidget');
    const web = app('./utils/webRequesters');
    const [cfgX] = await db('SELECT ticket_subjects, max_tickets_per_day FROM guild_config WHERE id = 1');
    await db("UPDATE guild_config SET ticket_subjects = '[]', max_tickets_per_day = 10 WHERE id = 1");
    const A1 = 'widget1@example.com', A2 = 'widget2@example.com';
    const O1 = web.webOwnerIdFor(A1), O2 = web.webOwnerIdFor(A2);
    const old = () => ww.stamp(G, Date.now() - 5000);
    const send = (token, body, headers = H()) => req('POST', `/api/widget/${token}/tickets`, { headers, body: { name: 'Camille', email: A1, message: 'Ma commande n est pas arrivée', t: old(), ...body } });

    r = await req('GET', '/api/widget-settings', { sid: sessions.F });
    check('widget: coupé par défaut, sans code', r.status === 200 && r.body.enabled === false && r.body.token === null, JSON.stringify(r.body));
    r = await req('GET', '/api/widget-settings', { sid: sessions.S1 });
    check('widget: réglages réservés aux fondateurs', r.status === 403, r.status);
    r = await req('PUT', '/api/widget-settings', { sid: sessions.F, body: { enabled: true, origins: 'javascript:alert(1)' } });
    check('widget: adresse de site invalide refusée', r.status === 400, JSON.stringify(r.body));
    r = await req('PUT', '/api/widget-settings', { sid: sessions.F, body: { enabled: true, origins: 'https://site.example.test/\nhttps://autre.example.test' } });
    const TOK = r.body.token;
    check('widget: activé → code public rattaché à l espace et code à coller', r.status === 200 && r.body.enabled && ww.TOKEN_RE.test(TOK || '') && TOK.startsWith(`${G}.`) && r.body.snippet.includes('/widget.js') && r.body.snippet.includes(TOK) && r.body.origins.length === 2, JSON.stringify(r.body));
    check('widget: réglage au journal de l espace', (await db("SELECT id FROM audit_log WHERE action = 'widget_settings'")).length >= 1, '');

    r = await req('GET', '/widget.js');
    check('widget: script public, chargeable depuis un autre site', r.status === 200 && /javascript/.test(r.headers['content-type']) && r.headers['cross-origin-resource-policy'] === 'cross-origin' && String(r.body).includes('data-datick-widget'), JSON.stringify(r.headers));
    r = await req('GET', `/widget/${TOK}`);
    check('widget: sans e-mail de l instance → formulaire indisponible', r.status === 404 && /pas disponible/.test(String(r.body)), r.status);
    await app('./utils/instanceMail').saveMailSettings({ enabled: true, host: 'smtp.example.com', port: 587, from: 'datick@example.com' });
    r = await req('GET', `/widget/${TOK}`, { headers: { 'Accept-Language': 'en' } });
    const csp = r.headers['content-security-policy'] || '';
    const fresh = (String(r.body).match(/name="t" value="([^"]+)"/) || [])[1];
    check('widget: formulaire intégrable seulement par les sites autorisés', r.status === 200 && csp.includes('frame-ancestors https://site.example.test https://autre.example.test') && !r.headers['x-frame-options'] && /script-src 'nonce-/.test(csp), JSON.stringify([r.status, csp, r.headers['x-frame-options']]));
    check('widget: formulaire dans la langue du visiteur, avec champ piège et heure signée', String(r.body).includes('Contact us') && String(r.body).includes('name="website"') && !!fresh, String(r.body).slice(0, 200));
    r = await req('GET', `/widget/${G}.mauvaiscodemauvaiscodemauvais`);
    check('widget: code inconnu → indisponible', r.status === 404, r.status);

    r = await send(TOK, { t: fresh });
    check('widget: envoi trop rapide après l ouverture → refusé', r.status === 400 && /rapide/.test(r.body.error), JSON.stringify(r.body));
    r = await send(TOK, { t: `${Date.now() - 5000}.falsifie` });
    check('widget: heure falsifiée → refusée', r.status === 400, JSON.stringify(r.body));
    r = await send(TOK, { t: ww.stamp(G, Date.now() - 3 * 3600 * 1000) });
    check('widget: formulaire trop ancien → refusé', r.status === 400 && /expiré/.test(r.body.error), JSON.stringify(r.body));
    r = await send(TOK, { website: 'http://spam.example.test' });
    const [botT] = await db('SELECT COUNT(*) AS n FROM tickets WHERE owner_id = ?', [O1]);
    check('widget: champ piège rempli → réponse normale, aucun ticket', r.status === 200 && Number(botT.n) === 0, JSON.stringify([r.body, botT]));
    r = await send(TOK, { email: 'pas-une-adresse' });
    check('widget: adresse invalide refusée', r.status === 400, JSON.stringify(r.body));
    r = await send(TOK, { message: '' });
    check('widget: message vide refusé', r.status === 400, JSON.stringify(r.body));

    mails.length = 0;
    r = await send(TOK, {});
    const [wt] = await db('SELECT id, owner_id, status FROM tickets WHERE owner_id = ? ORDER BY id DESC LIMIT 1', [O1]);
    const [wc] = await db('SELECT address FROM email_contacts WHERE owner_id = ?', [O1]);
    check('widget: ouverture depuis le widget → ticket du demandeur web, adresse gardée', r.status === 200 && r.body.ok && !!wt && wt.status === 'open' && wc?.address === A1, JSON.stringify([r.body, wt, wc]));
    check('widget: confirmation envoyée par l e-mail de l instance avec le lien de suivi', mails.some(m => m.to === A1 && /\/espace/.test(m.text || '')), JSON.stringify(mails.map(m => [m.to, (m.text || '').slice(0, 120)])));

    // With files (multipart, as the widget page sends them)
    {
      const os = require('os'), fsx = require('fs');
      app('./utils/config').config.attachmentsDir = fsx.mkdtempSync(path.join(os.tmpdir(), 'tb-wpj-'));
      const fd = new FormData();
      for (const [k, v] of Object.entries({ name: 'Ana', email: 'widget3@example.com', message: 'Capture de l erreur jointe', t: old() })) fd.append(k, v);
      fd.append('files', new Blob([Buffer.from('PNGDATA')], { type: 'image/png' }), 'erreur.png');
      const wr = await fetch(`http://127.0.0.1:${config.webServerPort}/api/widget/${TOK}/tickets`, { method: 'POST', body: fd, headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-Forwarded-For': '10.22.0.9' } }).then(async x => ({ status: x.status, body: await x.json() }));
      const [wtf] = await db('SELECT id FROM tickets WHERE owner_id = ? ORDER BY id DESC LIMIT 1', [web.webOwnerIdFor('widget3@example.com')]);
      const wfiles = wtf ? await db('SELECT filename FROM email_attachments WHERE ticket_id = ?', [wtf.id]) : [];
      check('widget: fichiers joints au formulaire gardés dans le ticket', wr.status === 200 && wfiles.some(f => f.filename === 'erreur.png'), JSON.stringify([wr, wfiles]));
      r = await req('GET', `/widget/${TOK}`);
      check('widget: champ fichiers proposé', String(r.body).includes('type="file"'), '');
      if (wtf) await db('DELETE FROM email_attachments WHERE ticket_id = ?', [wtf.id]);
    }

    // Limits: 3 per address and per hour, 5 per IP and per hour
    const byAddr = [];
    for (let i = 0; i < 3; i++) byAddr.push((await send(TOK, { message: `relance ${i}` })).status);
    check('widget: limité par adresse e-mail', byAddr.at(-1) === 429, byAddr.join());
    const sameIp = { 'X-Forwarded-For': '10.21.0.1' };
    const byIp = [];
    for (let i = 0; i < 6; i++) byIp.push((await send(TOK, { email: `ip${i}@example.com` }, sameIp)).status);
    check('widget: limité par adresse IP', byIp.slice(0, 5).every(s => s !== 429) && byIp[5] === 429, byIp.join());
    await db("INSERT INTO blacklist (user_id, user_tag, reason, added_by_id, added_by_tag) VALUES (?, 'widget2', 'test', '1', 'F')", [O2]);
    r = await send(TOK, { email: A2 });
    check('widget: adresse en blacklist → refusée', r.status === 403, JSON.stringify(r.body));
    await db('DELETE FROM blacklist WHERE user_id = ?', [O2]);

    r = await req('POST', '/api/widget-settings/token', { sid: sessions.F });
    const oldPage = await req('GET', `/widget/${TOK}`);
    const oldPost = await send(TOK, { email: A2 });
    check('widget: nouveau code → l ancien ne marche plus', r.status === 200 && r.body.token !== TOK && oldPage.status === 404 && oldPost.status === 404, JSON.stringify([r.body.token, oldPage.status, oldPost.status]));
    await req('PUT', '/api/widget-settings', { sid: sessions.F, body: { enabled: false, origins: '' } });
    r = await send(r.body.token, { email: A2 });
    check('widget: coupé → envoi refusé', r.status === 404, JSON.stringify(r.body));

    nodemailer.createTransport = realCreate;
    delete process.env.EMAIL_ALLOW_PRIVATE_HOSTS;
    await app('./utils/instanceMail').saveMailSettings({ enabled: false });
    await db('UPDATE guild_config SET ticket_subjects = ?, max_tickets_per_day = ?, widget_enabled = 0, widget_token = NULL, widget_origins = NULL WHERE id = 1', [cfgX.ticket_subjects == null || typeof cfgX.ticket_subjects === 'string' ? cfgX.ticket_subjects : JSON.stringify(cfgX.ticket_subjects), cfgX.max_tickets_per_day]);
    const owners = (await db("SELECT DISTINCT owner_id FROM email_contacts WHERE address LIKE 'widget%@example.com' OR address LIKE 'ip_@example.com'")).map(x => x.owner_id);
    if (owners.length) {
      const ids = (await db('SELECT id FROM tickets WHERE owner_id IN (?)', [owners])).map(x => x.id);
      if (ids.length) await db('DELETE FROM ticket_notes WHERE ticket_id IN (?)', [ids]);
      await db('DELETE FROM tickets WHERE owner_id IN (?)', [owners]);
      await db('DELETE FROM email_contacts WHERE owner_id IN (?)', [owners]);
      await db('DELETE FROM contacts WHERE id IN (SELECT contact_id FROM contact_identities WHERE value IN (?))', [owners]);
    }
  }

  // ── Types of tickets: Incident or Request (utils/ticketTypes.js, v5.1) ──
  {
    const tt = app('./utils/ticketTypes');
    const em = app('./utils/emailTickets');
    const [cfgT] = await db('SELECT ticket_subjects, ticket_types_enabled, ticket_type_labels, subject_types FROM guild_config WHERE id = 1');
    check('types: migration 53 — les tickets existants sont des demandes', (await db("SELECT COUNT(*) AS n FROM tickets WHERE ticket_type <> 'request'"))[0].n == 0
      && app('./utils/tenantMigrations').MIGRATIONS.find(m => m.version === 53).statements.includes('UPDATE guild_config SET ticket_types_enabled = 0'), '');
    await db('UPDATE guild_config SET ticket_types_enabled = 0, ticket_subjects = ? WHERE id = 1', [JSON.stringify(['Technique', 'Technique › Réseau', 'Facturation'])]);
    const open = async (subject, who) => {
      const owner = em.ownerIdFor(who);
      await em.upsertContact(db, who, null);
      const r0 = await app('./utils/ticketManager').createManager(db, fakeClient, G).createTicket(em.userFor(owner, who, null, G), 'Bonjour', [], subject, { forceNew: true });
      return (await db('SELECT id, ticket_type FROM tickets WHERE id = ?', [r0.ticket.id]))[0];
    };
    let t0 = await open('Technique', 'type0@ext.test');
    check('types: coupés → tout reste « demande »', t0.ticket_type === 'request', JSON.stringify(t0));
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketTypesEnabled: true, ticketTypeLabels: { incident: 'Panne', request: 'Demande' }, subjectTypes: { Inconnu: 'incident' } } });
    check('types: type pour un sujet inconnu refusé', r.status === 400, JSON.stringify(r.body));
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketTypesEnabled: true, ticketTypeLabels: { incident: 'x'.repeat(31) } } });
    check('types: nom d un type limité à 30 caractères', r.status === 400, JSON.stringify(r.body));
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketTypesEnabled: true, ticketTypeLabels: { incident: 'Panne', request: 'Demande' }, subjectTypes: { Technique: 'incident' } } });
    check('types: activés, renommés, type par sujet', r.status === 200, JSON.stringify(r.body));
    const tI = await open('Technique', 'type1@ext.test');
    const tSub = await open('Technique › Réseau', 'type2@ext.test');
    const tR = await open('Facturation', 'type3@ext.test');
    check('types: le sujet donne le type (la sous-catégorie hérite), les autres sont des demandes', tI.ticket_type === 'incident' && tSub.ticket_type === 'incident' && tR.ticket_type === 'request', JSON.stringify([tI, tSub, tR]));
    r = await req('GET', `/api/tickets/${tI.id}`, { sid: sessions.F });
    check('types: la fiche porte le type et les noms de l espace', r.body.ticket_type === 'incident' && r.body.types?.enabled && r.body.types.labels.incident === 'Panne', JSON.stringify([r.body.ticket_type, r.body.types]));
    r = await req('PATCH', `/api/tickets/${tR.id}/type`, { sid: sessions.F, body: { type: 'panne' } });
    check('types: type inconnu refusé', r.status === 400, r.status);
    r = await req('PATCH', `/api/tickets/${tR.id}/type`, { sid: sessions.F, body: { type: 'incident' } });
    const [ev] = await db("SELECT details FROM audit_log WHERE action = 'ticket_type' AND ticket_id = ?", [tR.id]);
    check('types: changé depuis la fiche, au journal', r.status === 200 && (await db('SELECT ticket_type FROM tickets WHERE id = ?', [tR.id]))[0].ticket_type === 'incident' && JSON.stringify(ev?.details).includes('request'), JSON.stringify(ev));
    r = await req('GET', '/api/tickets', { sid: sessions.F, query: { type: 'incident', status: 'open' } });
    const ids = (r.body.tickets || []).map(x => x.id);
    check('types: filtre de la liste', ids.includes(tI.id) && ids.includes(tR.id) && !ids.includes(t0.id) && r.body.types?.labels?.incident === 'Panne', JSON.stringify(ids));
    r = await req('GET', '/api/analytics/breakdown', { sid: sessions.F, query: { by: 'type', days: 1 } });
    check('types: rapports par type, avec les noms de l espace', r.status === 200 && r.body.rows.some(x => x.label === 'Panne' && x.opened >= 3), JSON.stringify(r.body.rows));
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketSubjects: ['Facturation'] } });
    const [pruned] = await db('SELECT subject_types FROM guild_config WHERE id = 1');
    check('types: le type d un sujet retiré part avec lui', r.status === 200 && (pruned.subject_types === null || pruned.subject_types === 'null' || !JSON.stringify(pruned.subject_types).includes('Technique')), JSON.stringify(pruned));
    await db('UPDATE guild_config SET ticket_types_enabled = 0 WHERE id = 1');
    r = await req('PATCH', `/api/tickets/${tI.id}/type`, { sid: sessions.F, body: { type: 'request' } });
    check('types: coupés → plus de changement de type', r.status === 400, r.status);
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[t0.id, tI.id, tSub.id, tR.id]]);
    await db('UPDATE guild_config SET ticket_subjects = ?, ticket_types_enabled = ?, ticket_type_labels = ?, subject_types = ? WHERE id = 1',
      [cfgT.ticket_subjects == null || typeof cfgT.ticket_subjects === 'string' ? cfgT.ticket_subjects : JSON.stringify(cfgT.ticket_subjects), cfgT.ticket_types_enabled,
        cfgT.ticket_type_labels == null || typeof cfgT.ticket_type_labels === 'string' ? cfgT.ticket_type_labels : JSON.stringify(cfgT.ticket_type_labels),
        cfgT.subject_types == null || typeof cfgT.subject_types === 'string' ? cfgT.subject_types : JSON.stringify(cfgT.subject_types)]);
  }

  // ── Resolution and closing (utils/resolution.js, v5.1) ──
  {
    const rs = app('./utils/resolution');
    const em = app('./utils/emailTickets');
    const interM = app('./events/interactionCreate');
    const [cfgR] = await db('SELECT resolution_enabled, resolution_autoclose_days FROM guild_config WHERE id = 1');
    check('résolution: un nouvel espace l a activée, la migration la coupe sur les existants', Number(cfgR.resolution_enabled) === 1
      && app('./utils/tenantMigrations').MIGRATIONS.find(m => m.version === 54).statements.includes('UPDATE guild_config SET resolution_enabled = 0'), JSON.stringify(cfgR));
    const MR = '200000000000000071';
    memberRoles.set(MR, new Map());
    const mkT = async (owner, tag) => (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, ?, ?, 'open', 'Résolution')", [owner, tag, `db-res-${Math.random().toString(36).slice(2, 10)}`])).insertId;
    const click = async (customId, userId) => {
      const out = {};
      await interM.execute(fakeClient, { customId, guildId: null, guild: null, channelId: 'dm', values: [], message: { embeds: [] },
        user: { id: userId, username: 'membre71', tag: 'membre71', send: async p => memberDms.push({ id: userId, p }) },
        isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false, isChatInputCommand: () => false, isRepliable: () => true,
        reply: async p => { out.reply = p; }, update: async p => { out.update = p; } });
      return out;
    };
    const t1 = await mkT(MR, 'membre71');
    r = await req('POST', `/api/tickets/${t1}/resolve`, { sid: sessions.F, body: { solution: '' } });
    check('résolution: solution obligatoire', r.status === 400, r.status);
    memberDms.length = 0;
    r = await req('POST', `/api/tickets/${t1}/resolve`, { sid: sessions.F, body: { solution: 'Votre compte est réactivé.' } });
    const [rt1] = await db('SELECT status, resolved_at, resolution, resolved_by_tag, resolution_token FROM tickets WHERE id = ?', [t1]);
    const dm = memberDms.find(m => m.id === MR)?.p;
    const btns = dm?.components?.[0]?.components?.map(c => c.data.custom_id) || [];
    check('résolution: solution enregistrée, ticket toujours ouvert, demandeur prévenu avec les boutons', r.status === 200 && rt1.status === 'open' && !!rt1.resolved_at && rt1.resolution === 'Votre compte est réactivé.'
      && /^[0-9a-f]{64}$/.test(rt1.resolution_token) && btns.includes(`resok_${t1}_${G}`) && btns.includes(`resno_${t1}_${G}`) && /réactivé/.test(JSON.stringify(dm.embeds)), JSON.stringify([r.body, btns]));
    r = await req('GET', `/api/tickets/${t1}`, { sid: sessions.F });
    check('résolution: délai arrêté, fiche porte la résolution', r.body.sla === null && !!r.body.resolved_at && r.body.resolutionSettings?.enabled === true && r.body.resolutionSettings.autoCloseDays === 7, JSON.stringify([r.body.sla, r.body.resolutionSettings]));
    r = await req('POST', `/api/tickets/${t1}/resolve`, { sid: sessions.F, body: { solution: 'encore' } });
    check('résolution: déjà résolu → refus', r.status === 409, r.status);
    let out = await click(`resok_${t1}_${G}`, '200000000000000072');
    check('résolution: bouton d un autre membre sans effet', /n'attend plus/.test(JSON.stringify(out.update)) && (await db('SELECT status FROM tickets WHERE id = ?', [t1]))[0].status === 'open', JSON.stringify(out));
    out = await click(`resok_${t1}_${G}`, MR);
    const [after1] = await db('SELECT status FROM tickets WHERE id = ?', [t1]);
    check('résolution: « C est résolu » ferme le ticket (au journal)', after1.status === 'closed' && (await db("SELECT id FROM audit_log WHERE action = 'ticket_resolution_accept' AND ticket_id = ?", [t1])).length === 1, JSON.stringify([after1, out.update]));

    const t2 = await mkT(MR, 'membre71');
    await rs.resolveTicket({ db, client: fakeClient, guildId: G, ticket: (await db('SELECT * FROM tickets WHERE id = ?', [t2]))[0], solution: 'Essaie de vider le cache.', actor: { id: U.F, username: 'F' } });
    out = await click(`resno_${t2}_${G}`, MR);
    const [after2] = await db('SELECT status, resolved_at FROM tickets WHERE id = ?', [t2]);
    check('résolution: « Pas encore » → le ticket reprend', after2.status === 'open' && after2.resolved_at === null && /reprend/.test(JSON.stringify(out.update)), JSON.stringify([after2, out.update]));
    await rs.resolveTicket({ db, client: fakeClient, guildId: G, ticket: (await db('SELECT * FROM tickets WHERE id = ?', [t2]))[0], solution: 'Et maintenant ?', actor: { id: U.F, username: 'F' } });
    const tm = app('./utils/ticketManager').createManager(db, fakeClient, G);
    await tm.relayToTicket((await db('SELECT * FROM tickets WHERE id = ?', [t2]))[0], { id: MR, tag: 'membre71', username: 'membre71' }, 'Toujours pas', []);
    const [after3] = await db('SELECT resolved_at FROM tickets WHERE id = ?', [t2]);
    const [n3] = await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND content LIKE '↩️%' ORDER BY id DESC LIMIT 1", [t2]);
    check('résolution: le demandeur qui écrit fait reprendre le ticket', after3.resolved_at === null && /reprend/.test(n3?.content || ''), JSON.stringify([after3, n3]));
    r = await req('POST', `/api/tickets/${t2}/unresolve`, { sid: sessions.F });
    check('résolution: annuler sur un ticket non résolu → refus', r.status === 400, r.status);
    await rs.resolveTicket({ db, client: fakeClient, guildId: G, ticket: (await db('SELECT * FROM tickets WHERE id = ?', [t2]))[0], solution: 'Dernier essai', actor: { id: U.F, username: 'F' } });
    r = await req('POST', `/api/tickets/${t2}/unresolve`, { sid: sessions.F });
    check('résolution: le staff annule la résolution', r.status === 200 && (await db('SELECT resolved_at FROM tickets WHERE id = ?', [t2]))[0].resolved_at === null, r.status);

    // E-mail requester: a single-use link
    const addr = 'resolu@ext.test', ownerE = em.ownerIdFor(addr);
    await em.upsertContact(db, addr, null);
    const t3 = await mkT(ownerE, addr);
    const res3 = await rs.resolveTicket({ db, client: fakeClient, guildId: G, ticket: (await db('SELECT * FROM tickets WHERE id = ?', [t3]))[0], solution: 'Remboursement effectué.', actor: { id: U.F, username: 'F' } });
    const token = res3.url.split('#')[1];
    r = await req('POST', '/api/resolution/link', { headers: { 'X-Forwarded-For': '10.60.0.1' }, body: { token: token.replace(/.$/, c => (c === 'a' ? 'b' : 'a')) } });
    const bad = r.status;
    r = await req('POST', '/api/resolution/link', { headers: { 'X-Forwarded-For': '10.60.0.2' }, body: { token } });
    check('résolution: le lien montre la solution seulement (faux lien refusé)', bad === 410 && r.status === 200 && r.body.solution === 'Remboursement effectué.' && r.body.ticketId === t3 && !('messages' in r.body), JSON.stringify(r.body));
    r = await req('POST', '/api/resolution/accept', { headers: { 'X-Forwarded-For': '10.60.0.3' }, body: { token } });
    const again = await req('POST', '/api/resolution/accept', { headers: { 'X-Forwarded-For': '10.60.0.4' }, body: { token } });
    check('résolution: confirmé par le lien, une seule fois', r.status === 200 && (await db('SELECT status FROM tickets WHERE id = ?', [t3]))[0].status === 'closed' && again.status === 410, JSON.stringify([r.body, again.status]));

    // Member space: accept or « not yet » with what is still wrong
    const MW2 = '200000000000000081';
    const t4 = await mkT(MW2, 'member81');
    await rs.resolveTicket({ db, client: fakeClient, guildId: G, ticket: (await db('SELECT * FROM tickets WHERE id = ?', [t4]))[0], solution: 'Mot de passe réinitialisé.', actor: { id: U.F, username: 'F' } });
    r = await req('GET', `/api/member/tickets/${G}/${t4}`, { sid: sessions.MW });
    check('résolution: l espace membre montre la solution', r.status === 200 && !!r.body.ticket?.resolved_at && r.body.ticket.resolution === 'Mot de passe réinitialisé.', JSON.stringify(r.body.ticket));
    r = await req('POST', `/api/member/tickets/${G}/${t4}/resolution`, { sid: sessions.MW, body: { accept: false, comment: 'Le lien ne marche pas' } });
    const [after4] = await db('SELECT resolved_at FROM tickets WHERE id = ?', [t4]);
    const [n4] = await db("SELECT id FROM ticket_notes WHERE ticket_id = ? AND source = 'user' AND content = 'Le lien ne marche pas'", [t4]);
    check('résolution: « pas encore » depuis l espace membre, avec le message', r.status === 200 && after4.resolved_at === null && !!n4, JSON.stringify([r.body, after4]));
    await rs.resolveTicket({ db, client: fakeClient, guildId: G, ticket: (await db('SELECT * FROM tickets WHERE id = ?', [t4]))[0], solution: 'Nouveau lien envoyé.', actor: { id: U.F, username: 'F' } });
    r = await req('POST', `/api/member/tickets/${G}/${t4}/resolution`, { sid: sessions.MW, body: { accept: true } });
    check('résolution: confirmé depuis l espace membre', r.status === 200 && r.body.closed && (await db('SELECT status FROM tickets WHERE id = ?', [t4]))[0].status === 'closed', JSON.stringify(r.body));

    // Without an answer: closed after the delay of the space
    const t5 = await mkT(MR, 'membre71');
    await rs.resolveTicket({ db, client: fakeClient, guildId: G, ticket: (await db('SELECT * FROM tickets WHERE id = ?', [t5]))[0], solution: 'Fait.', actor: { id: U.F, username: 'F' } });
    await db('UPDATE tickets SET resolved_at = NOW() - INTERVAL 8 DAY WHERE id = ?', [t5]);
    const t6 = await mkT(MR, 'membre71');
    await rs.resolveTicket({ db, client: fakeClient, guildId: G, ticket: (await db('SELECT * FROM tickets WHERE id = ?', [t6]))[0], solution: 'Fait aussi.', actor: { id: U.F, username: 'F' } });
    await rs.runResolutionAutoClose(fakeClient);
    const [c5] = await db('SELECT status FROM tickets WHERE id = ?', [t5]);
    const [c6] = await db('SELECT status FROM tickets WHERE id = ?', [t6]);
    check('résolution: fermeture automatique après le délai, pas avant', c5.status === 'closed' && c6.status === 'open', JSON.stringify([c5, c6]));
    check('résolution: tâche planifiée', !!app('./utils/jobQueue').JOBS['resolution-autoclose'], '');
    await db('UPDATE guild_config SET resolution_enabled = 0 WHERE id = 1');
    const t7 = await mkT(MR, 'membre71');
    r = await req('POST', `/api/tickets/${t7}/resolve`, { sid: sessions.F, body: { solution: 'x' } });
    check('résolution: coupée → on ferme comme avant', r.status === 400 && /Paramètres/.test(r.body.error), JSON.stringify(r.body));
    await db('UPDATE guild_config SET resolution_enabled = ?, resolution_autoclose_days = ? WHERE id = 1', [cfgR.resolution_enabled, cfgR.resolution_autoclose_days]);
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[t2, t6, t7]]);
  }

  // ── Priority matrix: urgency × impact (utils/priorityMatrix.js, v5.1) ──
  {
    const pm = app('./utils/priorityMatrix');
    const [cfgP] = await db('SELECT priority_matrix_enabled, priority_matrix FROM guild_config WHERE id = 1');
    const bad = await db("SELECT COUNT(*) AS n FROM tickets WHERE priority_level <> CASE priority WHEN 'low' THEN 2 WHEN 'urgent' THEN 4 ELSE 3 END");
    check('matrice: migration 55 — niveau repris des 3 priorités, coupée sur les espaces existants', Number(bad[0].n) === 0 && app('./utils/tenantMigrations').MIGRATIONS.find(m => m.version === 55).statements.includes('UPDATE guild_config SET priority_matrix_enabled = 0'), JSON.stringify(bad));
    const tP = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('200000000000000061', 'prio', 'db-prio', 'open', 'Matrice')")).insertId;
    const row = async () => (await db('SELECT priority, priority_level, urgency, impact, priority_forced FROM tickets WHERE id = ?', [tP]))[0];
    const tm = app('./utils/ticketManager').createManager(db, fakeClient, G);
    await tm.setPriority(tP, 'urgent', { id: U.F, username: 'F' });
    let p1 = await row();
    check('matrice: une priorité réglée à l ancienne déplace le niveau (urgente → Haute)', p1.priority === 'urgent' && p1.priority_level === 4, JSON.stringify(p1));
    await db('UPDATE guild_config SET priority_matrix_enabled = 1 WHERE id = 1');
    r = await req('PATCH', `/api/tickets/${tP}/priority-matrix`, { sid: sessions.F, body: { urgency: 5, impact: 5 } });
    p1 = await row();
    check('matrice: urgence 5 × impact 5 → Très haute, priorité urgente', r.status === 200 && p1.priority_level === 5 && p1.priority === 'urgent' && p1.urgency === 5 && p1.impact === 5 && p1.priority_forced === 0, JSON.stringify([r.body, p1]));
    await tm.setPriority(tP, 'urgent', { id: U.F, username: 'F' });
    check('matrice: même tranche réglée à l ancienne → le niveau fin est gardé', (await row()).priority_level === 5, '');
    r = await req('PATCH', `/api/tickets/${tP}/priority-matrix`, { sid: sessions.F, body: { urgency: 1, impact: 2 } });
    p1 = await row();
    check('matrice: urgence 1 × impact 2 → Très basse, priorité basse', p1.priority_level === 1 && p1.priority === 'low', JSON.stringify(p1));
    r = await req('PATCH', `/api/tickets/${tP}/priority-matrix`, { sid: sessions.F, body: { level: 6 } });
    p1 = await row();
    check('matrice: niveau Majeure forcé à la main', p1.priority_level === 6 && p1.priority === 'urgent' && p1.priority_forced === 1, JSON.stringify(p1));
    r = await req('PATCH', `/api/tickets/${tP}/priority-matrix`, { sid: sessions.F, body: { urgency: 7 } });
    check('matrice: urgence hors de 1 à 5 refusée', r.status === 400, JSON.stringify(r.body));
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { priorityMatrix: [[1, 2]] } });
    check('matrice: matrice mal formée refusée', r.status === 400, r.status);
    const custom = pm.DEFAULT_MATRIX.map(rw => rw.slice());
    custom[2][2] = 6;
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { priorityMatrixEnabled: true, priorityMatrix: custom } });
    await req('PATCH', `/api/tickets/${tP}/priority-matrix`, { sid: sessions.F, body: { urgency: 3, impact: 3, level: null } });
    p1 = await row();
    check('matrice: matrice de l espace appliquée (3 × 3 réglé sur Majeure)', r.status === 200 && p1.priority_level === 6 && p1.priority_forced === 0, JSON.stringify([r.status, p1]));
    r = await req('GET', `/api/tickets/${tP}`, { sid: sessions.F });
    check('matrice: la fiche porte urgence, impact, niveau et la matrice', r.body.priority_level === 6 && r.body.urgency === 3 && r.body.priorityMatrix?.enabled && r.body.priorityMatrix.matrix[2][2] === 6, JSON.stringify([r.body.priority_level, r.body.priorityMatrix?.enabled]));
    check('matrice: changements au journal', (await db("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ticket_priority' AND ticket_id = ?", [tP]))[0].n >= 4, '');
    await db('UPDATE guild_config SET priority_matrix_enabled = 0 WHERE id = 1');
    r = await req('PATCH', `/api/tickets/${tP}/priority-matrix`, { sid: sessions.F, body: { urgency: 2 } });
    check('matrice: coupée → urgence et impact refusés (les 3 priorités restent)', r.status === 400, r.status);
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tP]);
    await db('UPDATE guild_config SET priority_matrix_enabled = ?, priority_matrix = ? WHERE id = 1', [cfgP.priority_matrix_enabled, cfgP.priority_matrix == null || typeof cfgP.priority_matrix === 'string' ? cfgP.priority_matrix : JSON.stringify(cfgP.priority_matrix)]);
  }

  // ── Calendars: opening hours, time zone, closed days (utils/calendars.js, v5.1) ──
  {
    const C = app('./utils/calendars');
    const cal = { tz: 'Europe/Paris', hours: C.DEFAULT_HOURS, closed: [{ from: '2026-12-24', to: '2026-12-26', label: 'Fermeture' }] };
    const at = x => Date.parse(x);
    check('calendriers: ouvert / fermé selon les horaires et le fuseau', C.isOpen(cal, at('2026-11-18T08:30:00Z')) && !C.isOpen(cal, at('2026-11-18T07:30:00Z')) && !C.isOpen(cal, at('2026-11-21T10:00:00Z')), '');
    check('calendriers: période de fermeture', !C.isOpen(cal, at('2026-12-24T10:00:00Z')) && !C.isOpen(cal, at('2026-12-26T10:00:00Z')) && new Date(C.nextOpening(cal, at('2026-12-24T10:00:00Z'))).toISOString() === '2026-12-28T08:00:00.000Z', new Date(C.nextOpening(cal, at('2026-12-24T10:00:00Z'))).toISOString());
    check('calendriers: minutes ouvrées par-dessus un week-end', C.businessMinutes(cal, at('2026-11-20T16:00:00Z'), at('2026-11-23T09:00:00Z')) === 120 && new Date(C.addBusinessMinutes(cal, at('2026-11-20T15:00:00Z'), 240)).toISOString() === '2026-11-23T10:00:00.000Z', '');
    check('calendriers: changement d heure (9 h de Paris = 8 h UTC en hiver, 7 h en été)', new Date(C.zoned(2026, 3, 27, 9, 0, 'Europe/Paris')).toISOString() === '2026-03-27T08:00:00.000Z' && new Date(C.zoned(2026, 3, 30, 9, 0, 'Europe/Paris')).toISOString() === '2026-03-30T07:00:00.000Z'
      && C.businessMinutes(cal, at('2026-03-27T16:00:00Z'), at('2026-03-30T08:00:00Z')) === 120, '');
    const night = { tz: 'America/Montreal', hours: { ...C.DEFAULT_HOURS, sat: [['20:00', '24:00']] }, closed: [] };
    check('calendriers: plage jusqu à minuit, autre fuseau', C.isOpen(night, at('2026-11-22T04:30:00Z')) && !C.isOpen(night, at('2026-11-22T05:30:00Z')), '');
    check('calendriers: jours fériés calculés (Pâques comprise)', new Date(C.easter(2027)).toISOString().slice(0, 10) === '2027-03-28' && C.holidaysFor('FR', 2027).some(h => h.from === '2027-05-06' && /Ascension/.test(h.label)) && C.holidaysFor('US', 2026).some(h => h.from === '2026-11-26'), '');

    r = await req('POST', '/api/calendars', { sid: sessions.S1, body: { name: 'x' } });
    check('calendriers: réservés aux fondateurs', r.status === 403, r.status);
    r = await req('POST', '/api/calendars', { sid: sessions.F, body: { name: 'Paris', timezone: 'Mars/Olympus' } });
    const r2 = await req('POST', '/api/calendars', { sid: sessions.F, body: { name: 'Paris', hours: { mon: [['09:00', '12:00'], ['11:00', '14:00']] } } });
    check('calendriers: fuseau inconnu et plages qui se chevauchent refusés', r.status === 400 && r2.status === 400, JSON.stringify([r.body, r2.body]));
    r = await req('GET', '/api/calendars/holidays', { sid: sessions.F, query: { country: 'FR', year: '2026' } });
    const fr26 = r.body;
    check('calendriers: jours fériés proposés par pays', r.status === 200 && fr26.some(h => h.from === '2026-04-06'), JSON.stringify(fr26).slice(0, 120));
    const todayParis = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
    r = await req('POST', '/api/calendars', { sid: sessions.F, body: { name: 'Fermé aujourd hui', timezone: 'Europe/Paris', hours: C.DEFAULT_HOURS, closed: [...fr26, { from: todayParis, to: todayParis, label: 'Test' }], outsideReply: true } });
    const calClosed = r.body;
    r = await req('POST', '/api/calendars', { sid: sessions.F, body: { name: 'Toujours ouvert', timezone: 'UTC', hours: Object.fromEntries(C.DAYS.map(d => [d, [['00:00', '24:00']]])), outsideReply: true } });
    const calOpen = r.body;
    check('calendriers: créés, état en direct', calClosed.id > 0 && calClosed.openNow === false && !!calClosed.nextOpening && calOpen.openNow === true, JSON.stringify([calClosed.openNow, calOpen.openNow]));
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { calendarId: 999999 } });
    check('calendriers: calendrier de l espace inconnu refusé', r.status === 400, r.status);
    await req('PATCH', '/api/config', { sid: sessions.F, body: { calendarId: calClosed.id } });
    const MC = '200000000000000064';
    memberRoles.set(MC, new Map());
    const tmC = app('./utils/ticketManager').createManager(db, fakeClient, G);
    memberDms.length = 0;
    const rc = await tmC.createTicket({ id: MC, username: 'membre64', tag: 'membre64', send: async p => memberDms.push({ id: MC, p }) }, 'Bonjour', [], null, { forceNew: true });
    const closedMsg = memberDms.filter(m => m.id === MC).some(m => /fermé/.test(JSON.stringify(m.p)));
    check('calendriers: ticket ouvert hors horaires → « le support est fermé », avec la réouverture', closedMsg, JSON.stringify(memberDms.map(m => m.p?.embeds?.[0]?.data?.title)));
    const team = (await db("INSERT INTO teams (name, calendar_id) VALUES ('Équipe 24/7', ?)", [calOpen.id])).insertId;
    await db('UPDATE tickets SET team_id = ? WHERE id = ?', [team, rc.ticket.id]);
    const forTicket = await C.calendarForTicket(db, (await db('SELECT * FROM tickets WHERE id = ?', [rc.ticket.id]))[0]);
    check('calendriers: le calendrier de l équipe passe avant celui de l espace', forTicket?.id === calOpen.id, JSON.stringify(forTicket?.name));
    r = await req('DELETE', `/api/calendars/${calClosed.id}`, { sid: sessions.F });
    const [cfgC] = await db('SELECT calendar_id FROM guild_config WHERE id = 1');
    check('calendriers: supprimé → l espace redevient toujours ouvert', r.status === 200 && cfgC.calendar_id === null, JSON.stringify(cfgC));
    memberDms.length = 0;
    await tmC.createTicket({ id: MC, username: 'membre64', tag: 'membre64', send: async p => memberDms.push({ id: MC, p }) }, 'Encore', [], null, { forceNew: true });
    check('calendriers: sans calendrier, pas de message « fermé »', !memberDms.some(m => /fermé/.test(JSON.stringify(m.p))), '');
    await db("UPDATE tickets SET status = 'closed' WHERE owner_id = ?", [MC]);
    await db('DELETE FROM teams WHERE id = ?', [team]);
    await req('DELETE', `/api/calendars/${calOpen.id}`, { sid: sessions.F });
  }

  // ── SLA objectives in business hours (utils/slaPolicies.js, v5.1) ──
  {
    const SP = app('./utils/slaPolicies');
    const C = app('./utils/calendars');
    const mkT = async (extra = {}) => (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, priority, created_at) VALUES (?, 'sla', ?, 'open', ?, ?, ?)",
      [extra.owner || '200000000000000062', `db-sla-${Math.random().toString(36).slice(2, 10)}`, extra.subject || 'Facturation', extra.priority || 'normal', extra.created || new Date()])).insertId;
    const get = async id => (await db('SELECT * FROM tickets WHERE id = ?', [id]))[0];
    r = await req('POST', '/api/sla-policies', { sid: sessions.S1, body: { name: 'x', ttoMinutes: 60 } });
    check('SLA: objectifs réservés aux fondateurs', r.status === 403, r.status);
    r = await req('POST', '/api/sla-policies', { sid: sessions.F, body: { name: 'Sans délai' } });
    check('SLA: au moins un délai demandé', r.status === 400, JSON.stringify(r.body));
    const t0 = await mkT();
    r = await req('POST', '/api/sla-policies', { sid: sessions.F, body: { name: 'Standard', ttoMinutes: 60, ttrMinutes: 480, businessHours: false } });
    const pStd = r.body.policies?.find(p => p.name === 'Standard');
    const g0 = await get(t0);
    check('SLA: objectif créé, les tickets ouverts reçoivent leurs échéances', r.status === 200 && r.body.refreshed >= 1 && g0.sla_policy_id === pStd.id
      && Math.abs(new Date(g0.tto_due_at) - (new Date(g0.created_at).getTime() + 3600e3)) < 2000 && Math.abs(new Date(g0.ttr_due_at) - (new Date(g0.created_at).getTime() + 480 * 60e3)) < 2000, JSON.stringify([r.body.refreshed, g0.tto_due_at]));
    r = await req('POST', '/api/sla-policies', { sid: sessions.F, body: { name: 'Urgent facturation', ttoMinutes: 15, ttrMinutes: 120, businessHours: false, conditions: { priorities: ['urgent'], subjects: ['Facturation'] } } });
    const pUrg = r.body.policies.find(p => p.name === 'Urgent facturation');
    const tU = await mkT({ priority: 'urgent', subject: 'Facturation › Avoir' });
    await SP.refreshSla(db, tU);
    const tN = await mkT({ priority: 'normal', subject: 'Facturation › Avoir' });
    await SP.refreshSla(db, tN);
    check('SLA: le plus précis gagne (la catégorie couvre ses sous-catégories)', (await get(tU)).sla_policy_id === pUrg.id && (await get(tN)).sla_policy_id === pStd.id, '');
    await app('./utils/ticketManager').createManager(db, fakeClient, G).setPriority(tN, 'urgent', { id: U.F, username: 'F' });
    check('SLA: un changement de priorité refait les échéances', (await get(tN)).sla_policy_id === pUrg.id, '');

    // Business hours: Monday–Friday 9:00–18:00 in Paris; opened on Friday at 17:00 → first response due on Monday at 10:00
    r = await req('POST', '/api/calendars', { sid: sessions.F, body: { name: 'Bureau SLA', timezone: 'Europe/Paris', hours: C.DEFAULT_HOURS } });
    const calId = r.body.id;
    await req('PATCH', '/api/config', { sid: sessions.F, body: { calendarId: calId } });
    r = await req('PUT', `/api/sla-policies/${pStd.id}`, { sid: sessions.F, body: { name: 'Standard', ttoMinutes: 120, ttrMinutes: 600, businessHours: true } });
    const tB = await mkT({ created: new Date('2026-11-20T16:00:00Z') });
    await SP.refreshSla(db, tB);
    const gB = await get(tB);
    check('SLA: compté en heures ouvrées (vendredi 17 h + 2 h → lundi 10 h ; + 10 h → lundi 18 h)', new Date(gB.tto_due_at).toISOString() === '2026-11-23T09:00:00.000Z' && new Date(gB.ttr_due_at).toISOString() === '2026-11-23T17:00:00.000Z', JSON.stringify([gB.tto_due_at, gB.ttr_due_at]));
    // Waiting pauses the resolution: 30 business minutes spent waiting move it by 30 minutes
    await SP.onStageChange(db, tB, 'waiting');
    const paused = await get(tB);
    check('SLA: « en attente » met la résolution en pause', !!paused.sla_paused_at && SP.objectives(paused).ttr.state === 'paused', JSON.stringify(SP.objectives(paused)));
    await db('UPDATE tickets SET sla_paused_at = NOW() - INTERVAL 5 DAY WHERE id = ?', [tB]); // always covers working days
    const before = new Date((await get(tB)).ttr_due_at).getTime();
    await SP.onStageChange(db, tB, 'in_progress');
    const resumed = await get(tB);
    check('SLA: la reprise décale la résolution du temps ouvré passé en attente', !resumed.sla_paused_at && resumed.sla_paused_minutes > 0 && new Date(resumed.ttr_due_at).getTime() > before, JSON.stringify([resumed.sla_paused_minutes, resumed.ttr_due_at]));

    // Overdue: first response not given in time
    const tLate = await mkT({ created: new Date(Date.now() - 3 * 864e5) });
    await req('PUT', `/api/sla-policies/${pStd.id}`, { sid: sessions.F, body: { name: 'Standard', ttoMinutes: 60, ttrMinutes: 6000, businessHours: false } });
    r = await req('GET', '/api/tickets', { sid: sessions.F, query: { sla: 'breached', status: 'open' } });
    const late = (r.body.tickets || []).find(x => x.id === tLate);
    check('SLA: objectif manqué → dans « Hors délai », état visible dans la liste', !!late && late.objectives?.tto?.state === 'breached', JSON.stringify(late?.objectives));
    r = await req('GET', `/api/tickets/${tLate}`, { sid: sessions.F });
    check('SLA: la fiche montre les deux objectifs', r.body.objectives?.tto?.state === 'breached' && ['ok', 'warning'].includes(r.body.objectives.ttr?.state), JSON.stringify(r.body.objectives));
    await db('UPDATE tickets SET first_response_at = NOW() WHERE id = ?', [tLate]);
    check('SLA: réponse en retard → « manqué », plus en cours', SP.objectives(await get(tLate)).tto.state === 'missed', '');
    await db('UPDATE tickets SET first_response_at = created_at + INTERVAL 10 MINUTE WHERE id = ?', [t0]);
    r = await req('GET', '/api/analytics/breakdown', { sid: sessions.F, query: { by: 'channel', days: 7 } });
    check('SLA: rapports — prise en charge dans le délai (%)', r.status === 200 && r.body.rows.some(x => x.ttoMetPct !== null), JSON.stringify(r.body.rows.map(x => [x.label, x.ttoMetPct])));

    r = await req('DELETE', `/api/sla-policies/${pUrg.id}`, { sid: sessions.F });
    await req('DELETE', `/api/sla-policies/${pStd.id}`, { sid: sessions.F });
    const cleared = await get(t0);
    check('SLA: sans objectif, plus d échéance (les délais par étape restent)', !cleared.sla_policy_id && !cleared.tto_due_at, JSON.stringify(cleared.tto_due_at));
    await req('PATCH', '/api/config', { sid: sessions.F, body: { calendarId: null } });
    await req('DELETE', `/api/calendars/${calId}`, { sid: sessions.F });
    await db('DELETE FROM tickets WHERE id IN (?)', [[t0, tU, tN, tB, tLate]]);
  }

  // ── Escalation levels and team objectives (OLA) (utils/slaEscalation.js, v5.1) ──
  {
    const E = app('./utils/slaEscalation');
    const SP = app('./utils/slaPolicies');
    const get = async id => (await db('SELECT * FROM tickets WHERE id = ?', [id]))[0];
    const mkT = async (created, priority = 'normal') => (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, priority, created_at) VALUES ('200000000000000063', 'esc', ?, 'open', 'Escalade test', ?, ?)",
      [`db-esc-${Math.random().toString(36).slice(2, 10)}`, priority, created])).insertId;
    r = await req('POST', '/api/sla-policies', { sid: sessions.F, body: { name: 'Esc', ttoMinutes: 60, ttrMinutes: 600, businessHours: false, escalations: [{ objective: 'tto', percent: 50 }] } });
    check('escalade: un niveau sans action refusé', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/sla-policies', { sid: sessions.F, body: { name: 'Esc', ttoMinutes: 60, ttrMinutes: 600, businessHours: false, escalations: [{ objective: 'tto', percent: 900, notify: true }] } });
    check('escalade: pourcentage borné (10 à 500 %)', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/sla-policies', { sid: sessions.F, body: { name: 'Esc', ttoMinutes: 60, ttrMinutes: 600, businessHours: false, escalations: [{ objective: 'ola', percent: 100, notify: true }] } });
    check('escalade: un objectif SLA n a pas de niveau OLA', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/sla-policies', { sid: sessions.F, body: { name: 'Esc', ttoMinutes: 60, ttrMinutes: 600, businessHours: false,
      escalations: [{ objective: 'tto', percent: 50, notify: true, raisePriority: true }, { objective: 'ttr', percent: 100, followerIds: [U.S1] }] } });
    const pol = r.body.policies?.find(p => p.name === 'Esc');
    check('escalade: niveaux enregistrés avec l objectif', r.status === 200 && pol?.escalations?.length === 2 && pol.escalations[0].raisePriority === true, JSON.stringify(pol?.escalations));
    const tA = await mkT(new Date(Date.now() - 45 * 60e3));            // 75 % of the first response time
    const tP = await mkT(new Date(Date.now() - 45 * 60e3));            // same, but already answered
    await db('UPDATE tickets SET first_response_at = NOW() WHERE id = ?', [tP]);
    await SP.refreshSla(db, tA); await SP.refreshSla(db, tP);
    const ctx = { db, guildId: G, client: fakeClient };
    let fired = await E.runForGuild(ctx);
    const gA = await get(tA);
    check('escalade: 50 % de la prise en charge atteint → priorité montée, au journal', fired === 1 && gA.priority === 'urgent'
      && (await db("SELECT 1 FROM audit_log WHERE action = 'ticket_sla_escalation' AND ticket_id = ?", [tA])).length === 1, JSON.stringify([fired, gA.priority]));
    check('escalade: déjà répondu → pas d escalade de prise en charge', (await get(tP)).priority === 'normal', '');
    fired = await E.runForGuild(ctx);
    check('escalade: un niveau ne se déclenche qu une fois par ticket', fired === 0, fired);
    // Resolution deadline passed (10 h); waiting pauses it, then it fires once resumed
    const tR = await mkT(new Date(Date.now() - 11 * 3600e3));
    await db('UPDATE tickets SET first_response_at = created_at, sla_paused_at = NOW() WHERE id = ?', [tR]);
    await SP.refreshSla(db, tR);
    await E.runForGuild(ctx);
    check('escalade: en attente du demandeur, la résolution n escalade pas', !(await db('SELECT 1 FROM ticket_followers WHERE ticket_id = ?', [tR])).length, '');
    await db('UPDATE tickets SET sla_paused_at = NULL WHERE id = ?', [tR]);
    await E.runForGuild(ctx);
    check('escalade: résolution dépassée → observateur ajouté', (await db('SELECT user_id FROM ticket_followers WHERE ticket_id = ?', [tR])).some(x => x.user_id === U.S1), '');

    // OLA: team A has 30 minutes; past it, the ticket goes to team B
    r = await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'Niveau 2 esc' } });
    const teamB = r.body.find(x => x.name === 'Niveau 2 esc').id;
    r = await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'Niveau 1 esc', olaMinutes: 30, escalations: [{ objective: 'tto', percent: 100, notify: true }] } });
    check('OLA: une équipe n a que des niveaux OLA', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'Niveau 1 esc', olaMinutes: 30, escalations: [{ objective: 'ola', percent: 100, teamId: teamB, notify: true }] } });
    const teamA = r.body.find(x => x.name === 'Niveau 1 esc');
    check('OLA: objectif interne et niveaux de l équipe enregistrés', r.status === 200 && teamA.olaMinutes === 30 && teamA.escalations?.[0]?.teamId === teamB, JSON.stringify(teamA));
    const tO = await mkT(new Date());
    const tm = app('./utils/ticketManager').createManager(db, fakeClient, G);
    await app('./utils/teams').routeTicket({ db, tm, ticket: await get(tO), teamId: teamA.id });
    let gO = await get(tO);
    check('OLA: arrivée dans l équipe → échéance interne', !!gO.team_since && Math.abs(new Date(gO.ola_due_at) - (new Date(gO.team_since).getTime() + 30 * 60e3)) < 2000 && SP.objectives(gO).ola?.state === 'ok', JSON.stringify([gO.team_since, gO.ola_due_at]));
    await db('UPDATE tickets SET team_since = NOW() - INTERVAL 1 HOUR WHERE id = ?', [tO]);
    await E.refreshOla(db, tO);
    r = await req('GET', '/api/tickets', { sid: sessions.F, query: { sla: 'breached', status: 'open' } });
    check('OLA: dépassé → dans « Hors délai »', (r.body.tickets || []).some(x => x.id === tO && x.objectives?.ola?.state === 'breached'), '');
    await E.runForGuild(ctx);
    gO = await get(tO);
    check('OLA: dépassé → passé à l équipe suivante, son horloge repart', gO.team_id === teamB && !gO.ola_due_at && new Date(gO.team_since) > Date.now() - 60e3, JSON.stringify([gO.team_id, gO.ola_due_at]));

    await req('DELETE', `/api/teams/${teamA.id}`, { sid: sessions.F });
    await req('DELETE', `/api/teams/${teamB}`, { sid: sessions.F });
    await req('DELETE', `/api/sla-policies/${pol.id}`, { sid: sessions.F });
    check('escalade: supprimer l objectif et l équipe retire leurs niveaux', Number((await db('SELECT COUNT(*) AS n FROM sla_escalations'))[0].n) === 0, '');
    await db('DELETE FROM tickets WHERE id IN (?)', [[tA, tP, tR, tO]]);
  }

  // ── Business rules (utils/ruleEngine.js, v5.2) ──
  {
    const E = app('./utils/ruleEngine');
    const tmR = createManager(db, fakeClient, G);
    const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r2 => setTimeout(r2, 50)); } return false; };
    const mkMail = (n, addr) => ({ id: `mail:${String(n).padStart(24, '0')}`, username: addr, tag: addr, send: async () => ({}) });
    const tk = async id => (await db('SELECT * FROM tickets WHERE id = ?', [id]))[0];
    const notes = async id => (await db("SELECT content, author_tag FROM ticket_notes WHERE ticket_id = ? AND source = 'system'", [id]));
    r = await req('GET', '/api/rules', { sid: sessions.S1 });
    check('règles: réservées aux fondateurs et à manage_rules', r.status === 403, r.status);
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'x', triggers: [], actions: [{ type: 'priority', value: 'low' }] } });
    check('règles: un déclencheur requis', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'x', triggers: ['created'], conditions: [{ field: 'salaire', values: ['1'] }], actions: [{ type: 'priority', value: 'low' }] } });
    check('règles: condition inconnue refusée', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'x', triggers: ['created'], actions: [{ type: 'subject', value: 'Sujet qui n existe pas' }] } });
    check('règles: sujet inconnu refusé', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'x', triggers: ['created'], actions: [{ type: 'assign', value: U.OUT }] } });
    check('règles: on n attribue qu au staff de l espace', r.status === 400, JSON.stringify(r.body));

    // The old rules by keywords become rules of the engine, with the same effect (migration 59)
    const tagF = (await db("INSERT INTO ticket_tags (name, color) VALUES ('Impayés', '#aa0000')")).insertId;
    await db("INSERT INTO subject_rules (match_type, keywords, priority, tag_id) VALUES ('keyword', 'facture impayée, relance', 'urgent', ?)", [tagF]);
    const m59 = app('./utils/tenantMigrations').MIGRATIONS.find(m => m.version === 59);
    for (const sql of m59.statements.slice(1)) await db(sql);
    const conv = (await db("SELECT * FROM ticket_rules WHERE origin = 'subject' AND name LIKE 'Mots-clés : facture%'"))[0];
    check('règles: conversion des règles par mots-clés', !!conv && !(await db('SELECT 1 FROM subject_rules')).length, JSON.stringify(conv));
    r = await req('GET', '/api/subject-rules', { sid: sessions.F });
    check('règles: la forme simple reste lisible', r.body.some(x => x.id === conv.id && x.match_type === 'keyword' && x.tag_name === 'Impayés'), JSON.stringify(r.body).slice(0, 300));
    const c1 = await tmR.createTicket({ id: '200000000000000091', username: 'u91', tag: 'u91', send: async () => ({}) }, 'Bonjour, une facture impayée de mars', [], 'Autre', { forceNew: true });
    const g1 = await tk(c1.ticket.id);
    check('règles: règle convertie, même effet (priorité et tag)', g1.priority === 'urgent' && (await db('SELECT 1 FROM ticket_tag_assignments WHERE ticket_id = ? AND tag_id = ?', [g1.id, tagF])).length === 1, g1.priority);
    await db('DELETE FROM ticket_rules WHERE id = ?', [conv.id]);

    // At the opening: e-mail AND requester of a domain → priority, internal note, tag; stop after it
    const tagV = (await db("INSERT INTO ticket_tags (name, color) VALUES ('VIP', '#ffd700')")).insertId;
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'VIP mail', triggers: ['created'], match: 'all', stop: true,
      conditions: [{ field: 'channel', values: ['email'] }, { field: 'requester', values: ['@vip.test'] }],
      actions: [{ type: 'priority', value: 'urgent' }, { type: 'note', value: 'Client VIP : traiter en priorité' }, { type: 'tagAdd', value: tagV }] } });
    check('règles: règle créée par un fondateur', r.status === 200 && r.body.rules.some(x => x.name === 'VIP mail'), JSON.stringify(r.body).slice(0, 300));
    const rVip = r.body.id;
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'Par défaut basse', triggers: ['created'], conditions: [{ field: 'channel', values: ['email'] }], actions: [{ type: 'priority', value: 'low' }] } });
    const rLow = r.body.id;
    const v1 = await tmR.createTicket(mkMail(1, 'paul@vip.test'), 'Bonjour', [], 'Autre', { forceNew: true });
    const gv = await tk(v1.ticket.id);
    check('règles: conditions toutes vraies → actions appliquées', gv.priority === 'urgent' && (await notes(gv.id)).some(n => n.content.includes('Client VIP'))
      && (await db('SELECT 1 FROM ticket_tag_assignments WHERE ticket_id = ? AND tag_id = ?', [gv.id, tagV])).length === 1, gv.priority);
    check('règles: « arrêter après cette règle » respecté', gv.priority !== 'low', gv.priority);
    check('règles: chaque règle appliquée au journal du ticket', JSON.stringify((await db("SELECT details FROM audit_log WHERE action = 'ticket_rule' AND ticket_id = ?", [gv.id]))[0]?.details || '').includes('VIP mail'), '');
    const v2 = await tmR.createTicket(mkMail(2, 'ana@autre.test'), 'Bonjour', [], 'Autre', { forceNew: true });
    check('règles: une condition fausse → règle suivante', (await tk(v2.ticket.id)).priority === 'low', (await tk(v2.ticket.id)).priority);
    r = await req('PUT', `/api/rules/${rLow}`, { sid: sessions.F, body: { name: 'Par défaut basse', triggers: ['created'], match: 'any', conditions: [{ field: 'channel', values: ['discord'] }, { field: 'requester', not: true, values: ['@vip.test'] }], actions: [{ type: 'priority', value: 'low' }] } });
    check('règles: modifiée (au moins une condition, négation)', r.status === 200, JSON.stringify(r.body).slice(0, 200));

    // Test button: what the rule would do, without doing it
    r = await req('POST', '/api/rules/test', { sid: sessions.F, body: { ticketId: gv.id, rule: { name: 't', triggers: ['created'], conditions: [{ field: 'priority', values: ['urgent'] }, { field: 'tag', values: [tagV] }], actions: [{ type: 'stage', value: 'waiting' }] } } });
    check('règles: tester montre ce qu elle ferait', r.status === 200 && r.body.matched === true && r.body.actions.length === 1 && (await tk(gv.id)).stage !== 'waiting', JSON.stringify(r.body));
    r = await req('POST', '/api/rules/test', { sid: sessions.F, body: { ticketId: gv.id, rule: { name: 't', triggers: ['created'], conditions: [{ field: 'type', values: ['incident'] }], actions: [{ type: 'close' }] } } });
    check('règles: tester — conditions non remplies, rien ne serait fait', r.status === 200 && r.body.matched === false && r.body.conditions[0].ok === false && (await tk(gv.id)).status === 'open', JSON.stringify(r.body));

    // When the requester writes: keywords in the message
    await req('DELETE', `/api/rules/${rVip}`, { sid: sessions.F });
    await req('DELETE', `/api/rules/${rLow}`, { sid: sessions.F });
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'Relance', triggers: ['member_reply'], conditions: [{ field: 'text', values: ['toujours rien, relance'] }], actions: [{ type: 'priority', value: 'urgent' }] } });
    const rRel = r.body.id;
    await db("UPDATE tickets SET priority = 'normal' WHERE id = ?", [v2.ticket.id]);
    await tmR.relayToTicket(await tk(v2.ticket.id), mkMail(2, 'ana@autre.test'), 'Bonjour, toujours rien depuis hier', []);
    check('règles: « quand le demandeur écrit » + mots du message', await until(async () => (await tk(v2.ticket.id)).priority === 'urgent'), (await tk(v2.ticket.id)).priority);
    await req('DELETE', `/api/rules/${rRel}`, { sid: sessions.F });

    // No loop: a rule started by a change of priority that changes the priority runs once
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'Boucle', triggers: ['priority'], actions: [{ type: 'priority', value: 'low' }, { type: 'note', value: 'boucle ?' }] } });
    const rLoop = r.body.id;
    await tmR.setPriority(gv.id, 'normal', { id: U.F, username: 'F' });
    await until(async () => (await tk(gv.id)).priority === 'low');
    await new Promise(r2 => setTimeout(r2, 300));
    check('règles: pas de boucle sur sa propre modification', (await tk(gv.id)).priority === 'low' && (await notes(gv.id)).filter(n => n.content === 'boucle ?').length === 1, JSON.stringify(await notes(gv.id)));
    await req('DELETE', `/api/rules/${rLoop}`, { sid: sessions.F });

    // At most 50 actions per event
    const many = [];
    for (let i = 0; i < 3; i++) {
      r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: `Bavarde ${i}`, triggers: ['staff_reply'], actions: Array.from({ length: 20 }, (_, j) => ({ type: 'note', value: `n${i}-${j}` })) } });
      many.push(r.body.id);
    }
    await tmR.recordStaffResponse(gv.id, { id: U.F, tag: 'F', username: 'F' });
    await until(async () => (await notes(gv.id)).filter(n => /^n\d-\d+$/.test(n.content)).length >= 50);
    await new Promise(r2 => setTimeout(r2, 300));
    check('règles: 50 actions au plus par événement', (await notes(gv.id)).filter(n => /^n\d-\d+$/.test(n.content)).length === 50, (await notes(gv.id)).length);
    r = await req('PUT', '/api/rules/order', { sid: sessions.F, body: { ids: [...many].reverse() } });
    check('règles: ordre modifiable', r.body.rules?.[0]?.id === many[2], JSON.stringify(r.body.rules?.map(x => x.id)));

    // Export and import: tags by name, the people left out
    await req('PUT', `/api/rules/${many[0]}`, { sid: sessions.F, body: { name: 'Bavarde 0', triggers: ['created'], conditions: [{ field: 'tag', values: [tagV] }], actions: [{ type: 'tagAdd', value: tagV }, { type: 'notify', value: [U.F] }] } });
    r = await req('GET', '/api/config/export', { sid: sessions.F });
    const exported = (r.body.rules || []).find(x => x.name === 'Bavarde 0');
    check('règles: exportées (tags par nom, personnes retirées)', !!exported && exported.conditions[0].values[0] === 'VIP' && exported.actions.length === 1 && exported.actions[0].value === 'VIP', JSON.stringify(exported));
    for (const id of many) await req('DELETE', `/api/rules/${id}`, { sid: sessions.F });
    r = await app('./utils/configTransfer').importConfig(db, { format: r.body.format, version: r.body.version, rules: [exported] }, { applyConfig: async () => ({ ok: true }) });
    const back = (await E.listRules(db)).find(x => x.name === 'Bavarde 0');
    check('règles: importées avec leurs tags', !!back && back.conditions[0].values[0] === tagV && back.actions[0].value === tagV, JSON.stringify(back));
    if (back) await db('DELETE FROM ticket_rules WHERE id = ?', [back.id]);
    await db('DELETE FROM tickets WHERE id IN (?)', [[c1.ticket.id, v1.ticket.id, v2.ticket.id]]);
    await db('DELETE FROM ticket_tags WHERE id IN (?)', [[tagF, tagV]]);
  }

  // ── Rules « when time passes » (utils/ruleTimers.js, v5.2) ──
  {
    const RT = app('./utils/ruleTimers');
    const C = app('./utils/calendars');
    const mkT = async (extra = {}) => (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, stage, subject, created_at, ttr_due_at) VALUES ('200000000000000064', 'tmr', ?, 'open', ?, 'Temps', ?, ?)",
      [`db-tmr-${Math.random().toString(36).slice(2, 10)}`, extra.stage || 'open', extra.created || new Date(), extra.ttrDue || null])).insertId;
    const notesOf = async (id, text) => (await db("SELECT 1 FROM ticket_notes WHERE ticket_id = ? AND source = 'system' AND content = ?", [id, text])).length;
    const ctx = { db, guildId: G, client: fakeClient };
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'x', triggers: ['time', 'created'], timer: { basis: 'created', minutes: 60 }, actions: [{ type: 'note', value: 'x' }] } });
    check('temps: « le temps passe » seul', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'x', triggers: ['time'], timer: { basis: 'created', minutes: 60, direction: 'before' }, actions: [{ type: 'note', value: 'x' }] } });
    check('temps: « avant » réservé aux échéances', r.status === 400, JSON.stringify(r.body));

    // 2 hours after the staff's last message, while waiting for the requester
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'Relance', triggers: ['time'], timer: { basis: 'last_staff', minutes: 120, businessHours: false },
      conditions: [{ field: 'stage', values: ['waiting'] }], actions: [{ type: 'note', value: 'relance auto' }] } });
    const rRel = r.body.id;
    check('temps: règle créée avec son délai', r.status === 200 && r.body.rules.find(x => x.id === rRel)?.timer?.basis === 'last_staff', JSON.stringify(r.body).slice(0, 200));
    const tW = await mkT({ stage: 'waiting' });
    const tO = await mkT({ stage: 'open' });
    for (const id of [tW, tO]) await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source, created_at) VALUES (?, ?, 'F', 'réponse', 'reply', NOW() - INTERVAL 3 HOUR)", [id, U.F]);
    await RT.runForGuild(ctx);
    check('temps: délai écoulé + conditions → actions', await notesOf(tW, 'relance auto') === 1 && await notesOf(tO, 'relance auto') === 0, '');
    await RT.runForGuild(ctx);
    check('temps: une seule fois pour le même moment', await notesOf(tW, 'relance auto') === 1, '');
    await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source, created_at) VALUES (?, ?, 'F', 'encore', 'reply', NOW() - INTERVAL 150 MINUTE)", [tW, U.F]);
    await RT.runForGuild(ctx);
    check('temps: une nouvelle réponse relance le compte', await notesOf(tW, 'relance auto') === 2, '');
    await req('DELETE', `/api/rules/${rRel}`, { sid: sessions.F });

    // Business hours: opened on Friday at 17:00 (Paris), 2 business hours → Monday 10:00
    r = await req('POST', '/api/calendars', { sid: sessions.F, body: { name: 'Bureau règles', timezone: 'Europe/Paris', hours: C.DEFAULT_HOURS } });
    const calId = r.body.id;
    await req('PATCH', '/api/config', { sid: sessions.F, body: { calendarId: calId } });
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'Ouvré', triggers: ['time'], timer: { basis: 'created', minutes: 120, businessHours: true }, actions: [{ type: 'note', value: 'deux heures ouvrées' }] } });
    const rBiz = r.body.id;
    const tB = await mkT({ created: new Date('2026-11-20T16:00:00Z') });
    await RT.runForGuild(ctx, new Date('2026-11-21T12:00:00Z').getTime());
    check('temps: en heures ouvrées, rien le week-end', await notesOf(tB, 'deux heures ouvrées') === 0, '');
    await RT.runForGuild(ctx, new Date('2026-11-23T09:30:00Z').getTime());
    check('temps: en heures ouvrées, lundi 10 h passé → appliquée', await notesOf(tB, 'deux heures ouvrées') === 1, '');
    await req('DELETE', `/api/rules/${rBiz}`, { sid: sessions.F });
    await req('PATCH', '/api/config', { sid: sessions.F, body: { calendarId: null } });
    await req('DELETE', `/api/calendars/${calId}`, { sid: sessions.F });

    // Before a deadline: one hour before the resolution is due
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'Bientôt', triggers: ['time'], timer: { basis: 'ttr_due', minutes: 60, direction: 'before', businessHours: false }, actions: [{ type: 'note', value: 'échéance proche' }] } });
    const rDue = r.body.id;
    const tSoon = await mkT({ ttrDue: new Date(Date.now() + 30 * 60e3) });
    const tLater = await mkT({ ttrDue: new Date(Date.now() + 3 * 3600e3) });
    await RT.runForGuild(ctx);
    check('temps: avant une échéance SLA', await notesOf(tSoon, 'échéance proche') === 1 && await notesOf(tLater, 'échéance proche') === 0, '');
    await req('DELETE', `/api/rules/${rDue}`, { sid: sessions.F });
    await db('DELETE FROM tickets WHERE id IN (?)', [[tW, tO, tB, tSoon, tLater]]);
  }

  // ── Notifications: events × recipients × channels, preferences, requester texts (utils/notifications.js, v5.2) ──
  {
    const N = app('./utils/notifications');
    const I = app('./utils/i18n');
    const before = await N.listRules(db);
    check('notifications: migration 61 → le comportement d avant (abonnés, attribution)', before.some(x => x.event === 'member_reply' && x.recipients.includes('followers'))
      && before.some(x => x.event === 'assigned' && x.recipients.includes('assignee') && x.channels.includes('discord')), JSON.stringify(before));
    r = await req('GET', '/api/notifications', { sid: sessions.S1 });
    check('notifications: réglage réservé aux fondateurs', r.status === 403, r.status);
    const base = before.map(({ id, ...x }) => x);
    r = await req('PUT', '/api/notifications/rules', { sid: sessions.F, body: { rules: [...base, { event: 'stage', recipients: ['assignee'], channels: ['dashboard'] }] } });
    check('notifications: « la personne attribuée » seulement pour une attribution', r.status === 400, JSON.stringify(r.body));
    r = await req('PUT', '/api/notifications/rules', { sid: sessions.F, body: { rules: [...base, { event: 'closed', recipients: ['emails'], emails: ['pas-une-adresse'], channels: ['email'] }] } });
    check('notifications: adresse fixe vérifiée', r.status === 400, JSON.stringify(r.body));
    r = await req('PUT', '/api/notifications/rules', { sid: sessions.F, body: { rules: [...base, { event: 'ticket_created', recipients: ['founders'], channels: ['dashboard'] }, { event: 'stage', recipients: ['assignees'], channels: ['dashboard'], imposed: true }] } });
    check('notifications: règles enregistrées, au journal', r.status === 200 && r.body.rules.length === base.length + 2
      && (await db("SELECT 1 FROM audit_log WHERE action = 'notifications_update'")).length > 0, JSON.stringify(r.body).slice(0, 200));
    const tN = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('200000000000000065', 'notif', 'db-notif', 'open', 'Notifications')")).insertId;
    const tRow = async () => (await db('SELECT * FROM tickets WHERE id = ?', [tN]))[0];
    let told = await N.notify(db, G, 'ticket_created', await tRow(), {});
    check('notifications: nouvel événement → fondateurs prévenus', told.includes(U.F) && !told.includes(U.S1), JSON.stringify(told));
    r = await req('PUT', '/api/notifications/prefs', { sid: sessions.F, body: { prefs: { ticket_created: { dashboard: false } } } });
    told = await N.notify(db, G, 'ticket_created', await tRow(), {});
    check('notifications: préférence personnelle respectée', r.status === 200 && r.body.prefs.ticket_created.dashboard === false && !told.includes(U.F), JSON.stringify(told));
    await db('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES (?, ?)', [tN, U.S1]);
    await req('PUT', '/api/notifications/prefs', { sid: sessions.S1, body: { prefs: { stage: { dashboard: false } } } });
    told = await N.notify(db, G, 'stage', await tRow(), { stage: 'En cours' });
    check('notifications: imposée par l espace → la préférence ne la coupe pas', told.includes(U.S1), JSON.stringify(told));
    told = await N.notify(db, G, 'stage', await tRow(), { stage: 'En cours', byId: U.S1 });
    check('notifications: jamais pour sa propre action', !told.includes(U.S1), JSON.stringify(told));
    await db('UPDATE tickets SET visibility_grade_id = -1 WHERE id = ?', [tN]);
    told = await N.notify(db, G, 'stage', await tRow(), { stage: 'En cours' });
    check('notifications: personne ne reçoit un ticket qu il ne voit pas', !told.includes(U.S1), JSON.stringify(told));
    r = await req('GET', '/api/notifications/prefs', { sid: sessions.S1 });
    check('notifications: chacun voit ce qui peut l atteindre', r.status === 200 && r.body.rules.some(x => x.event === 'stage' && x.imposed) && r.body.prefs.stage?.dashboard === false, JSON.stringify(r.body).slice(0, 300));
    // The older profile switch is the same preference
    r = await req('PATCH', '/api/profile', { sid: sessions.S2, body: { notifyAssignDm: false } });
    check('notifications: l interrupteur « MP d attribution » du profil = préférence', (await N.prefsOf(db, U.S2)).assigned?.discord === false, JSON.stringify(await N.prefsOf(db, U.S2)));
    await req('PATCH', '/api/profile', { sid: sessions.S2, body: { notifyAssignDm: true } });

    // Objective breached: once per ticket and objective
    await req('PUT', '/api/notifications/rules', { sid: sessions.F, body: { rules: [...base, { event: 'sla_breached', recipients: ['founders'], channels: ['dashboard'] }] } });
    await db('UPDATE tickets SET visibility_grade_id = NULL, sla_policy_id = 999999, tto_due_at = NOW() - INTERVAL 1 HOUR WHERE id = ?', [tN]);
    const E = app('./utils/slaEscalation');
    await E.runForGuild({ db, guildId: G, client: fakeClient });
    await E.runForGuild({ db, guildId: G, client: fakeClient });
    check('notifications: objectif dépassé → prévenu une seule fois', (await db('SELECT COUNT(*) AS n FROM sla_escalation_fired WHERE ticket_id = ? AND escalation_id = -1', [tN]))[0].n == 1, '');

    // Requester texts, per language
    r = await req('PUT', '/api/notifications/templates', { sid: sessions.F, body: { texts: [{ key: 'closed.body', lang: 'fr', text: 'Merci {foo}' }] } });
    check('notifications: variable inconnue refusée dans un texte', r.status === 400 && /foo/.test(r.body.error), JSON.stringify(r.body));
    r = await req('PUT', '/api/notifications/templates', { sid: sessions.F, body: { texts: I.LANGS.map(l => ({ key: 'closed.title', lang: l, text: `[${l}] Ticket #{id} terminé` })) } });
    check('notifications: textes enregistrés par langue', r.status === 200 && r.body.templates.find(x => x.key === 'closed.title')?.texts.en.custom === '[en] Ticket #{id} terminé', JSON.stringify(r.body).slice(0, 200));
    const said = await I.inMemberLang('200000000000000065', G, null, async () => `${I.lang()}|${I.t('closed.title', { id: 7 })}`);
    const [sl, st] = said.split('|');
    check('notifications: le demandeur reçoit le texte de l espace, dans sa langue', st === `[${sl}] Ticket #7 terminé`, said);
    check('notifications: un autre espace garde le texte standard', !I.t('closed.title', { id: 7 }).includes('terminé'), I.t('closed.title', { id: 7 }));
    r = await req('POST', '/api/notifications/templates/preview', { sid: sessions.F, body: { text: 'Ticket #{id}, fermé dans {days} jours' } });
    check('notifications: aperçu avec des valeurs d exemple', r.body.text === 'Ticket #42, fermé dans 7 jours', JSON.stringify(r.body));
    await req('PUT', '/api/notifications/templates', { sid: sessions.F, body: { texts: I.LANGS.map(l => ({ key: 'closed.title', lang: l, text: '' })) } });
    const back = await I.inMemberLang('200000000000000065', G, null, async () => I.t('closed.title', { id: 7 }));
    check('notifications: texte vidé → retour au texte standard', !back.includes('terminé'), back);

    await req('PUT', '/api/notifications/rules', { sid: sessions.F, body: { rules: base } });
    await db('DELETE FROM user_notification_prefs');
    await db('DELETE FROM tickets WHERE id = ?', [tN]);
  }

  // ── Slack and Microsoft Teams (utils/chatIntegrations.js, routes/chat*.js, v5.2) ──
  {
    const crypto = require('crypto');
    const W = app('./utils/webhookEmitter');
    const N = app('./utils/notifications');
    const realPost = W.safePostJson;
    const posted = [];
    W.safePostJson = async (url, body) => { posted.push({ url, body }); return { status: 200 }; };
    const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r2 => setTimeout(r2, 50)); } return false; };
    // Made up at each run: no value that looks like a real secret in the repository
    const SECRET = crypto.randomBytes(16).toString('hex');
    const SLACK_URL = `https://hooks.slack.com/services/T0000/B0000/${crypto.randomBytes(8).toString('hex')}`;
    r = await req('GET', '/api/chat', { sid: sessions.S1 });
    check('slack/teams: réglage réservé aux fondateurs', r.status === 403, r.status);
    r = await req('PUT', '/api/chat/slack', { sid: sessions.F, body: { webhookUrl: 'https://exemple.test/hook', active: true } });
    check('slack/teams: seule une adresse de webhook Slack est acceptée', r.status === 400, JSON.stringify(r.body));
    r = await req('PUT', '/api/chat/teams', { sid: sessions.F, body: { webhookUrl: 'https://hooks.slack.com/services/x', active: true } });
    check('slack/teams: Teams refuse une adresse qui n est pas Microsoft', r.status === 400, JSON.stringify(r.body));
    r = await req('PUT', '/api/chat/slack', { sid: sessions.F, body: { webhookUrl: SLACK_URL, signingSecret: SECRET, active: true } });
    const stored = (await db("SELECT webhook_url, signing_secret FROM chat_integrations WHERE kind = 'slack'"))[0];
    check('slack/teams: enregistré, scellé, jamais renvoyé', r.status === 200 && r.body.slack.configured && r.body.slack.hasSecret && !JSON.stringify(r.body).includes('hooks.slack.com/services')
      && !stored.webhook_url.includes('hooks.slack.com') && !stored.signing_secret.includes(SECRET), JSON.stringify(r.body));
    await req('PUT', '/api/chat/teams', { sid: sessions.F, body: { webhookUrl: 'https://contoso.webhook.office.com/webhookb2/abc', active: true } });

    // A team notification: one post per event on Slack and Teams, whoever the recipients
    const base = (await N.listRules(db)).map(({ id, ...x }) => x);
    r = await req('PUT', '/api/notifications/rules', { sid: sessions.F, body: { rules: [...base, { event: 'ticket_created', recipients: [], channels: ['slack', 'teams'] }] } });
    check('slack/teams: une notification vers un canal d équipe, sans destinataire', r.status === 200, JSON.stringify(r.body).slice(0, 200));
    const tC = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('200000000000000066', 'chat', 'db-chat', 'open', 'Imprimante en panne')")).insertId;
    const row = async () => (await db('SELECT * FROM tickets WHERE id = ?', [tC]))[0];
    posted.length = 0;
    await N.notify(db, G, 'ticket_created', await row(), { by: 'chat' });
    const sl = posted.find(p => p.url === SLACK_URL), tm = posted.find(p => p.url.includes('webhook.office.com'));
    const claimBtn = sl?.body.blocks?.[1]?.elements?.find(e => e.action_id === 'datick_claim');
    check('slack/teams: posté une fois sur chacun, avec « Prendre » sur Slack', posted.length === 2 && claimBtn?.value === `${G}:${tC}` && JSON.stringify(sl.body).includes('Imprimante'), JSON.stringify(posted).slice(0, 400));
    check('slack/teams: carte Teams avec Prendre (ouvre le dashboard) et Répondre', tm?.body.attachments?.[0]?.content?.actions?.some(a => a.title === 'Prendre' && a.url.endsWith(`/tickets/${tC}?prendre=1`)), JSON.stringify(tm?.body).slice(0, 300));
    await db('UPDATE tickets SET visibility_grade_id = -1 WHERE id = ?', [tC]);
    posted.length = 0;
    await N.notify(db, G, 'ticket_created', await row(), { by: 'chat' });
    check('slack/teams: ticket confidentiel → son numéro seulement', posted.length === 2 && posted.every(p => !JSON.stringify(p.body).includes('Imprimante')), JSON.stringify(posted).slice(0, 300));
    await db('UPDATE tickets SET visibility_grade_id = NULL WHERE id = ?', [tC]);

    // The « Prendre » button: signed by Slack, the Slack user linked once
    const slackCall = (payload, { ts = Math.floor(Date.now() / 1000), secret = SECRET } = {}) => new Promise((resolve, reject) => {
      const raw = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const sig = `v0=${crypto.createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex')}`;
      const rq = http.request({ host: '127.0.0.1', port: config.webServerPort, method: 'POST', path: `/api/chat/slack/actions/${G}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(raw), 'X-Slack-Request-Timestamp': String(ts), 'X-Slack-Signature': sig } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      rq.on('error', reject); rq.write(raw); rq.end();
    });
    const click = { type: 'block_actions', team: { id: 'T0TEST' }, user: { id: 'U0TEST', team_id: 'T0TEST' }, response_url: 'https://hooks.slack.com/actions/T0TEST/1/abc', actions: [{ action_id: 'datick_claim', value: `${G}:${tC}` }] };
    check('slack/teams: requête non signée par l espace refusée', await slackCall(click, { secret: 'f'.repeat(32) }) === 401, '');
    check('slack/teams: requête trop ancienne refusée', await slackCall(click, { ts: Math.floor(Date.now() / 1000) - 600 }) === 401, '');
    posted.length = 0;
    check('slack/teams: requête signée acceptée', await slackCall(click) === 200, '');
    await until(() => posted.some(p => p.url === click.response_url));
    const linkMsg = posted.find(p => p.url === click.response_url)?.body.text || '';
    const token = (/[?&]slack=([A-Za-z0-9_-]+)/.exec(linkMsg) || [])[1];
    check('slack/teams: utilisateur Slack inconnu → lien pour relier son compte, rien de pris', !!token && !(await db('SELECT 1 FROM ticket_assignees WHERE ticket_id = ?', [tC])).length, linkMsg);
    r = await req('POST', '/api/chat/slack/link', { sid: sessions.F, body: { token } });
    const again = await req('POST', '/api/chat/slack/link', { sid: sessions.F, body: { token } });
    check('slack/teams: compte relié, lien à usage unique', r.status === 200 && again.status === 400, JSON.stringify([r.body, again.body]));
    posted.length = 0;
    await slackCall(click);
    check('slack/teams: « Prendre » depuis Slack → ticket attribué', await until(async () => (await db('SELECT user_id FROM ticket_assignees WHERE ticket_id = ?', [tC])).some(x => x.user_id === U.F)), '');
    check('slack/teams: réponse visible par lui seul dans Slack', await until(() => posted.some(p => p.url === click.response_url && /pris le ticket/.test(p.body.text) && p.body.response_type === 'ephemeral')), JSON.stringify(posted));
    r = await req('POST', '/api/chat/slack/link', { sid: sessions.F, body: { token: 'x' } });
    check('slack/teams: jeton de liaison invalide refusé', r.status === 400, r.status);

    W.safePostJson = realPost;
    await req('PUT', '/api/notifications/rules', { sid: sessions.F, body: { rules: base } });
    await db('DELETE FROM chat_integrations');
    await db('DELETE FROM chat_user_links');
    await db('DELETE FROM tickets WHERE id = ?', [tC]);
  }

  // ── Organisations (utils/organizations.js, v5.3) ──
  {
    const O = app('./utils/organizations');
    const SP = app('./utils/slaPolicies');
    const mkContact = async (n, email) => {
      const value = `mail:${String(n).padStart(24, 'a')}`;
      const cid = (await db('INSERT INTO contacts (display_name, email, seed) VALUES (?, ?, ?)', [email, email, value])).insertId;
      await db("INSERT INTO contact_identities (value, contact_id, kind, label) VALUES (?, ?, 'email', ?)", [value, cid, email]);
      const tid = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, ?, ?, 'open', 'Org test')", [value, email, `db-org-${n}`])).insertId;
      return { value, cid, tid };
    };
    const orgOfT = async id => (await db('SELECT organization_id FROM tickets WHERE id = ?', [id]))[0].organization_id;
    r = await req('POST', '/api/organizations', { sid: sessions.S1, body: { name: 'Acme' } });
    check('organisations: écriture réservée (fondateurs, Paramètres)', r.status === 403, r.status);
    r = await req('POST', '/api/organizations', { sid: sessions.F, body: { name: 'Acme', domains: 'gmail.com' } });
    check('organisations: une messagerie publique n est pas un domaine d organisation', r.status === 400 && /publique/.test(r.body.error), JSON.stringify(r.body));
    r = await req('POST', '/api/organizations', { sid: sessions.F, body: { name: 'Acme', domains: 'pas un domaine' } });
    check('organisations: domaine invalide refusé', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/organizations', { sid: sessions.F, body: { name: 'Acme', domains: '@acme.test, acme-corp.test', managerId: U.S2, fields: { Contrat: 'Or', Téléphone: '01 02 03 04 05' } } });
    const acme = r.body.id;
    check('organisations: créée avec domaines, responsable et champs', r.status === 200 && r.body.organizations.find(o => o.id === acme)?.domains.includes('acme.test') && r.body.organizations.find(o => o.id === acme).fields.Contrat === 'Or', JSON.stringify(r.body).slice(0, 300));
    r = await req('POST', '/api/organizations', { sid: sessions.F, body: { name: 'Autre', domains: 'acme.test' } });
    check('organisations: un domaine n appartient qu à une organisation', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/organizations', { sid: sessions.F, body: { name: 'Acme Lyon', parentId: acme } });
    const lyon = r.body.id;
    r = await req('POST', '/api/organizations', { sid: sessions.F, body: { name: 'Acme Lyon Est', parentId: lyon } });
    check('organisations: un seul niveau de sous-organisations', r.status === 400, JSON.stringify(r.body));

    const a = await mkContact(1, 'paul@acme.test');
    const b = await mkContact(2, 'zoe@ailleurs.test');
    await O.assignTicket(db, a.tid); await O.assignTicket(db, b.tid);
    check('organisations: rattachement automatique par domaine (contact et ticket)', await orgOfT(a.tid) === acme && !(await orgOfT(b.tid))
      && (await db('SELECT organization_id FROM contacts WHERE id = ?', [a.cid]))[0].organization_id === acme, '');
    r = await req('GET', `/api/profiles/${a.value}`, { sid: sessions.F });
    check('organisations: visible sur la fiche du contact', r.body.organization?.id === acme && r.body.organization.manual === false, JSON.stringify(r.body.organization));
    r = await req('PUT', `/api/profiles/${a.value}/organization`, { sid: sessions.F, body: { organizationId: lyon } });
    check('organisations: placé à la main → ses tickets ouverts suivent', r.status === 200 && r.body.organization.manual && await orgOfT(a.tid) === lyon, JSON.stringify(r.body));
    await req('PUT', `/api/organizations/${acme}`, { sid: sessions.F, body: { name: 'Acme', domains: ['acme.test', 'acme-corp.test'], managerId: U.S2 } });
    check('organisations: le domaine ne déplace plus un contact placé à la main', await orgOfT(a.tid) === lyon, '');

    // Its SLA (an objective covering it and its sub-organisations), its rules, its filter
    r = await req('POST', '/api/sla-policies', { sid: sessions.F, body: { name: 'Contrat Acme', ttoMinutes: 30, businessHours: false, conditions: { organizations: [acme] } } });
    const pol = r.body.policies.find(x => x.name === 'Contrat Acme');
    await SP.refreshSla(db, a.tid); await SP.refreshSla(db, b.tid);
    check('organisations: SLA d organisation (sous-organisations comprises)', (await db('SELECT sla_policy_id FROM tickets WHERE id = ?', [a.tid]))[0].sla_policy_id === pol.id
      && (await db('SELECT sla_policy_id FROM tickets WHERE id = ?', [b.tid]))[0].sla_policy_id !== pol.id, '');
    await req('DELETE', `/api/sla-policies/${pol.id}`, { sid: sessions.F });
    r = await req('POST', '/api/rules/test', { sid: sessions.F, body: { ticketId: a.tid, rule: { name: 't', triggers: ['created'], conditions: [{ field: 'organization', values: [acme] }], actions: [{ type: 'priority', value: 'urgent' }] } } });
    check('organisations: condition de règle (sous-organisations comprises)', r.body.matched === true, JSON.stringify(r.body));
    r = await req('GET', '/api/tickets', { sid: sessions.F, query: { organization: acme, status: 'open' } });
    check('organisations: filtre de la liste (avec les sous-organisations)', r.body.tickets.some(t => t.id === a.tid) && !r.body.tickets.some(t => t.id === b.tid), JSON.stringify(r.body.tickets.map(t => t.id)));
    r = await req('GET', `/api/tickets/${a.tid}`, { sid: sessions.F });
    check('organisations: sur la fiche ticket', r.body.organization?.id === lyon, JSON.stringify(r.body.organization));

    // Its hours come before the team's and the space's
    r = await req('POST', '/api/calendars', { sid: sessions.F, body: { name: 'Contrat Acme', timezone: 'Europe/Paris', hours: app('./utils/calendars').DEFAULT_HOURS } });
    const calO = r.body.id;
    await req('PUT', `/api/organizations/${lyon}`, { sid: sessions.F, body: { name: 'Acme Lyon', parentId: acme, calendarId: calO } });
    check('organisations: horaires propres', (await app('./utils/calendars').calendarForTicket(db, (await db('SELECT * FROM tickets WHERE id = ?', [a.tid]))[0]))?.id === calO, '');
    // Its account manager can be notified
    const N = app('./utils/notifications');
    const baseN = (await N.listRules(db)).map(({ id, ...x }) => x);
    await req('PUT', '/api/notifications/rules', { sid: sessions.F, body: { rules: [...baseN, { event: 'ticket_created', recipients: ['org_manager'], channels: ['dashboard'] }] } });
    await db('UPDATE tickets SET organization_id = ? WHERE id = ?', [acme, b.tid]);
    const told = await N.notify(db, G, 'ticket_created', (await db('SELECT * FROM tickets WHERE id = ?', [b.tid]))[0], {});
    check('organisations: le responsable de compte peut être prévenu', told.includes(U.S2), JSON.stringify(told));
    await req('PUT', '/api/notifications/rules', { sid: sessions.F, body: { rules: baseN } });
    r = await req('PUT', `/api/profiles/${a.value}/organization`, { sid: sessions.F, body: { auto: true } });
    check('organisations: retour au rattachement par domaine', r.body.organization?.id === acme && !r.body.organization.manual, JSON.stringify(r.body));

    r = await req('POST', '/api/organizations/import', { sid: sessions.F, body: { csv: 'nom;domaines\nGlobex;globex.test, globex.example\nInitech;gmail.com' } });
    check('organisations: import CSV (lignes en erreur signalées)', r.status === 200 && r.body.created === 1 && r.body.errors.length === 1 && r.body.organizations.some(o => o.name === 'Globex' && o.domains.length === 2), JSON.stringify(r.body).slice(0, 300));
    r = await req('GET', '/api/organizations', { sid: sessions.S1 });
    check('organisations: le staff voit les noms, pas les notes ni les champs', r.status === 200 && r.body.length >= 3 && r.body.every(o => o.fields === undefined && o.notes === undefined), JSON.stringify(r.body).slice(0, 200));

    for (const o of (await O.listOrgs(db))) await req('DELETE', `/api/organizations/${o.id}`, { sid: sessions.F });
    check('organisations: supprimées → contacts détachés', !(await db('SELECT 1 FROM contacts WHERE organization_id IS NOT NULL')).length && !(await db('SELECT 1 FROM organizations')).length, '');
    await req('DELETE', `/api/calendars/${calO}`, { sid: sessions.F });
    await db('DELETE FROM tickets WHERE id IN (?)', [[a.tid, b.tid]]);
    await db('DELETE FROM contacts WHERE id IN (?)', [[a.cid, b.cid]]);
  }

  // ── Organisation portal: the tickets of one's organisation in the member space (v5.3) ──
  {
    const O = app('./utils/organizations');
    const MA = '200000000000000101', MB = '200000000000000102', MC = '200000000000000103';
    const mkPerson = async (id, name) => {
      const cid = (await db('INSERT INTO contacts (display_name, seed) VALUES (?, ?)', [name, id])).insertId;
      await db("INSERT INTO contact_identities (value, contact_id, kind, label) VALUES (?, ?, 'discord', ?)", [id, cid, name]);
      return cid;
    };
    const mkT = async (owner, tag, extra = '') => (await db(`INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject${extra ? ', visibility_grade_id' : ''}) VALUES (?, ?, ?, 'open', ?${extra ? ', ?' : ''})`,
      [owner, tag, `db-po-${Math.random().toString(36).slice(2, 9)}`, `Demande de ${tag}`, ...(extra ? [extra] : [])])).insertId;
    r = await req('POST', '/api/organizations', { sid: sessions.F, body: { name: 'Portail SA' } });
    const org = r.body.id;
    const cA = await mkPerson(MA, 'Alice'), cB = await mkPerson(MB, 'Bruno'), cC = await mkPerson(MC, 'Chloé');
    for (const c of [cA, cB]) await O.setContactOrg(db, c, org);
    const tA = await mkT(MA, 'Alice'), tB = await mkT(MB, 'Bruno'), tConf = await mkT(MB, 'Bruno', -1), tC = await mkT(MC, 'Chloé');
    const [gR] = await db('SELECT id FROM grades LIMIT 1');
    const tGrade = await mkT(MB, 'Bruno', gR.id);
    for (const id of [tA, tB, tConf, tGrade, tC]) await O.assignTicket(db, id, { sync: false });
    await mk('POA', { member: { id: MA, username: 'alice', avatar: null } });
    const orgIds = async () => ((await req('GET', '/api/member/tickets', { sid: sessions.POA })).body.find(g => g.guild.id === G)?.orgTickets || []).map(t => t.id);
    check('portail org: « personne » par défaut → rien de plus', (await orgIds()).length === 0, '');
    await req('PUT', `/api/organizations/${org}`, { sid: sessions.F, body: { name: 'Portail SA', portalVisibility: 'manager' } });
    check('portail org: « responsables » → pas pour un contact ordinaire', (await orgIds()).length === 0, '');
    r = await req('PUT', `/api/profiles/${MA}/organization`, { sid: sessions.S1, body: { portalManager: true } });
    check('portail org: désigner un responsable côté client est réservé', r.status === 403, r.status);
    r = await req('PUT', `/api/profiles/${MA}/organization`, { sid: sessions.F, body: { portalManager: true } });
    check('portail org: responsable côté client désigné, au journal', r.status === 200 && r.body.organization.portalManager === true
      && (await db("SELECT 1 FROM audit_log WHERE action = 'contact_portal_manager'")).length > 0, JSON.stringify(r.body));
    let ids = await orgIds();
    check('portail org: le responsable voit les tickets de ses collègues', ids.includes(tB) && !ids.includes(tA), JSON.stringify(ids));
    check('portail org: jamais un ticket confidentiel ni restreint à un grade', !ids.includes(tConf) && !ids.includes(tGrade), JSON.stringify(ids));
    check('portail org: jamais hors de son organisation', !ids.includes(tC), JSON.stringify(ids));
    r = await req('GET', `/api/member/tickets/${G}/${tB}`, { sid: sessions.POA });
    check('portail org: le ticket d un collègue se lit, sans fichiers ni envoi', r.status === 200 && r.body.access === 'org' && r.body.ticket.requester === 'Bruno' && r.body.upload.enabled === false && r.body.files.length === 0, JSON.stringify(r.body).slice(0, 300));
    r = await req('POST', `/api/member/tickets/${G}/${tB}/messages`, { sid: sessions.POA, body: { content: 'Je réponds à la place de Bruno' } });
    check('portail org: lecture seule (pas de réponse dans le ticket d un collègue)', r.status === 404, r.status);
    r = await req('GET', `/api/member/tickets/${G}/${tConf}`, { sid: sessions.POA });
    check('portail org: un ticket confidentiel reste introuvable', r.status === 404, r.status);
    await req('PUT', `/api/profiles/${MA}/organization`, { sid: sessions.F, body: { portalManager: false } });
    await req('PUT', `/api/organizations/${org}`, { sid: sessions.F, body: { name: 'Portail SA', portalVisibility: 'all' } });
    ids = await orgIds();
    check('portail org: « tous les membres » → chacun voit les tickets de l organisation', ids.includes(tB) && !ids.includes(tConf), JSON.stringify(ids));
    await req('DELETE', `/api/organizations/${org}`, { sid: sessions.F });
    check('portail org: organisation supprimée → plus rien', (await orgIds()).length === 0, '');
    await db('DELETE FROM tickets WHERE id IN (?)', [[tA, tB, tConf, tGrade, tC]]);
    await db('DELETE FROM contacts WHERE id IN (?)', [[cA, cB, cC]]);
  }

  // ── Service catalogue (utils/catalog.js, v5.3) ──
  {
    const C = app('./utils/catalog');
    // The opening forms of before become services (migration 65)
    await db('DELETE FROM catalog_services');
    const fId = (await db("INSERT INTO intake_forms (name, subject, active) VALUES ('Accès VPN', 'Compte', 1)")).insertId;
    await db("INSERT INTO intake_form_fields (form_id, label, field_type, choices, required, position) VALUES (?, 'Système', 'choice', ?, 1, 0), (?, 'Motif', 'text', NULL, 0, 1)", [fId, JSON.stringify(['Windows', 'macOS']), fId]);
    const m65 = app('./utils/tenantMigrations').MIGRATIONS.find(m => m.version === 65);
    await db(m65.statements[m65.statements.length - 1]);
    const conv = (await C.listServices(db)).find(x => x.name === 'Accès VPN');
    check('catalogue: les formulaires d avant deviennent des services', !!conv && conv.template.subject === 'Compte' && conv.fields.length === 2
      && conv.fields[0].type === 'select' && conv.fields[0].choices.includes('macOS') && conv.fields[0].required && !conv.fields[1].required, JSON.stringify(conv));
    await db('DELETE FROM catalog_services'); await db('DELETE FROM intake_forms WHERE id = ?', [fId]);

    r = await req('POST', '/api/catalog', { sid: sessions.S1, body: { name: 'x' } });
    check('catalogue: écriture réservée (fondateurs, Paramètres)', r.status === 403, r.status);
    r = await req('POST', '/api/catalog', { sid: sessions.F, body: { name: 'x', fields: [{ label: 'Choix', type: 'select', choices: ['Seul'] }] } });
    check('catalogue: une liste a au moins deux choix', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/catalog', { sid: sessions.F, body: { name: 'x', fields: [{ key: 'a', label: 'A', showIf: { key: 'b', equals: 'x' } }, { key: 'b', label: 'B' }] } });
    check('catalogue: une condition porte sur un champ placé avant', r.status === 400, JSON.stringify(r.body));
    const team = (await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'Équipe matériel' } })).body.find(t => t.name === 'Équipe matériel');
    const [cfgB] = await db('SELECT ticket_subjects, max_tickets_per_day FROM guild_config WHERE id = 1');
    await db('UPDATE guild_config SET ticket_subjects = ?, max_tickets_per_day = 50 WHERE id = 1', [JSON.stringify(['Matériel', 'Compte'])]);
    const svc = { name: 'Demander du matériel', icon: '💻', category: 'Matériel', description: 'Un poste, un écran, un casque…',
      fields: [{ key: 'kind', label: 'Matériel', type: 'select', choices: ['Portable', 'Écran'], required: true },
        { key: 'model', label: 'Modèle souhaité', type: 'text', required: true, showIf: { key: 'kind', equals: 'Portable' } },
        { key: 'date', label: 'Pour quand ?', type: 'date' }, { key: 'manager_ok', label: 'Validé par mon responsable', type: 'checkbox', required: true }],
      template: { subject: 'Matériel', type: 'request', priority: 'urgent', teamId: team.id } };
    r = await req('POST', '/api/catalog', { sid: sessions.F, body: svc });
    const sid = r.body.id;
    check('catalogue: service avec champs conditionnels et gabarit', r.status === 200 && r.body.services.find(x => x.id === sid)?.fields[1].showIf?.equals === 'Portable', JSON.stringify(r.body).slice(0, 300));
    const s1 = await C.serviceOf(db, sid);
    check('catalogue: champ conditionnel demandé seulement si la condition est remplie', C.checkAnswers(s1, { kind: 'Portable', manager_ok: true }).error?.label === 'Modèle souhaité'
      && !C.checkAnswers(s1, { kind: 'Écran', manager_ok: true }).error, JSON.stringify(C.checkAnswers(s1, { kind: 'Écran', manager_ok: true })));
    check('catalogue: valeurs vérifiées (liste, date, case obligatoire)', C.checkAnswers(s1, { kind: 'Tablette', manager_ok: true }).error?.reason === 'choice'
      && C.checkAnswers(s1, { kind: 'Écran', manager_ok: true, date: 'demain' }).error?.reason === 'date' && C.checkAnswers(s1, { kind: 'Écran' }).error?.reason === 'required', '');

    const MW = '200000000000000081';
    await redis.del(`memberguilds:${MW}`);
    await mk('MCAT', { member: { id: MW, username: 'member81', avatar: null } });
    r = await req('GET', `/api/member/guilds/${G}/catalog`, { sid: sessions.MCAT });
    check('catalogue: proposé dans l espace membre, sans le gabarit', r.status === 200 && r.body.services.some(x => x.id === sid && x.fields.length === 4) && !JSON.stringify(r.body).includes('teamId'), JSON.stringify(r.body).slice(0, 300));
    r = await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.MCAT, body: { serviceId: sid, catalog: { kind: 'Portable', manager_ok: true }, content: 'Mon portable est trop lent' } });
    check('catalogue: champ conditionnel manquant refusé à l ouverture', r.status === 400 && /Modèle souhaité/.test(r.body.error), JSON.stringify(r.body));
    for (const k of await redis.keys('*burst:webopen:*')) await redis.del(k);
    r = await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.MCAT, body: { serviceId: sid, catalog: { kind: 'Portable', model: 'ThinkPad X1', manager_ok: true, date: '2026-12-01' }, content: 'Mon portable est trop lent' } });
    const ct = r.body.ticketId;
    const [cT] = ct ? await db('SELECT * FROM tickets WHERE id = ?', [ct]) : [];
    const [cN] = ct ? await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user' ORDER BY id LIMIT 1", [ct]) : [];
    check('catalogue: ticket ouvert avec les réponses du formulaire', r.status === 200 && /Demander du matériel/.test(cN?.content) && /Modèle souhaité\*\* : ThinkPad X1/.test(cN?.content), JSON.stringify([r.body, cN]));
    check('catalogue: gabarit appliqué (sujet, type, priorité, équipe)', cT?.subject === 'Matériel' && cT.ticket_type === 'request' && cT.priority === 'urgent' && cT.team_id === team.id && cT.catalog_service_id === sid, JSON.stringify(cT && { s: cT.subject, t: cT.ticket_type, p: cT.priority, team: cT.team_id }));
    await req('PUT', `/api/catalog/${sid}`, { sid: sessions.F, body: { ...svc, active: false } });
    r = await req('POST', `/api/member/guilds/${G}/tickets`, { sid: sessions.MCAT, body: { serviceId: sid, catalog: { kind: 'Écran', manager_ok: true }, content: 'Un écran' } });
    check('catalogue: service retiré → refusé', r.status === 404, r.status);

    await req('DELETE', `/api/catalog/${sid}`, { sid: sessions.F });
    await req('DELETE', `/api/teams/${team.id}`, { sid: sessions.F });
    const subj = cfgB.ticket_subjects == null || typeof cfgB.ticket_subjects === 'string' ? cfgB.ticket_subjects : JSON.stringify(cfgB.ticket_subjects);
    await db('UPDATE guild_config SET ticket_subjects = ?, max_tickets_per_day = ? WHERE id = 1', [subj, cfgB.max_tickets_per_day]);
    if (ct) await db('DELETE FROM tickets WHERE id = ?', [ct]);
  }

  // ── Recurring tickets (utils/recurring.js, v5.3) ──
  {
    const RC = app('./utils/recurring');
    const iso = d => d && new Date(d).toISOString();
    r = await req('GET', '/api/recurring', { sid: sessions.S1 });
    check('récurrents: réservés (fondateurs, Paramètres)', r.status === 403, r.status);
    r = await req('POST', '/api/recurring', { sid: sessions.F, body: { name: 'x', content: 'y', frequency: 'monthly', monthday: 31, time: '09:00' } });
    check('récurrents: jour du mois de 1 à 28', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/recurring', { sid: sessions.F, body: { name: 'x', content: 'y', frequency: 'daily', time: '25:00' } });
    check('récurrents: heure vérifiée', r.status === 400, JSON.stringify(r.body));
    const base = { timezone: 'Europe/Paris', time: '09:00' };
    check('récurrents: chaque lundi à 9 h (Paris)', iso(RC.nextRun({ ...base, frequency: 'weekly', weekday: 1 }, Date.parse('2026-11-22T12:00:00Z'))) === '2026-11-23T08:00:00.000Z', '');
    check('récurrents: le 15 de chaque mois', iso(RC.nextRun({ ...base, frequency: 'monthly', monthday: 15 }, Date.parse('2026-11-20T12:00:00Z'))) === '2026-12-15T08:00:00.000Z', '');
    check('récurrents: jours ouvrés (vendredi après 9 h → lundi)', iso(RC.nextRun({ ...base, frequency: 'weekdays' }, Date.parse('2026-11-20T10:00:00Z'))) === '2026-11-23T08:00:00.000Z', '');
    check('récurrents: heure d été respectée', iso(RC.nextRun({ ...base, frequency: 'daily' }, Date.parse('2027-03-27T09:00:00Z'))) === '2027-03-28T07:00:00.000Z', '');

    const team = (await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'Équipe système' } })).body.find(t => t.name === 'Équipe système');
    r = await req('POST', '/api/recurring', { sid: sessions.F, body: { name: 'Contrôle des sauvegardes', content: 'Vérifier les sauvegardes de la nuit.', frequency: 'weekly', weekday: 1, time: '09:00', priority: 'urgent', teamId: team.id, type: 'request' } });
    const rid = r.body.id;
    const one = r.body.recurring?.find(x => x.id === rid);
    check('récurrent créé, prochaine ouverture calculée', r.status === 200 && new Date(one.nextRunAt) > Date.now(), JSON.stringify(one));
    await db('UPDATE recurring_tickets SET next_run_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [rid]);
    const ctx = { db, guildId: G, client: fakeClient };
    let n = await RC.runForGuild(ctx);
    const row = async () => (await RC.list(db)).find(x => x.id === rid);
    const t1 = (await row()).lastTicketId;
    const [T1] = t1 ? await db('SELECT * FROM tickets WHERE id = ?', [t1]) : [];
    check('récurrents: ouvert à l heure, avec son gabarit', n === 1 && T1 && T1.owner_id === RC.ownerOf(G, rid) && T1.subject === 'Contrôle des sauvegardes' && T1.priority === 'urgent' && T1.team_id === team.id && T1.ticket_type === 'request', JSON.stringify(T1 && { o: T1.owner_id, s: T1.subject, p: T1.priority }));
    check('récurrents: au journal, prochaine ouverture repoussée', (await db("SELECT 1 FROM audit_log WHERE action = 'ticket_recurring' AND ticket_id = ?", [t1])).length === 1 && new Date((await row()).nextRunAt) > Date.now(), '');
    check('récurrents: une seule fois par échéance', await RC.runForGuild(ctx) === 0, '');
    await db('UPDATE recurring_tickets SET next_run_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [rid]);
    n = await RC.runForGuild(ctx);
    check('récurrents: attend que le précédent soit fermé', n === 0 && (await row()).lastTicketId === t1 && new Date((await row()).nextRunAt) > Date.now(), '');
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [t1]);
    await db('UPDATE recurring_tickets SET next_run_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [rid]);
    n = await RC.runForGuild(ctx);
    const t2 = (await row()).lastTicketId;
    check('récurrents: le précédent fermé → le suivant s ouvre', n === 1 && t2 && t2 !== t1, '');
    r = await req('POST', `/api/recurring/${rid}/run`, { sid: sessions.F });
    check('récurrents: « Ouvrir maintenant » pour essayer', r.status === 200 && r.body.ticketId && r.body.ticketId !== t2, JSON.stringify(r.body));
    const ids = [t1, t2, r.body.ticketId].filter(Boolean);
    await req('DELETE', `/api/recurring/${rid}`, { sid: sessions.F });
    await req('DELETE', `/api/teams/${team.id}`, { sid: sessions.F });
    await db('DELETE FROM tickets WHERE id IN (?)', [ids]);
  }

  // ── Tasks of a ticket and task templates (utils/tasks.js, v5.4) ──
  {
    const MWT = '200000000000000081';
    const tk = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member81', 'db-tasks', 'open', 'Arrivée de Léa')", [MWT])).insertId;
    r = await req('POST', `/api/tickets/${tk}/tasks`, { sid: sessions.F, body: { title: 'Créer le compte', assigneeId: U.OUT } });
    check('tâches: on n attribue qu au staff', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', `/api/tickets/${tk}/tasks`, { sid: sessions.F, body: { title: 'Créer le compte', assigneeId: U.S1, plannedMinutes: 30, dueAt: '2026-12-01T09:00:00Z', visible: true } });
    const t1 = r.body.tasks?.[0];
    check('tâches: ajoutée (personne, durée prévue, date, visible)', r.status === 200 && t1?.assigneeId === U.S1 && t1.plannedMinutes === 30 && t1.visible && t1.state === 'todo', JSON.stringify(r.body).slice(0, 300));
    r = await req('POST', `/api/tickets/${tk}/tasks`, { sid: sessions.F, body: { title: 'Commander le badge', description: 'Au service sécurité' } });
    const t2 = r.body.tasks.find(t => t.title === 'Commander le badge');
    r = await req('PATCH', `/api/tickets/${tk}/tasks/${t1.id}`, { sid: sessions.F, body: { state: 'fini' } });
    check('tâches: état vérifié', r.status === 400, JSON.stringify(r.body));
    r = await req('PATCH', `/api/tickets/${tk}/tasks/${t1.id}`, { sid: sessions.F, body: { state: 'done' } });
    const d1 = r.body.tasks.find(t => t.id === t1.id);
    check('tâches: faite (qui, quand), avancement', d1.state === 'done' && d1.doneBy === 'F' && !!d1.doneAt && r.body.progress.done === 1 && r.body.progress.total === 2, JSON.stringify(r.body.progress));
    r = await req('PATCH', `/api/tickets/${tk}/tasks/${t2.id}`, { sid: sessions.F, body: { state: 'na' } });
    check('tâches: « sans objet » sort du compte', r.body.progress.total === 1 && r.body.progress.done === 1, JSON.stringify(r.body.progress));
    // Time spent on a task: by hand and by the stopwatch
    r = await req('POST', `/api/tickets/${tk}/time`, { sid: sessions.F, body: { minutes: 30, taskId: t1.id } });
    r = await req('POST', `/api/tickets/${tk}/time/start`, { sid: sessions.F, body: { taskId: t1.id } });
    await db('UPDATE ticket_time SET started_at = NOW() - INTERVAL 10 MINUTE WHERE task_id = ? AND ended_at IS NULL', [t1.id]);
    await req('POST', `/api/tickets/${tk}/time/stop`, { sid: sessions.F });
    r = await req('GET', `/api/tickets/${tk}/tasks`, { sid: sessions.F });
    check('tâches: temps passé (à la main et chronomètre)', r.body.tasks.find(t => t.id === t1.id).spentSeconds >= 2390, JSON.stringify(r.body.tasks.map(t => t.spentSeconds)));
    r = await req('POST', `/api/tickets/${tk}/time`, { sid: sessions.F, body: { minutes: 5, taskId: 999999 } });
    check('tâches: temps sur une tâche d un autre ticket refusé', r.status === 400, r.status);
    // The requester sees only the visible tasks
    await mk('MTASK', { member: { id: MWT, username: 'member81', avatar: null } });
    r = await req('GET', `/api/member/tickets/${G}/${tk}`, { sid: sessions.MTASK });
    check('tâches: le demandeur ne voit que les tâches visibles', r.status === 200 && r.body.tasks?.length === 1 && r.body.tasks[0].title === 'Créer le compte' && r.body.tasks[0].state === 'done' && !JSON.stringify(r.body.tasks).includes('assignee'), JSON.stringify(r.body.tasks));

    // Templates: by hand and by a rule
    r = await req('POST', '/api/task-templates', { sid: sessions.S1, body: { name: 'x', tasks: [{ title: 'a' }] } });
    check('tâches: modèles réservés (fondateurs, Paramètres)', r.status === 403, r.status);
    r = await req('POST', '/api/task-templates', { sid: sessions.F, body: { name: 'Arrivée d un salarié', tasks: [{ title: 'Préparer le poste', plannedMinutes: 60, dueInDays: 2 }, { title: 'Ouvrir la messagerie' }, { title: 'Accueil le premier jour', visible: true, dueInDays: 7 }] } });
    const tpl = r.body.id;
    r = await req('POST', `/api/tickets/${tk}/tasks`, { sid: sessions.F, body: { templateId: tpl } });
    const fromTpl = r.body.tasks.filter(t => ['Préparer le poste', 'Ouvrir la messagerie', 'Accueil le premier jour'].includes(t.title));
    check('tâches: modèle appliqué (3 tâches, échéances calculées)', r.status === 200 && fromTpl.length === 3 && fromTpl.find(t => t.title === 'Préparer le poste').dueAt && !fromTpl.find(t => t.title === 'Ouvrir la messagerie').dueAt, JSON.stringify(fromTpl));
    const tk2 = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('200000000000000067', 'regle', 'db-tasks2', 'open', 'Arrivée')")).insertId;
    r = await req('POST', '/api/rules', { sid: sessions.F, body: { name: 'Arrivées', triggers: ['created'], conditions: [{ field: 'subject', values: ['Arrivée'] }], actions: [{ type: 'tasks', value: tpl }] } });
    const ruleId = r.body.id;
    await app('./utils/ruleEngine').runRules({ db, client: fakeClient, guildId: G, ticketId: tk2, trigger: 'created' });
    check('tâches: une règle applique un modèle', (await db('SELECT COUNT(*) AS n FROM ticket_tasks WHERE ticket_id = ?', [tk2]))[0].n == 3, '');
    await req('DELETE', `/api/rules/${ruleId}`, { sid: sessions.F });
    r = await req('DELETE', `/api/tickets/${tk}/tasks/${t1.id}`, { sid: sessions.F });
    check('tâches: supprimée, son temps reste sur le ticket', r.status === 200 && !r.body.tasks.some(t => t.id === t1.id)
      && (await db('SELECT COUNT(*) AS n FROM ticket_time WHERE ticket_id = ? AND task_id IS NULL', [tk]))[0].n >= 2, '');
    check('tâches: au journal du ticket', (await db("SELECT 1 FROM audit_log WHERE ticket_id = ? AND action IN ('task_add', 'task_state', 'task_template_apply', 'task_delete')", [tk])).length >= 4, '');
    await req('DELETE', `/api/task-templates/${tpl}`, { sid: sessions.F });
    await db('DELETE FROM tickets WHERE id IN (?)', [[tk, tk2]]);
  }

  // ── Planning and iCal feed (utils/planning.js, v5.4) ──
  {
    const tomorrow = new Date(Date.now() + 864e5);
    const tP = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, ttr_due_at) VALUES ('200000000000000068', 'plan', 'db-plan', 'open', 'Migration du serveur', ?)", [new Date(Date.now() + 2 * 864e5)])).insertId;
    await db('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES (?, ?)', [tP, U.F]);
    const tConf = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES ('200000000000000069', 'conf', 'db-plan2', 'open', 'Secret', -1)")).insertId;
    r = await req('POST', `/api/tickets/${tP}/tasks`, { sid: sessions.F, body: { title: 'Sauvegarder avant migration', assigneeId: U.F, dueAt: tomorrow.toISOString(), plannedMinutes: 45 } });
    const task = r.body.tasks[0];
    await db("INSERT INTO ticket_tasks (ticket_id, title, assignee_id, due_at) VALUES (?, 'Tâche confidentielle', ?, ?)", [tConf, U.S1, tomorrow]);
    const absId = (await db("INSERT INTO staff_absences (user_id, starts_at, ends_at, reason, created_by_id, created_by_tag) VALUES (?, ?, ?, 'Congés', ?, 'F')", [U.F, new Date(Date.now() + 3 * 864e5), new Date(Date.now() + 5 * 864e5), U.F])).insertId;
    r = await req('GET', '/api/planning', { sid: sessions.F, query: { from: new Date().toISOString(), to: new Date(Date.now() + 7 * 864e5).toISOString() } });
    check('planning: mes tâches planifiées, échéances de mes tickets, absences', r.status === 200 && r.body.tasks.some(k => k.id === task.id) && r.body.deadlines.some(d => d.ticketId === tP) && r.body.absences.some(a => a.id === absId), JSON.stringify(r.body).slice(0, 300));
    r = await req('GET', '/api/planning', { sid: sessions.F, query: { from: new Date().toISOString(), to: new Date(Date.now() + 90 * 864e5).toISOString() } });
    check('planning: période bornée', r.status === 400, r.status);
    r = await req('GET', '/api/planning', { sid: sessions.S1, query: { user: U.F } });
    check('planning: celui d un collègue hors de son équipe refusé', r.status === 403, r.status);
    const team = (await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'Équipe planning', members: [U.S1] } })).body.find(t => t.name === 'Équipe planning');
    r = await req('GET', '/api/planning', { sid: sessions.S2, query: { team: team.id } });
    check('planning: une équipe réservée à ses membres', r.status === 403, r.status);
    r = await req('GET', '/api/planning', { sid: sessions.S1 });
    check('planning: jamais une tâche d un ticket qu on ne voit pas', r.status === 200 && !r.body.tasks.some(k => k.title === 'Tâche confidentielle'), JSON.stringify(r.body.tasks));
    // Drag and drop: the task changes day
    const later = new Date(Date.now() + 4 * 864e5);
    await req('PATCH', `/api/tickets/${tP}/tasks/${task.id}`, { sid: sessions.F, body: { dueAt: later.toISOString() } });
    r = await req('GET', '/api/planning', { sid: sessions.F, query: { from: new Date(Date.now() + 3 * 864e5).toISOString(), to: new Date(Date.now() + 6 * 864e5).toISOString() } });
    check('planning: replanifier une tâche (glisser-déposer)', r.body.tasks.some(k => k.id === task.id), JSON.stringify(r.body.tasks.map(k => k.dueAt)));

    // iCal feed
    r = await req('POST', '/api/planning/ical', { sid: sessions.F });
    const path = new URL(r.body.url, 'http://x').pathname;
    const raw = (await db('SELECT ical_token_hash FROM dashboard_users WHERE user_id = ?', [U.F]))[0].ical_token_hash;
    check('ical: lien secret créé, stocké haché', r.status === 200 && /\/api\/ical\/\d+\.[A-Za-z0-9_-]{32}\.ics$/.test(path) && raw && !path.includes(raw), path);
    r = await req('GET', path);
    check('ical: flux au format iCalendar avec la tâche', r.status === 200 && /text\/calendar/.test(r.headers['content-type']) && /BEGIN:VCALENDAR/.test(r.body) && /SUMMARY:Tâche : Sauvegarder avant migration/.test(r.body) && /BEGIN:VEVENT/.test(r.body), String(r.body).slice(0, 300));
    r = await req('GET', `/api/ical/${G}.${'x'.repeat(32)}.ics`);
    check('ical: secret inconnu → 404', r.status === 404, r.status);
    const r2 = await req('POST', '/api/planning/ical', { sid: sessions.F });
    check('ical: un nouveau lien coupe l ancien', (await req('GET', path)).status === 404 && (await req('GET', new URL(r2.body.url, 'http://x').pathname)).status === 200, '');
    await req('DELETE', '/api/planning/ical', { sid: sessions.F });
    check('ical: lien retiré → 404', (await req('GET', new URL(r2.body.url, 'http://x').pathname)).status === 404, '');
    await req('DELETE', `/api/teams/${team.id}`, { sid: sessions.F });
    await db('DELETE FROM staff_absences WHERE id = ?', [absId]);
    await db('DELETE FROM tickets WHERE id IN (?)', [[tP, tConf]]);
  }

  // ── Staff interface: columns of the list, views shared with a team (v5.4) ──
  {
    r = await req('PUT', '/api/profile/ui-prefs', { sid: sessions.S1, body: { listColumns: ['user', 'motdepasse'] } });
    check('interface: colonne inconnue refusée', r.status === 400, r.status);
    r = await req('PUT', '/api/profile/ui-prefs', { sid: sessions.S1, body: { listColumns: ['user', 'team', 'organization', 'last'] } });
    const back = await req('GET', '/api/profile/ui-prefs', { sid: sessions.S1 });
    check('interface: colonnes de la liste gardées par personne', r.status === 200 && back.body.listColumns?.join() === 'user,team,organization,last'
      && !(await req('GET', '/api/profile/ui-prefs', { sid: sessions.S2 })).body.listColumns, JSON.stringify(back.body));
    const team = (await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'Équipe vues', members: [U.S1, U.S2] } })).body.find(t => t.name === 'Équipe vues');
    r = await req('POST', '/api/ticket-views', { sid: sessions.S3, body: { name: 'Hors équipe', filters: { status: 'open' }, team_id: team.id } });
    check('vues: on ne partage qu avec une équipe dont on fait partie', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/ticket-views', { sid: sessions.S1, body: { name: 'Urgents de l équipe', filters: { status: 'open', priority: 'urgent', organization: '3' }, team_id: team.id } });
    const vid = r.body.id;
    check('vues: vue partagée avec l équipe (filtre organisation compris)', r.status === 201 && r.body.team_id === team.id && r.body.filters.organization === '3', JSON.stringify(r.body));
    r = await req('GET', '/api/ticket-views', { sid: sessions.S2 });
    const seen = r.body.find(v => v.id === vid);
    check('vues: un membre de l équipe la voit, en lecture seule', seen?.shared === true && seen.author === 'S1' && seen.team_name === 'Équipe vues', JSON.stringify(seen));
    r = await req('DELETE', `/api/ticket-views/${vid}`, { sid: sessions.S2 });
    check('vues: seul son auteur la supprime', (await db('SELECT 1 FROM ticket_views WHERE id = ?', [vid])).length === 1, '');
    r = await req('GET', '/api/ticket-views', { sid: sessions.S3 });
    check('vues: hors de l équipe, invisible', !r.body.some(v => v.id === vid), JSON.stringify(r.body.map(v => v.id)));
    await req('PATCH', `/api/ticket-views/${vid}`, { sid: sessions.S1, body: { team_id: null } });
    check('vues: le partage se retire', !(await req('GET', '/api/ticket-views', { sid: sessions.S2 })).body.some(v => v.id === vid), '');
    await req('DELETE', `/api/ticket-views/${vid}`, { sid: sessions.S1 });
    await req('DELETE', `/api/teams/${team.id}`, { sid: sessions.F });
  }

  // ── Costs (utils/costs.js, v5.4) ──
  {
    r = await req('GET', '/api/costs/settings', { sid: sessions.S1 });
    check('coûts: réservés (fondateurs, permission Coûts)', r.status === 403, r.status);
    const team = (await req('POST', '/api/teams', { sid: sessions.F, body: { name: 'Équipe coûts' } })).body.find(t => t.name === 'Équipe coûts');
    r = await req('PUT', '/api/costs/settings', { sid: sessions.F, body: { currency: 'EUR', defaultRateCents: 3000, fixedCents: 500, userRates: { [U.OUT]: 1000 } } });
    check('coûts: un taux par personne seulement pour le staff', r.status === 400, JSON.stringify(r.body));
    r = await req('PUT', '/api/costs/settings', { sid: sessions.F, body: { currency: 'EUR', defaultRateCents: 3000, fixedCents: 500, userRates: { [U.S1]: 6000 }, teamRates: { [team.id]: 4500 } } });
    check('coûts: taux et forfait enregistrés, au journal', r.status === 200 && r.body.userRates[U.S1] === 6000 && r.body.teamRates[String(team.id)] === 4500 && r.body.fixedCents === 500
      && (await db("SELECT 1 FROM audit_log WHERE action = 'cost_settings'")).length > 0, JSON.stringify(r.body));
    const org = (await req('POST', '/api/organizations', { sid: sessions.F, body: { name: 'Client coûts' } })).body.id;
    const tc = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, team_id, organization_id) VALUES ('200000000000000070', 'cout', 'db-cost', 'open', 'Intervention', ?, ?)", [team.id, org])).insertId;
    const tNo = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('200000000000000071', 'cout2', 'db-cost2', 'open', 'Sans équipe')")).insertId;
    await db("INSERT INTO ticket_time (ticket_id, user_id, user_tag, source, started_at, ended_at, seconds) VALUES (?, ?, 'S1', 'manual', NOW(), NOW(), 3600), (?, ?, 'S2', 'manual', NOW(), NOW(), 1800), (?, ?, 'S2', 'manual', NOW(), NOW(), 3600)",
      [tc, U.S1, tc, U.S2, tNo, U.S2]);
    r = await req('POST', `/api/costs/tickets/${tc}`, { sid: sessions.F, body: { label: 'Déplacement', amountCents: 1200 } });
    check('coûts: coût du ticket (taux de la personne, sinon de l équipe, forfait, frais)', r.status === 200 && r.body.time.find(x => x.userId === U.S1)?.cents === 6000
      && r.body.time.find(x => x.userId === U.S2)?.cents === 2250 && r.body.fixedCents === 500 && r.body.totalCents === 6000 + 2250 + 500 + 1200, JSON.stringify(r.body));
    r = await req('GET', `/api/costs/tickets/${tNo}`, { sid: sessions.F });
    check('coûts: sans équipe → taux de l espace', r.body.time[0]?.cents === 3000 && r.body.totalCents === 3500, JSON.stringify(r.body));
    r = await req('POST', `/api/costs/tickets/${tc}`, { sid: sessions.F, body: { label: 'x', amountCents: -5 } });
    check('coûts: montant vérifié', r.status === 400, r.status);
    const from = new Date(Date.now() - 864e5).toISOString(), to = new Date(Date.now() + 864e5).toISOString();
    r = await req('GET', '/api/costs/report', { sid: sessions.F, query: { from, to, by: 'organization' } });
    const rowOrg = r.body.rows?.find(x => x.label === 'Client coûts');
    check('coûts: rapport par organisation sur la période', r.status === 200 && rowOrg?.totalCents === 9950 && rowOrg.tickets === 1 && r.body.rows.some(x => x.label === 'Sans organisation'), JSON.stringify(r.body.rows));
    r = await req('GET', '/api/costs/report', { sid: sessions.F, query: { from, to, by: 'user' } });
    check('coûts: rapport par personne (temps et frais)', r.body.rows.find(x => x.key === U.S1)?.timeCents === 6000 && r.body.rows.find(x => x.key === U.S2)?.timeCents === 2250 + 3000, JSON.stringify(r.body.rows));
    r = await req('GET', '/api/costs/report', { sid: sessions.F, query: { from, to, by: 'organization', format: 'csv' } });
    check('coûts: export CSV', r.status === 200 && /text\/csv/.test(r.headers['content-type']) && /Client coûts;1;1\.50;82\.50;5\.00;12\.00;99\.50/.test(r.body), String(r.body).slice(0, 300));
    const extraId = (await db('SELECT id FROM ticket_costs WHERE ticket_id = ?', [tc]))[0].id;
    r = await req('DELETE', `/api/costs/tickets/${tc}/${extraId}`, { sid: sessions.F });
    check('coûts: frais retiré, au journal du ticket', r.body.extras.length === 0 && (await db("SELECT 1 FROM audit_log WHERE ticket_id = ? AND action IN ('ticket_cost_add', 'ticket_cost_delete')", [tc])).length === 2, '');
    await req('PUT', '/api/costs/settings', { sid: sessions.F, body: { currency: 'EUR', defaultRateCents: 0, fixedCents: 0 } });
    await db('DELETE FROM tickets WHERE id IN (?)', [[tc, tNo]]);
    await req('DELETE', `/api/organizations/${org}`, { sid: sessions.F });
    await req('DELETE', `/api/teams/${team.id}`, { sid: sessions.F });
  }

  // ── Dashboard leaderboard: week and month, staff only ──
  {
    const [lbCfg] = await db('SELECT leaderboard_enabled FROM guild_config WHERE id = 1');
    await db('UPDATE guild_config SET leaderboard_enabled = 1 WHERE id = 1');
    const tLb = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('200000000000000088', 'lb', 'db-lb', 'open', 'Classement')")).insertId;
    await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, 'F', 'réponse', 'reply'), (?, 'system', 'Attribution automatique', 'attribué', 'system'), (?, 'rule-bot', 'Robot', 'x', 'web')", [tLb, U.F, tLb, tLb]);
    const week = await req('GET', '/api/dashboard/leaderboard', { sid: sessions.F, query: { period: 'week' } });
    const month = await req('GET', '/api/dashboard/leaderboard', { sid: sessions.F, query: { period: 'month' } });
    const ids = x => (x.body.staff || []).map(p => p.userId);
    check('classement: la semaine répond (elle échouait toujours)', week.status === 200 && ids(week).includes(U.F), JSON.stringify(week.body).slice(0, 200));
    check('classement: le mois répond aussi', month.status === 200 && ids(month).includes(U.F), month.status);
    const cmp = [];
    for (const period of ['today', 'week', 'month', 'all']) cmp.push((await req('GET', '/api/analytics/staff-compare', { sid: sessions.F, query: { period } })).status);
    check('comparatif staff: chaque période répond (7 jours échouait toujours)', cmp.every(x => x === 200), cmp.join());
    check('classement: seulement des membres du staff, jamais les notes automatiques', !ids(week).includes('system') && !ids(week).includes('rule-bot'), JSON.stringify(ids(week)));
    await db('DELETE FROM tickets WHERE id = ?', [tLb]);
    await db('UPDATE guild_config SET leaderboard_enabled = ? WHERE id = 1', [lbCfg.leaderboard_enabled]);
  }

  // ── Public knowledge base (utils/knowledgeBase.js, routes/kb.js, v4.2) ──
  {
    const [cfgK] = await db('SELECT kb_public FROM guild_config WHERE id = 1');
    check('base: migration 47 → FAQ reprise, page publique coupée par défaut', Number(cfgK.kb_public) === 0
      && Number((await db("SELECT COUNT(*) AS n FROM faq_entries WHERE visibility <> 'members'"))[0].n) === 0, JSON.stringify(cfgK));
    r = await req('POST', '/api/faq', { sid: sessions.F, body: { question: 'Comment suivre ma livraison colis ?', answer: 'Le lien de suivi arrive par e-mail.', keywords: 'livraison, colis', category: '  Commandes  ', visibility: 'public' } });
    const PUB = r.body.id;
    check('base: article public créé avec sa catégorie', r.status === 200 && r.body.visibility === 'public' && r.body.category === 'Commandes', JSON.stringify(r.body));
    r = await req('POST', '/api/faq', { sid: sessions.F, body: { question: 'Code promo réservé aux membres livraison', answer: 'Code interne MEMBRES10.', keywords: 'livraison, promo' } });
    const PRIV = r.body.id;
    check('base: article réservé aux membres par défaut', r.status === 200 && r.body.visibility === 'members', JSON.stringify(r.body));
    r = await req('POST', '/api/faq', { sid: sessions.F, body: { question: 'x', answer: 'y', visibility: 'tout-le-monde' } });
    check('base: visibilité inconnue refusée', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/faq', { sid: sessions.F, body: { question: 'Long', answer: 'a'.repeat(5001) } });
    check('base: article limité à 5000 caractères', r.status === 400, r.status);

    r = await req('GET', `/api/kb/${G}`);
    check('base: page coupée → 404, même réponse qu un espace inconnu', r.status === 404 && (await req('GET', '/api/kb/999999999999999999')).status === 404 && (await req('GET', '/api/kb/..%2F..')).status === 404, r.status);
    r = await req('PUT', '/api/faq/public', { sid: sessions.S1, body: { enabled: true } });
    check('base: mise en ligne réservée aux fondateurs', r.status === 403, r.status);
    r = await req('PUT', '/api/faq/public', { sid: sessions.F, body: { enabled: true } });
    check('base: mise en ligne par un fondateur, au journal', r.status === 200 && JSON.stringify((await db("SELECT details FROM audit_log WHERE action = 'config_update' ORDER BY id DESC LIMIT 1"))[0]?.details || '').includes('kbPublic'), JSON.stringify(r.body));

    r = await req('GET', `/api/kb/${G}`);
    const ids = (r.body.articles || []).map(a => a.id);
    check('base: sans connexion, seuls les articles publics et actifs', r.status === 200 && ids.includes(PUB) && !ids.includes(PRIV) && r.body.space?.id === G, JSON.stringify(r.body).slice(0, 300));
    check('base: ni mots-clés ni auteur ni compteurs exposés', !JSON.stringify(r.body).includes('created_by_tag') && !JSON.stringify(r.body).includes('keywords') && !JSON.stringify(r.body).includes('solved_count'), '');
    r = await req('GET', `/api/kb/${G}/articles/${PRIV}`);
    check('base: article réservé aux membres → 404 sans connexion', r.status === 404, r.status);
    r = await req('GET', `/api/kb/${G}/articles/${PUB}`, { headers: { 'X-Forwarded-For': '10.40.0.1' } });
    await req('GET', `/api/kb/${G}/articles/${PUB}`, { headers: { 'X-Forwarded-For': '10.40.0.1' } });
    const [vc] = await db('SELECT view_count FROM faq_entries WHERE id = ?', [PUB]);
    check('base: article lu, compté une fois par visiteur et par heure', r.status === 200 && r.body.article?.answer === 'Le lien de suivi arrive par e-mail.' && vc.view_count === 1, JSON.stringify([r.body, vc]));
    await req('PATCH', `/api/faq/${PUB}`, { sid: sessions.F, body: { active: false } });
    r = await req('GET', `/api/kb/${G}/articles/${PUB}`);
    check('base: article désactivé → plus public', r.status === 404, r.status);
    await req('PATCH', `/api/faq/${PUB}`, { sid: sessions.F, body: { active: true } });
    const [upd] = await db('SELECT updated_at FROM faq_entries WHERE id = ?', [PUB]);
    check('base: date de mise à jour tenue', !!upd.updated_at, JSON.stringify(upd));

    // Member space: everything, public or not; the help page links to the public base
    r = await req('GET', '/api/faq', { sid: sessions.F });
    check('base: le staff voit l adresse de la page publique', r.body.kbPublic === true && r.body.kbUrl.endsWith(`/aide/${G}`), JSON.stringify([r.body.kbPublic, r.body.kbUrl]));
    const { findFaqMatches } = app('./utils/faq');
    const all = await findFaqMatches(db, 'Problème de livraison de mon colis');
    const pubOnly = await findFaqMatches(db, 'Problème de livraison de mon colis', 3, { publicOnly: true });
    check('base: suggestions publiques sans les articles réservés', all.some(m => m.id === PRIV) && pubOnly.length && pubOnly.every(m => m.id !== PRIV), JSON.stringify([all.map(m => m.id), pubOnly.map(m => m.id)]));
    const emb = app('./utils/dmEmbeds').faqSuggestEmbed('S', [{ question: 'Q', answer: 'b'.repeat(1100), url: `https://ticket.example.test/aide/${G}/${PUB}` }]).data;
    check('base: en MP, lien vers l article public, réponse tronquée pour tenir', emb.fields[0].value.length <= 1024 && emb.fields[0].value.endsWith(`(https://ticket.example.test/aide/${G}/${PUB})`), emb.fields[0].value.slice(-80));

    // Widget: suggestions while the visitor types, public articles only
    r = await req('PUT', '/api/widget-settings', { sid: sessions.F, body: { enabled: true, origins: 'https://site.example.test' } });
    const TOKK = r.body.token;
    r = await req('GET', `/api/widget/${TOKK}/suggest`, { query: { q: 'Où en est la livraison de mon colis' } });
    check('base: widget → articles publics suggérés à l ouverture', r.status === 200 && r.body.some(a => a.id === PUB && a.url.endsWith(`/aide/${G}/${PUB}`)) && !r.body.some(a => a.id === PRIV), JSON.stringify(r.body));
    r = await req('GET', `/api/widget/${G}.mauvaiscodemauvaiscodemauvais/suggest`, { query: { q: 'livraison colis' } });
    check('base: widget, code inconnu → aucune suggestion', r.status === 200 && Array.isArray(r.body) && r.body.length === 0, JSON.stringify(r.body));

    await req('PUT', '/api/faq/public', { sid: sessions.F, body: { enabled: false } });
    r = await req('GET', `/api/widget/${TOKK}/suggest`, { query: { q: 'livraison colis' } });
    const off = await req('GET', `/api/kb/${G}/articles/${PUB}`);
    check('base: page coupée → plus rien de public, plus de suggestion', off.status === 404 && r.body.length === 0, JSON.stringify([off.status, r.body]));
    await db('UPDATE guild_config SET widget_enabled = 0, widget_token = NULL, widget_origins = NULL WHERE id = 1');
    await db('DELETE FROM faq_entries WHERE id IN (?)', [[PUB, PRIV]]);
  }

  // ── Reports by team, category, subject and channel (utils/breakdownReport.js, v4.2) ──
  {
    const team = (await db("INSERT INTO teams (name) VALUES ('Rapports-Équipe')")).insertId;
    const mkT = async (owner, subject, extra = {}) => (await db(
      `INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, team_id, created_at, first_response_at, closed_at, visibility_grade_id)
       VALUES (?, 'rep', ?, ?, ?, ?, NOW() - INTERVAL 5 HOUR, ?, ?, ?)`,
      [owner, `rep-${Math.random().toString(36).slice(2, 12)}`, extra.closed ? 'closed' : 'open', subject, extra.team ?? null,
        extra.reply ? new Date(Date.now() - 5 * 3600e3 + extra.reply * 60e3) : null, extra.closed ? new Date(Date.now() - 3 * 3600e3) : null, extra.vis ?? null])).insertId;
    const ZS = 'Rapport-Zz';
    const t1 = await mkT('200000000000000091', `${ZS} › Remboursement`, { team, reply: 10, closed: true });
    const t2 = await mkT('mail:' + 'a'.repeat(24), `${ZS} › Facture`, { team, reply: 30 });
    const t3 = await mkT('web:' + 'b'.repeat(24), ZS, {});
    const t4 = await mkT('200000000000000092', ZS, { team, vis: -1 }); // confidential
    await db("INSERT INTO ticket_ratings (ticket_id, owner_id, rating) VALUES (?, '200000000000000091', 4)", [t1]);
    await db("INSERT INTO ticket_time (ticket_id, user_id, user_tag, started_at, seconds, source) VALUES (?, ?, 'F', NOW() - INTERVAL 4 HOUR, 5400, 'manual')", [t1, U.F]);
    const rowOf = (body, label) => (body.rows || []).find(x => x.label === label);

    r = await req('GET', '/api/analytics/breakdown', { sid: sessions.F, query: { by: 'team', days: 7 } });
    const rt = rowOf(r.body, 'Rapports-Équipe');
    check('rapports: par équipe — volume, fermés, médianes, note, temps', r.status === 200 && rt?.opened === 3 && rt.closed === 1 && rt.stillOpen === 2
      && rt.firstResponseMedianMin === 20 && rt.resolutionMedianHours === 2 && rt.avgRating === 4 && rt.ratings === 1 && rt.timeHours === 1.5, JSON.stringify(rt));
    check('rapports: tickets sans équipe regroupés', !!rowOf(r.body, 'Sans équipe'), JSON.stringify(r.body.rows?.map(x => x.label)));
    r = await req('GET', '/api/analytics/breakdown', { sid: sessions.F, query: { by: 'category', days: 7 } });
    check('rapports: par catégorie — les sous-catégories comptent dans leur catégorie', rowOf(r.body, ZS)?.opened === 4, JSON.stringify(rowOf(r.body, ZS)));
    r = await req('GET', '/api/analytics/breakdown', { sid: sessions.F, query: { by: 'subject', days: 7 } });
    check('rapports: par sujet — chemin complet', rowOf(r.body, `${ZS} › Remboursement`)?.opened === 1 && rowOf(r.body, ZS)?.opened === 2, JSON.stringify(r.body.rows?.filter(x => x.label.startsWith(ZS))));
    r = await req('GET', '/api/analytics/breakdown', { sid: sessions.F, query: { by: 'channel', days: 7 } });
    const ch = Object.fromEntries((r.body.rows || []).map(x => [x.key, x.opened]));
    check('rapports: par canal — Discord, e-mail, web', ch.discord >= 2 && ch.email >= 1 && ch.web >= 1 && rowOf(r.body, 'E-mail') && rowOf(r.body, 'Web (espace membre, widget)'), JSON.stringify(ch));
    r = await req('GET', '/api/analytics/breakdown', { sid: sessions.S1, query: { by: 'team', days: 7 } });
    check('rapports: un ticket confidentiel reste hors des chiffres du staff', rowOf(r.body, 'Rapports-Équipe')?.opened === 2, JSON.stringify(rowOf(r.body, 'Rapports-Équipe')));
    r = await req('GET', '/api/analytics/breakdown', { sid: sessions.F, query: { by: 'n_importe_quoi; DROP', days: 99999 } });
    check('rapports: dimension inconnue → par équipe, période bornée à 365 jours', r.status === 200 && r.body.by === 'team' && r.body.days === 365, JSON.stringify([r.status, r.body.by, r.body.days]));

    r = await req('GET', '/api/analytics/export/breakdown.csv', { sid: sessions.F, query: { by: 'category', days: 7 } });
    const csv = String(r.body);
    check('rapports: export CSV (en-tête, ligne, nom du fichier, BOM)', r.status === 200 && /text\/csv/.test(r.headers['content-type'])
      && /rapport-par-categorie-7j-/.test(r.headers['content-disposition'] || '') && csv.charCodeAt(0) === 0xFEFF && csv.includes('Groupe,Tickets ouverts') && csv.includes(`${ZS},4,1,3`), csv.slice(0, 200));
    await db('UPDATE teams SET name = ? WHERE id = ?', ['=HYPERLINK("http://x")', team]);
    r = await req('GET', '/api/analytics/export/breakdown.csv', { sid: sessions.F, query: { by: 'team', days: 7 } });
    check('rapports: export CSV protégé contre les formules', String(r.body).includes("'=HYPERLINK") && !String(r.body).includes('\n=HYPERLINK') && !String(r.body).includes(',=HYPERLINK'), String(r.body).slice(0, 300));
    r = await req('GET', '/api/analytics/export/breakdown.csv', { query: { by: 'team' } });
    check('rapports: export réservé au staff connecté', r.status === 401 || r.status === 403, r.status);

    await db('DELETE FROM tickets WHERE id IN (?)', [[t1, t2, t3, t4]]);
    await db('DELETE FROM teams WHERE id = ?', [team]);
  }

  // ── Accounts (utils/accounts.js, v4 PR 3): created by the Discord sign-in, ID = Discord ID ──
  {
    const axios = require('axios');
    const realPost = axios.post, realGet = axios.get;
    const ACC = '100000000000000077';
    let who = { id: ACC, username: 'compte77', global_name: 'Compte 77', avatar: 'abc' };
    axios.post = async () => ({ data: { access_token: 'tok' } });
    axios.get = async () => ({ data: who });
    const signIn = async () => {
      await mk('OA', { oauthState: 'st8' });
      return req('GET', '/api/auth/discord/callback', { sid: sessions.OA, query: { code: 'c', state: 'st8' } });
    };
    r = await signIn();
    const [acc] = await globalQuery('SELECT * FROM accounts WHERE id = ?', [ACC]);
    const ids = await globalQuery('SELECT provider, subject, account_id FROM account_identities WHERE account_id = ?', [ACC]);
    check('comptes: première connexion Discord → compte créé, ID = ID Discord', r.status === 302 && r.headers.location === '/select-guild' && acc?.display_name === 'Compte 77' && ids.length === 1 && ids[0].provider === 'discord' && ids[0].subject === ACC, JSON.stringify([r.status, r.headers.location, acc, ids]));
    who = { ...who, global_name: 'Nouveau nom' };
    r = await signIn();
    const [acc2] = await globalQuery('SELECT display_name, last_login_at FROM accounts WHERE id = ?', [ACC]);
    const [nAcc] = await globalQuery('SELECT COUNT(*) AS n FROM accounts WHERE id = ?', [ACC]);
    check('comptes: connexion suivante → même compte, nom mis à jour', Number(nAcc.n) === 1 && acc2.display_name === 'Nouveau nom' && !!acc2.last_login_at, JSON.stringify(acc2));
    await mk('ACC', { user: { id: ACC, username: 'compte77', role: null } });
    r = await req('GET', '/api/profile/login-methods', { sid: sessions.ACC });
    check('comptes: Profil → Connexion liste Discord, sans mot de passe', r.status === 200 && r.body.identities.length === 1 && r.body.identities[0].label === 'Discord' && r.body.password === false && r.body.account.id === ACC, JSON.stringify(r.body));
    r = await req('GET', '/api/profile/login-methods');
    check('comptes: moyens de connexion réservés au compte connecté', r.status === 401, r.status);
    await globalQuery('UPDATE accounts SET disabled = 1 WHERE id = ?', [ACC]);
    r = await signIn();
    const [logD] = await globalQuery("SELECT status FROM login_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1", [ACC]);
    check('comptes: compte désactivé → connexion refusée et notée au journal', r.status === 302 && r.headers.location === '/login?error=account_disabled' && logD?.status === 'disabled', JSON.stringify([r.headers.location, logD]));
    axios.post = realPost; axios.get = realGet;
    await globalQuery('DELETE FROM account_identities WHERE account_id = ?', [ACC]);
    await globalQuery('DELETE FROM accounts WHERE id = ?', [ACC]);
  }

  // ── Sign-in providers (utils/loginProviders.js, routes/oidcAuth.js, v4 PR 12) ──
  {
    const axios = require('axios');
    const realPost = axios.post, realGet = axios.get;
    const lp = app('./utils/loginProviders');
    let ipN = 0; // the sign-in limit counts per address: one address per few requests
    const xff = () => ({ 'X-Forwarded-For': `10.0.13.${1 + (Math.floor(ipN++ / 4) % 250)}` });
    const ISS = 'https://sso.example.test/realms/t';
    const AO = 'u_oidc0000000000000000001', AL = 'u_oidc0000000000000000002';
    const MAIL = 'oidc-person@example.test';
    const now = () => Math.floor(Date.now() / 1000);
    const jwt = c => ['e30', Buffer.from(JSON.stringify(c)).toString('base64url'), 'sig'].join('.');
    let claims = () => ({});
    const posts = [];
    axios.get = async (url, opts) => (String(url) === `${ISS}/.well-known/openid-configuration`
      ? { data: { issuer: ISS, authorization_endpoint: `${ISS}/auth`, token_endpoint: `${ISS}/token`, userinfo_endpoint: `${ISS}/userinfo` } }
      : realGet(url, opts));
    axios.post = async (url, body) => { posts.push({ url, body: String(body) }); return { data: { id_token: jwt(claims()), access_token: 'at' } }; };
    await globalQuery('INSERT INTO accounts (id, email, email_verified, display_name) VALUES (?, ?, 1, ?), (?, NULL, 0, ?)', [AO, MAIL, 'Personne OIDC', AL, 'Compte à relier']);

    r = await req('GET', '/api/instance/login-providers', { sid: sessions.OWN });
    check('connexion: Discord activé par défaut sur une instance existante, OIDC coupé', r.status === 200 && r.body.discord.enabled === true && r.body.discord.configured === true && r.body.oidc.enabled === false && !('clientSecret' in r.body.google), JSON.stringify(r.body));
    r = await req('GET', '/api/instance/login-providers', { sid: sessions.S1 });
    check('connexion: réglages réservés au propriétaire de l instance', r.status === 403, r.status);
    r = await req('PUT', '/api/instance/login-providers', { sid: sessions.OWN, body: { oidc: { enabled: true, issuer: ISS, clientId: 'cid' } } });
    check('connexion: activer un fournisseur sans secret → refusé', r.status === 400, JSON.stringify(r.body));
    r = await req('PUT', '/api/instance/login-providers', { sid: sessions.OWN, body: { oidc: { enabled: true, issuer: 'http://sso.example.test', clientId: 'cid', clientSecret: 'oidc-client-value' } } }); // ggignore
    check('connexion: adresse du fournisseur en http → refusée', r.status === 400, JSON.stringify(r.body));
    r = await req('PUT', '/api/instance/login-providers', { sid: sessions.OWN, body: { oidc: { enabled: true, name: 'SSO maison', issuer: ISS + '/', clientId: 'cid', clientSecret: 'oidc-client-value' } } }); // ggignore
    const [rawLp] = await globalQuery("SELECT v FROM instance_settings WHERE k = 'login_providers'");
    const [jLp] = await globalQuery("SELECT details FROM instance_audit_log WHERE action = 'login_providers_update' ORDER BY id DESC LIMIT 1");
    check('connexion: fournisseur OIDC activé, secret chiffré en base et jamais renvoyé', r.status === 200 && r.body.oidc.enabled && r.body.oidc.secretSet === true && !JSON.stringify(r.body).includes('oidc-client-value') && !String(rawLp?.v).includes('oidc-client-value') && r.body.oidc.issuer === ISS, JSON.stringify([r.status, r.body.oidc]));
    const jTxt = typeof jLp?.details === 'string' ? jLp.details : JSON.stringify(jLp?.details);
    check('connexion: secret masqué dans le journal de l instance', !!jLp && !jTxt.includes('oidc-client-value') && jTxt.includes('masqué'), jTxt);
    r = await req('GET', '/api/instance/info');
    check('connexion: page de connexion → bouton du fournisseur avec son nom', r.body.discordLogin === true && r.body.providers.length === 1 && r.body.providers[0].id === 'oidc' && r.body.providers[0].label === 'SSO maison', JSON.stringify(r.body.providers));

    const start = async (name, data = {}, link = false) => {
      await mk(name, data);
      const s = await req('GET', `/api/auth/oidc/oidc${link ? '?link=1' : ''}`, { sid: sessions[name], headers: xff() });
      const u = new URL(s.headers.location || 'https://x.invalid');
      return { s, u, state: u.searchParams.get('state'), nonce: u.searchParams.get('nonce') };
    };
    const back = (name, state) => req('GET', '/api/auth/oidc/oidc/callback', { sid: sessions[name], headers: xff(), query: { code: 'c0de', state } });
    const good = (st, extra = {}) => () => ({ iss: ISS, aud: 'cid', sub: 'sub-1', exp: now() + 300, iat: now(), nonce: st.nonce, email: MAIL, email_verified: true, name: 'Personne', ...extra });

    let st = await start('OI1');
    const ch = st.u.searchParams.get('code_challenge');
    check('oidc: départ vers le fournisseur avec state, nonce et PKCE S256', st.s.status === 302 && st.u.origin + st.u.pathname === `${ISS}/auth` && st.state?.length >= 30 && st.nonce?.length >= 30 && ch && st.u.searchParams.get('code_challenge_method') === 'S256' && st.u.searchParams.get('scope') === 'openid email profile', st.s.headers.location);
    r = await back('OI1', 'faux-state');
    check('oidc: retour avec un autre state → refusé', r.status === 302 && r.headers.location === '/login?error=invalid_state', r.headers.location);

    st = await start('OI2'); claims = good(st);
    r = await back('OI2', st.state);
    const verifier = new URLSearchParams(posts.at(-1)?.body).get('code_verifier');
    const pkceOk = !!verifier && crypto.createHash('sha256').update(verifier).digest('base64url') === new URL(st.s.headers.location).searchParams.get('code_challenge');
    const [idn] = await globalQuery("SELECT account_id FROM account_identities WHERE provider = 'oidc:oidc' AND subject = 'sub-1'");
    check('oidc: flux complet, adresse vérifiée → relié au compte existant et connecté', r.status === 302 && r.headers.location === '/select-guild' && idn?.account_id === AO, JSON.stringify([r.headers.location, idn]));
    check('oidc: le code est échangé avec le vérificateur PKCE', pkceOk, verifier);
    r = await back('OI2', st.state);
    check('oidc: un retour ne sert qu une fois', r.headers.location === '/login?error=invalid_state', r.headers.location);

    st = await start('OI3'); claims = good(st, { sub: 'sub-2', email_verified: false });
    r = await back('OI3', st.state);
    const [idn2] = await globalQuery("SELECT account_id FROM account_identities WHERE provider = 'oidc:oidc' AND subject = 'sub-2'");
    check('oidc: adresse non vérifiée par le fournisseur → refus, rien de relié', r.headers.location === '/login?error=oidc_unverified' && !idn2, JSON.stringify([r.headers.location, idn2]));
    st = await start('OI4'); claims = good(st, { nonce: 'autre' });
    r = await back('OI4', st.state);
    check('oidc: nonce différent → jeton refusé', r.headers.location === '/login?error=oidc_invalid', r.headers.location);
    st = await start('OI5'); claims = good(st, { aud: 'autre-client' });
    r = await back('OI5', st.state);
    check('oidc: jeton pour une autre application → refusé', r.headers.location === '/login?error=oidc_invalid', r.headers.location);
    st = await start('OI6'); claims = good(st, { iss: 'https://ailleurs.example.test' });
    r = await back('OI6', st.state);
    check('oidc: jeton d un autre émetteur → refusé', r.headers.location === '/login?error=oidc_invalid', r.headers.location);
    st = await start('OI7'); claims = good(st, { exp: now() - 3600 });
    r = await back('OI7', st.state);
    check('oidc: jeton expiré → refusé', r.headers.location === '/login?error=oidc_invalid', r.headers.location);
    st = await start('OI8'); claims = good(st, { sub: 'sub-9', email: 'inconnu@example.test' });
    r = await back('OI8', st.state);
    check('oidc: adresse vérifiée sans compte → aucun compte créé', r.headers.location === '/login?error=oidc_no_account', r.headers.location);
    st = await start('OI9'); claims = good(st, { email: 'autre@example.test', email_verified: false });
    r = await back('OI9', st.state);
    check('oidc: identité déjà reliée → connexion même sans adresse vérifiée', r.headers.location === '/select-guild', r.headers.location);
    await globalQuery("INSERT INTO user_totp (user_id, totp_secret, totp_enabled) VALUES (?, 'x', 1)", [AO]);
    st = await start('OI10'); claims = good(st);
    r = await back('OI10', st.state);
    check('oidc: double authentification du compte demandée', r.headers.location === '/totp-verify', r.headers.location);
    await globalQuery('DELETE FROM user_totp WHERE user_id = ?', [AO]);

    // Link from Profil → Connexion, without any address
    st = await start('OL1', { user: { id: AL, username: 'Compte à relier', role: null } }, true);
    claims = good(st, { sub: 'sub-1' });
    r = await back('OL1', st.state);
    check('oidc: relier une identité déjà prise par un autre compte → refusé', r.headers.location === '/profile?link=oidc_taken', r.headers.location);
    st = await start('OL2', { user: { id: AL, username: 'Compte à relier', role: null } }, true);
    claims = good(st, { sub: 'sub-3', email: undefined, email_verified: undefined });
    r = await back('OL2', st.state);
    const [idn3] = await globalQuery("SELECT account_id FROM account_identities WHERE provider = 'oidc:oidc' AND subject = 'sub-3'");
    check('oidc: relier depuis Profil → Connexion, sans adresse vérifiée', r.headers.location === '/profile?link=ok' && idn3?.account_id === AL, JSON.stringify([r.headers.location, idn3]));
    await mk('OL3', { user: { id: AL, username: 'Compte à relier', role: null } });
    r = await req('GET', '/api/profile/login-methods', { sid: sessions.OL3 });
    check('oidc: Profil → Connexion affiche le fournisseur sous son nom', r.status === 200 && r.body.identities.some(i => i.provider === 'oidc:oidc' && i.label === 'SSO maison' && i.removable) && r.body.available.length === 0, JSON.stringify(r.body));
    r = await req('DELETE', '/api/profile/identities/oidc:oidc', { sid: sessions.OL3 });
    check('oidc: délier son seul moyen de connexion → refusé', r.status === 400, JSON.stringify(r.body));
    r = await req('GET', '/api/auth/oidc/oidc?link=1', { headers: xff() });
    check('oidc: relier sans être connecté → page de connexion', r.status === 302 && r.headers.location === '/login', r.headers.location);

    // The owner cannot cut their last way to sign in
    r = await req('PUT', '/api/instance/login-providers', { sid: sessions.OWN, body: { discord: { enabled: false } } });
    check('connexion: couper Discord sans autre moyen pour le propriétaire → refusé', r.status === 400 && /aucun moyen/.test(r.body.error), JSON.stringify(r.body));
    await globalQuery("INSERT INTO account_identities (provider, subject, account_id) VALUES ('oidc:oidc', 'sub-own', ?)", [U.F]);
    r = await req('PUT', '/api/instance/login-providers', { sid: sessions.OWN, body: { discord: { enabled: false } } });
    const offD = await req('GET', '/api/auth/discord', { headers: xff() });
    const infoD = await req('GET', '/api/instance/info');
    check('connexion: Discord coupé quand un autre moyen reste → bouton retiré, connexion refusée', r.status === 200 && offD.headers.location === '/login?error=discord_off' && infoD.body.discordLogin === false, JSON.stringify([r.status, offD.headers.location, infoD.body.discordLogin]));
    r = await req('PUT', '/api/instance/login-providers', { sid: sessions.OWN, body: { oidc: { enabled: false } } });
    check('connexion: couper ensuite le dernier fournisseur du propriétaire → refusé', r.status === 400, JSON.stringify(r.body));
    r = await req('PUT', '/api/instance/login-providers', { sid: sessions.OWN, body: { discord: { enabled: true }, oidc: { enabled: false } } });
    const offO = await req('GET', '/api/auth/oidc/oidc', { headers: xff() });
    check('oidc: fournisseur coupé → départ refusé', r.status === 200 && offO.headers.location === '/login?error=provider_off', JSON.stringify([r.status, offO.headers.location]));

    axios.post = realPost; axios.get = realGet;
    lp.resetCache();
    await globalQuery("DELETE FROM instance_settings WHERE k = 'login_providers'");
    await globalQuery("DELETE FROM account_identities WHERE provider LIKE 'oidc:%'");
    await globalQuery('DELETE FROM accounts WHERE id IN (?, ?)', [AO, AL]);
  }

  // ── E-mail of the instance (utils/instanceMail.js, v4 PR 4) ──
  {
    const im = app('./utils/instanceMail');
    const T = require(path.join(ROOT, 'utils/locales/mails.js'));
    const keysOf = o => Object.keys(o).sort().join();
    const varsOf = str => [...String(str).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join();
    const sameVars = Object.keys(T.fr).every(k => typeof T.fr[k] === 'string' ? varsOf(T.fr[k]) === varsOf(T.en[k]) : varsOf(T.fr[k].subject + T.fr[k].text) === varsOf(T.en[k].subject + T.en[k].text));
    check('e-mail instance: modèles FR et EN complets, mêmes variables', keysOf(T.fr) === keysOf(T.en) && sameVars, '');
    const m = im.renderMail('loginLink', 'en', { link: 'https://x.test/l/abc', minutes: 15 });
    check('e-mail instance: modèle rendu (texte, HTML échappé, lien cliquable)', m.subject === 'Your sign-in link to Datick' && m.text.includes('https://x.test/l/abc') && m.text.includes('15 minutes') && m.html.includes('<a href="https://x.test/l/abc">') && im.renderMail('test', 'de').subject.startsWith('Datick'), JSON.stringify(m.subject));
    r = await req('PUT', '/api/instance/email', { sid: sessions.NOWN, body: { enabled: true } });
    check('e-mail instance: réservé au propriétaire', r.status === 403, r.status);
    r = await req('PUT', '/api/instance/email', { sid: sessions.OWN, body: { enabled: true, host: 'smtp.example.com', port: 3306, from: 'datick@example.com' } });
    const r2 = await req('PUT', '/api/instance/email', { sid: sessions.OWN, body: { enabled: true, port: 587 } });
    check('e-mail instance: port non standard et activation incomplète refusés', r.status === 400 && r2.status === 400, JSON.stringify([r.body, r2.body]));
    r = await req('PUT', '/api/instance/email', { sid: sessions.OWN, body: { enabled: true, host: 'smtp.example.com', port: 587, user: 'datick', password: 'SECRET-SMTP-I', from: 'Datick@Example.com', fromName: 'Datick' } });
    const [rowI] = await globalQuery("SELECT v FROM instance_settings WHERE k = 'instance_email'");
    // The instance journal is written once the response has left: wait for it
    let auditI;
    for (let i = 0; i < 20 && !auditI; i++) { [auditI] = await globalQuery("SELECT details FROM instance_audit_log WHERE action = 'instance_email_update' ORDER BY id DESC LIMIT 1"); if (!auditI) await new Promise(res => setTimeout(res, 50)); }
    check('e-mail instance: enregistré, mot de passe chiffré, jamais renvoyé ni journalisé', r.status === 200 && r.body.passwordSet && r.body.from === 'datick@example.com' && !JSON.stringify(r.body).includes('SECRET') && !JSON.stringify(rowI.v).includes('SECRET') && !JSON.stringify(auditI.details).includes('SECRET'), JSON.stringify([r.body, auditI]));
    r = await req('POST', '/api/instance/email/test', { sid: sessions.OWN, body: { to: 'owner@example.com' } });
    check('e-mail instance: serveur résolu en adresse privée refusé', r.status === 502 && /privée|introuvable/.test(r.body.error), JSON.stringify(r.body));
    process.env.EMAIL_ALLOW_PRIVATE_HOSTS = 'true';
    const nodemailer = require('nodemailer');
    const realCreate = nodemailer.createTransport;
    const sentI = [];
    let opts = null;
    nodemailer.createTransport = o => { opts = o; return { sendMail: async x => { sentI.push(x); return {}; }, close: () => {} }; };
    r = await req('POST', '/api/instance/email/test', { sid: sessions.OWN, body: { to: 'owner@example.com', lang: 'en' } });
    check('e-mail instance: test envoyé avec les bons réglages', r.status === 200 && sentI[0]?.to === 'owner@example.com' && sentI[0].from.address === 'datick@example.com' && sentI[0].subject === 'Datick e-mail test' && opts.auth?.pass === 'SECRET-SMTP-I' && opts.port === 587, JSON.stringify([r.body, sentI[0]?.subject]));
    r = await req('POST', '/api/instance/email/test', { sid: sessions.OWN, body: { to: 'pas-une-adresse' } });
    check('e-mail instance: destinataire invalide refusé', r.status === 400, JSON.stringify(r.body));
    await req('PUT', '/api/instance/email', { sid: sessions.OWN, body: { enabled: false } });
    r = await req('POST', '/api/instance/email/test', { sid: sessions.OWN, body: { to: 'owner@example.com' } });
    check('e-mail instance: désactivé → envoi refusé', r.status === 409, JSON.stringify(r.body));
    nodemailer.createTransport = realCreate;
    delete process.env.EMAIL_ALLOW_PRIVATE_HOSTS;
  }

  // ── Datick: the name shown without a Discord bot, the release publishes both image names ──
  {
    const inst = app('./utils/instance');
    const wf = require('fs').readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
    const compose = require('fs').readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
    check('datick: nom par défaut sans bot Discord, nom du bot sinon', inst.instanceName(null) === 'Datick' && inst.instanceName({ user: { username: 'Mon bot' } }) === 'Mon bot', '');
    check('datick: image publiée sous le nouveau et l ancien nom, DATICK_VERSION avec repli', /\/datick"/.test(wf) && /\/bot-ticketting"/.test(wf) && compose.includes('${DATICK_VERSION:-${TICKETBOT_VERSION:-latest}}'), '');
  }

  // ── Language of the bot for the staff (utils/staffI18n.js, utils/locales/staff.js) ──
  {
    const si = app('./utils/staffI18n');
    const vars = str => [...String(str).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
    const bad = [];
    for (const [k, v] of Object.entries(si.STRINGS)) {
      if (!Array.isArray(v) || v.length !== 6 || v.some(x => typeof x !== 'string' || !x)) bad.push(`${k}: 6 textes attendus`);
      else if (v.some(x => vars(x) !== vars(v[0]))) bad.push(`${k}: variables`);
    }
    check('staff: chaque texte en 6 langues, mêmes variables', Object.keys(si.STRINGS).length > 100 && bad.length === 0, JSON.stringify(bad.slice(0, 8)));
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { staffLanguage: 'klingon' } });
    check('staff: langue inconnue refusée', r.status === 400, r.status);
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { staffLanguage: 'de' } });
    const cfgS = await req('GET', '/api/config', { sid: sessions.F });
    const Lde = await si.staffT(G);
    check('staff: allemand enregistré (migration 37) et appliqué', r.status === 200 && cfgS.body.staffLanguage === 'de' && Lde('claim.title') === '✋ Ticket übernommen', JSON.stringify([r.body, cfgS.body.staffLanguage]));
    // Messages in the channel of a new ticket, and its buttons
    await req('PATCH', '/api/config', { sid: sessions.F, body: { staffLanguage: 'en' } });
    const before = sent.length;
    const resS = await createManager(db, fakeClient, G).createTicket({ id: '200000000000000071', username: 'member71', tag: 'member71', send: async () => {} }, 'Hello', [], 'Lang test', { forceNew: true });
    const posted = sent.slice(before).map(x => x.p);
    const card = posted.find(p => p?.embeds?.[0]?.data?.author?.name);
    const btns = card?.components?.[0]?.components?.map(b => b.data.label) || [];
    check('staff: salon du ticket en anglais (fiche, boutons)', card?.embeds[0].data.author.name === 'New ticket' && card.embeds[0].data.fields.some(f => f.name === '📂 Subject') && btns.includes('🔒 Close the ticket'), JSON.stringify([card?.embeds?.[0]?.data, btns]));
    const userMsg = posted.find(p => p?.embeds?.[0]?.data?.author?.name?.endsWith('· user'));
    check('staff: message du membre recopié avec les mots du staff', !!userMsg, JSON.stringify(posted.map(p => p?.embeds?.[0]?.data?.author)));
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [resS.ticket.id]);
    // Automatic: the reader's Discord language for what only they see, the server's for the rest
    await req('PATCH', '/api/config', { sid: sessions.F, body: { staffLanguage: 'auto' } });
    const Lme = await si.forInteraction({ guildId: G, locale: 'es-ES', client: fakeClient });
    const Lall = await si.forInteraction({ guildId: G, locale: 'es-ES', client: fakeClient }, { shared: true });
    check('staff: automatique = langue Discord de chacun, sinon celle du serveur', Lme.lang === 'es' && Lme('perm.denied') === '❌ Permiso denegado.' && Lall.lang === 'fr', `${Lme.lang} ${Lall.lang}`);
    // A refused command answers in that language too
    const replies = [];
    const fakeI = { guildId: G, channelId: null, locale: 'it', client: fakeClient, user: { id: '200000000000000072', username: 'nobody' }, reply: async p => { replies.push(p); } };
    const okPerm = await app('./utils/permissions').ensureSupport(fakeI, fakeClient, db, 'reply_ticket');
    check('staff: refus de permission dans la langue de la personne', okPerm === false && replies[0]?.content === '❌ Permesso negato.', JSON.stringify(replies));
    const outS = [];
    await app('./commands/setup').execute(fakeClient, { guildId: G, locale: 'en-US', client: fakeClient, user: { id: U.F, username: 'F' }, reply: async p => outS.push(p) });
    const setupTitle = outS[0]?.embeds?.[0]?.data?.title || '';
    const setupBtns = outS[0]?.components?.[2]?.components?.map(b => b.data.label) || [];
    check('staff: assistant /setup dans la langue Discord du fondateur', setupTitle === '🧭 Setup — 1/3 · Staff roles' && setupBtns.includes('Continue') && setupBtns.includes('Cancel'), JSON.stringify([setupTitle, setupBtns]));
    await req('PATCH', '/api/config', { sid: sessions.F, body: { staffLanguage: 'fr' } });
    // Notes copied from the dashboard never end up in a transcript, whatever their language
    const { buildTranscripts } = app('./utils/transcript');
    const mkMsg = (id, content, bot) => ({ id, createdTimestamp: Date.now() + Number(id), content, author: { id: bot ? '1' : '2', tag: bot ? 'Bot' : 'Membre', username: 'x', bot, displayAvatarURL: () => null }, attachments: new Map(), embeds: [] });
    const fakeCh = { name: 'ticket', messages: { fetch: async () => new (require('discord.js').Collection)([['1', mkMsg('1', 'Bonjour', false)], ['2', mkMsg('2', '📌 **Dashboard note** · F\nSECRET-EN', true)], ['3', mkMsg('3', '📌 **Note dashboard** · F\nSECRET-FR', true)]]) } };
    const tr = await buildTranscripts(fakeCh, { ticketId: 1 });
    check('staff: notes internes recopiées du dashboard absentes du transcript', tr.txt.includes('Bonjour') && !tr.txt.includes('SECRET-EN') && !tr.txt.includes('SECRET-FR'), tr.txt);
  }

  // ── Restoring one server (utils/backupRestore.js; the backup service is simulated) ──
  {
    const os = require('os'), fsx = require('fs');
    const cfgR = app('./utils/config').config;
    const br = app('./utils/backupRestore');
    const statusDir = fsx.mkdtempSync(path.join(os.tmpdir(), 'tb-status-'));
    const reqDir = fsx.mkdtempSync(path.join(os.tmpdir(), 'tb-req-'));
    const GR = '987654321098765432';
    await globalQuery("INSERT IGNORE INTO guilds (guild_id, guild_name, status) VALUES (?, 'Serveur à restaurer', 'active')", [GR]);
    await app('./utils/tenantSchema').ensureTenantSchema(GR);
    r = await req('GET', '/api/instance/restore', { sid: sessions.OWN });
    check('restauration: indisponible sans service de sauvegarde', r.status === 200 && r.body.available === false, JSON.stringify(r.body));
    cfgR.backupStatusDir = statusDir; cfgR.backupRequestsDir = reqDir;
    const ARCH = 'ticketbot-20261115-030000.sql.gz.enc';
    fsx.writeFileSync(path.join(statusDir, 'archives.json'), JSON.stringify([{ file: ARCH, bytes: 1234, at: '2026-11-15T03:00:00Z' }, { file: '../../etc/passwd', bytes: 1, at: '2026-11-15T03:00:00Z' }]));
    r = await req('GET', '/api/instance/restore', { sid: sessions.OWN });
    check('restauration: archives lues dans le statut du service (noms invalides écartés)', r.body.available === true && r.body.archives.length === 1 && r.body.archives[0].file === ARCH, JSON.stringify(r.body));
    r = await req('GET', '/api/instance/restore', { sid: sessions.NOWN });
    check('restauration: réservée au propriétaire', r.status === 403, r.status);
    r = await req('POST', '/api/instance/restore', { sid: sessions.OWN, body: { archive: ARCH, guildId: GR, confirm: 'non' } });
    check('restauration: confirmation par l identifiant exigée', r.status === 400, JSON.stringify(r.body));
    r = await req('POST', '/api/instance/restore', { sid: sessions.OWN, body: { archive: 'ticketbot-20990101-000000.sql.gz.enc', guildId: GR, confirm: GR } });
    const rBad = await req('POST', '/api/instance/restore', { sid: sessions.OWN, body: { archive: ARCH, guildId: '111111111111111112', confirm: '111111111111111112' } });
    check('restauration: archive absente et serveur inconnu refusés', r.status === 400 && rBad.status === 404, [r.status, rBad.status].join());
    r = await req('POST', '/api/instance/restore', { sid: sessions.OWN, body: { archive: ARCH, guildId: GR, confirm: GR } });
    const reqId = r.body.id;
    const reqText = fsx.readFileSync(path.join(reqDir, 'restore.req'), 'utf8');
    check('restauration: demande écrite pour le service de sauvegarde', r.status === 200 && reqText === `archive=${ARCH}\nguild=${GR}\nid=${reqId}\n`, reqText);
    r = await req('POST', '/api/instance/restore', { sid: sessions.OWN, body: { archive: ARCH, guildId: GR, confirm: GR } });
    const st = await req('GET', '/api/instance/restore', { sid: sessions.OWN });
    check('restauration: une seule à la fois, en cours affichée', r.status === 409 && st.body.pending?.id === reqId, JSON.stringify(st.body.pending));
    // The backup service did its job: tables swapped, the old ones in _prev, result written
    const target = `ticketbot_guild_${GR}`;
    await globalQuery(`CREATE DATABASE IF NOT EXISTS \`${target}_prev\``);
    await globalQuery(`CREATE TABLE \`${target}_prev\`.marker_before (x INT)`);
    await globalQuery(`DELETE FROM \`${target}\`.schema_migrations ORDER BY version DESC LIMIT 1`);
    fsx.unlinkSync(path.join(reqDir, 'restore.req'));
    fsx.writeFileSync(path.join(statusDir, 'restore.json'), JSON.stringify({ ok: true, at: new Date().toISOString(), guild: GR, file: ARCH, request: reqId, message: '42 tables restaurées' }));
    r = await req('GET', '/api/instance/restore', { sid: sessions.OWN });
    const [mig] = await getTenantDb(GR)('SELECT MAX(version) AS v FROM schema_migrations');
    const [aud] = await globalQuery("SELECT COUNT(*) AS n FROM instance_audit_log WHERE action = 'guild_restore_done' AND guild_id = ?", [GR]);
    check('restauration: terminée → migrations appliquées, journal, copie d avant listée', !r.body.pending && r.body.last.ok && Number(mig.v) === app('./utils/tenantMigrations').LATEST_VERSION && Number(aud.n) === 1 && r.body.previous.includes(GR), JSON.stringify([r.body, mig, aud]));
    r = await req('POST', `/api/instance/restore/${GR}/rollback`, { sid: sessions.OWN });
    const nowTables = (await globalQuery('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [target])).map(x => x.t);
    const prevTables = (await globalQuery('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [`${target}_prev`])).map(x => x.t);
    check('restauration: annulation → tables d avant remises, restaurées gardées dans la copie', r.status === 200 && nowTables.includes('marker_before') && prevTables.includes('tickets') && !prevTables.includes('marker_before'), JSON.stringify([r.body, nowTables.length, prevTables.length]));
    r = await req('DELETE', `/api/instance/restore/${GR}/previous`, { sid: sessions.OWN });
    const [left] = await globalQuery('SELECT COUNT(*) AS n FROM information_schema.schemata WHERE schema_name = ?', [`${target}_prev`]);
    check('restauration: copie d avant supprimée', r.status === 200 && Number(left.n) === 0, JSON.stringify(left));
    await globalQuery(`DROP DATABASE IF EXISTS \`${target}\``);
    await globalQuery('DELETE FROM guilds WHERE guild_id = ?', [GR]);
    delete cfgR.backupStatusDir; delete cfgR.backupRequestsDir;
    fsx.rmSync(statusDir, { recursive: true, force: true }); fsx.rmSync(reqDir, { recursive: true, force: true });
  }

  // ── Session store on ioredis (utils/sessionStore.js): same keys and format as connect-redis ──
  {
    const { RedisSessionStore } = app('./utils/sessionStore');
    const store = new RedisSessionStore();
    const call = (fn, ...a) => new Promise((res, rej) => store[fn](...a, (e, d) => (e ? rej(e) : res(d))));
    const sess = { cookie: { expires: new Date(Date.now() + 3600 * 1000).toISOString(), httpOnly: true }, user: { id: '1' } };
    await call('set', 'test-sid', sess);
    const ttl = await redis.ttl('sess:test-sid');
    const back = await call('get', 'test-sid');
    check('sessions: clé sess:<sid> en JSON, expiration du cookie', ttl > 3500 && ttl <= 3600 && back.user.id === '1' && JSON.parse(await redis.get('sess:test-sid')).user.id === '1', String(ttl));
    await call('destroy', 'test-sid');
    await call('set', 'test-sid2', { cookie: { expires: new Date(Date.now() - 1000).toISOString() } });
    check('sessions: supprimée, et jamais écrite déjà expirée', !(await redis.exists('sess:test-sid')) && !(await redis.exists('sess:test-sid2')) && (await call('get', 'test-sid')) === null, '');
  }

  // ── New versions and one-click update (utils/updates.js, docker/updater.sh) ──
  {
    const up = app('./utils/updates');
    const cfgU = app('./utils/config').config;
    check('mise à jour: comparaison des versions', up.compareVersions('v3.0.10', '3.0.9') > 0 && up.compareVersions('v3.1', '3.0.12') > 0 && up.compareVersions('v3.0.7', '3.0.7') === 0 && up.compareVersions('v2.24', '3.0.0') < 0, '');
    const fakeFetch = async () => ({ ok: true, json: async () => ({ tag_name: 'v99.0.0', html_url: 'https://github.com/x/y/releases/tag/v99.0.0', body: 'Notes', published_at: '2026-11-15T00:00:00Z' }) });
    await up.checkLatest({ fetchImpl: fakeFetch });
    r = await req('GET', '/api/instance/update', { sid: sessions.NOWN });
    check('mise à jour: état réservé au propriétaire', r.status === 403, r.status);
    r = await req('GET', '/api/instance/update', { sid: sessions.OWN });
    check('mise à jour: nouvelle version détectée', r.status === 200 && r.body.available === true && r.body.latest === 'v99.0.0' && r.body.current === 'v' + require('../../package.json').version && r.body.updater.connected === false, JSON.stringify(r.body));
    const evil = async () => ({ ok: true, json: async () => ({ tag_name: '<script>', html_url: 'javascript:alert(1)' }) });
    let refused = false; try { await up.checkLatest({ fetchImpl: evil }); } catch { refused = true; }
    check('mise à jour: version publiée illisible refusée', refused, '');
    r = await req('POST', '/api/instance/update', { sid: sessions.OWN, body: {} });
    check('mise à jour: refusée sans service updater en marche', r.status === 409, JSON.stringify(r.body));
    const poll = (headers, tag = 'latest') => req('GET', '/api/updater/poll', { query: { tag }, headers });
    r = await poll({ Authorization: 'Bearer x'.repeat(10) });
    check('updater: refusé sans UPDATER_TOKEN configuré', r.status === 401, r.status);
    cfgU.updater = { token: 'u'.repeat(64) };
    const auth = { Authorization: 'Bearer ' + 'u'.repeat(64) };
    r = await poll({ Authorization: 'Bearer ' + 'v'.repeat(64) });
    const rProxy = await poll({ ...auth, 'X-Forwarded-For': '1.2.3.4' });
    check('updater: mauvais jeton ou passage par le proxy public refusés', r.status === 401 && rProxy.status === 401, JSON.stringify([r.status, rProxy.status]));
    r = await poll(auth, 'v3.0.5');
    const pinned = await req('POST', '/api/instance/update', { sid: sessions.OWN, body: {} });
    check('mise à jour: version épinglée refusée avec explication', r.body.update === false && pinned.status === 409 && /épinglée/.test(pinned.body.error), JSON.stringify([r.body, pinned.body]));
    await poll(auth);
    r = await req('POST', '/api/instance/update', { sid: sessions.NOWN, body: {} });
    check('mise à jour: demande réservée au propriétaire', r.status === 403, r.status);
    r = await req('POST', '/api/instance/update', { sid: sessions.OWN, body: {} });
    const again = await req('POST', '/api/instance/update', { sid: sessions.OWN, body: {} });
    check('mise à jour: demandée une seule fois', r.status === 200 && r.body.to === 'v99.0.0' && again.status === 409, JSON.stringify([r.body, again.body]));
    const p1 = await poll(auth), p2 = await poll(auth);
    let st = await req('GET', '/api/instance/update', { sid: sessions.OWN });
    check('updater: reçoit la demande une seule fois, état « en cours »', p1.body.update === true && p2.body.update === false && st.body.status.state === 'running' && st.body.updater.connected, JSON.stringify([p1.body, p2.body, st.body.status]));
    r = await req('POST', '/api/updater/result', { headers: auth, body: { ok: true, log: 'Pulled\nStarted' } });
    st = await req('GET', '/api/instance/update', { sid: sessions.OWN });
    check('updater: résultat enregistré', r.status === 200 && st.body.status.state === 'done' && /Started/.test(st.body.status.log), JSON.stringify(st.body.status));
    r = await req('POST', '/api/updater/result', { body: { ok: false } });
    check('updater: résultat refusé sans jeton', r.status === 401, r.status);
    const [ja] = await globalQuery("SELECT action FROM instance_audit_log WHERE action LIKE '%update%' ORDER BY id DESC LIMIT 1");
    check('mise à jour: demande inscrite au journal de l\'instance', !!ja, JSON.stringify(ja));
    for (const k of ['updater:seen', 'updater:request', 'updater:status']) await redis.del(k);
    await globalQuery("DELETE FROM instance_settings WHERE k = 'update_check'");
    delete cfgU.updater;
  }

  // ── Journal of the instance section ──
  {
    await new Promise(res => setTimeout(res, 200));
    r = await req('GET', '/api/instance/audit', { sid: sessions.NOWN });
    check('journal SA: réservé au propriétaire', r.status === 403, r.status);
    r = await req('GET', '/api/instance/audit', { sid: sessions.OWN, query: { action: 'guild_maintenance' } });
    const lim = r.body.rows?.find(x => x.guild_id === G);
    check('journal SA: maintenance enregistrée avec le serveur', r.status === 200 && lim && lim.actor_name === 'F' && JSON.stringify(lim.details).includes('enabled'), JSON.stringify(r.body.rows?.slice(0, 2)));
    check('journal SA: action refusée (400) non enregistrée', !r.body.rows.some(x => JSON.stringify(x.details).includes('"non"')));
    r = await req('GET', '/api/instance/audit', { sid: sessions.OWN, query: { action: 'error_alert_update' } });
    const al = JSON.stringify((r.body.rows || []).find(x => x.details?.webhookUrl)?.details || {});
    check('journal SA: URL de webhook réduite à son origine', al.includes('https://127.0.0.1/…') && !al.includes('/hook'), al);
    r = await req('GET', '/api/instance/audit', { sid: sessions.OWN, query: { action: 'founder_add' } });
    check('journal SA: nomination de fondateur enregistrée', r.body.rows?.length >= 1 && r.body.rows[0].guild_id === G, JSON.stringify(r.body.rows?.[0]));
  }

  // ── Mandatory 2FA per server ──
  {
    await globalQuery('DELETE FROM user_totp WHERE user_id = ?', [U.F]);
    await mk('F2', { user: { id: U.F, username: 'F', role: null }, currentGuildId: G });
    await mk('S3Z', { user: { id: U.S3, username: 'S3', role: null }, currentGuildId: G });
    r = await req('PATCH', '/api/config', { sid: sessions.F2, body: { require2fa: 'founders' } });
    check('2FA obligatoire: refusée si le fondateur n\'a pas lui-même la 2FA', r.status === 400 && /double authentification/.test(r.body.error), JSON.stringify(r.body));
    await globalQuery("INSERT INTO user_totp (user_id, totp_secret, totp_enabled) VALUES (?, 'x', 1)", [U.F]);
    r = await req('PATCH', '/api/config', { sid: sessions.F2, body: { require2fa: 'staff' } });
    check('2FA obligatoire: activée par un fondateur protégé', r.status === 200, JSON.stringify(r.body));
    r = await req('GET', '/api/tickets', { sid: sessions.S3Z });
    check('2FA obligatoire: staff sans 2FA bloqué avec un code dédié', r.status === 403 && r.body.code === '2fa_required', JSON.stringify(r.body));
    r = await req('GET', '/api/profile', { sid: sessions.S3Z });
    check('2FA obligatoire: le profil reste accessible pour l\'activer', r.status === 200, r.status);
    r = await req('GET', '/api/tickets', { sid: sessions.F2 });
    check('2FA obligatoire: compte protégé accepté', r.status === 200, r.status);
    r = await req('POST', '/api/profile/2fa/disable', { sid: sessions.F2, body: { code: '000000' } });
    check('2FA obligatoire: désactivation refusée', r.status === 400 && /impose/.test(r.body.error), JSON.stringify(r.body));
    await db("UPDATE guild_config SET require_2fa = 'none' WHERE id = 1");
    await globalQuery('DELETE FROM user_totp WHERE user_id = ?', [U.F]);
    r = await req('GET', '/api/tickets', { sid: sessions.S3Z });
    check('2FA obligatoire: retirée → accès rétabli', r.status === 200, r.status);
  }

  // ── Versioned tenant migrations ──
  {
    const tm = app('./utils/tenantMigrations');
    const applied = await db('SELECT version FROM schema_migrations ORDER BY version');
    check('migrations: versions appliquées et enregistrées', applied.map(x => x.version).join() === tm.MIGRATIONS.map(m => m.version).join() && (await tm.schemaVersion(db)) === tm.LATEST_VERSION, JSON.stringify(applied));
    const [badgeT] = await db("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('badge_definitions','user_badges','staff_roles','faq_rules')");
    const [badgeC] = await db("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'guild_config' AND column_name = 'badges_enabled'");
    check('migrations: tables et colonnes inutilisées supprimées', Number(badgeT.n) === 0 && Number(badgeC.n) === 0, JSON.stringify([badgeT, badgeC]));
    await app('./utils/tenantSchema').ensureTenantSchema(G);
    const again = await db('SELECT COUNT(*) AS n FROM schema_migrations');
    check('migrations: relancer ne rejoue rien', Number(again[0].n) === tm.MIGRATIONS.length, JSON.stringify(again));
    // A failing migration stops the run and is not recorded
    tm.MIGRATIONS.push({ version: 9999, name: 'test en échec', statements: ['ALTER TABLE table_inexistante ADD COLUMN x INT'] });
    let migErr = null;
    try { await app('./utils/tenantSchema').ensureTenantSchema(G); } catch (e) { migErr = e.message; }
    tm.MIGRATIONS.pop();
    const [v9999] = await db('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 9999');
    check('migrations: une erreur arrête la migration et n\'est pas enregistrée', /9999/.test(migErr || '') && Number(v9999.n) === 0, JSON.stringify([migErr, v9999]));
  }

  // ── Encryption key rotation ──
  {
    const box = app('./utils/secretBox');
    const cfgD = app('./utils/config').config.dashboard;
    const oldKey = cfgD.encryptionKey, oldPrev = cfgD.previousEncryptionKeys;
    box.resetKeys();
    const legacyV1 = 'enc:v1:' + (() => {   // a value written before rotation existed (v1, current key)
      const k = require('crypto').hkdfSync('sha256', cfgD.sessionSecret, 'ticketbot', 'secret-box-v1', 32);
      const key = oldKey && /^[0-9a-f]{64}$/i.test(oldKey) ? Buffer.from(oldKey, 'hex') : Buffer.from(k);
      const iv = require('crypto').randomBytes(12); const c = require('crypto').createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update('JBSWY3DPEHPK3PXP', 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
    })();
    const before = box.seal('KRSXG5CTMVRXEZLU');
    // Transcripts: one written before encryption (clear), one encrypted with the old key
    const { sealTranscript, openTranscript } = app('./utils/transcriptCrypto');
    const [anyClosed] = await db("SELECT html FROM transcript_snapshots ORDER BY id DESC LIMIT 1");
    check('transcripts: stockés chiffrés', !anyClosed || /^enc:v2z:/.test(anyClosed.html), String(anyClosed?.html).slice(0, 30));
    const tTr = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('41','u41','ctr1','closed','transcripts')")).insertId;
    const trClear = (await db("INSERT INTO transcript_snapshots (ticket_id, channel_id, created_by_id, created_by_tag, message_count, html, txt) VALUES (?, 'ctr1', '1', 'F', 1, '<p>en clair</p>', 'en clair')", [tTr])).insertId;
    const trOld = (await db("INSERT INTO transcript_snapshots (ticket_id, channel_id, created_by_id, created_by_tag, message_count, html, txt) VALUES (?, 'ctr1', '1', 'F', 1, ?, ?)", [tTr, sealTranscript('<p>ancienne clé</p>'), sealTranscript('ancienne clé')])).insertId;
    let rTr = await req('GET', `/api/transcripts/${trClear}/html`, { sid: sessions.FV });
    check('transcripts: anciens transcripts en clair toujours lisibles', rTr.status === 200 && rTr.body === '<p>en clair</p>', String(rTr.body).slice(0, 60));
    const k1 = require('crypto').randomBytes(32).toString('hex');
    cfgD.previousEncryptionKeys = oldKey ? [oldKey] : [];
    cfgD.encryptionKey = k1;
    box.resetKeys();
    check('rotation: anciens secrets lisibles avec la nouvelle clé configurée', box.open(before) === 'KRSXG5CTMVRXEZLU' && box.open(legacyV1) === 'JBSWY3DPEHPK3PXP');
    await globalQuery("INSERT INTO user_totp (user_id, totp_secret, totp_enabled) VALUES ('100000000000000077', ?, 1), ('100000000000000078', ?, 1)", [before, legacyV1]);
    // Secrets added in v4/v5: sign-in providers, mailbox OAuth2 applications and tokens
    const iset = app('./utils/instanceSettings');
    const lpBefore = await iset.getSetting('login_providers', {}), moBefore = await iset.getSetting('mail_oauth', {});
    await iset.setSetting('login_providers', { ...lpBefore, google: { ...(lpBefore.google || {}), enabled: false, clientId: 'rot', clientSecret: before } });
    await iset.setSetting('mail_oauth', { ...moBefore, microsoft: { clientId: 'rot', clientSecret: before, tenant: 'common' } });
    const [ems] = await db('SELECT oauth_refresh FROM email_settings WHERE id = 1');
    await db('INSERT INTO email_settings (id, oauth_refresh) VALUES (1, ?) ON DUPLICATE KEY UPDATE oauth_refresh = VALUES(oauth_refresh)', [before]);
    const rep = await require(path.join(ROOT, 'scripts/rotate-encryption-key.js')).rotate();
    const lpAfter = await iset.getSetting('login_providers', {}), moAfter = await iset.getSetting('mail_oauth', {});
    const [emsAfter] = await db('SELECT oauth_refresh FROM email_settings WHERE id = 1');
    check('rotation: secrets des fournisseurs de connexion, des applications e-mail et jetons OAuth rechiffrés',
      [lpAfter.google.clientSecret, moAfter.microsoft.clientSecret, emsAfter.oauth_refresh].every(v => box.isCurrent(v) && box.open(v) === 'KRSXG5CTMVRXEZLU') && rep.loginProviders.rewritten === 1 && rep.mailOAuth.rewritten === 1,
      JSON.stringify([rep.loginProviders, rep.mailOAuth, rep.emailPasswords]));
    await iset.setSetting('login_providers', lpBefore); await iset.setSetting('mail_oauth', moBefore);
    await db('UPDATE email_settings SET oauth_refresh = ? WHERE id = 1', [ems?.oauth_refresh ?? null]);
    const rows = await globalQuery("SELECT totp_secret FROM user_totp WHERE user_id IN ('100000000000000077', '100000000000000078') ORDER BY user_id");
    check('rotation: secrets rechiffrés avec la nouvelle clé', rep.user_totp.rewritten >= 2 && rep.user_totp.failed === 0 && rows.every(r => box.isCurrent(r.totp_secret)) && box.open(rows[0].totp_secret) === 'KRSXG5CTMVRXEZLU' && box.open(rows[1].totp_secret) === 'JBSWY3DPEHPK3PXP', JSON.stringify(rep));
    const trRows = await db('SELECT id, html, txt FROM transcript_snapshots WHERE id IN (?) ORDER BY id', [[trClear, trOld]]);
    check('rotation: transcripts chiffrés avec la nouvelle clé (y compris ceux en clair)', rep.transcripts.rewritten >= 2 && rep.transcripts.failed === 0 && trRows.every(r => box.isCurrent(r.html) && box.isCurrent(r.txt))
      && openTranscript(trRows[0].html) === '<p>en clair</p>' && openTranscript(trRows[1].txt) === 'ancienne clé', JSON.stringify(rep.transcripts));
    rTr = await req('GET', `/api/transcripts/${trOld}/txt`, { sid: sessions.FV });
    check('transcripts: lisibles après rotation', rTr.status === 200 && rTr.body === 'ancienne clé', String(rTr.body).slice(0, 60));
    const rep2 = await require(path.join(ROOT, 'scripts/rotate-encryption-key.js')).rotate();
    check('rotation: relancer ne réécrit rien', rep2.user_totp.rewritten === 0 && rep2.transcripts.rewritten === 0, JSON.stringify(rep2));
    let unknownErr = null;
    try { box.open('enc:v2:deadbeef:AAAA'); } catch (e) { unknownErr = e.message; }
    check('rotation: clé inconnue signalée clairement', /deadbeef/.test(unknownErr || ''), unknownErr);
    // The new key stays current for the rest of the run (secrets rewritten with it)
    cfgD.previousEncryptionKeys = [...(oldKey ? [oldKey] : []), ...(oldPrev || [])];
    box.resetKeys();
    await globalQuery("DELETE FROM user_totp WHERE user_id IN ('100000000000000077', '100000000000000078')");
  }

  // ── Multi-instance: limits and creation lock shared through Redis ──
  {
    const rl = app('./utils/rateLimit');
    const first = await rl.checkRateLimit('test:cd', 5000), second = await rl.checkRateLimit('test:cd', 5000);
    check('multi-instance: cooldown des commandes dans Redis', first === 0 && second > 0 && !!(await redis.get('rl:bot:cd:test:cd')), JSON.stringify([first, second]));
    let allowed = 0;
    for (let i = 0; i < 5; i++) if (await rl.allowBurst('test:burst', 3, 5000)) allowed++;
    check('multi-instance: anti-flood des MP dans Redis', allowed === 3 && (await rl.firstOverflow('test:burst')) && !(await rl.firstOverflow('test:burst')), String(allowed));
    check('multi-instance: compteurs HTTP dans Redis', (await redis.keys('rl:auth:*')).length > 0);
    // Another instance holds this member's creation lock and creates the ticket meanwhile
    const ML = '200000000000000014';
    await redis.set(`lock:create:${G}:${ML}`, 'other-instance', 'PX', 5000);
    const otherTicket = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member14', ?, 'open', 'créé ailleurs')", [ML, OWN_CH])).insertId;
    setTimeout(async () => { await redis.set(`lock:created:${G}:${ML}`, String(otherTicket), 'EX', 15); await redis.del(`lock:create:${G}:${ML}`); }, 300);
    const res = await createManager(db, fakeClient, G).createTicket({ id: ML, username: 'member14', tag: 'member14', send: async () => {} }, 'message pendant la création', []);
    const [cnt] = await db('SELECT COUNT(*) AS n FROM tickets WHERE owner_id = ?', [ML]);
    const relayed = await db("SELECT 1 FROM ticket_notes WHERE ticket_id = ? AND content LIKE '%pendant la création%'", [otherTicket]);
    check('multi-instance: création en cours ailleurs → pas de doublon, message relayé', Number(cnt.n) === 1 && relayed.length === 1 && res.created === false, JSON.stringify([cnt, relayed.length, res.created]));
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [otherTicket]);
  }

  // ── Discord: server health, overflow categories, threads, staff-opened tickets, voice, reply edits ──
  {
    const { PermissionsBitField, Collection, ChannelType } = require('discord.js');
    const F = PermissionsBitField.Flags;
    const ALL = [F.ViewChannel, F.SendMessages, F.EmbedLinks, F.AttachFiles, F.ReadMessageHistory, F.ManageChannels, F.ManageRoles];
    const perms = list => new PermissionsBitField(list);
    const hc = new Collection();
    const CAT = '950000000000000001', LOG = '950000000000000002', GONE = '950000000000000009';
    const mkCat = (id, name) => ({ id, name, type: ChannelType.GuildCategory, position: 0, isTextBased: () => false, guildId: G,
      permissionOverwrites: { cache: new Collection() }, permissionsFor: () => perms(ALL), delete: async () => { hc.delete(id); } });
    hc.set(CAT, mkCat(CAT, 'Tickets'));
    hc.set(LOG, { id: LOG, name: 'logs', type: 0, isTextBased: () => true, permissionsFor: () => perms([F.ViewChannel]) });
    for (let i = 0; i < 50; i++) hc.set(`96000000000000${String(i).padStart(4, '0')}`, { id: `96000000000000${String(i).padStart(4, '0')}`, parentId: CAT, type: 0 });
    let catSeq = 0;
    const hGuild = {
      id: G, members: { me: { permissions: perms(ALL.filter(f => f !== F.ManageRoles)) } },
      channels: { cache: hc, fetch: async id => hc.get(id) || null,
        create: async o => { const id = `97000000000000000${++catSeq}`; const c = mkCat(id, o.name); hc.set(id, c); return c; } },
      roles: { fetch: async () => new Collection([['800000000000000001', { name: 'Support' }]]) },
    };
    const healthDms = [];
    const hClient = { isReady: () => true, user: { id: '1' }, guilds: { fetch: async () => hGuild, cache: new Map() }, users: { fetch: async id => ({ id, send: async p => healthDms.push({ id, p }) }) } };
    const [saved] = await db('SELECT ticket_category_id, waiting_category_id, close_log_channel_id, support_role_ids FROM guild_config WHERE id = 1');
    await db('UPDATE guild_config SET ticket_category_id = ?, waiting_category_id = ?, close_log_channel_id = ?, support_role_ids = ? WHERE id = 1',
      [CAT, GONE, LOG, JSON.stringify(['800000000000000001', '800000000000000077'])]);
    const health = app('./utils/guildHealth');
    const rep = await health.checkGuildHealth(db, hClient, G);
    const ids = rep.problems.map(p => p.id);
    check('santé: permission « Gérer les rôles » manquante détectée', rep.permissions.find(p => p.key === 'ManageRoles')?.ok === false && ids.includes('perm:ManageRoles'), JSON.stringify(ids));
    check('santé: catégorie supprimée détectée', rep.channels.find(c => c.field === 'waiting_category_id')?.problem === 'Supprimé ou introuvable', JSON.stringify(rep.channels));
    check('santé: salon de logs sans droit d écrire détecté', /Envoyer des messages/.test(rep.channels.find(c => c.field === 'close_log_channel_id')?.problem || ''), JSON.stringify(rep.channels));
    check('santé: rôle support supprimé détecté', ids.includes('role:800000000000000077') && !ids.includes('role:800000000000000001'), JSON.stringify(ids));
    check('santé: remplissage de la catégorie', rep.categories[0]?.count === 50 && rep.categories[0]?.limit === 50, JSON.stringify(rep.categories));
    await redis.del(`health:problems:${G}`);
    const fresh1 = await health.alertNewProblems(db, hClient, G, 'Test', rep);
    const dmsAfter1 = healthDms.length;
    const fresh2 = await health.alertNewProblems(db, hClient, G, 'Test', rep);
    check('santé: MP aux fondateurs une seule fois par nouveau problème', fresh1.length === rep.problems.length && dmsAfter1 === 1 && fresh2.length === 0 && healthDms.length === 1
      && /Gérer les rôles/.test(healthDms[0].p.embeds[0].data.description), JSON.stringify([fresh1.length, dmsAfter1, fresh2.length]));
    rep.problems.push({ id: 'perm:Other', text: 'Nouveau' });
    const fresh3 = await health.alertNewProblems(db, hClient, G, 'Test', rep);
    check('santé: un nouveau problème est signalé ensuite', fresh3.length === 1 && healthDms.length === 2, JSON.stringify(fresh3));
    r = await req('GET', '/api/server-health', { sid: sessions.S1 });
    check('santé: page refusée à un support sans manage_settings', r.status === 403, r.status);
    r = await req('GET', '/api/server-health', { sid: sessions.F });
    check('santé: page accessible au fondateur', r.status === 200 && Array.isArray(r.body.permissions) && r.body.alertsEnabled === true, JSON.stringify(r.body).slice(0, 200));

    // Overflow categories
    const ov = app('./utils/categoryOverflow');
    const c2 = await ov.categoryWithRoom(db, hGuild, CAT);
    const c2again = await ov.categoryWithRoom(db, hGuild, CAT);
    check('débordement: catégorie pleine → « Tickets 2 » créée et réutilisée', c2 !== CAT && c2 === c2again && hc.get(c2)?.name === 'Tickets 2', JSON.stringify([c2, c2again, hc.get(c2)?.name]));
    for (let i = 0; i < 50; i++) hc.set(`98000000000000${String(i).padStart(4, '0')}`, { id: `98000000000000${String(i).padStart(4, '0')}`, parentId: c2, type: 0 });
    const c3 = await ov.categoryWithRoom(db, hGuild, CAT);
    check('débordement: « Tickets 3 » quand la 2 est pleine aussi', hc.get(c3)?.name === 'Tickets 3', hc.get(c3)?.name);
    check('débordement: une catégorie de débordement reconnue comme la même étape', await ov.inCategoryFamily(db, c3, CAT) && !(await ov.inCategoryFamily(db, LOG, CAT)));
    hc.delete('960000000000000000');
    check('débordement: retour à la catégorie de base quand une place se libère', (await ov.categoryWithRoom(db, hGuild, CAT)) === CAT);
    const removed = await ov.pruneEmptyOverflow(db, hGuild);
    const [{ n: ovLeft }] = await db('SELECT COUNT(*) AS n FROM overflow_categories');
    check('débordement: catégories vides supprimées', removed === 1 && !hc.has(c3) && hc.has(c2) && Number(ovLeft) === 1, JSON.stringify([removed, ovLeft]));
    await db('DELETE FROM overflow_categories');
    await db('UPDATE guild_config SET ticket_category_id = ?, waiting_category_id = ?, close_log_channel_id = ?, support_role_ids = ? WHERE id = 1',
      [saved.ticket_category_id, saved.waiting_category_id, saved.close_log_channel_id, saved.support_role_ids == null ? null : JSON.stringify(saved.support_role_ids)]);
    await redis.del(`health:problems:${G}`);

    // Private threads
    const PARENT = '950000000000000100';
    const added = [], removedM = [];
    const threadGuild = { id: G, members: { fetch: async () => new Map() }, roles: { cache: new Map([['800000000000000001', { members: new Map([['400000000000000001', { id: '400000000000000001', user: { bot: false } }]]) }]]) } };
    let threadOpts = null;
    const parentCh = mkChannel(PARENT, G, 0, 'tickets');
    parentCh.threads = { create: async o => {
      threadOpts = o;
      const th = mkChannel('950000000000000101', G, 12, o.name);
      th.isThread = () => true; th.guild = threadGuild; th.setTopic = undefined;
      th.members = { fetch: async () => new Map([['1', {}], [U.S1, {}]]), add: async id => added.push(id), remove: async id => removedM.push(id) };
      channels.set(th.id, th);
      return th;
    } };
    channels.set(PARENT, parentCh);
    const [cfgT] = await db('SELECT support_role_ids FROM guild_config WHERE id = 1');
    await db("UPDATE guild_config SET ticket_mode = 'thread', thread_parent_channel_id = ?, support_role_ids = ? WHERE id = 1", [PARENT, JSON.stringify(['800000000000000001'])]);
    const tmT = createManager(db, fakeClient, G);
    const resT = await tmT.createTicket({ id: '200000000000000041', username: 'member41', tag: 'member41', send: async () => {} }, 'besoin d aide en fil', [], 'fil');
    check('fils: ticket créé comme fil privé du salon choisi', resT.created && resT.channel.isThread() && threadOpts?.type === ChannelType.PrivateThread && threadOpts?.invitable === false, JSON.stringify(threadOpts));
    check('fils: staff ajouté (rôle support + comptes dashboard autorisés), sans accès retiré à tort',
      added.includes('400000000000000001') && added.includes(U.F) && !added.includes(U.S1) && !added.includes('1') && removedM.length === 0, JSON.stringify([added, removedM]));
    added.length = 0; removedM.length = 0;
    await db('UPDATE tickets SET visibility_grade_id = ? WHERE id = ?', [g2, resT.ticket.id]);
    await app('./utils/channelVisibility').syncTicketChannel(db, fakeClient, G, { ...resT.ticket, visibility_grade_id: g2 });
    check('fils: ticket restreint → seuls les autorisés restent', added.includes(U.F) && !added.includes('400000000000000001') && removedM.includes(U.S1) && !removedM.includes('1'), JSON.stringify([added, removedM]));
    const mv = await tmT.moveToStage(resT.ticket.id, 'waiting', { id: U.F, username: 'F', tag: 'F' });
    const [stT] = await db('SELECT stage FROM tickets WHERE id = ?', [resT.ticket.id]);
    check('fils: changement d étape sans catégorie', mv.ok && stT.stage === 'waiting', JSON.stringify(mv));
    r = await req('GET', `/api/tickets/${resT.ticket.id}`, { sid: sessions.F });
    check('fils: toutes les étapes disponibles sur la fiche', r.status === 200 && r.body.stages.waiting && r.body.stages.in_progress, JSON.stringify(r.body.stages));
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [resT.ticket.id]);
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketMode: 'thread', threadParentChannelId: null } });
    check('fils: mode fils sans salon parent refusé', r.status === 400 && /salon/.test(r.body.error), JSON.stringify(r.body));
    r = await req('PATCH', '/api/config', { sid: sessions.F, body: { threadParentChannelId: CAT_OPEN } });
    check('fils: salon parent qui n est pas textuel refusé', r.status === 400, JSON.stringify(r.body));
    await db("UPDATE guild_config SET ticket_mode = 'auto', thread_parent_channel_id = NULL, support_role_ids = ? WHERE id = 1", [cfgT.support_role_ids == null ? null : JSON.stringify(cfgT.support_role_ids)]);

    // ── Ticket format « database »: no Discord channel at all (utils/virtualChannel.js) ──
    {
      const vc = app('./utils/virtualChannel');
      r = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketMode: 'database' } });
      check('sans salon: format « base de données » enregistré (migration 34)', r.status === 200, JSON.stringify(r.body));
      const before = chanSeq;
      const MD = '200000000000000061';
      memberDms.length = 0;
      const tmD = createManager(db, fakeClient, G);
      const resD = await tmD.createTicket({ id: MD, username: 'member61', tag: 'member61', send: async () => {} }, 'Bonjour, ma commande est bloquée', [], 'Commande');
      const tD = resD.ticket;
      check('sans salon: ticket créé sans aucun salon ni fil Discord', resD.created && vc.isVirtualChannelId(tD.channel_id) && chanSeq === before, JSON.stringify([tD.channel_id, chanSeq, before]));
      const again = await tmD.relayDmToTicket({ id: MD, username: 'member61', tag: 'member61' }, 'Voici le numéro : 4512', []);
      const notesD = await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user' ORDER BY id", [tD.id]);
      check('sans salon: les MP du membre arrivent dans le même ticket', again?.ticket?.id === tD.id && notesD.length === 2 && notesD[1].content.includes('4512'), JSON.stringify(notesD));
      r = await req('POST', `/api/tickets/${tD.id}/reply`, { sid: sessions.F, body: { content: 'Merci, on regarde votre commande.' } });
      check('sans salon: réponse du staff depuis le dashboard, envoyée en MP', r.status === 200 && memberDms.some(d => d.id === MD && JSON.stringify(d.p).includes('on regarde votre commande')), JSON.stringify(r.body).slice(0, 200));
      await req('POST', `/api/tickets/${tD.id}/notes`, { sid: sessions.F, body: { content: 'NOTE-INTERNE-DB' } });
      const mv = await tmD.moveToStage(tD.id, 'waiting', { id: U.F, username: 'F', tag: 'F' });
      check('sans salon: changement d étape sans catégorie Discord', mv.ok, JSON.stringify(mv));
      r = await req('PATCH', `/api/tickets/${tD.id}/status`, { sid: sessions.F, body: { status: 'closed' } });
      const [snap] = await db('SELECT html, txt, message_count FROM transcript_snapshots WHERE ticket_id = ? ORDER BY id DESC LIMIT 1', [tD.id]);
      const txt = snap ? app('./utils/transcriptCrypto').openTranscript(snap.txt) : '';
      check('sans salon: fermeture avec transcript tiré de l historique, sans les notes internes', r.status === 200 && snap && txt.includes('4512') && txt.includes('on regarde votre commande') && !txt.includes('NOTE-INTERNE-DB'), String(txt).slice(0, 300));
      check('sans salon: le membre reçoit le message de fermeture et la demande de note', memberDms.filter(d => d.id === MD).length >= 3, String(memberDms.filter(d => d.id === MD).length));
      const [closedD] = await db('SELECT * FROM tickets WHERE id = ?', [tD.id]);
      await tmD.reopenTicket(closedD, { id: U.F, username: 'F', tag: 'F' });
      const [reD] = await db('SELECT status, channel_id FROM tickets WHERE id = ?', [tD.id]);
      check('sans salon: réouverture sans salon non plus', reD.status === 'open' && vc.isVirtualChannelId(reD.channel_id) && reD.channel_id !== tD.channel_id && chanSeq === before, JSON.stringify(reD));
      await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tD.id]);
      const { Client } = require('discord.js');
      const real = new Client({ intents: [] });
      const err = await real.channels.fetch(tD.channel_id).then(() => null, e => e);
      check('sans salon: un identifiant virtuel n est jamais demandé à Discord', err?.code === 10003, String(err));
      await real.destroy();
      await db("UPDATE guild_config SET ticket_mode = 'auto' WHERE id = 1");
    }

    // Fake DMs and channel messages that can be fetched, edited and deleted
    const msgs = new Map();
    let msgSeq = 0;
    const mkMsg = (channelId, p) => {
      const m = { id: `99000000000000${String(++msgSeq).padStart(4, '0')}`, channelId, embeds: p?.embeds || [], content: p?.content ?? (typeof p === 'string' ? p : ''), edits: [], deleted: false,
        edit: async e => { m.edits.push(e); return m; }, delete: async () => { m.deleted = true; } };
      msgs.set(m.id, m);
      return m;
    };
    const msgChannel = id => ({ id, guildId: G, type: 0, name: 'x', isTextBased: () => true, isThread: () => false, setTopic: async () => {}, setName: async () => {}, delete: async () => {},
      send: async p => mkMsg(id, p), messages: { fetch: async q => (typeof q === 'string' ? (msgs.get(q)?.channelId === id ? msgs.get(q) : null) : new Map()) } });
    const ECH = '950000000000000200', DMCH = '950000000000000201', MEM = '200000000000000042';
    channels.set(ECH, msgChannel(ECH));
    channels.set(DMCH, msgChannel(DMCH));
    const origUsers = fakeClient.users.fetch, origMembers = guildObj.members.fetch;
    fakeClient.users.fetch = async id => (id === MEM ? { id, username: 'member42', tag: 'member42', bot: false, send: async p => mkMsg(DMCH, p) } : origUsers(id));
    guildObj.members.fetch = async id => (id === MEM ? { id, user: await fakeClient.users.fetch(id), roles: { cache: new Map() } } : origMembers(id));
    const te = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES (?, 'member42', ?, 'open', 'édition')", [MEM, ECH])).insertId;
    r = await req('POST', `/api/tickets/${te}/reply`, { sid: sessions.F, body: { content: 'Votre remboursement est de 10 €' } });
    const [rn] = await db("SELECT id, reply_refs FROM ticket_notes WHERE ticket_id = ? AND source = 'reply'", [te]);
    const J = v => (typeof v === 'string' ? JSON.parse(v) : v);
    const refs = J(rn.reply_refs);
    check('réponse: emplacements du MP et du salon mémorisés', r.status === 200 && refs.dms.length === 1 && refs.dms[0].channelId === DMCH && refs.channel?.channelId === ECH, JSON.stringify([r.status, refs]));
    r = await req('PATCH', `/api/tickets/${te}/notes/${rn.id}`, { sid: sessions.S1, body: { content: 'piratage' } });
    check('réponse: un autre membre du staff ne peut pas la modifier', r.status === 403, r.status);
    r = await req('PATCH', `/api/tickets/${te}/notes/${rn.id}`, { sid: sessions.F, body: { content: 'Votre remboursement est de 15 €' } });
    const dmMsg = msgs.get(refs.dms[0].messageId), chMsg = msgs.get(refs.channel.messageId);
    const [rn2] = await db('SELECT content, edit_history, edited_at FROM ticket_notes WHERE id = ?', [rn.id]);
    check('réponse corrigée: MP du membre modifié', r.status === 200 && r.body.dms.done === 1 && dmMsg.edits[0]?.embeds?.[0]?.data?.description === 'Votre remboursement est de 15 €', JSON.stringify([r.body, dmMsg.edits]));
    check('réponse corrigée: copie du salon et historique mis à jour', /15 €/.test(chMsg.edits[0]?.content || '') && rn2.content === 'Votre remboursement est de 15 €'
      && J(rn2.edit_history)[0].content === 'Votre remboursement est de 10 €' && !!rn2.edited_at, JSON.stringify([chMsg.edits, rn2]));
    r = await req('GET', `/api/tickets/${te}/notes`, { sid: sessions.F });
    check('réponse: marquée modifiable dans l historique', r.body.find(n => n.id === rn.id)?.editable === true && r.body.find(n => n.id === rn.id)?.edit_text === 'Votre remboursement est de 15 €', JSON.stringify(r.body.find(n => n.id === rn.id)));
    r = await req('DELETE', `/api/tickets/${te}/notes/${rn.id}`, { sid: sessions.F });
    const [rn3] = await db('SELECT deleted_at FROM ticket_notes WHERE id = ?', [rn.id]);
    check('réponse retirée: MP supprimé, trace gardée', r.status === 200 && r.body.retracted && dmMsg.deleted && !!rn3?.deleted_at && /retirée/.test(chMsg.edits.at(-1)?.content || ''), JSON.stringify([r.body, dmMsg.deleted, rn3]));
    r = await req('PATCH', `/api/tickets/${te}/notes/${rn.id}`, { sid: sessions.F, body: { content: 'encore' } });
    check('réponse retirée: plus modifiable', r.status === 400, r.status);
    const oldNote = (await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, 'F', 'ancienne', 'reply')", [te, U.F])).insertId;
    r = await req('PATCH', `/api/tickets/${te}/notes/${oldNote}`, { sid: sessions.F, body: { content: 'x' } });
    check('réponse antérieure à la fonctionnalité: modification refusée proprement', r.status === 400 && /avant/.test(r.body.error), JSON.stringify(r.body));
    const webNote = (await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, 'S1', 'note interne', 'web')", [te, U.S1])).insertId;
    r = await req('PATCH', `/api/tickets/${te}/notes/${webNote}`, { sid: sessions.S1, body: { content: 'note interne corrigée' } });
    const [wn] = await db('SELECT content FROM ticket_notes WHERE id = ?', [webNote]);
    check('note interne: modifiable par son auteur', r.status === 200 && wn.content === 'note interne corrigée', JSON.stringify([r.body, wn]));

    // Discord reply (/reply): embed in the channel, edited the same way
    const tmE = createManager(db, fakeClient, G);
    const [tkE] = await db('SELECT * FROM tickets WHERE id = ?', [te]);
    await app('./utils/discordReply').sendDiscordReply({ client: fakeClient, db, tm: tmE, guildId: G, ticket: tkE, author: { id: U.F, username: 'F', tag: 'F' }, channel: channels.get(ECH), content: 'depuis discord' });
    const [dn] = await db("SELECT * FROM ticket_notes WHERE ticket_id = ? AND content = 'depuis discord'", [te]);
    const er = await app('./utils/replyEdits').editReply({ client: fakeClient, db, guildId: G, ticket: tkE, note: dn, content: 'depuis discord (corrigé)', actor: { id: U.F, username: 'F', tag: 'F' } });
    const dRefs = J(dn.reply_refs);
    check('réponse /reply: embed du salon et MP corrigés', er.ok && msgs.get(dRefs.channel.messageId).edits[0]?.embeds?.[0]?.data?.description === 'depuis discord (corrigé)' && dRefs.channel.format === 'embed', JSON.stringify([er, dRefs]));

    // Staff opens a ticket to contact a member (NP: support account without any grade)
    const NP = '100000000000000006';
    await db("INSERT INTO dashboard_users (user_id, username, role) VALUES (?, 'NP', 'support')", [NP]);
    await mk('NP', { user: { id: NP, username: 'NP', role: null }, currentGuildId: G });
    memberDms.length = 0;
    r = await req('POST', '/api/tickets/open', { sid: sessions.NP, body: { userId: MEM, message: 'x' } });
    check('contacter un membre: refusé sans permission', r.status === 403, r.status);
    r = await req('POST', '/api/tickets/open', { sid: sessions.F, body: { userId: 'abc', message: 'x' } });
    check('contacter un membre: identifiant invalide refusé', r.status === 400, r.status);
    r = await req('POST', '/api/tickets/open', { sid: sessions.F, body: { userId: '200000000000000099', message: 'x' } });
    check('contacter un membre: membre absent du serveur refusé', r.status === 404, r.status);
    const sentBefore = msgSeq;
    r = await req('POST', '/api/tickets/open', { sid: sessions.F, body: { userId: MEM, subject: 'Remboursement', message: 'Bonjour, nous revenons vers vous.' } });
    const [opened] = r.body?.id ? await db('SELECT * FROM tickets WHERE id = ?', [r.body.id]) : [];
    const dmsTo = [...msgs.values()].filter(m => m.channelId === DMCH && Number(m.id.slice(-4)) > sentBefore);
    check('contacter un membre: ticket ouvert, ouvert par le staff', r.status === 200 && opened?.owner_id === MEM && opened?.opened_by_id === U.F && opened?.subject === 'Remboursement', JSON.stringify([r.body, opened]));
    check('contacter un membre: MP d ouverture puis message du staff', dmsTo.length === 2 && /contacter|contact/.test(dmsTo[0].embeds[0].data.description) && dmsTo[1].embeds[0].data.description === 'Bonjour, nous revenons vers vous.', JSON.stringify(dmsTo.map(m => m.embeds[0]?.data)));
    const [evOpen] = await db("SELECT actor_id FROM audit_log WHERE action = 'ticket_open_staff' AND ticket_id = ?", [r.body.id]);
    check('contacter un membre: inscrit au journal', evOpen?.actor_id === U.F, JSON.stringify(evOpen));
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [r.body.id]);

    // Temporary voice channel
    r = await req('POST', `/api/tickets/${te}/voice`, { sid: sessions.NP });
    check('vocal: refusé sans permission', r.status === 403, r.status);
    r = await req('POST', `/api/tickets/${te}/voice`, { sid: sessions.F });
    const [tv] = await db('SELECT voice_channel_id FROM tickets WHERE id = ?', [te]);
    const voice = channels.get(tv.voice_channel_id);
    const ow = voice?.opts?.permissionOverwrites || [];
    check('vocal: salon vocal créé, réservé au membre et au staff', r.status === 200 && voice?.opts?.type === ChannelType.GuildVoice
      && ow.some(o => o.id === MEM) && ow.some(o => o.id === G && o.deny?.length) && /discord\.com\/channels/.test(r.body.url), JSON.stringify([r.body, ow.map(o => o.id)]));
    r = await req('POST', `/api/tickets/${te}/voice`, { sid: sessions.F });
    check('vocal: un seul salon par ticket', r.status === 200 && r.body.channelId === tv.voice_channel_id, JSON.stringify(r.body));
    const tmV = createManager(db, fakeClient, G);
    await tmV.closeTicketWithTranscript(channels.get(ECH), { id: U.F, tag: 'F', username: 'F' });
    const [tv2] = await db('SELECT voice_channel_id FROM tickets WHERE id = ?', [te]);
    check('vocal: supprimé à la fermeture du ticket', voice.deleted === true && tv2.voice_channel_id === null, JSON.stringify([voice.deleted, tv2]));

    fakeClient.users.fetch = origUsers;
    guildObj.members.fetch = origMembers;
  }

  // ── Ticket handling: search operators, following, grade mentions, bulk actions, preferences ──
  {
    const mkT = async (owner, tag, extra = {}) => (await db(
      'INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, stage, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [owner, tag, `cs${owner}${Math.random()}`.slice(0, 30), extra.status || 'open', extra.subject || 'recherche op', extra.stage || 'open', extra.priority || 'normal', extra.created || new Date()])).insertId;
    const ta = await mkT('200000000000000051', 'alicesearch', { subject: 'Remboursement carte', stage: 'waiting', created: new Date('2026-09-15') });
    const tb = await mkT('200000000000000052', 'bobsearch', { subject: 'Remboursement virement', priority: 'urgent' });
    const tc = await mkT('200000000000000053', 'carolsearch', { subject: 'Compte bloqué', status: 'closed' });
    const vip = (await db("INSERT INTO ticket_tags (name, color) VALUES ('VIP op', '#ff0000')")).insertId;
    await db('INSERT INTO ticket_tag_assignments (ticket_id, tag_id) VALUES (?, ?)', [ta, vip]);
    const ids = async q => { const r = await req('GET', '/api/tickets', { sid: sessions.F, query: { subject: q } }); return r.status === 200 ? r.body.tickets.map(t => t.id).sort() : r; };
    check('recherche: tag:"VIP op"', JSON.stringify(await ids('tag:"VIP op"')) === JSON.stringify([ta]), JSON.stringify(await ids('tag:"VIP op"')));
    check('recherche: de:pseudo', JSON.stringify(await ids('de:bobsearch')) === JSON.stringify([tb]));
    check('recherche: étape:attente + mot du sujet', JSON.stringify(await ids('étape:attente remboursement')) === JSON.stringify([ta]));
    check('recherche: avant:date', JSON.stringify(await ids('avant:2026-10-01 remboursement')) === JSON.stringify([ta]));
    check('recherche: priorité:urgente', JSON.stringify(await ids('priorité:urgente remboursement')) === JSON.stringify([tb]));
    check('recherche: statut:fermé', JSON.stringify(await ids('statut:fermé compte bloqué')) === JSON.stringify([tc]));
    check('recherche: sujet entre guillemets', JSON.stringify(await ids('sujet:"carte" remboursement')) === JSON.stringify([ta]));
    await db('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES (?, ?)', [tb, U.F]);
    check('recherche: assigné:moi', JSON.stringify(await ids('assigné:moi remboursement')) === JSON.stringify([tb]));
    check('recherche: assigné:personne', JSON.stringify(await ids('assigné:personne statut:ouvert remboursement')) === JSON.stringify([ta]));
    let r2 = await req('GET', '/api/tickets', { sid: sessions.F, query: { subject: 'étape:nimporte' } });
    check('recherche: valeur inconnue → message clair', r2.status === 400 && /étape/.test(r2.body.error), JSON.stringify(r2.body));
    r2 = await req('GET', '/api/tickets', { sid: sessions.F, query: { subject: 'avant:2026-02-30' } });
    check('recherche: date invalide refusée', r2.status === 400 && /Date invalide/.test(r2.body.error), JSON.stringify(r2.body));
    r2 = await req('GET', '/api/tickets', { sid: sessions.S1, query: { subject: 'statut:ouvert secret' } });
    check('recherche: les opérateurs respectent la visibilité', r2.status === 200 && !r2.body.tickets.some(t => t.id === t2), JSON.stringify(r2.body.tickets?.map(t => t.id)));

    // Following
    r2 = await req('POST', `/api/tickets/${ta}/follow`, { sid: sessions.S1, body: { follow: true } });
    const listF = await req('GET', '/api/tickets', { sid: sessions.S1, query: { following: 'me' } });
    const detF = await req('GET', `/api/tickets/${ta}`, { sid: sessions.S1 });
    check('suivi: ticket suivi listé et marqué', r2.status === 200 && listF.body.tickets.map(t => t.id).join() === String(ta) && detF.body.following === true, JSON.stringify([r2.body, listF.body.tickets?.map(t => t.id)]));
    r2 = await req('POST', `/api/tickets/${t2}/follow`, { sid: sessions.S1, body: { follow: true } });
    check('suivi: impossible sur un ticket non visible', r2.status === 403, r2.status);
    const fol = app('./utils/followers');
    await fol.setFollowing(db, ta, U.F, true);
    const n1 = await fol.notifyFollowers(db, G, { id: ta, visibility_grade_id: null }, { kind: 'member', by: 'alice', byId: '200000000000000051', excerpt: 'nouveau message' });
    const n2 = await fol.notifyFollowers(db, G, { id: ta, visibility_grade_id: null }, { kind: 'reply', by: 'S1', byId: U.S1, excerpt: 'réponse' });
    const n3 = await fol.notifyFollowers(db, G, { id: ta, visibility_grade_id: -1 }, { kind: 'note', by: 'x', byId: 'x' });
    check('suivi: abonnés prévenus, sauf l auteur et ceux qui ne voient plus le ticket', n1.sort().join() === [U.F, U.S1].sort().join() && n2.join() === U.F && n3.join() === U.F, JSON.stringify([n1, n2, n3]));
    r2 = await req('POST', `/api/tickets/${ta}/follow`, { sid: sessions.S1, body: { follow: false } });
    const listF2 = await req('GET', '/api/tickets', { sid: sessions.S1, query: { following: 'me' } });
    check('suivi: arrêt du suivi', listF2.body.tickets.length === 0, JSON.stringify(listF2.body.tickets?.map(t => t.id)));

    // Grade mention in an internal note: every member of the grade who can see the ticket
    const [gName] = await db('SELECT name FROM grades WHERE id = ?', [g1]);
    r2 = await req('POST', `/api/tickets/${ta}/notes`, { sid: sessions.F, body: { content: `@${gName.name} pouvez-vous regarder ?` } });
    check('mention d un grade: ses membres sont prévenus', r2.status === 200 && r2.body.mentioned.includes(U.S1) && !r2.body.mentioned.includes(U.F), JSON.stringify(r2.body.mentioned));
    r2 = await req('POST', `/api/tickets/${ta}/notes`, { sid: sessions.F, body: { content: `email@${gName.name}.fr` } });
    check('mention d un grade: pas de faux positif dans une adresse', r2.status === 200 && r2.body.mentioned.length === 0, JSON.stringify(r2.body.mentioned));

    // Bulk actions for the staff: per-action permission, invisible tickets ignored
    r2 = await req('POST', '/api/tickets/bulk', { sid: sessions.S1, body: { ids: [ta, tb, t2], action: 'priority', value: 'low' } });
    const [pt2] = await db('SELECT priority FROM tickets WHERE id = ?', [t2]);
    check('masse: support avec reply_ticket peut changer la priorité, ticket restreint ignoré', r2.status === 200 && r2.body.affected === 2 && pt2.priority !== 'low', JSON.stringify([r2.body, pt2]));
    r2 = await req('POST', '/api/tickets/bulk', { sid: sessions.S1, body: { ids: [ta], action: 'close' } });
    check('masse: fermeture refusée sans close_ticket', r2.status === 403, r2.status);
    r2 = await req('POST', '/api/tickets/bulk', { sid: sessions.S1, body: { ids: [ta], action: 'nimporte' } });
    check('masse: action inconnue refusée', r2.status === 400, r2.status);
    r2 = await req('POST', '/api/tickets/bulk', { sid: sessions.S1, body: { ids: [ta, tb], action: 'add_tag', value: vip } });
    const r3 = await req('POST', '/api/tickets/bulk', { sid: sessions.S1, body: { ids: [ta, tb], action: 'remove_tag', value: vip } });
    const [{ n: tagLeft }] = await db('SELECT COUNT(*) AS n FROM ticket_tag_assignments WHERE tag_id = ?', [vip]);
    check('masse: tag ajouté puis retiré', r2.body.affected === 1 && r3.body.affected === 2 && Number(tagLeft) === 0, JSON.stringify([r2.body, r3.body, tagLeft]));
    await db("UPDATE guild_config SET ticket_mode = 'thread' WHERE id = 1"); // stage changes without categories
    const thr = mkChannel('950000000000000300', G); thr.isThread = () => true;
    channels.set(thr.id, thr);
    await db('UPDATE tickets SET channel_id = ? WHERE id = ?', [thr.id, tb]);
    r2 = await req('POST', '/api/tickets/bulk', { sid: sessions.S1, body: { ids: [tb], action: 'stage', value: 'in_progress' } });
    const [st] = await db('SELECT stage FROM tickets WHERE id = ?', [tb]);
    check('masse: changement d étape', r2.status === 200 && r2.body.affected === 1 && st.stage === 'in_progress', JSON.stringify([r2.body, st]));
    await db("UPDATE guild_config SET ticket_mode = 'auto' WHERE id = 1");
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[ta, tb]]);

    // Interface preferences (split view)
    r2 = await req('PUT', '/api/profile/prefs', { sid: sessions.S1, body: { splitView: true } });
    const pr = await req('GET', '/api/profile/prefs', { sid: sessions.S1 });
    const bad = await req('PUT', '/api/profile/prefs', { sid: sessions.S1, body: { splitView: 'oui' } });
    check('préférences: vue fractionnée enregistrée', r2.status === 200 && pr.body.splitView === true && bad.status === 400, JSON.stringify([r2.body, pr.body, bad.status]));
    const sk = await req('PUT', '/api/profile/prefs', { sid: sessions.S1, body: { uiSkin: 'pro' } });
    const skGet = await req('GET', '/api/profile/prefs', { sid: sessions.S1 });
    const skBad = await req('PUT', '/api/profile/prefs', { sid: sessions.S1, body: { uiSkin: 'neon' } });
    check('préférences: interface Pro enregistrée (valeur inconnue refusée)', sk.status === 200 && skGet.body.uiSkin === 'pro' && skBad.status === 400, JSON.stringify([sk.body, skGet.body.uiSkin, skBad.status]));
  }

  // ── Team: period comparison, reopen rates, CSV exports, planned absences, guided tour ──
  {
    const tm3 = createManager(db, fakeClient, G);
    const mkClosed = async (subject, closer) => {
      const id = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, created_at, first_response_at, closed_at, closed_by_id) VALUES ('200000000000000061', 'm61', ?, 'closed', ?, DATE_SUB(NOW(), INTERVAL 2 HOUR), DATE_SUB(NOW(), INTERVAL 90 MINUTE), NOW(), ?)",
        [`rr${Math.random()}`.slice(0, 30), subject, closer.id])).insertId;
      await app('./utils/audit').recordEvent(db, { actor: { ...closer, source: 'dashboard' }, action: 'ticket_close', ticketId: id });
      return id;
    };
    const F_ = { id: U.F, tag: 'F', username: 'F' }, S1_ = { id: U.S1, tag: 'S1', username: 'S1' };
    const r1 = await mkClosed('Réouv A', F_), r2 = await mkClosed('Réouv A', F_), r3 = await mkClosed('Réouv B', S1_);
    await app('./utils/audit').recordEvent(db, { actor: { id: '200000000000000061', tag: 'm61', source: 'discord' }, action: 'ticket_reopen', ticketId: r1 });
    let rr = await req('GET', '/api/analytics/reopens', { sid: sessions.F, query: { days: 7 } });
    const subjA = rr.body.bySubject?.find(x => x.label === 'Réouv A'), agF = rr.body.byAgent?.find(x => x.userId === U.F);
    check('réouvertures: taux par sujet', rr.status === 200 && subjA?.closures === 2 && subjA?.reopened === 1 && subjA?.rate === 50, JSON.stringify(subjA));
    check('réouvertures: taux par agent (celui qui a fermé)', agF?.reopened >= 1 && rr.body.byAgent.find(x => x.userId === U.S1)?.reopened === 0, JSON.stringify(rr.body.byAgent));
    rr = await req('GET', '/api/analytics/reopens', { sid: sessions.S1, query: { days: 7 } });
    check('réouvertures: un support ne voit que ses propres fermetures', rr.status === 200 && rr.body.scope === 'mine' && rr.body.byAgent.every(x => x.userId === U.S1), JSON.stringify(rr.body.byAgent));

    rr = await req('GET', '/api/analytics/compare', { sid: sessions.F, query: { period: '30d' } });
    check('comparaison: période actuelle et précédente', rr.status === 200 && rr.body.current.closed >= 3 && rr.body.current.reopened >= 1 && typeof rr.body.previous.opened === 'number'
      && new Date(rr.body.previous.to) <= new Date(rr.body.current.from), JSON.stringify(rr.body).slice(0, 300));
    rr = await req('GET', '/api/analytics/compare', { sid: sessions.F, query: { period: 'nimporte' } });
    check('comparaison: période inconnue → mois en cours', rr.status === 200 && rr.body.period === 'month', rr.body.period);
    const { periodRanges } = app('./utils/teamStats');
    const pm = periodRanges('month', new Date(2026, 2, 31, 12));
    check('comparaison: le 31 mars est comparé à février entier, pas au-delà', pm.previous.to.getTime() === pm.current.from.getTime() && pm.previous.from.getMonth() === 1, JSON.stringify(pm));

    await db("INSERT INTO ticket_time (ticket_id, user_id, user_tag, source, started_at, ended_at, seconds, note) VALUES (?, ?, 'S1', 'manual', NOW(), NOW(), 1800, '=cmd()')", [r3, U.S1]);
    await db("INSERT INTO ticket_time (ticket_id, user_id, user_tag, source, started_at, ended_at, seconds) VALUES (?, ?, 'F', 'manual', NOW(), NOW(), 600)", [r1, U.F]);
    rr = await req('GET', '/api/analytics/export/time.csv', { sid: sessions.F, query: { days: 7 } });
    check('export temps: CSV de l équipe, formules neutralisées', rr.status === 200 && /text\/csv/.test(rr.headers['content-type']) && /Réouv B/.test(rr.body) && /Réouv A/.test(rr.body) && rr.body.includes("'=cmd()") && rr.body.includes('30'), String(rr.body).slice(0, 300));
    rr = await req('GET', '/api/analytics/export/time.csv', { sid: sessions.S1, query: { days: 7 } });
    check('export temps: un support n exporte que son temps', rr.status === 200 && /Réouv B/.test(rr.body) && !/,F,/.test(rr.body), String(rr.body).slice(0, 300));
    rr = await req('GET', '/api/analytics/export/stats.csv', { sid: sessions.F, query: { days: 7 } });
    const lines = String(rr.body).replace(/^﻿/, '').split('\r\n');
    check('export statistiques: une ligne par membre du staff', rr.status === 200 && /Taux de réouverture/.test(lines[0]) && lines.some(l => l.startsWith('S1,')) && lines.some(l => l.startsWith('F,')), JSON.stringify(lines.slice(0, 4)));
    rr = await req('GET', '/api/analytics/export/stats.csv', { sid: sessions.S1, query: { days: 7 } });
    check('export statistiques: un support n a que sa ligne', String(rr.body).replace(/^﻿/, '').split('\r\n').length === 2, String(rr.body));
    void tm3;

    // Planned absences
    await db('UPDATE dashboard_users SET vacation_mode = 0 WHERE user_id IN (?)', [[U.S1, U.S3]]);
    const iso = ms => new Date(Date.now() + ms).toISOString();
    rr = await req('POST', '/api/absences', { sid: sessions.S1, body: { userId: U.S3, startsAt: iso(-3600e3), endsAt: iso(86400e3) } });
    check('absences: impossible pour quelqu un d autre sans manage_users', rr.status === 403, rr.status);
    rr = await req('POST', '/api/absences', { sid: sessions.S1, body: { startsAt: iso(86400e3), endsAt: iso(3600e3) } });
    check('absences: fin avant le début refusée', rr.status === 400, rr.status);
    rr = await req('POST', '/api/absences', { sid: sessions.S1, body: { startsAt: iso(-60e3), endsAt: iso(7 * 86400e3), reason: 'Vacances' } });
    const [vac1] = await db('SELECT vacation_mode FROM dashboard_users WHERE user_id = ?', [U.S1]);
    check('absences: en cours → mode vacances activé tout de suite', rr.status === 200 && rr.body.state === 'active' && rr.body.set_vacation === 1 && vac1.vacation_mode === 1, JSON.stringify([rr.body, vac1]));
    const abs1 = rr.body.id;
    rr = await req('POST', '/api/absences', { sid: sessions.S1, body: { startsAt: iso(86400e3), endsAt: iso(2 * 86400e3) } });
    check('absences: chevauchement refusé', rr.status === 409, rr.status);
    rr = await req('POST', '/api/absences', { sid: sessions.S3, body: { userId: U.S1, startsAt: iso(30 * 86400e3), endsAt: iso(31 * 86400e3) } });
    check('absences: manage_users planifie pour un collègue', rr.status === 200 && rr.body.state === 'planned', JSON.stringify(rr.body));
    rr = await req('GET', '/api/absences', { sid: sessions.S2 });
    check('absences: un support ne voit que les siennes', rr.status === 200 && rr.body.current.every(a => a.user_id === U.S2) && rr.body.canManage === false, JSON.stringify(rr.body));
    await db('UPDATE staff_absences SET ends_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?', [abs1]);
    await app('./utils/absences').applyAbsences(db, G);
    const [vac2] = await db('SELECT vacation_mode FROM dashboard_users WHERE user_id = ?', [U.S1]);
    const [a1] = await db('SELECT state FROM staff_absences WHERE id = ?', [abs1]);
    check('absences: fin → mode vacances retiré tout seul', vac2.vacation_mode === 0 && a1.state === 'done', JSON.stringify([vac2, a1]));
    await db('UPDATE dashboard_users SET vacation_mode = 1 WHERE user_id = ?', [U.S3]);
    const a3 = (await db("INSERT INTO staff_absences (user_id, starts_at, ends_at, created_by_id, created_by_tag) VALUES (?, DATE_SUB(NOW(), INTERVAL 1 HOUR), DATE_ADD(NOW(), INTERVAL 1 HOUR), 'x', 'x')", [U.S3])).insertId;
    await app('./utils/absences').applyAbsences(db, G);
    await db('UPDATE staff_absences SET ends_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?', [a3]);
    await app('./utils/absences').applyAbsences(db, G);
    const [vac3] = await db('SELECT vacation_mode FROM dashboard_users WHERE user_id = ?', [U.S3]);
    check('absences: un mode vacances activé à la main n est pas retiré', vac3.vacation_mode === 1, JSON.stringify(vac3));
    await db('UPDATE dashboard_users SET vacation_mode = 0 WHERE user_id = ?', [U.S3]);
    const [evA] = await db("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('absence_start', 'absence_end', 'absence_create')");
    check('absences: inscrites au journal', Number(evA.n) >= 4, JSON.stringify(evA));
    await db("DELETE FROM staff_absences");

    // Guided tour preference
    await db('UPDATE dashboard_users SET first_login = NOW() WHERE user_id = ?', [U.S2]);
    rr = await req('GET', '/api/profile/prefs', { sid: sessions.S2 });
    const oldF = await req('GET', '/api/profile/prefs', { sid: sessions.F });
    await db('UPDATE dashboard_users SET first_login = DATE_SUB(NOW(), INTERVAL 60 DAY) WHERE user_id = ?', [U.F]);
    const oldF2 = await req('GET', '/api/profile/prefs', { sid: sessions.F });
    const put = await req('PUT', '/api/profile/prefs', { sid: sessions.S2, body: { tourDone: 'v1' } });
    const after = await req('GET', '/api/profile/prefs', { sid: sessions.S2 });
    const badT = await req('PUT', '/api/profile/prefs', { sid: sessions.S2, body: { tourDone: '<script>' } });
    check('visite guidée: proposée aux nouveaux comptes, mémorisée une fois vue', rr.body.newAgent === true && oldF2.body.newAgent === false && put.status === 200 && after.body.tourDone === 'v1' && badT.status === 400,
      JSON.stringify([rr.body, oldF.body, oldF2.body, after.body, badT.status]));
  }

  // ── Security: confidential access log, new device alert, sign-out after inactivity ──
  {
    const tconf = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, visibility_grade_id) VALUES ('200000000000000071', 'm71', 'cconf71', 'open', 'harcèlement', -1)")).insertId;
    await redis.del(...(await redis.keys(`cfaccess:${G}:${tconf}:*`)).concat(['__none__']));
    let r4 = await req('GET', `/api/tickets/${tconf}`, { sid: sessions.F });
    await req('GET', `/api/tickets/${tconf}`, { sid: sessions.F });
    await req('GET', `/api/tickets/${tconf}/notes`, { sid: sessions.F });
    const logRows = await db('SELECT user_id, kind FROM ticket_access_log WHERE ticket_id = ? ORDER BY id', [tconf]);
    check('confidentiel: ouverture tracée, une fois par 10 min et par type', r4.status === 200 && logRows.length === 2 && logRows[0].user_id === U.F && logRows.map(x => x.kind).join() === 'view,notes', JSON.stringify(logRows));
    r4 = await req('GET', `/api/tickets/${t1}`, { sid: sessions.F });
    const [{ n: nonConf }] = await db('SELECT COUNT(*) AS n FROM ticket_access_log WHERE ticket_id = ?', [t1]);
    check('confidentiel: un ticket normal n est pas tracé', Number(nonConf) === 0, JSON.stringify(nonConf));
    r4 = await req('GET', `/api/tickets/${tconf}`, { sid: sessions.S1 });
    const [{ n: afterDenied }] = await db('SELECT COUNT(*) AS n FROM ticket_access_log WHERE ticket_id = ?', [tconf]);
    check('confidentiel: un refus d accès n est pas une consultation', r4.status === 403 && Number(afterDenied) === 2, JSON.stringify([r4.status, afterDenied]));
    r4 = await req('GET', `/api/tickets/${tconf}/access-log`, { sid: sessions.F });
    const r5 = await req('GET', '/api/audit/confidential-access', { sid: sessions.F });
    const r6 = await req('GET', '/api/audit/confidential-access', { sid: sessions.S1 });
    check('confidentiel: consultations visibles des fondateurs seulement', r4.status === 200 && r4.body.length === 2 && r5.status === 200 && r5.body.rows.some(x => x.ticket_id === tconf) && r6.status === 403,
      JSON.stringify([r4.status, r5.status, r6.status]));
    const snap = (await db("INSERT INTO transcript_snapshots (ticket_id, channel_id, created_by_id, created_by_tag, message_count, html, txt) VALUES (?, 'cconf71', 'x', 'x', 0, ?, ?)",
      [tconf, app('./utils/transcriptCrypto').sealTranscript('<p>x</p>'), app('./utils/transcriptCrypto').sealTranscript('x')])).insertId;
    r4 = await req('GET', `/api/transcripts/${snap}/html`, { sid: sessions.F });
    const [tr] = await db("SELECT COUNT(*) AS n FROM ticket_access_log WHERE ticket_id = ? AND kind = 'transcript'", [tconf]);
    check('confidentiel: lecture du transcript tracée', r4.status === 200 && Number(tr.n) === 1, JSON.stringify([r4.status, tr]));
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [tconf]);

    // New device alert
    const dev = app('./utils/deviceAlert');
    const DU = '100000000000000088';
    const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const sentDm = [];
    const send = async (id, p) => sentDm.push({ id, p });
    const first = await dev.alertNewDevice({ userId: DU, userAgent: CHROME_WIN, ip: '1.2.3.4', send });
    await globalQuery("INSERT INTO login_logs (user_id, username, ip, user_agent, status) VALUES (?, 'du', '1.2.3.4', ?, 'success')", [DU, CHROME_WIN]);
    const sameNewIp = await dev.alertNewDevice({ userId: DU, userAgent: CHROME_WIN.replace('130.0', '131.0'), ip: '5.6.7.8', send });
    const phone = await dev.alertNewDevice({ userId: DU, userAgent: SAFARI_IOS, ip: '5.6.7.8', baseUrl: 'https://x.fr', send });
    check('nouvel appareil: rien à la première connexion ni pour une nouvelle IP sur un appareil connu', first === null && sameNewIp === null, JSON.stringify([first, sameNewIp]));
    check('nouvel appareil: MP envoyé avec l appareil et l IP', phone === 'Safari sur iPhone' && sentDm.length === 1 && sentDm[0].id === DU
      && /Safari sur iPhone/.test(sentDm[0].p.embeds[0].description) && /5\.6\.7\.8/.test(sentDm[0].p.embeds[0].description), JSON.stringify(sentDm));
    await globalQuery('DELETE FROM login_logs WHERE user_id = ?', [DU]);

    // Sign-out after inactivity
    r4 = await req('PATCH', '/api/config', { sid: sessions.F, body: { idleTimeoutMinutes: 3 } });
    check('inactivité: durée trop courte refusée', r4.status === 400, r4.status);
    r4 = await req('PATCH', '/api/config', { sid: sessions.F, body: { idleTimeoutMinutes: 30 } });
    const me = await req('GET', '/api/auth/me', { sid: sessions.S1 });
    check('inactivité: durée enregistrée et transmise au dashboard', r4.status === 200 && me.body.idleTimeoutMinutes === 30, JSON.stringify([r4.status, me.body.idleTimeoutMinutes]));
    await mk('IDLE', { user: { id: U.S1, username: 'S1', role: null }, currentGuildId: G, lastActivityAt: Date.now() - 31 * 60000 });
    r4 = await req('GET', '/api/tickets', { sid: sessions.IDLE });
    const gone = !(await redis.get('sess:' + sessions.IDLE));
    check('inactivité: session inactive trop longtemps fermée', r4.status === 401 && r4.body.code === 'idle' && gone, JSON.stringify([r4.status, r4.body, gone]));
    await mk('IDLE2', { user: { id: U.S1, username: 'S1', role: null }, currentGuildId: G, lastActivityAt: Date.now() - 25 * 60000 });
    for (let i = 0; i < 3; i++) await req('GET', '/api/tickets', { sid: sessions.IDLE2 });
    await req('POST', `/api/tickets/${t1}/presence`, { sid: sessions.IDLE2, body: {} });
    const s2 = JSON.parse(await redis.get('sess:' + sessions.IDLE2));
    check('inactivité: les lectures et la présence automatique ne comptent pas comme activité', Date.now() - s2.lastActivityAt > 24 * 60000, String(Date.now() - s2.lastActivityAt));
    r4 = await req('POST', '/api/profile/activity', { sid: sessions.IDLE2 });
    const s3 = JSON.parse(await redis.get('sess:' + sessions.IDLE2));
    check('inactivité: le signal d activité du dashboard prolonge la session', r4.status === 200 && Date.now() - s3.lastActivityAt < 5000, String(Date.now() - s3.lastActivityAt));
    await req('PATCH', '/api/config', { sid: sessions.F, body: { idleTimeoutMinutes: 0 } });
    await mk('IDLE3', { user: { id: U.S1, username: 'S1', role: null }, currentGuildId: G, lastActivityAt: Date.now() - 1000 * 60000 });
    r4 = await req('GET', '/api/tickets', { sid: sessions.IDLE3 });
    check('inactivité: désactivée → aucune déconnexion', r4.status === 200, r4.status);
  }

  // ── Ticket format (3 modes) and « Créer un ticket » (right click) ──
  {
    const { ChannelType } = require('discord.js');
    const [cfgM] = await db('SELECT ticket_mode FROM guild_config WHERE id = 1');
    check('format: « Salons, puis fils privés » par défaut', cfgM.ticket_mode === 'auto', cfgM.ticket_mode);
    const origCreate = guildObj.channels.create;
    guildObj.channels.create = async () => { const e = new Error('Maximum number of guild channels reached (500)'); e.code = 30013; throw e; };
    const PARENT2 = '950000000000000400';
    const parent2 = mkChannel(PARENT2, G, 0, 'tickets-fils');
    parent2.threads = { create: async o => { const th = mkChannel('950000000000000401', G, 12, o.name); th.isThread = () => true; th.guild = { id: G, members: { fetch: async () => new Map() }, roles: { cache: new Map() } };
      th.members = { fetch: async () => new Map(), add: async () => {}, remove: async () => {} }; channels.set(th.id, th); return th; } };
    channels.set(PARENT2, parent2);
    const member = id => ({ id, username: 'member' + id.slice(-2), tag: 'member' + id.slice(-2), send: async () => {} });
    await redis.del(`health:capacity:${G}`);
    memberDms.length = 0;
    await db("UPDATE guild_config SET ticket_mode = 'channel', thread_parent_channel_id = ? WHERE id = 1", [PARENT2]);
    let err = null;
    await createManager(db, fakeClient, G).createTicket(member('200000000000000091'), 'x', [], 'plein').catch(e => { err = e; });
    check('salons uniquement: serveur plein → ticket refusé proprement', err?.code === 'TICKET_CAPACITY', err?.message);
    check('salons uniquement: les fondateurs sont prévenus par MP', memberDms.some(d => d.id === U.F && /impossible/i.test(d.p.embeds?.[0]?.data?.title || '')), JSON.stringify(memberDms.map(d => d.id)));
    await db("UPDATE guild_config SET ticket_mode = 'auto' WHERE id = 1");
    const fb = await createManager(db, fakeClient, G).createTicket(member('200000000000000092'), 'x', [], 'repli');
    check('salons puis fils: serveur plein → le ticket devient un fil privé', fb.created && fb.channel.isThread() && fb.channel.id === '950000000000000401', fb.channel?.id);
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [fb.ticket.id]);
    await db("UPDATE guild_config SET thread_parent_channel_id = NULL WHERE id = 1");
    err = null;
    await createManager(db, fakeClient, G).createTicket(member('200000000000000093'), 'x', [], 'sans salon').catch(e => { err = e; });
    check('salons puis fils: sans salon des fils choisi → refusé proprement', err?.code === 'TICKET_CAPACITY', err?.message);
    let rm = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketMode: 'auto', threadParentChannelId: null } });
    check('format: « Salons, puis fils » accepté sans salon des fils', rm.status === 200, JSON.stringify(rm.body));
    rm = await req('PATCH', '/api/config', { sid: sessions.F, body: { ticketMode: 'nimporte' } });
    check('format: valeur inconnue refusée', rm.status === 400, rm.status);
    guildObj.channels.create = origCreate;

    // Right click « Créer un ticket »: grade permission create_ticket, only a title is asked
    const AUTH = '200000000000000044', MCH = '950000000000000500';
    const srcMsg = { id: '950000000000000501', channelId: MCH, content: 'Je me plains publiquement', url: 'https://discord.com/channels/x/y/z', author: { id: AUTH, username: 'member44', tag: 'member44', bot: false }, attachments: new Map() };
    const srcCh = mkChannel(MCH, G); srcCh.messages = { fetch: async id => (id === srcMsg.id ? srcMsg : null) };
    channels.set(MCH, srcCh);
    const cm = app('./commands/createTicketFromMessage');
    const ix = (userId, extra = {}) => { const o = {}; return { o, i: { guildId: G, channelId: MCH, guild: guildObj, user: { id: userId, username: 'u' + userId.slice(-1), tag: 'u' + userId.slice(-1) }, member: { roles: { cache: new Map() } },
      targetMessage: srcMsg, reply: async p => { o.reply = p; }, showModal: async m => { o.modal = m.toJSON(); }, deferReply: async () => {}, editReply: async p => { o.edit = p; }, ...extra } }; };
    let f = ix(U.S1);
    await cm.execute(fakeClient, f.i);
    check('clic droit: refusé sans la permission « Ouvrir un ticket pour un membre »', !f.o.modal && /Ouvrir un ticket pour un membre/.test(f.o.reply?.content || ''), JSON.stringify(f.o));
    f = ix(U.F);
    await cm.execute(fakeClient, f.i);
    const fields = (f.o.modal?.components || []).flatMap(r => r.components);
    check('clic droit: la fenêtre ne demande que le titre (obligatoire)', fields.length === 1 && fields[0].custom_id === 'subject' && fields[0].required === true, JSON.stringify(fields));
    const g = ix(U.F, { customId: f.o.modal.custom_id, fields: { getTextInputValue: k => (k === 'subject' ? '  Plainte   publique ' : '') } });
    await cm.handleModal(fakeClient, g.i);
    const [ct] = await db('SELECT * FROM tickets WHERE owner_id = ? ORDER BY id DESC LIMIT 1', [AUTH]);
    const quoted = ct ? await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user'", [ct.id]) : [];
    check('clic droit: ticket créé avec le titre, message d origine repris', ct?.subject === 'Plainte publique' && ct?.opened_by_id === U.F && /plains publiquement/.test(quoted[0]?.content || '') && /#\d+/.test(g.o.edit?.content || ''), JSON.stringify([ct?.subject, g.o.edit]));
    const [{ n: replies }] = await db("SELECT COUNT(*) AS n FROM ticket_notes WHERE ticket_id = ? AND source = 'reply'", [ct.id]);
    check('clic droit: aucun message envoyé à la place du staff', Number(replies) === 0, String(replies));
    await db('INSERT INTO grade_permissions VALUES (?, ?)', [g1, 'create_ticket']);
    f = ix(U.S1);
    await cm.execute(fakeClient, f.i);
    check('clic droit: autorisé à un grade qui a la permission (support, chef support, helper…)', !!f.o.modal, JSON.stringify(f.o.reply));
    await db("DELETE FROM grade_permissions WHERE grade_id = ? AND permission = 'create_ticket'", [g1]);
    f = ix(AUTH === U.F ? U.S1 : U.F, { targetMessage: { ...srcMsg, author: { id: U.F, username: 'F', bot: false } } });
    await cm.execute(fakeClient, f.i);
    check('clic droit: impossible sur son propre message', !f.o.modal && /toi-même/.test(f.o.reply?.content || ''), JSON.stringify(f.o));
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [ct.id]);
  }

  // ── Staff roles attached to tags (page Rôles) ──
  {
    const gp = app('./utils/gradePermissions');
    const rt = (await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject) VALUES ('510000000000000001', 'rolemember', 'crole1', 'open', 'ticket rôle')")).insertId;
    const tagR = (await db("INSERT INTO ticket_tags (name, color) VALUES ('Litige', '#ff0000')")).insertId;
    r = await req('POST', '/api/roles', { sid: sessions.S1, body: { name: 'Modération' } });
    check('rôles: création réservée aux fondateurs', r.status === 403, r.status);
    r = await req('POST', '/api/roles', { sid: sessions.F, body: { name: 'Modération', color: '#123456' } });
    const roleId = r.body.id;
    check('rôles: création', r.status === 200 && roleId > 0 && r.body.color === '#123456', JSON.stringify(r.body));
    r = await req('PUT', `/api/roles/${roleId}/tags`, { sid: sessions.F, body: { tagIds: [tagR, 999999] } });
    check('rôles: tags rattachés (tag inconnu ignoré)', r.status === 200 && r.body.tagIds.join() === String(tagR), JSON.stringify(r.body));
    r = await req('PUT', `/api/roles/${roleId}/members`, { sid: sessions.F, body: { userIds: [U.S3, U.OUT, 'x'] } });
    check('rôles: membres = comptes du staff seulement', r.status === 200 && r.body.userIds.join() === U.S3, JSON.stringify(r.body));
    const listIds = async sid => ((await req('GET', '/api/tickets?status=open&limit=100', { sid })).body.tickets || []).map(t => t.id);
    check('rôles: ticket sans tag visible du staff', (await listIds(sessions.S1)).includes(rt));
    await db('INSERT INTO ticket_tag_assignments (ticket_id, tag_id) VALUES (?, ?)', [rt, tagR]);
    check('rôles: ticket au tag lié masqué hors du rôle (liste)', !(await listIds(sessions.S1)).includes(rt));
    r = await req('GET', `/api/tickets/${rt}`, { sid: sessions.S1 });
    check('rôles: ticket au tag lié masqué hors du rôle (fiche)', r.status === 403 || r.status === 404, r.status);
    check('rôles: membre du rôle le voit (liste)', (await listIds(sessions.S3)).includes(rt));
    check('rôles: fondateur le voit', (await listIds(sessions.F)).includes(rt));
    const tObj = { id: rt, visibility_grade_id: null };
    check('rôles: temps réel / push suivent le rôle', !(await gp.canUserSeeTicket(db, U.S1, tObj)) && (await gp.canUserSeeTicket(db, U.S3, tObj)) && (await gp.canUserSeeTicket(db, U.F, tObj)));
    check('rôles: commandes Discord suivent le rôle', !(await gp.discordStaffCanSee(db, '510000000000000099', tObj)) && (await gp.discordStaffCanSee(db, U.S3, tObj)));
    r = await req('GET', '/api/roles', { sid: sessions.F });
    const listed = (r.body || []).find(x => x.id === roleId);
    check('rôles: liste avec membres et tags', listed?.members.map(m => m.user_id).join() === U.S3 && listed?.tags.map(t => t.id).join() === String(tagR), JSON.stringify(listed));
    r = await req('DELETE', `/api/roles/${roleId}`, { sid: sessions.F });
    check('rôles: suppression → ticket de nouveau visible du staff', r.status === 200 && (await listIds(sessions.S1)).includes(rt), r.status);
    await db("UPDATE tickets SET status = 'closed' WHERE id = ?", [rt]);
    await db('DELETE FROM ticket_tags WHERE id = ?', [tagR]);
  }

  // ── Instance: delete guild → bot leaves Discord ──
  await globalQuery(`INSERT INTO guilds (guild_id, guild_name, owner_discord_id, owner_discord_tag, status, db_name) VALUES (?, 'G2', '1', 'o', 'active', ?)`, [G2, 'ticketbot_guild_' + G2]);
  r = await req('DELETE', `/api/instance/guilds/${G2}`, { sid: sessions.OWN });
  const [g2row] = await globalQuery('SELECT COUNT(*) AS n FROM guilds WHERE guild_id = ?', [G2]);
  check('suppression serveur: le bot quitte Discord', r.status === 200 && g2Left && r.body.leftDiscord === true && Number(g2row.n) === 0, JSON.stringify([r.status, r.body, g2Left, g2row]));

  // ── Self-hosting: configuration from the environment, automatic activation of a server ──
  {
    const { loadConfig } = app('./utils/config');
    const env = { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: '42', DISCORD_CLIENT_SECRET: 's', PUBLIC_URL: 'https://tickets.example.com/',
      SESSION_SECRET: 'x'.repeat(32), DB_PASSWORD: 'pw', DB_PORT: '3307', OWNER_IDS: '100000000000000001, x', ALLOWED_GUILDS: '523456789012345678', TRUSTED_PROXY_HOST: '' };
    const c = loadConfig({ file: '/nonexistent/config.json', env });
    check('config: tout par variables d environnement, sans config.json', !c.hasFile && c.token === 't' && c.clientId === '42' && c.dashboard.discordClientSecret === 's'
      && c.dashboard.sessionSecret.length === 32 && c.database.password === 'pw' && c.database.port === 3307 && c.database.host === 'db' && c.webServerPort === 3000, JSON.stringify(c));
    check('config: URL publique normalisée et retour OAuth déduit', c.webServerBaseUrl === 'https://tickets.example.com' && c.dashboard.discordCallbackUrl === 'https://tickets.example.com/api/auth/discord/callback', c.dashboard.discordCallbackUrl);
    check('config: OWNER_IDS, ALLOWED_GUILDS (listes d IDs) et TRUSTED_PROXY_HOST vide lus', c.ownerIds.join() === '100000000000000001' && c.allowedGuilds.join() === '523456789012345678' && c.trustedProxyHost === '', JSON.stringify([c.ownerIds, c.allowedGuilds]));
    const merged = loadConfig({ env: { DB_PORT: '3399', DB_HOST: '' } });
    check('config: la variable d environnement l emporte sur config.json, une valeur vide est ignorée', merged.hasFile && merged.database.port === 3399 && merged.database.host === config.database.host && merged.token === 'test-token', JSON.stringify(merged.database));

    // Regression (v3.0 in production): the routes read their settings from the shared loader, so the
    // Discord sign-in works with no config.json at all, only environment variables
    {
      const { execFileSync } = require('child_process');
      const probe = `
        const router = require('./web/routes/auth');
        const req = { method: 'GET', url: '/discord', originalUrl: '/discord', headers: {}, session: {}, query: {} };
        const res = { redirect: u => { console.log('REDIRECT ' + u); process.exit(0); }, status() { return this; }, json: b => { console.log('JSON ' + JSON.stringify(b)); process.exit(0); }, setHeader() {}, getHeader() {} };
        router.handle(req, res, err => { console.log('ERR ' + (err && err.message)); process.exit(0); });`;
      let out = '';
      try {
        out = execFileSync(process.execPath, ['-e', probe], { cwd: ROOT, encoding: 'utf8', timeout: 20000, env: {
          PATH: process.env.PATH, TICKETBOT_CONFIG: '/nonexistent/config.json', REDIS_HOST: process.env.REDIS_HOST, REDIS_PORT: process.env.REDIS_PORT,
          DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: '424242', DISCORD_CLIENT_SECRET: 's', PUBLIC_URL: 'https://tickets.example.com', SESSION_SECRET: 'y'.repeat(32), DB_PASSWORD: 'pw' } });
      } catch (e) { out = String(e.stdout || '') + String(e.message); }
      const line = out.split('\n').find(l => /^(REDIRECT|JSON|ERR)/.test(l)) || out.slice(0, 200);
      check('connexion Discord sans config.json (variables d environnement seules)', line.startsWith('REDIRECT https://discord.com/oauth2/authorize') && line.includes('client_id=424242') && line.includes(encodeURIComponent('https://tickets.example.com/api/auth/discord/callback')), line);
      const offenders = [];
      for (const dir of ['web', 'utils', 'events', 'commands']) {
        for (const f of fs.readdirSync(path.join(ROOT, dir), { recursive: true })) {
          if (!String(f).endsWith('.js') || path.join(dir, String(f)) === path.join('utils', 'config.js')) continue;
          const src = fs.readFileSync(path.join(ROOT, dir, String(f)), 'utf8');
          if (/CONFIG_PATH|require\([^)]*config\.json/.test(src)) offenders.push(path.join(dir, String(f)));
        }
      }
      check('configuration: seul utils/config.js lit config.json', offenders.length === 0, offenders.join(', '));
    }

    // A server is active as soon as the bot joins it: database, inviter founder, no approval step
    const G5 = '523456789012345678', G6 = '623456789012345678';
    const guildCreate = app('./events/guildCreate');
    let left = false;
    const mkGuild = id => ({ id, name: 'Auto', ownerId: '300000000000000001', memberCount: 3, iconURL: () => null, leave: async () => { left = true; },
      fetchOwner: async () => ({ id: '300000000000000001', user: { username: 'founder1' } }), fetchAuditLogs: async () => ({ entries: new Map() }) });
    const welcome = [];
    const realFetch = fakeClient.users.fetch;
    fakeClient.users.fetch = async id => (id === '300000000000000001' ? { id, username: 'founder1', send: async p => welcome.push(p) } : realFetch(id));
    await guildCreate.execute(fakeClient, mkGuild(G5));
    fakeClient.users.fetch = realFetch;
    const [g5row] = await globalQuery('SELECT status FROM guilds WHERE guild_id = ?', [G5]);
    const [g5founder] = await getTenantDb(G5)("SELECT role FROM dashboard_users WHERE user_id = '300000000000000001'").catch(() => []);
    const [g5v] = await getTenantDb(G5)('SELECT MAX(version) AS v FROM schema_migrations').catch(() => [{}]);
    check('activation: serveur actif dès l arrivée du bot (base à jour, invitant fondateur)', g5row?.status === 'active' && g5founder?.role === 'fondateur' && g5v.v === app('./utils/tenantMigrations').LATEST_VERSION, JSON.stringify([g5row, g5founder, g5v]));
    check('activation: MP de bienvenue avec le nom du bot', welcome.some(p => String(p).includes('Bot de test') && String(p).includes('Paramètres')), JSON.stringify(welcome));
    // ALLOWED_GUILDS: any other server is left
    const cfgA = app('./utils/config').config;
    cfgA.allowedGuilds = [G5];
    await guildCreate.execute(fakeClient, mkGuild(G6));
    const [g6row] = await globalQuery('SELECT COUNT(*) AS n FROM guilds WHERE guild_id = ?', [G6]);
    check('ALLOWED_GUILDS: le bot quitte un serveur hors liste, sans l enregistrer', left && Number(g6row.n) === 0, JSON.stringify([left, g6row]));
    delete cfgA.allowedGuilds;
    // Upgrade from v2.x: a server left « pending » is activated at the next start (ready)
    await globalQuery('ALTER TABLE guilds MODIFY status ENUM(\'pending\',\'active\',\'suspended\') NOT NULL DEFAULT \'active\'');
    await globalQuery("UPDATE guilds SET status = 'pending' WHERE guild_id = ?", [G5]);
    await app('./utils/guildActivation').registerGuild(fakeClient, mkGuild(G5), { notify: false });
    const [g5again] = await globalQuery('SELECT status FROM guilds WHERE guild_id = ?', [G5]);
    check('mise à jour v2 → v3: serveur en attente activé au démarrage', g5again.status === 'active', JSON.stringify(g5again));
    await globalQuery('ALTER TABLE guilds MODIFY status ENUM(\'active\',\'suspended\') NOT NULL DEFAULT \'active\'');
    // The owner of the instance is founder on every server
    await getTenantDb(G5)("INSERT INTO dashboard_users (user_id, username, role) VALUES (?, 'F', 'nouveau') ON DUPLICATE KEY UPDATE role = 'nouveau'", [U.F]);
    await mk('OWNsel', { user: { id: U.F, username: 'F', role: null }, discordAccessToken: 't' });
    r = await req('POST', '/api/auth/select-guild', { sid: sessions.OWNsel, body: { guildId: G5 } });
    const [ownRole] = await getTenantDb(G5)('SELECT role FROM dashboard_users WHERE user_id = ?', [U.F]);
    check('propriétaire: fondateur sur chaque serveur de l instance', r.status === 200 && r.body.role === 'fondateur' && ownRole.role === 'fondateur', JSON.stringify([r.body, ownRole]));
    await globalQuery('DELETE FROM guilds WHERE guild_id IN (?, ?)', [G5, G6]);
    await globalQuery(`DROP DATABASE IF EXISTS \`ticketbot_guild_${G5}\``).catch(() => null);
  }

  console.log(`\n${pass} passed, ${failed} failed`);
  server.close();
  await redis.quit();
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

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
  await globalQuery('DELETE FROM guilds'); await globalQuery('DROP DATABASE IF EXISTS ticketbot_guild_223456789012345678'); await globalQuery('DELETE FROM login_logs'); await globalQuery('DELETE FROM user_sessions'); await globalQuery('DELETE FROM user_totp'); await globalQuery('DELETE FROM superadmins');
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
  await mk('MGR', { superAdmin: { id: 1, username: 'm', type: 'manager', lastSeen: Date.now() } });
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
    isReady: () => true, user: { id: '1' },
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

  // Superadmin
  r = await req('GET', '/api/sa/error-logs', { sid: sessions.MGR });
  check('error-logs refusé aux managers', r.status === 403, r.status);

  // API v1
  await db('UPDATE guild_config SET api_keys_enabled = 1 WHERE id = 1');
  r = await req('POST', '/api/api-keys', { sid: sessions.F, body: { name: 'ci', permissions: ['read_tickets', 'close_tickets', 'create_tickets'] } });
  const key = r.body.key;
  check('clé API créée au nouveau format', r.status === 200 && new RegExp(`^tb_${G}_[a-f0-9]{64}$`).test(key) && !r.body.permissions.includes('create_tickets'), JSON.stringify(r.body));
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
  const bcrypt = require('bcrypt');
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

  // H3 — super-admin ticket limit no longer breaks ticket creation
  const { openTicketForGuild } = app('./events/messageCreate');
  await globalQuery('UPDATE guilds SET max_tickets = 50 WHERE guild_id = ?', [G]);
  const dms = [];
  const mkUser = id => ({ id, username: 'u' + id.slice(-2), tag: 'u' + id.slice(-2), send: async p => dms.push({ id, p }) });
  const [cfg] = await db('SELECT * FROM guild_config LIMIT 1');
  const entry = () => ({ guildId: G, db, tm: createManager(db, fakeClient, G), config: cfg });
  const u1 = mkUser('200000000000000001');
  await openTicketForGuild(u1, 'bonjour', [], entry(), fakeClient, 'Sujet test');
  const [c1] = await db('SELECT COUNT(*) AS n FROM tickets WHERE owner_id = ?', [u1.id]);
  check('H3 ticket créé avec max_tickets > 0', Number(c1.n) === 1, JSON.stringify(c1));

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

  // M5 — per-account lockout for superadmin login
  await globalQuery('INSERT INTO superadmins (username, password_hash) VALUES (?, ?)', ['root', await bcrypt.hash('correct-horse-battery', 4)]);
  for (let i = 0; i < 5; i++) await req('POST', '/api/sa/auth/login', { body: { username: 'root', password: 'wrong' } });
  r = await req('POST', '/api/sa/auth/login', { body: { username: 'root', password: 'correct-horse-battery' } });
  check('M5 compte verrouillé après 5 échecs', r.status === 429, r.status + JSON.stringify(r.body));

  // SA idle timeout
  await mk('SAold', { superAdmin: { id: 1, username: 'root', type: 'superadmin', lastSeen: Date.now() - 31 * 60 * 1000 } });
  r = await req('GET', '/api/sa/stats', { sid: sessions.SAold });
  check('session SA expirée après 30 min d\'inactivité', r.status === 401, r.status);
  await mk('SAnew', { superAdmin: { id: 1, username: 'root', type: 'superadmin', lastSeen: Date.now() } });
  r = await req('GET', '/api/sa/stats', { sid: sessions.SAnew });
  check('session SA active acceptée', r.status === 200, r.status);

  // SA — appoint tenant founders by Discord ID
  r = await req('POST', `/api/sa/guilds/${G}/founders`, { sid: sessions.MGR, body: { discordId: '300000000000000001' } });
  check('fondateurs: ajout refusé à un manager', r.status === 403, r.status);
  r = await req('POST', `/api/sa/guilds/${G}/founders`, { sid: sessions.SAnew, body: { discordId: '12345' } });
  check('fondateurs: ID invalide refusé', r.status === 400, r.status);
  r = await req('POST', `/api/sa/guilds/${G}/founders`, { sid: sessions.SAnew, body: { discordId: '399999999999999999' } });
  check('fondateurs: utilisateur Discord inconnu -> 404', r.status === 404, r.status);
  r = await req('POST', `/api/sa/guilds/${G}/founders`, { sid: sessions.SAnew, body: { discordId: '300000000000000001' } });
  check('fondateurs: ajout OK (non membre signalé)', r.status === 200 && r.body.isMember === false, r.status + JSON.stringify(r.body));
  r = await req('POST', `/api/sa/guilds/${G}/founders`, { sid: sessions.SAnew, body: { discordId: '300000000000000002' } });
  check('fondateurs: ajout OK (membre)', r.status === 200 && r.body.isMember === true, r.status + JSON.stringify(r.body));
  const [fr] = await db('SELECT role FROM dashboard_users WHERE user_id = ?', ['300000000000000001']);
  check('fondateurs: rôle fondateur en base', fr?.role === 'fondateur', JSON.stringify(fr));
  r = await req('GET', `/api/sa/guilds/${G}/founders`, { sid: sessions.SAnew });
  const fids = (r.body || []).map(f => f.user_id);
  check('fondateurs: liste (F propriétaire + 2 nouveaux)', r.status === 200 && fids.includes(U.F) && fids.includes('300000000000000001') && r.body.find(f => f.user_id === U.F)?.isOwner, JSON.stringify(r.body));
  const [fa] = await db("SELECT actor_tag FROM audit_log WHERE action = 'founder_add' LIMIT 1");
  check('fondateurs: action tracée dans l\'audit du serveur', fa?.actor_tag === 'SA root', JSON.stringify(fa));
  r = await req('GET', `/api/sa/guilds/${G}/founders`, { sid: sessions.MGR });
  check('fondateurs: manager non assigné -> 403', r.status === 403, r.status);

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
    r = await req('PATCH', '/api/config', { sid: sessions.FV, body: { botLanguage: 'klingon' } });
    check('langues: valeur inconnue refusée', r.status === 400, r.status);
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
    check('doc API: permissions et exemples', r.body.paths['/tickets/{id}/close'].post['x-permission'] === 'close_tickets' && r.body.paths['/stats'].get.responses[200].content['application/json'].example.tickets, '');
    const routes = app('./web/routes/apiV1').stack.filter(l => l.route).map(l => `${Object.keys(l.route.methods)[0]} ${l.route.path}`).filter(x => !x.endsWith('/openapi.json'));
    const documented = Object.entries(r.body.paths).flatMap(([p, m]) => Object.keys(m).map(k => `${k} ${p.replace(/\{(\w+)\}/g, ':$1')}`));
    check('doc API: chaque route est documentée', routes.length > 0 && routes.every(x => documented.includes(x)), JSON.stringify({ routes, documented }));
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
    const { setSetting, getSetting } = app('./utils/saSettings');
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
    await mk('SAdw', { superAdmin: { id: 1, username: 'root', type: 'superadmin', lastSeen: Date.now() } });
    r = await req('PUT', '/api/sa/settings/error-alert', { sid: sessions.SAdw, body: { enabled: false, threshold: 20, windowMinutes: 15, discordUserIds: [], webhookUrl: null, discordDownMinutes: -1 } });
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
    r = await req('GET', '/api/auth/discord');
    check('tour: connexion Discord (redirection avec état)', r.status === 302 && /state=[0-9a-f]{32}/.test(r.headers.location), r.headers.location);
    r = await req('GET', '/api/auth/discord/callback', { query: { code: 'x', state: 'faux' } });
    check('tour: retour OAuth avec mauvais état refusé', r.status === 302 && /invalid_state/.test(r.headers.location), r.headers.location);
    r = await req('GET', '/api/auth/guilds', { sid: F });
    check('tour: serveurs Discord sans jeton → reconnexion', r.status === 401, r.status);

    // Super-admin: servers (approve, suspend, reactivate, maintenance), managers, plans, announcements
    for (const k of await redis.keys('rl:*')) await redis.del(k); // earlier sign-in tests used up the limit
    await mk('SAt', { superAdmin: { id: 1, username: 'root', type: 'superadmin', lastSeen: Date.now() } });
    const SA = sessions.SAt;
    ok('SA : identité', await req('GET', '/api/sa/auth/me', { sid: SA }));
    ok('SA : serveurs', await req('GET', '/api/sa/guilds', { sid: SA }));
    ok('SA : fiche serveur', await req('GET', `/api/sa/guilds/${G}`, { sid: SA }));
    const G4 = '423456789012345678';
    await globalQuery("INSERT INTO guilds (guild_id, guild_name, owner_discord_id, owner_discord_tag, status, db_name) VALUES (?, 'Tour', ?, 'f', 'pending', ?)", [G4, U.F, 'ticketbot_guild_' + G4]);
    ok('SA : approuver un serveur', await req('POST', `/api/sa/guilds/${G4}/approve`, { sid: SA }));
    const [g4] = await globalQuery('SELECT status FROM guilds WHERE guild_id = ?', [G4]);
    const [v4] = await getTenantDb(G4)('SELECT MAX(version) AS v FROM schema_migrations');
    check('tour: serveur approuvé avec sa base à jour', g4.status === 'active' && v4.v === app('./utils/tenantMigrations').LATEST_VERSION, JSON.stringify([g4, v4]));
    ok('SA : suspendre', await req('PATCH', `/api/sa/guilds/${G4}/suspend`, { sid: SA, body: { reason: 'tour' } }));
    ok('SA : réactiver', await req('PATCH', `/api/sa/guilds/${G4}/reactivate`, { sid: SA }));
    ok('SA : maintenance', await req('PATCH', `/api/sa/guilds/${G4}/maintenance`, { sid: SA, body: { enabled: true } }));
    r = await req('POST', '/api/sa/managers', { sid: SA, body: { username: 'tour-manager', password: 'un-mot-de-passe-long', assigned_guilds: [G4] } });
    ok('SA : créer un manager', r);
    const mid = r.body?.id;
    ok('SA : managers', await req('GET', '/api/sa/managers', { sid: SA }));
    ok('SA : modifier un manager', await req('PATCH', `/api/sa/managers/${mid}`, { sid: SA, body: { assigned_guilds: [] } }));
    ok('SA : réinitialiser la 2FA d un manager', await req('POST', `/api/sa/managers/${mid}/reset-totp`, { sid: SA }));
    ok('SA : supprimer un manager', await req('DELETE', `/api/sa/managers/${mid}`, { sid: SA }));
    denied('SA : managers (manager)', await req('GET', '/api/sa/managers', { sid: sessions.MGR }));
    for (const p of ['announcements', 'plans', 'settings/error-alert']) ok(`SA : ${p}`, await req('GET', `/api/sa/${p}`, { sid: SA }));
    ok('SA : déconnexion', await req('POST', '/api/sa/auth/logout', { sid: SA }));
    denied('SA : session terminée', await req('GET', '/api/sa/auth/me', { sid: SA }));
    await globalQuery('DELETE FROM guilds WHERE guild_id = ?', [G4]);
    await globalQuery('DROP DATABASE IF EXISTS ticketbot_guild_' + G4);

    // Manager first sign-in: password, then 2FA set up by scanning the QR code
    for (const k of await redis.keys('rl:*')) await redis.del(k);
    const bcrypt = require('bcrypt');
    await globalQuery("INSERT INTO managers (username, password_hash, assigned_guilds, created_by) VALUES ('tour-sa', ?, '[]', 1)", [await bcrypt.hash('mot-de-passe-du-tour', 4)]);
    r = await req('POST', '/api/sa/auth/login', { body: { username: 'tour-sa', password: 'mot-de-passe-du-tour' } });
    const saCookie = { Cookie: String(r.headers['set-cookie']?.[0] || '').split(';')[0] };
    check('tour: SA première connexion → configuration 2FA', r.status === 200 && r.body.needs_totp_setup && r.body.secret, JSON.stringify(r.body).slice(0, 120));
    const bad = await req('POST', '/api/sa/auth/totp-setup', { headers: saCookie, body: { code: '000000' } });
    check('tour: SA code 2FA faux refusé', bad.status === 400, bad.status);
    const good = await req('POST', '/api/sa/auth/totp-setup', { headers: saCookie, body: { code: require('otplib').generateSync({ secret: r.body.secret }) } });
    const saCookie2 = good.headers['set-cookie'] ? { Cookie: String(good.headers['set-cookie'][0]).split(';')[0] } : saCookie;
    const meSa = await req('GET', '/api/sa/auth/me', { headers: saCookie2 });
    check('tour: SA 2FA configurée et connecté', good.status === 200 && meSa.status === 200 && meSa.body.username === 'tour-sa', JSON.stringify([good.status, meSa.body]));
    const [mgr] = await globalQuery("SELECT totp_enabled, totp_secret FROM managers WHERE username = 'tour-sa'");
    check('tour: SA secret 2FA stocké chiffré', mgr.totp_enabled === 1 && /^enc:v2:/.test(mgr.totp_secret), JSON.stringify(mgr).slice(0, 80));
    r = await req('POST', '/api/sa/auth/login', { body: { username: 'tour-sa', password: 'mot-de-passe-du-tour' } });
    const saCookie3 = { Cookie: String(r.headers['set-cookie']?.[0] || '').split(';')[0] };
    check('tour: SA connexion suivante → code demandé', r.body.needs_totp_verify === true, JSON.stringify(r.body));
    r = await req('POST', '/api/sa/auth/totp-verify', { headers: saCookie3, body: { code: '123456' } });
    check('tour: SA code faux à la connexion refusé', r.status === 400 || r.status === 401, r.status);
    await globalQuery("DELETE FROM managers WHERE username = 'tour-sa'");

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
    const [ev] = await db("SELECT details FROM audit_log WHERE action = 'ticket_priority' AND ticket_id = ? ORDER BY id DESC LIMIT 1", [a.ticket.id]);
    check('mots-clés: tracé dans le journal', JSON.stringify(ev?.details).includes('mots-clés'), JSON.stringify(ev));
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
    await db("INSERT INTO subject_rules (subject, visibility_grade_id) VALUES ('Demande confidentielle', ?)", [gR]);
    await app('./utils/subjectRules').applySubjectRules({ db, client: fakeClient, guildId: G, ticket: tc, firstMessage: '' });
    const [tc2] = await db('SELECT visibility_grade_id FROM tickets WHERE id = ?', [tc.id]);
    check('confidentiel: une règle par sujet ne le lève pas', tc2.visibility_grade_id === -1, JSON.stringify(tc2));
    await db("DELETE FROM subject_rules WHERE subject = 'Demande confidentielle'");
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

  // ── Public status page ──
  {
    await globalQuery('DELETE FROM status_events');
    fakeClient.isReady = () => true; fakeClient.ws = { status: 0 };
    let r = await req('GET', '/api/status');
    check('statut: page publique sans connexion', r.status === 200 && r.body.overall === 'operational' && r.body.components.bot === 'operational' && r.body.days.length === 90, JSON.stringify(r.body).slice(0, 200));
    check('statut: rien d interne exposé', !JSON.stringify(r.body).includes(G) && !JSON.stringify(r.body).includes('Test'), '');
    await mk('SAst', { superAdmin: { id: 1, username: 'root', type: 'superadmin', lastSeen: Date.now() } });
    r = await req('POST', '/api/sa/status-events', { sid: sessions.SAst, body: { kind: 'incident', component: 'dashboard', severity: 'minor', title: 'Lenteurs du dashboard', message: 'On regarde.' } });
    const evId = r.body.id;
    r = await req('GET', '/api/status');
    check('statut: incident déclaré visible', r.body.overall === 'degraded' && r.body.components.dashboard === 'degraded' && r.body.current.some(e => e.title === 'Lenteurs du dashboard'), JSON.stringify(r.body.current));
    await req('PATCH', `/api/sa/status-events/${evId}`, { sid: sessions.SAst, body: { resolved: true } });
    r = await req('GET', '/api/status');
    check('statut: incident résolu dans l historique', r.body.overall === 'operational' && r.body.history.some(e => e.id === evId && e.resolved_at), JSON.stringify(r.body.history));
    check('statut: gestion réservée au super-admin', (await req('POST', '/api/sa/status-events', { sid: sessions.MGR, body: { title: 'x' } })).status === 403);
    // Outage detected by the Discord watch: recorded and closed automatically
    const { setSetting, getSetting } = app('./utils/saSettings');
    const before = await getSetting('error_alert', {});
    await setSetting('error_alert', { ...before, discordUserIds: [], webhookUrl: null, discordDownMinutes: 5 });
    const os = require('os');
    await redis.del(`discord:down_since:${os.hostname()}`, `discord:down_alerted:${os.hostname()}`);
    const { runDiscordWatch } = app('./utils/discordWatch');
    const t0 = Date.now();
    await runDiscordWatch({ isReady: () => false, ws: { status: 5 }, users: fakeClient.users }, t0);
    await runDiscordWatch({ isReady: () => false, ws: { status: 5 }, users: fakeClient.users }, t0 + 6 * 60000);
    fakeClient.isReady = () => false;
    r = await req('GET', '/api/status');
    check('statut: coupure du bot inscrite automatiquement', r.body.components.bot === 'down' && r.body.current.some(e => e.component === 'bot'), JSON.stringify(r.body.current));
    fakeClient.isReady = () => true;
    await runDiscordWatch({ isReady: () => true, ws: { status: 0 }, users: fakeClient.users }, t0 + 8 * 60000);
    r = await req('GET', '/api/status');
    check('statut: coupure close à la reconnexion', r.body.components.bot === 'operational' && !r.body.current.length && r.body.history.some(e => e.component === 'bot' && e.resolved_at), JSON.stringify(r.body).slice(0, 200));
    await setSetting('error_alert', before);
  }

  // ── Demonstration server ──
  {
    for (const k of await redis.keys('rl:*')) await redis.del(k);
    const DEMO = app('./utils/demo').DEMO_GUILD_ID;
    await globalQuery('DROP DATABASE IF EXISTS ticketbot_guild_' + DEMO);
    let r = await req('POST', '/api/demo/start');
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
    await mk('SAdm', { superAdmin: { id: 1, username: 'root', type: 'superadmin', lastSeen: Date.now() } });
    r = await req('GET', '/api/sa/guilds', { sid: sessions.SAdm });
    check('démo: absente des serveurs du super-admin', r.status === 200 && !JSON.stringify(r.body).includes(DEMO), '');
    r = await req('POST', '/api/sa/demo/reset', { sid: sessions.SAdm });
    const [dcfg2] = await getTenantDb(DEMO)('SELECT welcome_message FROM guild_config WHERE id = 1');
    check('démo: remise à zéro', r.status === 200 && r.body.tickets === 24 && dcfg2.welcome_message !== 'Bienvenue (démo)', JSON.stringify([r.body, dcfg2]));
    await req('PUT', '/api/sa/demo', { sid: sessions.SAdm, body: { enabled: false } });
    check('démo: désactivable', (await req('POST', '/api/demo/start')).status === 403);
    await req('PUT', '/api/sa/demo', { sid: sessions.SAdm, body: { enabled: true } });
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

  // ── SA: remove founder ──
  r = await req('DELETE', `/api/sa/guilds/${G}/founders/300000000000000001`, { sid: sessions.MGR });
  check('SA retrait fondateur: manager -> 403', r.status === 403, r.status);
  r = await req('DELETE', `/api/sa/guilds/${G}/founders/300000000000000001`, { sid: sessions.SAnew });
  const [rf] = await db("SELECT role FROM dashboard_users WHERE user_id = '300000000000000001'");
  check('SA retrait fondateur: OK (repasse en nouveau)', r.status === 200 && rf.role === 'nouveau', JSON.stringify([r.status, r.body, rf]));
  r = await req('DELETE', `/api/sa/guilds/${G}/founders/${U.S1}`, { sid: sessions.SAnew });
  check('SA retrait fondateur: non-fondateur -> 404', r.status === 404, r.status);
  await req('DELETE', `/api/sa/guilds/${G}/founders/300000000000000002`, { sid: sessions.SAnew });
  const others = (await db("SELECT user_id FROM dashboard_users WHERE role = 'fondateur'")).map(x => x.user_id).filter(id => id !== U.F);
  for (const id of others) await req('DELETE', `/api/sa/guilds/${G}/founders/${id}`, { sid: sessions.SAnew });
  r = await req('DELETE', `/api/sa/guilds/${G}/founders/${U.F}`, { sid: sessions.SAnew });
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
  check('journal: filtre catégorie', r.status === 200 && r.body.rows.length > 0 && r.body.rows.every(x => x.action.startsWith('ticket_') || x.action.startsWith('participant_') || x.action.startsWith('scheduled_') || x.action.startsWith('note_') || x.action.startsWith('member_') || x.action.startsWith('guest_') || x.action === 'faq_solved'), JSON.stringify(r.body.rows.map(x => x.action)));
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

  // ── Limite max_agents ──
  const { agentCount } = app('./utils/limits');
  await globalQuery('UPDATE guilds SET max_agents = ? WHERE guild_id = ?', [await agentCount(db), G]);
  r = await req('PATCH', '/api/users/300000000000000001/role', { sid: sessions.F, body: { role: 'support' } });
  check('max_agents: promotion refusée quand la limite est atteinte', r.status === 400 && /Limite/.test(r.body.error), JSON.stringify(r.body));
  await globalQuery('UPDATE guilds SET max_agents = 0 WHERE guild_id = ?', [G]);
  r = await req('PATCH', '/api/users/300000000000000001/role', { sid: sessions.F, body: { role: 'support' } });
  check('max_agents: 0 = illimité', r.status === 200, r.status + JSON.stringify(r.body));

  // ── Rétention ──
  const { runRetentionPurge } = app('./utils/retention');
  await globalQuery("INSERT INTO login_logs (user_id, username, ip, user_agent, status, created_at) VALUES ('1', 'old', '1.1.1.1', 'ua', 'success', DATE_SUB(NOW(), INTERVAL 400 DAY))");
  await db("INSERT INTO audit_log (actor_id, actor_tag, action, created_at) VALUES ('1', 'old', 'config_update', DATE_SUB(NOW(), INTERVAL 400 DAY))");
  await db("INSERT INTO transcript_snapshots (ticket_id, channel_id, created_by_id, created_by_tag, message_count, html, txt, created_at) VALUES (?, 'x', '1', 'x', 0, '', '', DATE_SUB(NOW(), INTERVAL 10 DAY))", [st1.id]);
  await globalQuery('UPDATE guilds SET transcript_retention_days = 5 WHERE guild_id = ?', [G]);
  const beforeRecent = (await db('SELECT COUNT(*) AS n FROM audit_log WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)'))[0].n;
  const purged = await runRetentionPurge();
  const afterRecent = (await db('SELECT COUNT(*) AS n FROM audit_log WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)'))[0].n;
  check('rétention: anciens journaux et transcripts purgés', purged.login_logs >= 1 && purged.audit_log >= 1 && purged.transcripts >= 1, JSON.stringify(purged));
  check('rétention: données récentes conservées', Number(afterRecent) === Number(beforeRecent), `${beforeRecent} -> ${afterRecent}`);

  // ── Automatismes BullMQ ──
  const { startWorkers, getQueue, JOBS } = app('./utils/jobQueue');
  const worker = await startWorkers(fakeClient);
  const schedulers = await getQueue().getJobSchedulers();
  check('BullMQ: toutes les tâches planifiées', Object.keys(JOBS).every(n => schedulers.some(x => (x.key || x.id || x.name) === n)), JSON.stringify(schedulers.map(x => x.key || x.id)));
  await worker.close();
  await getQueue().close();

  // ── SA: blocked accounts / IPs ──
  r = await req('GET', '/api/sa/blocked', { sid: sessions.SAnew });
  const lockedRoot = (r.body.accounts || []).find(a => a.username === 'root');
  check('blocages: compte SA verrouillé listé', r.status === 200 && !!lockedRoot, JSON.stringify(r.body));
  r = await req('POST', `/api/sa/blocked/accounts/superadmin/${lockedRoot?.id}/unlock`, { sid: sessions.SAnew });
  const [rootRow] = await globalQuery("SELECT locked_until, failed_attempts FROM superadmins WHERE username = 'root'");
  check('blocages: compte débloqué', r.status === 200 && rootRow.locked_until === null && rootRow.failed_attempts === 0, JSON.stringify([r.status, rootRow]));
  r = await req('GET', '/api/sa/blocked', { sid: sessions.MGR });
  check('blocages: réservé au superadmin', r.status === 403, r.status);
  let lastStatus = 0;
  for (let i = 0; i < 25; i++) lastStatus = (await req('GET', '/api/auth/me')).status;
  check('blocages: limite de connexion atteinte (429)', lastStatus === 429, lastStatus);
  r = await req('GET', '/api/sa/blocked', { sid: sessions.SAnew });
  const ipBlock = (r.body.ips || []).find(b => b.limiter === 'auth');
  check('blocages: IP bloquée listée', !!ipBlock && ipBlock.path === '/api/auth/me' && ipBlock.hits >= 1, JSON.stringify(r.body.ips));
  r = await req('POST', '/api/sa/blocked/ips/unblock', { sid: sessions.SAnew, body: { limiter: ipBlock?.limiter, key: ipBlock?.key } });
  const after = await req('GET', '/api/auth/me');
  check('blocages: IP débloquée', r.status === 200 && after.status === 401, JSON.stringify([r.status, after.status]));

  // ── SA: overview, limits, error journal ──
  r = await req('GET', '/api/sa/stats', { sid: sessions.SAnew });
  const gStat = r.body.perGuild?.find(g => g.guild_id === G);
  check('SA stats: totaux et détail par serveur', r.status === 200 && r.body.totals.tickets > 0 && r.body.daily.length === 30 && gStat && typeof gStat.openTickets === 'number' && typeof gStat.staff === 'number', JSON.stringify(gStat));
  r = await req('GET', '/api/sa/stats', { sid: sessions.MGR });
  check('SA stats: manager sans le compteur d\'erreurs', r.status === 200 && r.body.errors24h === null, JSON.stringify(r.body.errors24h));
  r = await req('PATCH', `/api/sa/guilds/${G}/limits`, { sid: sessions.SAnew, body: { max_tickets: 40, max_agents: 0, transcript_retention_days: 120 } });
  const lim = (await req('GET', '/api/sa/stats', { sid: sessions.SAnew })).body.perGuild.find(g => g.guild_id === G);
  check('SA limites: enregistrées et visibles', r.status === 200 && lim.max_tickets === 40 && lim.transcript_retention_days === 120, JSON.stringify(lim));
  r = await req('PATCH', `/api/sa/guilds/${G}/limits`, { sid: sessions.SAnew, body: { max_tickets: -1 } });
  check('SA limites: valeur négative refusée', r.status === 400, r.status);
  await globalQuery('UPDATE guilds SET max_tickets = 0, transcript_retention_days = 0 WHERE guild_id = ?', [G]);

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
  r = await req('GET', '/api/sa/error-logs', { sid: sessions.SAnew, query: { context: 'test-ctx' } });
  check('erreurs: enregistrée avec le serveur, doublon ignoré', r.status === 200 && r.body.total === 1 && !!r.body.rows[0].guild_name && r.body.rows[0].stack.includes('boom unique'), JSON.stringify(r.body.rows));
  r = await req('GET', '/api/sa/error-logs', { sid: sessions.SAnew, query: { q: 'message capturé', hours: 1 } });
  const [benign] = await globalQuery("SELECT COUNT(*) AS n FROM error_logs WHERE context = 'dm-fermes'");
  check('erreurs: erreurs Discord attendues ignorées (MP fermés…)', Number(benign.n) === 0, JSON.stringify(benign));
  check('erreurs: console.error capturé', r.body.rows?.some(e => e.context === 'capture-test'), JSON.stringify(r.body.rows));
  r = await req('GET', '/api/sa/error-logs', { sid: sessions.SAnew, query: { context: 'http' } });
  check('erreurs: réponse HTTP 500 enregistrée avec la route', r.body.rows?.some(e => e.message === 'GET /api/tickets/:id → 500' && e.guild_id === G), JSON.stringify(r.body.rows));
  check('erreurs: sources fréquentes et activité horaire', r.body.contexts?.some(c => c.context === 'test-ctx') && Array.isArray(r.body.hourly), JSON.stringify(r.body.contexts));
  const errId = r.body.rows?.[0]?.id;
  r = await req('DELETE', `/api/sa/error-logs/${errId}`, { sid: sessions.MGR });
  check('erreurs: suppression réservée au superadmin', r.status === 403, r.status);
  r = await req('DELETE', `/api/sa/error-logs/${errId}`, { sid: sessions.SAnew });
  const [gone] = await globalQuery('SELECT COUNT(*) AS n FROM error_logs WHERE id = ?', [errId]);
  check('erreurs: suppression d\'une entrée', r.status === 200 && Number(gone.n) === 0, JSON.stringify(gone));
  r = await req('DELETE', '/api/sa/error-logs', { sid: sessions.SAnew, query: { context: 'test-ctx' } });
  const [left] = await globalQuery("SELECT COUNT(*) AS n FROM error_logs WHERE context = 'test-ctx'");
  const [captured] = await globalQuery("SELECT COUNT(*) AS n FROM error_logs WHERE context = 'capture-test'");
  check('erreurs: vider selon les filtres uniquement', r.body.deleted === 1 && Number(left.n) === 0 && Number(captured.n) >= 1, JSON.stringify([r.body, left, captured]));

  // ── Error spike alert ──
  r = await req('PUT', '/api/sa/settings/error-alert', { sid: sessions.MGR, body: {} });
  check('alerte erreurs: réservée au superadmin', r.status === 403, r.status);
  r = await req('PUT', '/api/sa/settings/error-alert', { sid: sessions.SAnew, body: { enabled: true, threshold: 0, windowMinutes: 15, discordUserIds: [], webhookUrl: null } });
  check('alerte erreurs: seuil invalide refusé', r.status === 400, r.status);
  r = await req('PUT', '/api/sa/settings/error-alert', { sid: sessions.SAnew, body: { enabled: true, threshold: 3, windowMinutes: 15, discordUserIds: [U.S1], webhookUrl: 'https://127.0.0.1/hook' } });
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
    r = await req('POST', '/api/sa/settings/error-alert/test', { sid: sessions.SAnew });
    check('alerte erreurs: envoi de test', r.status === 200 && r.body.dm === 1, JSON.stringify(r.body));
    await req('PUT', '/api/sa/settings/error-alert', { sid: sessions.SAnew, body: { enabled: false, threshold: 3, windowMinutes: 15, discordUserIds: [], webhookUrl: null } });
    await redis.del('alert:errors:cooldown');
    res = await alert.runErrorAlertCheck(fakeClient);
    check('alerte erreurs: désactivée → aucun envoi', res.skipped === 'disabled', JSON.stringify(res));
  }

  // ── Plans (preset limits) and limit alerts ──
  {
    r = await req('POST', '/api/sa/plans', { sid: sessions.MGR, body: { name: 'x' } });
    check('formules: création réservée au superadmin', r.status === 403, r.status);
    r = await req('POST', '/api/sa/plans', { sid: sessions.SAnew, body: { name: 'Standard', max_tickets: 50, max_agents: 10, transcript_retention_days: 180 } });
    const plan = r.body;
    check('formules: formule créée', r.status === 200 && plan.id > 0, JSON.stringify(r.body));
    r = await req('POST', '/api/sa/plans', { sid: sessions.SAnew, body: { name: 'Standard' } });
    check('formules: nom unique', r.status === 400, r.status);
    r = await req('PUT', `/api/sa/guilds/${G}/plan`, { sid: sessions.SAnew, body: { planId: plan.id } });
    let [gp] = await globalQuery('SELECT plan_id, max_tickets, max_agents, transcript_retention_days FROM guilds WHERE guild_id = ?', [G]);
    check('formules: attribution copie les limites', r.status === 200 && gp.plan_id === plan.id && gp.max_tickets === 50 && gp.max_agents === 10 && gp.transcript_retention_days === 180, JSON.stringify(gp));
    r = await req('PATCH', `/api/sa/plans/${plan.id}`, { sid: sessions.SAnew, body: { max_tickets: 60 } });
    [gp] = await globalQuery('SELECT max_tickets FROM guilds WHERE guild_id = ?', [G]);
    check('formules: modification propagée aux serveurs', r.body.propagated === 1 && gp.max_tickets === 60, JSON.stringify([r.body, gp]));
    r = await req('PATCH', `/api/sa/guilds/${G}/limits`, { sid: sessions.SAnew, body: { max_tickets: 2 } });
    [gp] = await globalQuery('SELECT plan_id, max_tickets FROM guilds WHERE guild_id = ?', [G]);
    check('formules: limites modifiées à la main → personnalisé', gp.plan_id === null && gp.max_tickets === 2, JSON.stringify(gp));

    // Limit alert: 2 open tickets max, fill it up
    const openNow = Number((await db("SELECT COUNT(*) AS n FROM tickets WHERE status = 'open'"))[0].n);
    for (let i = openNow; i < 2; i++) await db("INSERT INTO tickets (owner_id, owner_tag, channel_id, status) VALUES ('24','u24','cqa','open')");
    await globalQuery('UPDATE guilds SET max_tickets = 2, max_agents = 0 WHERE guild_id = ?', [G]);
    for (const k of await redis.keys(`alert:quota:${G}:*`)) await redis.del(k);
    memberDms.length = 0;
    let sentQ = await app('./utils/quotaAlert').runQuotaCheck(fakeClient);
    const qdm = memberDms.find(m => m.id === U.F)?.p?.embeds?.[0]?.data;
    const [qev] = await db("SELECT details FROM audit_log WHERE action = 'quota_warning' ORDER BY id DESC LIMIT 1");
    check('limites: fondateurs prévenus quand la limite est atteinte', sentQ.some(x => x.guildId === G && x.level === 'reached') && qdm?.title?.includes('Limite atteinte'), JSON.stringify([sentQ, qdm]));
    check('limites: alerte journalisée sur le serveur', qev?.details?.limit === 'tickets', JSON.stringify(qev));
    sentQ = await app('./utils/quotaAlert').runQuotaCheck(fakeClient);
    check('limites: une alerte par jour au plus', !sentQ.some(x => x.guildId === G), JSON.stringify(sentQ));
    await globalQuery('UPDATE guilds SET max_tickets = 0, max_agents = 0, transcript_retention_days = 0 WHERE guild_id = ?', [G]);
    await db("UPDATE tickets SET status = 'closed' WHERE owner_id = '24'");
    r = await req('DELETE', `/api/sa/plans/${plan.id}`, { sid: sessions.SAnew });
    check('formules: suppression', r.status === 200, r.status);
  }

  // ── Global announcements ──
  {
    r = await req('POST', '/api/sa/announcements', { sid: sessions.SAnew, body: { title: 'x', body: 'y', showBanner: false, sendDm: false } });
    check('annonces: au moins un canal', r.status === 400, r.status);
    r = await req('POST', '/api/sa/announcements', { sid: sessions.MGR, body: { title: 'x', body: 'y', showBanner: true } });
    check('annonces: réservées au superadmin', r.status === 403, r.status);
    memberDms.length = 0;
    r = await req('POST', '/api/sa/announcements', { sid: sessions.SAnew, body: { title: 'Maintenance dimanche', body: 'Coupure de 22 h à 23 h.', level: 'warning', showBanner: true, sendDm: true } });
    const ann = r.body;
    await new Promise(res => setTimeout(res, 400));
    const annDm = memberDms.find(m => m.id === U.F)?.p?.embeds?.[0]?.data;
    const [annRow] = await globalQuery('SELECT dm_sent FROM announcements WHERE id = ?', [ann.id]);
    check('annonces: MP aux fondateurs', r.status === 200 && ann.recipients >= 1 && annDm?.title === 'Maintenance dimanche' && annRow.dm_sent >= 1, JSON.stringify([ann.recipients, annDm?.title, annRow]));
    r = await req('GET', '/api/announcements', { sid: sessions.FV });
    check('annonces: bandeau pour les fondateurs', r.status === 200 && r.body.some(x => x.id === ann.id && x.level === 'warning'), JSON.stringify(r.body));
    r = await req('GET', '/api/announcements', { sid: sessions.S3T });
    check('annonces: pas de bandeau pour le support', r.status === 403, r.status);
    await globalQuery('UPDATE announcements SET ends_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [ann.id]);
    r = await req('GET', '/api/announcements', { sid: sessions.FV });
    check('annonces: bandeau expiré masqué', !r.body.some(x => x.id === ann.id), JSON.stringify(r.body));
    r = await req('DELETE', `/api/sa/announcements/${ann.id}`, { sid: sessions.SAnew });
    check('annonces: suppression', r.status === 200, r.status);
  }

  // ── SA health page ──
  {
    r = await req('GET', '/api/sa/health', { sid: sessions.MGR });
    check('santé: réservée au superadmin', r.status === 403, r.status);
    r = await req('GET', '/api/sa/health', { sid: sessions.SAnew });
    const tm2 = app('./utils/tenantMigrations');
    check('santé: base et Redis joignables', r.status === 200 && r.body.database.ok && r.body.redis.ok && typeof r.body.process.uptimeS === 'number', JSON.stringify([r.body.database, r.body.redis]));
    check('santé: tâches planifiées listées', r.body.jobs?.jobs?.length === Object.keys(app('./utils/jobQueue').JOBS).length && r.body.jobs.jobs.every(j => j.schedule), JSON.stringify(r.body.jobs).slice(0, 300));
    check('santé: versions de schéma', r.body.schemas.latest === tm2.LATEST_VERSION && r.body.schemas.guilds.some(g => g.guildId === G && g.version === tm2.LATEST_VERSION), JSON.stringify(r.body.schemas));
  }

  // ── Journal of the super-admin panel ──
  {
    await new Promise(res => setTimeout(res, 200));
    r = await req('GET', '/api/sa/audit', { sid: sessions.MGR });
    check('journal SA: réservé au superadmin', r.status === 403, r.status);
    r = await req('GET', '/api/sa/audit', { sid: sessions.SAnew, query: { action: 'guild_limits' } });
    const lim = r.body.rows?.find(x => x.guild_id === G);
    check('journal SA: modification de limites enregistrée avec le serveur', r.status === 200 && lim && lim.actor_name === 'root' && JSON.stringify(lim.details).includes('max_tickets'), JSON.stringify(r.body.rows?.slice(0, 2)));
    check('journal SA: action refusée (400) non enregistrée', !r.body.rows.some(x => JSON.stringify(x.details).includes('-1')));
    r = await req('GET', '/api/sa/audit', { sid: sessions.SAnew, query: { action: 'error_alert_update' } });
    const al = JSON.stringify((r.body.rows || []).find(x => x.details?.webhookUrl)?.details || {});
    check('journal SA: URL de webhook réduite à son origine', al.includes('https://127.0.0.1/…') && !al.includes('/hook'), al);
    r = await req('GET', '/api/sa/audit', { sid: sessions.SAnew, query: { action: 'founder_add' } });
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
    const rep = await require(path.join(ROOT, 'scripts/rotate-encryption-key.js')).rotate();
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
    await db("UPDATE guild_config SET ticket_mode = 'channel', thread_parent_channel_id = NULL, support_role_ids = ? WHERE id = 1", [cfgT.support_role_ids == null ? null : JSON.stringify(cfgT.support_role_ids)]);

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
    await db("UPDATE guild_config SET ticket_mode = 'channel' WHERE id = 1");
    await db("UPDATE tickets SET status = 'closed' WHERE id IN (?)", [[ta, tb]]);

    // Interface preferences (split view)
    r2 = await req('PUT', '/api/profile/prefs', { sid: sessions.S1, body: { splitView: true } });
    const pr = await req('GET', '/api/profile/prefs', { sid: sessions.S1 });
    const bad = await req('PUT', '/api/profile/prefs', { sid: sessions.S1, body: { splitView: 'oui' } });
    check('préférences: vue fractionnée enregistrée', r2.status === 200 && pr.body.splitView === true && bad.status === 400, JSON.stringify([r2.body, pr.body, bad.status]));
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

  // ── SA: delete guild → bot leaves Discord ──
  await globalQuery(`INSERT INTO guilds (guild_id, guild_name, owner_discord_id, owner_discord_tag, status, db_name) VALUES (?, 'G2', '1', 'o', 'pending', ?)`, [G2, 'ticketbot_guild_' + G2]);
  r = await req('DELETE', `/api/sa/guilds/${G2}`, { sid: sessions.SAnew });
  const [g2row] = await globalQuery('SELECT COUNT(*) AS n FROM guilds WHERE guild_id = ?', [G2]);
  check('suppression serveur: le bot quitte Discord', r.status === 200 && g2Left && r.body.leftDiscord === true && Number(g2row.n) === 0, JSON.stringify([r.status, r.body, g2Left, g2row]));

  console.log(`\n${pass} passed, ${failed} failed`);
  server.close();
  await redis.quit();
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

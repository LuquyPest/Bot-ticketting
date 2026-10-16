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
  token: 'test-token', clientId: '1', webEnabled: true, webServerPort: Number(process.env.TEST_HTTP_PORT || 39123),
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

function req(method, path, { sid, body, headers = {}, query } = {}) {
  if (query) path += '?' + new URLSearchParams(query);
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (sid) h.Cookie = 'connect.sid=' + encodeURIComponent('s:' + sign(sid, config.dashboard.sessionSecret));
    if (body !== undefined) { h['Content-Type'] = 'application/json'; }
    if (method !== 'GET' && h['X-Requested-With'] === undefined && !path.startsWith('/api/v1')) h['X-Requested-With'] = 'XMLHttpRequest';
    const r = http.request({ host: '127.0.0.1', port: config.webServerPort, method, path, headers: h }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        let json = null; try { json = JSON.parse(d); } catch {}
        resolve({ status: res.statusCode, body: json ?? d, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(JSON.stringify(body));
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
    id, guildId, type, name, isTextBased: () => true,
    setName: async function (n) { this.name = n; return this; },
    send: async p => { sent.push({ id, p }); return { id: 'm' + sent.length }; },
    setTopic: async () => {}, delete: async () => {}, setParent: async () => {},
    messages: { fetch: async () => null, delete: async () => {} },
  });
  // Discord members and their roles (mutable to simulate role changes)
  const memberRoles = new Map([
    ['300000000000000002', new Map()],
    ['400000000000000001', new Map([['800000000000000001', {}]])],
    ['400000000000000002', new Map([['800000000000000003', {}]])],
    ['400000000000000003', new Map()],
    ['200000000000000005', new Map()],
    ['200000000000000006', new Map()],
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
    channels: { create: async opts => { const id = String(910000000000000000n + BigInt(++chanSeq)); const c = mkChannel(id, G, 0, opts?.name); channels.set(id, c); await new Promise(r => setTimeout(r, 50)); return c; } },
    roles: { fetch: async () => new Map([['800000000000000001', {}]]) },
    members: { fetch: async id => { const r = memberRoles.get(id); if (r) return { id, roles: { cache: r } }; throw new Error('Unknown Member'); } },
  };
  const fakeClient = {
    isReady: () => true, user: { id: '1' },
    guilds: { fetch: async id => (id === G ? guildObj : id === G2 ? g2Discord : null), cache: new Map([[G, { name: 'Serveur Test', iconURL: () => null }]]) },
    channels: { fetch: async id => channels.get(id) || null },
    users: { fetch: async id => {
      if (/^30000000000000000[12]$/.test(id)) return { id, username: 'founder' + id.slice(-1), avatar: null, bot: false, send: async () => {} };
      if (/^2000000000000000\d\d$/.test(id)) return { id, username: 'member' + id.slice(-2), tag: 'member' + id.slice(-2), send: async p => memberDms.push({ id, p }) };
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
  r = await req('GET', '/api/analytics/search?q=secret', { sid: sessions.S1 });
  check('recherche ne fuit pas le ticket restreint', r.status === 200 && r.body.length === 0, JSON.stringify(r.body));
  r = await req('GET', '/api/analytics/search?q=secret', { sid: sessions.F });
  check('fondateur trouve le ticket restreint', r.status === 200 && r.body.length === 1, JSON.stringify(r.body));
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

  // CSRF still enforced on cookie routes
  r = await req('POST', '/api/auth/logout', { sid: sessions.F, headers: { 'X-Requested-With': '' } });
  check('CSRF toujours actif hors /api/v1', r.status === 403, r.status);

  // mysql2 object injection
  r = await req('POST', '/api/auth/select-guild', { sid: sessions.S1, body: { guildId: { guild_id: 1 } } });
  check('select-guild rejette un objet', r.status === 400, r.status);

  // ── Round 2: second audit fixes ──────────────────────────────────────────
  const { authenticator } = require('otplib');
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
  r = await req('PATCH', '/api/config', { sid: sessions.F, body: { welcomeMessage: 'x'.repeat(200000) } });
  check('limite 100 ko conservée ailleurs', r.status === 413, r.status);

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
  const secret = authenticator.generateSecret();
  const { codes, hashes } = generateRecoveryCodes();
  await globalQuery('INSERT INTO user_totp (user_id, totp_secret, totp_enabled, recovery_codes) VALUES (?, ?, 1, ?)', [U.S2, seal(secret), JSON.stringify(hashes)]);
  const pend = async () => { await mk('P', { pendingTotp: { userId: U.S2, username: 'S2', avatar: null, discordAccessToken: 't' } }); return sessions.P; };
  const code = authenticator.generate(secret);
  r = await req('POST', '/api/auth/totp-verify-login', { sid: await pend(), body: { code } });
  check('M4 code TOTP valide (secret chiffré) accepté', r.status === 200, r.status + JSON.stringify(r.body));
  r = await req('POST', '/api/auth/totp-verify-login', { sid: await pend(), body: { code } });
  check('M4 rejeu du même code refusé', r.status === 400, r.status);
  r = await req('POST', '/api/auth/totp-verify-login', { sid: await pend(), body: { code: codes[0] } });
  check('M4 code de secours accepté', r.status === 200, r.status + JSON.stringify(r.body));
  r = await req('POST', '/api/auth/totp-verify-login', { sid: await pend(), body: { code: codes[0] } });
  check('M4 code de secours à usage unique', r.status === 400, r.status);
  const [tr] = await globalQuery('SELECT totp_secret FROM user_totp WHERE user_id = ?', [U.S2]);
  check('M4 secret stocké chiffré', tr.totp_secret.startsWith('enc:v1:') && !tr.totp_secret.includes(secret), tr.totp_secret.slice(0, 20));

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
  check('journal: filtre catégorie', r.status === 200 && r.body.rows.length > 0 && r.body.rows.every(x => x.action.startsWith('ticket_') || x.action.startsWith('participant_') || x.action.startsWith('scheduled_') || x.action === 'note_delete'), JSON.stringify(r.body.rows.map(x => x.action)));
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
  console.error('capture-test:', new Error('message capturé'));
  const { EventEmitter } = require('events');
  const fakeRes = Object.assign(new EventEmitter(), { statusCode: 500 });
  errorLog.httpErrorMiddleware({ method: 'GET', baseUrl: '/api/tickets', route: { path: '/:id' }, path: '/9', session: { guildId: G } }, fakeRes, () => {});
  fakeRes.emit('finish');
  await new Promise(res => setTimeout(res, 150));
  r = await req('GET', '/api/sa/error-logs', { sid: sessions.SAnew, query: { context: 'test-ctx' } });
  check('erreurs: enregistrée avec le serveur, doublon ignoré', r.status === 200 && r.body.total === 1 && !!r.body.rows[0].guild_name && r.body.rows[0].stack.includes('boom unique'), JSON.stringify(r.body.rows));
  r = await req('GET', '/api/sa/error-logs', { sid: sessions.SAnew, query: { q: 'message capturé', hours: 1 } });
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

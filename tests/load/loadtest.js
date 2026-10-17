// Load test: the real web server and ticket logic against throwaway MariaDB + Redis (never the
// production ones), with a fake Discord client. Measures how the current version holds up:
//   1. data volume       N tickets with their messages (search, lists and stats on a full base)
//   2. ticket creation   new tickets opened in parallel (channel, lock, database)
//   3. live connections  K open real-time streams (SSE), and the delivery time of an event to all
//   4. dashboard load    C simultaneous users for D seconds on the most used routes
// Run: npm run test:load   (tests/load/run-local.sh starts and removes the containers)
// Settings (env): TICKETS=5000 MESSAGES=6 NEW_TICKETS=300 SSE=200 CONCURRENCY=50 DURATION=30
//   TENANT_POOL=5 (database connections per server), PROFILE=1 (CPU profile of the server)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const ROOT = path.join(__dirname, '..', '..');
const app = m => require(path.join(ROOT, m));
const env = (k, d) => Number(process.env[k] || d);
const P = {
  tenantPool: env('TENANT_POOL', 5),
  tickets: env('TICKETS', 5000), messages: env('MESSAGES', 6), newTickets: env('NEW_TICKETS', 300),
  sse: env('SSE', 200), concurrency: env('CONCURRENCY', 50), duration: env('DURATION', 30),
};
const PORT = env('LOAD_HTTP_PORT', 39124);

process.env.REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
process.env.REDIS_PORT = process.env.REDIS_PORT || '63792';
const config = {
  token: 'load-token', clientId: '1', webEnabled: true, rateLimits: { apiPerMinute: 10_000_000 }, webServerPort: PORT,
  webServerBaseUrl: `http://localhost:${PORT}`,
  dashboard: { sessionSecret: crypto.randomBytes(32).toString('hex'), discordClientSecret: 'x', discordCallbackUrl: `http://localhost:${PORT}/api/auth/discord/callback` },
  database: { host: process.env.DB_HOST || '127.0.0.1', port: env('DB_PORT', 33062), user: process.env.DB_USER || 'botuser', password: process.env.DB_PASSWORD || 'pw', database: 'ticketbot_global', tenantConnectionLimit: env('TENANT_POOL', 5) },
};
// The web server runs in a child process (same config): the load generator must not share its
// event loop, or the measured latencies would include the generator's own work
const SERVE = process.argv.includes('--serve');
const configFile = SERVE ? process.env.TICKETBOT_CONFIG : path.join(os.tmpdir(), `ticketbot-load-config-${process.pid}.json`);
if (SERVE) Object.assign(config, JSON.parse(fs.readFileSync(configFile, 'utf8')));
else {
  fs.writeFileSync(configFile, JSON.stringify(config));
  process.env.TICKETBOT_CONFIG = configFile;
  process.on('exit', () => { try { fs.unlinkSync(configFile); } catch {} });
}

const sign = require('cookie-signature').sign;
const G = '123456789012345678';
const FOUNDER = '100000000000000001';
const WORDS = 'paiement remboursement commande colis livraison compte connexion mot passe carte banque virement abonnement facture erreur bug jeu serveur discord retard annulation adresse code promo panier stock retour échange garantie'.split(' ');
const sentence = n => Array.from({ length: n }, () => WORDS[Math.floor(Math.random() * WORDS.length)]).join(' ');

const agent = new http.Agent({ keepAlive: true, maxSockets: P.concurrency + 20 });
const cookie = sid => 'connect.sid=' + encodeURIComponent('s:' + sign(sid, config.dashboard.sessionSecret));
function request(method, url, sid, body) {
  return new Promise(resolve => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { Cookie: cookie(sid), 'X-Requested-With': 'XMLHttpRequest' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const t0 = process.hrtime.bigint();
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: url, headers, agent }, res => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ms: Number(process.hrtime.bigint() - t0) / 1e6 }));
    });
    req.on('error', () => resolve({ status: 0, ms: Number(process.hrtime.bigint() - t0) / 1e6 }));
    req.setTimeout(30000, () => req.destroy());
    if (payload) req.write(payload);
    req.end();
  });
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
function stats(list) {
  const s = [...list].sort((a, b) => a - b);
  return { n: s.length, p50: +pct(s, 0.5).toFixed(1), p95: +pct(s, 0.95).toFixed(1), p99: +pct(s, 0.99).toFixed(1), max: +(s[s.length - 1] || 0).toFixed(1) };
}

// Fake Discord client: enough for ticket creation and relays
function fakeClient() {
  const channels = new Map();
  let seq = 0n;
  const mkChannel = id => ({
    id, guildId: G, type: 0, name: 'ticket', isTextBased: () => true,
    send: async () => ({ id: 'm', attachments: { first: () => undefined } }),
    setTopic: async () => {}, setName: async function () { return this; }, setParent: async () => {}, delete: async () => {},
    messages: { fetch: async q => (q && typeof q === 'object' ? new Map() : null) },
    permissionOverwrites: { edit: async () => {}, set: async () => {} },
  });
  const guild = {
    id: G, name: 'Charge', iconURL: () => null,
    channels: { create: async () => { const id = String(950000000000000000n + ++seq); const c = mkChannel(id); channels.set(id, c); return c; }, cache: new Map() },
    roles: { fetch: async () => new Map(), everyone: { id: G } },
    members: { fetch: async id => ({ id, roles: { cache: new Map() } }), me: { permissions: { has: () => true } } },
  };
  return {
    isReady: () => true, ws: { status: 0, ping: 20 }, user: { id: '1', username: 'bot' },
    guilds: { fetch: async id => (id === G ? guild : null), cache: new Map([[G, guild]]) },
    channels: { fetch: async id => channels.get(id) || null },
    users: { fetch: async id => ({ id, username: `u${id.slice(-4)}`, tag: `u${id.slice(-4)}`, send: async () => ({}) }) },
  };
}

async function main() {
  const started = Date.now();
  const { ensureGlobalDatabase, ensureGlobalTables } = app('bootstrap');
  await ensureGlobalDatabase(config);
  await ensureGlobalTables(config);
  const { globalQuery } = app('./utils/globalDb');
  const { ensureTenantSchema } = app('./utils/tenantSchema');
  const { getTenantDb } = app('./utils/tenantDb');
  const { getRedis } = app('./utils/redis');
  const redis = getRedis();
  await globalQuery('DROP DATABASE IF EXISTS ticketbot_guild_' + G);
  await globalQuery('DELETE FROM guilds');
  await globalQuery("INSERT INTO guilds (guild_id, guild_name, owner_discord_id, owner_discord_tag, status, db_name) VALUES (?, 'Charge', ?, 'f', 'active', ?)", [G, FOUNDER, 'ticketbot_guild_' + G]);
  await ensureTenantSchema(G);
  const db = getTenantDb(G);
  await db("INSERT INTO guild_config (id, max_tickets_per_day, ticket_subjects) VALUES (1, 1000, ?) ON DUPLICATE KEY UPDATE max_tickets_per_day = 1000", [JSON.stringify(['Paiement', 'Compte', 'Jeu', 'Autre'])]);

  // Staff accounts and sessions (5 live streams per account at most → enough accounts for SSE)
  const staffCount = Math.max(10, Math.ceil(P.sse / 5));
  const staff = Array.from({ length: staffCount }, (_, i) => String(100000000000001000n + BigInt(i)));
  await db('INSERT INTO dashboard_users (user_id, username, role) VALUES ' + staff.map(() => '(?, ?, ?)').join(','),
    staff.flatMap((id, i) => [id, `staff${i}`, i === 0 ? 'fondateur' : 'support']));
  const [{ insertId: gradeId }] = [await db("INSERT INTO grades (name) VALUES ('Support')")];
  for (const p of ['view_tickets', 'reply_ticket']) await db('INSERT INTO grade_permissions VALUES (?, ?)', [gradeId, p]);
  await db('INSERT INTO user_grades (user_id, grade_id, assigned_by_id, assigned_by_tag) VALUES ' + staff.slice(1).map(() => '(?, ?, "x", "x")').join(','), staff.slice(1).flatMap(id => [id, gradeId]));
  const sessions = [];
  for (const [i, id] of staff.entries()) {
    const sid = crypto.randomBytes(16).toString('hex');
    await redis.set('sess:' + sid, JSON.stringify({ cookie: { originalMaxAge: 86400000, httpOnly: true, path: '/' }, user: { id, username: `staff${i}`, role: null }, currentGuildId: G }), 'EX', 7200);
    sessions.push(sid);
  }

  // 1. Data volume
  let t0 = Date.now();
  const subjects = ['Paiement', 'Compte', 'Jeu', 'Autre'];
  for (let i = 0; i < P.tickets; i += 500) {
    const n = Math.min(500, P.tickets - i);
    const rows = Array.from({ length: n }, (_, k) => {
      const idx = i + k;
      return [String(200000000000000000n + BigInt(idx % 3000)), `membre${idx % 3000}`, `seed${idx}`, idx % 5 ? 'closed' : 'open', subjects[idx % 4], ['low', 'normal', 'urgent'][idx % 3]];
    });
    const { insertId } = await db('INSERT INTO tickets (owner_id, owner_tag, channel_id, status, subject, priority, created_at, last_message_at) VALUES '
      + rows.map(() => '(?, ?, ?, ?, ?, ?, NOW() - INTERVAL FLOOR(RAND() * 90) DAY, NOW())').join(','), rows.flat());
    const notes = [];
    for (let k = 0; k < n; k++) for (let m = 0; m < P.messages; m++) notes.push([insertId + k, m % 2 ? staff[m % staff.length] : rows[k][0], m % 2 ? 'staff' : rows[k][1], sentence(12), m % 2 ? 'reply' : 'user']);
    for (let j = 0; j < notes.length; j += 2000) {
      const part = notes.slice(j, j + 2000);
      await db('INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES ' + part.map(() => '(?, ?, ?, ?, ?)').join(','), part.flat());
    }
  }
  const seedMs = Date.now() - t0;
  const openIds = (await db("SELECT id FROM tickets WHERE status = 'open' LIMIT 2000")).map(r => r.id);
  console.log(`1. Données : ${P.tickets} tickets, ${P.tickets * P.messages} messages en ${(seedMs / 1000).toFixed(1)} s`);

  const client = fakeClient();
  // PROFILE=1: CPU profile of the server (.cpuprofile in tests/load/, opens in Chrome DevTools)
  const execArgv = process.env.PROFILE ? ['--cpu-prof', `--cpu-prof-dir=${__dirname}`] : [];
  const child = require('child_process').fork(__filename, ['--serve'], { env: process.env, execArgv, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const ask = msg => new Promise(resolve => { child.once('message', resolve); child.send(msg); });
  await new Promise((resolve, reject) => { child.once('message', resolve); child.once('exit', code => reject(new Error(`serveur arrêté (${code})`))); });

  // 2. Ticket creation in parallel
  const { createManager } = app('./utils/ticketManager');
  const creation = [];
  let creationErrors = 0;
  t0 = Date.now();
  let next = 0;
  await Promise.all(Array.from({ length: 20 }, async () => {
    while (next < P.newTickets) {
      const i = next++;
      const user = { id: String(300000000000000000n + BigInt(i)), username: `nouveau${i}`, tag: `nouveau${i}`, send: async () => ({}) };
      const s = Date.now();
      try { await createManager(db, client, G).createTicket(user, sentence(15), [], subjects[i % 4], { forceNew: true }); creation.push(Date.now() - s); } catch { creationErrors++; }
    }
  }));
  const creationMs = Date.now() - t0;
  console.log(`2. Création : ${creation.length} tickets en ${(creationMs / 1000).toFixed(1)} s (${(creation.length / (creationMs / 1000)).toFixed(1)}/s), ${creationErrors} erreur(s)`);

  // 3. Live connections (SSE)
  const streams = [];
  let sseOpen = 0;
  const sseReady = Array.from({ length: P.sse }, (_, i) => new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/events', headers: { Cookie: cookie(sessions[Math.floor(i / 5) % sessions.length]), Accept: 'text/event-stream' } }, res => {
      if (res.statusCode === 200) sseOpen++;
      const s = { res, got: null };
      res.on('data', chunk => { if (s.got === null && String(chunk).includes('load_probe')) s.got = Date.now(); });
      streams.push(s);
      resolve();
    });
    req.on('error', () => resolve());
  }));
  await Promise.all(sseReady);
  await new Promise(r => setTimeout(r, 1000));
  const probeAt = Date.now();
  await ask({ type: 'probe', at: probeAt });
  await new Promise(r => setTimeout(r, 3000));
  const delivered = streams.filter(s => s.got).map(s => s.got - probeAt);
  console.log(`3. Temps réel : ${sseOpen}/${P.sse} connexions ouvertes, événement reçu par ${delivered.length} (p95 ${stats(delivered).p95} ms)`);

  // 4. Dashboard load (streams stay open meanwhile)
  const ROUTES = [
    ['liste', 35, () => ['GET', `/api/tickets?status=open&page=${1 + Math.floor(Math.random() * 5)}`]],
    ['fiche', 20, () => ['GET', `/api/tickets/${openIds[Math.floor(Math.random() * openIds.length)]}`]],
    ['messages', 15, () => ['GET', `/api/tickets/${openIds[Math.floor(Math.random() * openIds.length)]}/notes`]],
    ['recherche', 10, () => ['GET', `/api/tickets/search?q=${encodeURIComponent(sentence(2))}`]],
    ['ma file', 10, () => ['GET', '/api/tickets/queue']],
    ['note interne', 10, () => ['POST', `/api/tickets/${openIds[Math.floor(Math.random() * openIds.length)]}/notes`, { content: sentence(10) }]],
  ];
  const total = ROUTES.reduce((n, r) => n + r[1], 0);
  const pick = () => { let x = Math.random() * total; for (const r of ROUTES) { if ((x -= r[1]) < 0) return r; } return ROUTES[0]; };
  const results = Object.fromEntries(ROUTES.map(r => [r[0], { ms: [], errors: 0 }]));
  const end = Date.now() + P.duration * 1000;
  await ask({ type: 'cpu-start' });
  t0 = Date.now();
  await Promise.all(Array.from({ length: P.concurrency }, async (_, w) => {
    const sid = sessions[w % sessions.length];
    while (Date.now() < end) {
      const [name, , build] = pick();
      const [method, url, body] = build();
      const r = await request(method, url, sid, body);
      results[name].ms.push(r.ms);
      if (r.status < 200 || r.status >= 300) results[name].errors++;
    }
  }));
  const loadMs = Date.now() - t0;
  const server = await ask({ type: 'cpu-stop' });

  const routes = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { ...stats(v.ms), rps: +(v.ms.length / (loadMs / 1000)).toFixed(1), errors: v.errors }]));
  const all = Object.values(results).flatMap(v => v.ms);
  const errors = Object.values(results).reduce((n, v) => n + v.errors, 0);
  console.log(`4. Dashboard : ${P.concurrency} utilisateurs simultanés pendant ${P.duration} s`);
  console.table(Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, { 'req/s': v.rps, 'p50 ms': v.p50, 'p95 ms': v.p95, 'p99 ms': v.p99, 'max ms': v.max, erreurs: v.errors }])));
  const report = {
    date: new Date().toISOString(), params: P, node: process.version,
    seed: { tickets: P.tickets, messages: P.tickets * P.messages, seconds: +(seedMs / 1000).toFixed(1) },
    creation: { tickets: creation.length, perSecond: +(creation.length / (creationMs / 1000)).toFixed(1), ...stats(creation), errors: creationErrors },
    sse: { requested: P.sse, open: sseOpen, delivered: delivered.length, ...stats(delivered) },
    load: { requests: all.length, perSecond: +(all.length / (loadMs / 1000)).toFixed(1), errorRate: +(100 * errors / Math.max(1, all.length)).toFixed(2), ...stats(all), routes },
    server: { cpuPercent: +(100 * server.cpuMs / loadMs).toFixed(0), memoryMb: server.memoryMb, eventLoopLagP99Ms: server.lagP99 },
    totalSeconds: Math.round((Date.now() - started) / 1000),
  };
  console.log(`Total : ${report.load.requests} requêtes, ${report.load.perSecond} req/s, p95 ${report.load.p95} ms, erreurs ${report.load.errorRate} %`);
  console.log(`Serveur : CPU ${report.server.cpuPercent} % d'un cœur, mémoire ${report.server.memoryMb} Mo, retard de la boucle d'événements p99 ${report.server.eventLoopLagP99Ms} ms`);
  const out = path.join(__dirname, 'last-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`Rapport : ${path.relative(ROOT, out)}`);

  for (const s of streams) s.res.destroy();
  child.kill(process.env.PROFILE ? 'SIGINT' : 'SIGTERM');
  await new Promise(r => child.once('exit', r));
  agent.destroy();
  // Optional thresholds (CI or before a release): MAX_P95_MS, MAX_ERROR_RATE
  const fail = (process.env.MAX_P95_MS && report.load.p95 > Number(process.env.MAX_P95_MS))
    || (process.env.MAX_ERROR_RATE && report.load.errorRate > Number(process.env.MAX_ERROR_RATE));
  if (fail) console.error('Seuils dépassés');
  process.exit(fail ? 1 : 0);
}

// Child process: the web server only, driven by the parent over IPC
async function serve() {
  const { monitorEventLoopDelay } = require('perf_hooks');
  const lag = monitorEventLoopDelay({ resolution: 10 });
  app('./web/server').startWebServer(fakeClient());
  await new Promise(r => setTimeout(r, 300));
  let cpu0 = null;
  process.on('message', msg => {
    if (msg.type === 'probe') { app('./utils/sse').broadcast('load_probe', { at: msg.at }, G); process.send({ ok: true }); }
    if (msg.type === 'cpu-start') { cpu0 = process.cpuUsage(); lag.reset(); lag.enable(); process.send({ ok: true }); }
    if (msg.type === 'cpu-stop') {
      const c = process.cpuUsage(cpu0); lag.disable();
      process.send({ cpuMs: (c.user + c.system) / 1000, memoryMb: Math.round(process.memoryUsage().rss / 1048576), lagP99: +(lag.percentile(99) / 1e6).toFixed(1) });
    }
  });
  process.on('SIGINT', () => process.exit(0)); // lets --cpu-prof write its file
  process.send({ ready: true });
}

(SERVE ? serve() : main()).catch(err => { console.error(err); process.exit(1); });

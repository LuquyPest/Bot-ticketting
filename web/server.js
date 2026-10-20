const express = require('express');
const session = require('express-session');
const helmet  = require('helmet');
const path = require('path');
const fs = require('fs');
const { pages } = require('../utils/transcriptServer');
const { globalQuery } = require('../utils/globalDb');
const logger = require('../utils/logger');

const { httpErrorMiddleware } = require('../utils/errorLog');

const EXPIRED_HTML = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Expiré</title>
<style>body{background:#0b0f16;color:#9aa8c7;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px}
h1{color:#edf2ff;font-size:24px;margin:0}p{margin:0;font-size:15px}</style></head>
<body><h1>Transcript expiré</h1><p>Cette page n'est disponible que 10 minutes après sa génération.</p></body></html>`;

const { config } = require('../utils/config');

if (!config.dashboard?.sessionSecret) {
  throw new Error('FATAL: dashboard.sessionSecret doit être défini dans config.json');
}
if (config.dashboard.sessionSecret.length < 32) {
  throw new Error('FATAL: dashboard.sessionSecret doit faire au moins 32 caractères (entropie insuffisante)');
}

const app = express();

// Number of reverse proxies in front of the app (Traefik = 1; Cloudflare + Traefik = 2).
// Drives req.ip, used by rate limiting, the IP allowlist and login logs.
app.set('trust proxy', Number.isInteger(config.trustProxyHops) ? config.trustProxyHops : 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc:      ["'self'", 'data:', 'https://cdn.discordapp.com', 'https://media.discordapp.net'],
      mediaSrc:    ["'self'", 'https://cdn.discordapp.com', 'https://media.discordapp.net'],
      fontSrc:     ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});

// Mutation log — registered after the session middleware so the user is known (see below)
function auditLog(req, res, next) {
  if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) {
    logger.info('audit', {
      method: req.method,
      path: req.path,
      user: req.session?.user?.id || null,
      role: req.session?.user?.role || null,
      ip: req.ip
    });
  }
  next();
}

// Session store: Redis (already a hard dependency for BullMQ).
// Keys are `${SESSION_PREFIX}<sid>` — routes/sessions.js deletes them to revoke a session.
const { RedisStore } = require('connect-redis');
const { getSessionRedis, SESSION_PREFIX } = require('../utils/redis');
const sessionStore = new RedisStore({ client: getSessionRedis(), prefix: SESSION_PREFIX, ttl: 86400 });

// Detect HTTPS from either the public base URL or the Discord callback URL.
// When TLS is terminated by a reverse proxy (Traefik), webServerBaseUrl may
// be set to http:// pointing at the internal port while the public URL is HTTPS.
// Using the OAuth callback URL (always set to the public domain) as a fallback
// prevents the session cookie from losing its Secure flag in that scenario.
const isHttps = config.webServerBaseUrl?.startsWith('https://')
             || config.dashboard?.discordCallbackUrl?.startsWith('https://');
app.use(session({
  secret: config.dashboard.sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps
  }
}));

// Bot avatar upload sends a base64 image (up to ~2 MB); everything else keeps the 100 kB default
app.use('/api/config/bot-identity', express.json({ limit: '3mb' }));
app.use('/api/config/import', express.json({ limit: '2mb' }));
app.use('/api/config', express.json({ limit: '400kb' })); // member space logo (data URL)
app.use(auditLog);
app.use(httpErrorMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// CSRF guard for cookie-authenticated routes. /api/v1 uses bearer API keys (no cookies) so it is exempt.
app.use((req, res, next) => {
  if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method) && !req.path.startsWith('/api/v1/')) {
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return res.status(403).json({ error: 'Requête non autorisée' });
    }
  }
  next();
});

app.get('/api/health', async (req, res) => {
  try {
    await globalQuery('SELECT 1');
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

const { authLimiter, apiLimiter } = require('./rateLimiters'); // blocked IPs are listed in the SA panel

app.use('/api/auth', authLimiter);
app.use('/api/member/auth', authLimiter);
app.use('/api/guest/session', authLimiter); // guest links: token guessing is rate-limited
app.use('/api/sa/auth', authLimiter);
app.use('/api', apiLimiter);

app.get('/t/:token', (req, res) => {
  const page = pages.get(req.params.token);
  if (!page) return res.status(410).type('html').send(EXPIRED_HTML);
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src https://cdn.discordapp.com data:; media-src https://cdn.discordapp.com; font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com;"
  );
  res.type('html').send(page.html);
});

app.use('/api/v1',       require('./routes/apiV1'));
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/push',     require('./routes/push'));
app.use('/api/profile',  require('./routes/profile'));
app.use('/api/member',   require('./routes/memberPortal')); // member web space (own tickets only)
app.use('/api/guest',    require('./routes/guest'));        // temporary guest access (read-only)

// GET /api/status — public status page (no authentication, nothing internal)
app.get('/api/status', async (req, res) => {
  try { res.json(await require('../utils/statusPage').publicStatus(app.locals.client)); }
  catch { res.status(503).json({ overall: 'down' }); }
});

// POST /api/client-errors — crash report from the dashboard or the member space (utils/reportError.js
// on the client), written to the error journal with context "navigateur". Open to signed-out
// visitors (the login page can crash too), hence the size limits and the per-IP rate limit.
app.post('/api/client-errors', async (req, res) => {
  const { allowBurst } = require('../utils/rateLimit');
  if (!(await allowBurst(`clienterr:${req.ip}`, 20, 10 * 60 * 1000))) return res.status(429).end();
  const b = req.body || {};
  const message = typeof b.message === 'string' ? b.message.trim().slice(0, 500) : '';
  if (!message) return res.status(400).end();
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  const who = req.session?.user ? `staff:${req.session.user.id}` : req.session?.member ? `membre:${req.session.member.id}` : req.session?.superAdmin ? `sa:${req.session.superAdmin.id}` : 'anonyme';
  const err = Object.assign(new Error(message), { stack: str(b.stack, 4000) || message });
  // Anonymous reports get their own source, left out of the error-spike alert (anyone can send them)
  require('../utils/errorLog').logError(req.session?.currentGuildId || null, who === 'anonyme' ? 'navigateur-anonyme' : 'navigateur', err, {
    page: str(b.url, 300), type: str(b.kind, 20), user: who, agent: str(req.headers['user-agent'], 200), composant: str(b.component, 1500),
  });
  res.status(204).end();
});

// GET /api/attachment?u=<Discord attachment link> — redirects to a working (re-signed) link, for
// the previews in the ticket view and the member space. Signed-in staff or members only.
app.get('/api/attachment', async (req, res) => {
  if (!req.session?.user && !req.session?.member) return res.status(401).json({ error: 'Non connecté' });
  const { parseAttachment, freshAttachmentUrl } = require('../utils/discordAttachments');
  if (!parseAttachment(req.query.u)) return res.status(400).json({ error: 'Lien de pièce jointe invalide' });
  const url = await freshAttachmentUrl(app.locals.client, req.query.u).catch(() => null);
  if (!url) return res.status(404).json({ error: 'Pièce jointe introuvable ou expirée' });
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.redirect(302, url);
});

const requireRole    = require('./middleware/role');
const guildMiddleware = require('./middleware/guild');

// All guild-scoped routes: guildMiddleware resolves req.guildDb from session,
// then requireRole checks permissions against that guild's DB.
const withGuild = (role) => [guildMiddleware, requireRole(...(Array.isArray(role) ? role : [role]))];

app.use('/api/dashboard',   withGuild(['support', 'fondateur']), require('./routes/dashboard'));
app.use('/api/tickets',     withGuild(['support', 'fondateur']), require('./routes/tickets'));
app.use('/api/ticket-views', withGuild(['support', 'fondateur']), require('./routes/ticketViews'));
app.use('/api/staff',       withGuild(['support', 'fondateur']), require('./routes/staff'));
app.use('/api/discord',     withGuild(['support', 'fondateur']), require('./routes/discord'));
app.use('/api/events',      withGuild(['support', 'fondateur']), require('./routes/events'));
app.use('/api/templates',   withGuild(['support', 'fondateur']), require('./routes/templates'));
app.use('/api/blacklist',   withGuild(['fondateur']),            require('./routes/blacklist'));
app.use('/api/transcripts', withGuild(['support', 'fondateur']), require('./routes/transcripts'));
app.use('/api/config',      withGuild(['fondateur']),            require('./routes/config'));
app.use('/api/users',       withGuild(['support', 'fondateur']), require('./routes/users'));
app.use('/api/grades',      withGuild(['support', 'fondateur']), require('./routes/grades'));
app.use('/api/audit',       withGuild(['support', 'fondateur']), require('./routes/audit'));
app.use('/api/tags',        withGuild(['support', 'fondateur']), require('./routes/tags'));
app.use('/api/faq',         withGuild(['support', 'fondateur']), require('./routes/faq'));
app.use('/api/members',     withGuild(['fondateur']),            require('./routes/members'));
app.use('/api/fields',      withGuild(['support', 'fondateur']), require('./routes/fields'));
app.use('/api/subject-rules', withGuild(['support', 'fondateur']), require('./routes/subjectRules'));
app.use('/api/reports',     withGuild(['support', 'fondateur']), require('./routes/reports'));
app.use('/api/incidents',   withGuild(['support', 'fondateur']), require('./routes/incidents'));
app.use('/api/procedures',  withGuild(['support', 'fondateur']), require('./routes/procedures'));
app.use('/api/profiles',    withGuild(['support', 'fondateur']), require('./routes/profiles'));
app.use('/api/guest-invites', withGuild(['fondateur']),        require('./routes/guestInvites'));
// Super-admin announcements shown as a banner to founders
app.use('/api/announcements', withGuild(['fondateur']), async (req, res) => {
  res.json(await require('../utils/announcements').activeBanners().catch(() => []));
});
app.use('/api/messages',    withGuild(['support', 'fondateur']), require('./routes/messages'));
app.use('/api/analytics',   withGuild(['support', 'fondateur']), require('./routes/analytics'));
app.use('/api/goals',       withGuild(['support', 'fondateur']), require('./routes/goals'));
app.use('/api/api-keys',    withGuild(['fondateur']),            require('./routes/apiKeys'));
app.use('/api/newsletter',  withGuild(['fondateur']),            require('./routes/newsletter'));
app.use('/api/panels',      withGuild(['fondateur']),            require('./routes/panels'));
app.use('/api/forms',       withGuild(['fondateur']),            require('./routes/forms'));
app.use('/api/login-logs',  withGuild(['support', 'fondateur']), require('./routes/loginLogs'));

app.use('/api/sa', require('./routes/superadmin'));

// Unknown API routes answer 404 JSON (instead of falling through to the dashboard's index.html)
app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

// Errors not caught by a route: JSON answer, never an HTML page with a stack trace
app.use('/api', (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) logger.error('Erreur non gérée', { path: req.originalUrl.split('?')[0], err: err.message });
  if (res.headersSent) return;
  res.status(status).json({ error: status >= 500 ? 'Erreur serveur' : (err.expose && err.message) || 'Requête invalide' });
});

const distPath = path.join(__dirname, '../dashboard/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
} else {
  app.get('/', (req, res) =>
    res.send('<h2 style="font-family:sans-serif;padding:2rem">Build le dashboard : <code>cd dashboard && npm install && npm run build</code></h2>')
  );
}

function startWebServer(client) {
  require('../utils/sse').startBus(); // real-time events shared between instances
  app.locals.client = client;
  app.set('botClient', client);
  const port = config.webServerPort || 3000;
  const server = app.listen(port, () =>
    logger.info('Serveur web démarré', { port, https: isHttps })
  );
  return server;
}

module.exports = { startWebServer };

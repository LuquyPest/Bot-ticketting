const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { pages } = require('../utils/transcriptServer');
const { pool } = require('../utils/db');
const logger = require('../utils/logger');

const EXPIRED_HTML = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Expiré</title>
<style>body{background:#0b0f16;color:#9aa8c7;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px}
h1{color:#edf2ff;font-size:24px;margin:0}p{margin:0;font-size:15px}</style></head>
<body><h1>Transcript expiré</h1><p>Cette page n'est disponible que 10 minutes après sa génération.</p></body></html>`;

const config = require('../config.json');

if (!config.dashboard?.sessionSecret) {
  throw new Error('FATAL: dashboard.sessionSecret doit être défini dans config.json');
}

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use((req, res, next) => {
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
});

const sessionStore = new MySQLStore({
  createDatabaseTable: true,
  schema: { tableName: 'web_sessions' }
}, pool);

const isHttps = config.webServerBaseUrl?.startsWith('https://');
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

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use((req, res, next) => {
  if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) {
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return res.status(403).json({ error: 'Requête non autorisée' });
    }
  }
  next();
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessaye dans 15 minutes' }
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes' }
});

app.use('/api/auth', authLimiter);
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

app.use('/api/auth',    require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));

const requireRole    = require('./middleware/role');
const guildMiddleware = require('./middleware/guild');

// All guild-scoped routes: guildMiddleware resolves req.guildDb from session,
// then requireRole checks permissions against that guild's DB.
const withGuild = (role) => [guildMiddleware, requireRole(...(Array.isArray(role) ? role : [role]))];

app.use('/api/dashboard',   withGuild(['support', 'fondateur']), require('./routes/dashboard'));
app.use('/api/tickets',     withGuild(['support', 'fondateur']), require('./routes/tickets'));
app.use('/api/staff',       withGuild(['support', 'fondateur']), require('./routes/staff'));
app.use('/api/discord',     withGuild(['support', 'fondateur']), require('./routes/discord'));
app.use('/api/events',      withGuild(['support', 'fondateur']), require('./routes/events'));
app.use('/api/templates',   withGuild(['support', 'fondateur']), require('./routes/templates'));
app.use('/api/blacklist',   withGuild(['fondateur']),            require('./routes/blacklist'));
app.use('/api/transcripts', withGuild(['fondateur']),            require('./routes/transcripts'));
app.use('/api/config',      withGuild(['fondateur']),            require('./routes/config'));
app.use('/api/users',       withGuild(['support', 'fondateur']), require('./routes/users'));
app.use('/api/grades',      withGuild(['support', 'fondateur']), require('./routes/grades'));
app.use('/api/audit',       withGuild(['support', 'fondateur']), require('./routes/audit'));
app.use('/api/tags',        withGuild(['support', 'fondateur']), require('./routes/tags'));
app.use('/api/messages',    withGuild(['support', 'fondateur']), require('./routes/messages'));
app.use('/api/staff-roles', withGuild(['fondateur']),            require('./routes/staffRoles'));
app.use('/api/analytics',   withGuild(['support', 'fondateur']), require('./routes/analytics'));
app.use('/api/badges',      withGuild(['support', 'fondateur']), require('./routes/badges'));
app.use('/api/goals',       withGuild(['support', 'fondateur']), require('./routes/goals'));

app.use('/api/sa', require('./routes/superadmin'));

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
  app.locals.client = client;
  const port = config.webServerPort || 3000;
  const server = app.listen(port, () =>
    logger.info('Serveur web démarré', { port, https: isHttps })
  );
  return server;
}

module.exports = { startWebServer };

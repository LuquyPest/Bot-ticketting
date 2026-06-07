const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { pages } = require('../utils/transcriptServer');
const { pool } = require('../utils/db');

const EXPIRED_HTML = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Expiré</title>
<style>body{background:#0b0f16;color:#9aa8c7;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px}
h1{color:#edf2ff;font-size:24px;margin:0}p{margin:0;font-size:15px}</style></head>
<body><h1>Transcript expiré</h1><p>Cette page n'est disponible que 10 minutes après sa génération.</p></body></html>`;

const config = require('../config.json');

// Fix #2/7 : secret obligatoire
if (!config.dashboard?.sessionSecret) {
  throw new Error('FATAL: dashboard.sessionSecret doit être défini dans config.json');
}

const app = express();

// Fix #13 : headers de sécurité via helmet
app.use(helmet({
  contentSecurityPolicy: false, // Géré manuellement par route
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Fix #20 : audit log de toutes les actions mutantes
app.use((req, res, next) => {
  if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      method: req.method,
      path: req.path,
      user: req.session?.user?.id || null,
      role: req.session?.user?.role || null,
      ip: req.ip
    }));
  }
  next();
});

// Fix #11 : session persistée en MySQL (plus de perte au redémarrage)
const sessionStore = new MySQLStore({
  createDatabaseTable: true,
  schema: { tableName: 'web_sessions' }
}, pool);

// Fix #3/9 : session initialisée une seule fois + cookie secure conditionnel
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
    secure: isHttps  // Fix #16 : secure uniquement si HTTPS
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Fix #13 : Cache-Control sur toutes les réponses API
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Fix #4 : protection CSRF via header custom
app.use((req, res, next) => {
  if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) {
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return res.status(403).json({ error: 'Requête non autorisée' });
    }
  }
  next();
});

// Fix #10 : rate limiting
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
app.use('/api', apiLimiter);

// Transcripts temporaires — Fix #1 : CSP stricte
app.get('/t/:token', (req, res) => {
  const page = pages.get(req.params.token);
  if (!page) return res.status(410).type('html').send(EXPIRED_HTML);
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src https://cdn.discordapp.com data:; media-src https://cdn.discordapp.com; font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com;"
  );
  res.type('html').send(page.html);
});

// Routes publiques
app.use('/api/auth', require('./routes/auth'));

// Routes protégées par rôle
const requireRole = require('./middleware/role');
app.use('/api/dashboard',   requireRole('support', 'fondateur'), require('./routes/dashboard'));
app.use('/api/tickets',     requireRole('support', 'fondateur'), require('./routes/tickets'));
app.use('/api/staff',       requireRole('support', 'fondateur'), require('./routes/staff'));
app.use('/api/blacklist',   requireRole('fondateur'),            require('./routes/blacklist'));
app.use('/api/transcripts', requireRole('fondateur'),            require('./routes/transcripts'));
app.use('/api/config',      requireRole('fondateur'),            require('./routes/config'));
app.use('/api/users',       requireRole('fondateur'),            require('./routes/users'));

// Frontend React
const distPath = path.join(__dirname, '../dashboard/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
} else {
  app.get('/', (req, res) =>
    res.send('<h2 style="font-family:sans-serif;padding:2rem">Build le dashboard : <code>cd dashboard && npm install && npm run build</code></h2>')
  );
}

function startWebServer() {
  const port = config.webServerPort || 3000;
  app.listen(port, () => console.log(`Serveur web démarré → ${isHttps ? 'https' : 'http'}://localhost:${port}`));
}

module.exports = { startWebServer };

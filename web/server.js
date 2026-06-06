const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { pages } = require('../utils/transcriptServer');

const EXPIRED_HTML = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Expiré</title>
<style>body{background:#0b0f16;color:#9aa8c7;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px}
h1{color:#edf2ff;font-size:24px;margin:0}p{margin:0;font-size:15px}</style></head>
<body><h1>Transcript expiré</h1><p>Cette page n'est disponible que 10 minutes après sa génération.</p></body></html>`;

const config = require('../config.json');

// Fix #2 / #7 : secret obligatoire — jamais de fallback faible
if (!config.dashboard?.sessionSecret) {
  throw new Error('FATAL: dashboard.sessionSecret doit être défini dans config.json');
}

const app = express();

// Fix #1 : headers de sécurité globaux
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Fix #3 : session initialisée une seule fois (plus de new MemoryStore par requête)
app.use(session({
  secret: config.dashboard.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Fix #4 : protection CSRF via header custom sur toutes les requêtes mutantes
app.use((req, res, next) => {
  if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) {
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return res.status(403).json({ error: 'Requête non autorisée' });
    }
  }
  next();
});

// Transcripts temporaires (public) — Fix #1 : CSP stricte sur cette page
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
  app.listen(port, () => console.log(`Serveur web démarré → http://localhost:${port}`));
}

module.exports = { startWebServer };

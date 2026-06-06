const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { pages } = require('../utils/transcriptServer');

const EXPIRED_HTML = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Expiré</title>
<style>body{background:#0b0f16;color:#9aa8c7;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px}
h1{color:#edf2ff;font-size:24px;margin:0}p{margin:0;font-size:15px}</style></head>
<body><h1>Transcript expiré</h1><p>Cette page n'est disponible que 10 minutes après sa génération.</p></body></html>`;

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const config = require('../config.json');
  session({
    secret: config.dashboard?.sessionSecret || 'please-change-this-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
  })(req, res, next);
});

// Transcripts temporaires
app.get('/t/:token', (req, res) => {
  const page = pages.get(req.params.token);
  if (!page) return res.status(410).type('html').send(EXPIRED_HTML);
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
  const config = require('../config.json');
  const port = config.webServerPort || 3000;
  app.listen(port, () => console.log(`Serveur web démarré → http://localhost:${port}`));
}

module.exports = { startWebServer };

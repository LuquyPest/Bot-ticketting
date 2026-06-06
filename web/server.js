const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session — secret lu depuis config.json au runtime
app.use((req, res, next) => {
  const config = require('../config.json');
  session({
    secret: config.dashboard?.sessionSecret || 'please-change-this-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
  })(req, res, next);
});

// Routes publiques
app.use('/api/auth', require('./routes/auth'));

// Routes protégées
const requireAuth = require('./middleware/auth');
app.use('/api/dashboard', requireAuth, require('./routes/dashboard'));
app.use('/api/tickets',   requireAuth, require('./routes/tickets'));
app.use('/api/staff',     requireAuth, require('./routes/staff'));
app.use('/api/blacklist', requireAuth, require('./routes/blacklist'));
app.use('/api/transcripts', requireAuth, require('./routes/transcripts'));
app.use('/api/config',    requireAuth, require('./routes/config'));

// Servir le frontend buildé
const distPath = path.join(__dirname, '../dashboard/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
} else {
  app.get('/', (req, res) =>
    res.send('<h2 style="font-family:sans-serif;padding:2rem">Dashboard pas encore buildé.<br>Lance: <code>cd dashboard && npm install && npm run build</code></h2>')
  );
}

function startDashboard() {
  const config = require('../config.json');
  const port = config.dashboard?.port || 3001;
  app.listen(port, () => console.log(`Dashboard démarré → http://localhost:${port}`));
}

module.exports = { startDashboard };

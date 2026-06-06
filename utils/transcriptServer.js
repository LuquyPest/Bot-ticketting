const http = require('http');
const { randomUUID } = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const pages = new Map();

function hostTranscript(html) {
  const token = randomUUID();
  const timer = setTimeout(() => pages.delete(token), TTL_MS);
  pages.set(token, { html, timer });
  return token;
}

function buildUrl(baseUrl, token) {
  return `${baseUrl.replace(/\/$/, '')}/${token}`;
}

function startTranscriptServer(port) {
  const server = http.createServer((req, res) => {
    const token = req.url.slice(1).split('?')[0];

    if (!token) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Page introuvable.');
      return;
    }

    const page = pages.get(token);

    if (!page) {
      res.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Expiré</title>
<style>body{background:#0b0f16;color:#9aa8c7;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px}
h1{color:#edf2ff;font-size:24px;margin:0}p{margin:0;font-size:15px}</style></head>
<body><h1>Transcript expiré</h1><p>Cette page n'est disponible que 10 minutes après sa génération.</p></body></html>`);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page.html);
  });

  server.listen(port, () => {
    console.log(`Serveur transcripts démarré sur le port ${port}`);
  });

  return server;
}

module.exports = { hostTranscript, buildUrl, startTranscriptServer };

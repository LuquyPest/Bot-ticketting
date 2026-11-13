// Renders terminal sessions as images for the installation guide
import { chromium } from 'playwright-core';
// node tests/terminal-shots.mjs   (writes ../docs/public/images/install-*.png)
const out = process.argv[2] || new URL("../../docs/public/images", import.meta.url).pathname;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Lines: [text, kind] — kind: cmd (prompt + command), in (typed answer after a prompt), ok, dim, plain
const sessions = {
  'install-docker': [
    ['curl -fsSL https://get.docker.com | sh', 'cmd'],
    ['# Executing docker install script…', 'dim'],
    ['sudo usermod -aG docker $USER', 'cmd'],
    ['exit                       # puis reconnecte-toi en SSH', 'cmd'],
    ['docker compose version', 'cmd'],
    ['Docker Compose version v5.5.1', 'hl'],
  ],
  'install-setup': [
    ['git clone https://github.com/LuquyPest/Bot-ticketting.git && cd Bot-ticketting', 'cmd'],
    ['scripts/setup.sh', 'cmd'],
    ['── Ticket Bot : configuration ──────────────────────────────────────────', 'dim'],
    ["Crée d'abord l'application sur https://discord.com/developers/applications", 'dim'],
    ['', ''],
    ['Token du bot Discord : ', 'p', '(saisie masquée)'],
    ["ID de l'application (Application ID) : ", 'p', '123456789012345678'],
    ['Client Secret OAuth2 : ', 'p', '(saisie masquée)'],
    ['Domaine public du dashboard (ex. tickets.example.com) : ', 'p', 'tickets.example.com'],
    ['Ton e-mail (certificats HTTPS et notifications push) : ', 'p', 'toi@example.com'],
    ['', ''],
    ['HTTPS :  1) Caddy inclus — recommandé, ports 80 et 443 libres', ''],
    ['         2) Traefik déjà en place (réseau Docker « proxy »)', ''],
    ['         3) Aucun — port local 3000 seulement, je gère mon proxy', ''],
    ['Choix [1] : ', 'p', '1'],
    ['Sauvegarder les bases chaque nuit dans ./backups ? (o/n) [o] : ', 'p', 'o'],
    ['', ''],
    ['✔ .env écrit.', 'ok'],
    ['', ''],
    ['Dernières étapes :', ''],
    ['  1. Portail Discord → OAuth2 → Redirects : ajoute exactement', ''],
    ['       https://tickets.example.com/api/auth/discord/callback', 'hl'],
    ['  2. Fais pointer le DNS de tickets.example.com vers ce serveur (ports 80 et 443 ouverts)', ''],
    ['  3. Démarre :   docker compose pull && docker compose up -d', ''],
  ],
  'install-start': [
    ['docker compose pull && docker compose up -d', 'cmd'],
    [' ✔ Network bot-ticketting_default     Created', 'dim'],
    [' ✔ Container bot-ticketting-redis-1   Healthy', 'dim'],
    [' ✔ Container bot-ticketting-db-1      Healthy', 'dim'],
    [' ✔ Container bot-ticketting-bot-1     Started', 'dim'],
    [' ✔ Container bot-ticketting-caddy-1   Started', 'dim'],
    [' ✔ Container bot-ticketting-backup-1  Started', 'dim'],
    ['docker compose logs -f bot', 'cmd'],
    ['✔ Configuration valide (environnement).', 'ok'],
    ['✔ Base globale "ticketbot_global" prête.', 'ok'],
    ['✔ Tables globales créées ou déjà présentes.', 'ok'],
    ['✔ Token Discord valide — MonBot#1234', 'ok'],
    ['21 commandes enregistrées globalement.', ''],
    ['✔ Tout est prêt. Démarrage du bot multitenant.', 'ok'],
    ['Connecté en tant que MonBot#1234', 'hl'],
  ],
};
const css = `body{margin:0;background:transparent;font-family:'JetBrains Mono','DejaVu Sans Mono',ui-monospace,monospace}
.w{width:980px;margin:24px;border-radius:8px;overflow:hidden;background:#0d1117;border:1px solid #262c36;box-shadow:0 20px 50px -20px rgba(0,0,0,.6)}
.t{height:34px;background:#161b22;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid #262c36}
.t i{width:11px;height:11px;border-radius:50%;display:inline-block}.t span{margin-left:10px;color:#8b949e;font:12px system-ui,sans-serif}
pre{margin:0;padding:18px 20px 22px;color:#c9d1d9;font-size:13.5px;line-height:1.65;white-space:pre-wrap}
.cmd{color:#e6edf3}.cmd b{color:#3fb950;font-weight:600}.dim{color:#8b949e}.ok{color:#3fb950}.hl{color:#79c0ff}.in{color:#79c0ff}.mask{color:#6e7681;font-style:italic}`;
const b = await chromium.launch();
for (const [name, lines] of Object.entries(sessions)) {
  const body = lines.map(([t, k, ans]) => {
    if (k === 'cmd') return `<span class="cmd"><b>toi@serveur:~$</b> ${esc(t)}</span>`;
    if (k === 'p') return `${esc(t)}<span class="${ans.startsWith('(') ? 'mask' : 'in'}">${esc(ans)}</span>`;
    return k ? `<span class="${k}">${esc(t)}</span>` : esc(t);
  }).join('\n');
  const page = await b.newPage({ viewport: { width: 1028, height: 400 }, deviceScaleFactor: 2 });
  await page.setContent(`<style>${css}</style><div class="w"><div class="t"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>Terminal — Bot-ticketting</span></div><pre>${body}</pre></div>`);
  await page.locator('.w').screenshot({ path: `${out}/${name}.png`, omitBackground: true });
  await page.close();
  console.log('✓', name);
}
await b.close();

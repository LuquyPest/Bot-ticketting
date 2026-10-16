// Dashboard smoke test: serves the production build, mocks the API, opens the main pages in
// headless Chromium (dark and light themes) and fails on a console error or a missing title.
// Screenshots go to tests/screenshots/ (uploaded by the CI as an artifact).
//   npm run build && npm run test:smoke
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('tests/screenshots');
mkdirSync(OUT, { recursive: true });

const now = Date.now(), iso = d => new Date(now - d * 60000).toISOString();
const ticket = (id, o = {}) => ({ id, owner_id: '2000000000000000' + String(id).padStart(2, '0'), owner_tag: 'membre' + id, channel_id: '9' + id, claimed_by: null,
  status: 'open', stage: 'open', stage_changed_at: iso(30 * id), subject: 'Problème de paiement ' + id, priority: id % 3 ? 'normal' : 'urgent',
  last_message_at: iso(10 * id), created_at: iso(60 * id), closed_at: null, assignees: [{ user_id: '1', username: 'Daryu', avatar: null }],
  sla: id % 2 ? { hours: 2, elapsedMinutes: 150, state: 'breached', since: iso(150) } : { hours: 4, elapsedMinutes: 60, state: 'ok', since: iso(60) }, ...o });
const MOCK = {
  '/api/auth/me': { id: '1', username: 'Daryu', avatar: null, role: 'fondateur', guildId: '1', guildName: 'Sunset FA', permissions: [] },
  '/api/dashboard/stats': { unclaimedTickets: 3, openTickets: 8, closedToday: 4, avgRating: 4.6, totalTickets: 120 },
  '/api/tickets': { tickets: [1, 2, 3, 4, 5, 6].map(i => ticket(i)), total: 6, page: 1, pages: 1 },
  '/api/tickets/1': { ...ticket(1), participants: [], stages: { open: true, waiting: true, in_progress: true }, transcript: null,
    rating: { rating: 4, comment: 'Très rapide, merci !', rated_at: iso(5) } },
  '/api/tickets/1/notes': [
    { id: 1, ticket_id: 1, author_id: '20', author_tag: 'membre1', content: 'Bonjour, je n\'arrive pas à payer.', source: 'user', created_at: iso(50) },
    { id: 2, ticket_id: 1, author_id: '1', author_tag: 'Daryu', content: 'On regarde ça tout de suite.', source: 'reply', created_at: iso(40) },
    { id: 3, ticket_id: 1, author_id: '1', author_tag: 'Daryu', content: 'Note interne : vérifier Stripe', source: 'web', created_at: iso(30) }],
  '/api/templates': [{ id: 1, name: 'Remboursement', content: 'Bonjour {{username}}', subject: 'paiement', scope: 'shared', suggested: true, mine: true, created_by_id: '1', created_by_tag: 'Daryu', use_count: 3 }],
  '/api/sa/auth/me': { id: 1, username: 'root', type: 'superadmin' },
  '/api/sa/stats': { guilds: { total: 3, active: 2, pending: 1, suspended: 0 }, managers: 1, errors24h: 4,
    totals: { tickets: 340, openTickets: 12, opened30d: 80, closed30d: 75, staff: 9 },
    daily: Array.from({ length: 30 }, (_, i) => ({ day: new Date(now - (29 - i) * 864e5).toISOString().slice(0, 10), opened: (i * 7) % 6, closed: (i * 5) % 5 })),
    perGuild: [{ guild_id: '1', guild_name: 'Sunset FA', status: 'active', maintenance_mode: false, openTickets: 9, max_tickets: 10, staff: 5, max_agents: 0, opened30d: 50, avgRating: 4.5, transcript_retention_days: 90 }] },
};

// [name, path, text that must be visible, anonymous visitor]
const PAGES = [
  ['login', '/login', 'Discord', true],
  ['dashboard', '/', 'Dashboard'],
  ['tickets', '/tickets', 'Problème de paiement 1'],
  ['ticket', '/tickets/1', 'Ticket #1'],
  ['settings', '/settings', 'Paramètres'],
  ['sa', '/sa/overview', "Vue d'ensemble"],
];
// EventSource has no mock: its connection errors are expected
const IGNORED = /EventSource|text\/event-stream|MIME type|\/api\/events|status of 401/;

const server = await preview({ preview: { port: 4175, strictPort: true }, logLevel: 'error' });
const base = 'http://127.0.0.1:4175';
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const failures = [];

for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(t => localStorage.setItem('theme', t), theme);
  page.on('console', m => { if (m.type() === 'error' && !IGNORED.test(m.text())) failures.push(`[${theme}] console: ${m.text()}`); });
  page.on('pageerror', e => failures.push(`[${theme}] page: ${e.message}`));
  let anonymous = false;
  await page.route('**/api/**', route => {
    const u = new URL(route.request().url());
    if (anonymous && u.pathname.endsWith('/auth/me')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    const body = MOCK[u.pathname] ?? (route.request().method() === 'GET' ? [] : { ok: true });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  for (const [name, p, text, anon = false] of PAGES) {
    anonymous = anon;
    await page.goto(base + p, { waitUntil: 'networkidle' });
    const visible = await page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
    if (!visible) failures.push(`[${theme}] ${name}: « ${text} » introuvable`);
    await page.screenshot({ path: path.join(OUT, `${theme}-${name}.png`) });
    console.log(`${visible ? 'PASS' : 'FAIL'}  ${theme} ${name}`);
  }
  await page.close();
}

await browser.close();
await new Promise(r => server.httpServer.close(r));
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Smoke test OK');

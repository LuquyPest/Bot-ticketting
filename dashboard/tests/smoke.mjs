// Dashboard smoke test: serves the production build, mocks the API, opens the main pages in
// headless Chromium (dark and light themes) and fails on a console error or a missing title.
// Screenshots go to tests/screenshots/ (uploaded by the CI as an artifact).
//   npm run build && npm run test:smoke
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const OUT = path.resolve('tests/screenshots');
// Accessibility audit (axe-core, WCAG 2.1 A/AA): serious and critical violations fail the test
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const A11Y_IMPACTS = new Set(['serious', 'critical']);
mkdirSync(OUT, { recursive: true });

const now = Date.now(), iso = d => new Date(now - d * 60000).toISOString();
const ticket = (id, o = {}) => ({ id, owner_id: '2000000000000000' + String(id).padStart(2, '0'), owner_tag: 'membre' + id, channel_id: '9' + id, claimed_by: null,
  status: 'open', stage: 'open', stage_changed_at: iso(30 * id), subject: 'Problème de paiement ' + id, priority: id % 3 ? 'normal' : 'urgent',
  last_message_at: iso(10 * id), created_at: iso(60 * id), closed_at: null, assignees: [{ user_id: '1', username: 'Daryu', avatar: null }],
  sla: id % 2 ? { hours: 2, elapsedMinutes: 150, state: 'breached', since: iso(150) } : { hours: 4, elapsedMinutes: 60, state: 'ok', since: iso(60) }, ...o });
const days = n => Array.from({ length: n }, (_, i) => ({ date: new Date(now - (n - 1 - i) * 864e5).toISOString().slice(0, 10), count: (i * 7) % 5 + 1 }));
const MOCK = {
  '/api/auth/me': { id: '1', username: 'Daryu', avatar: null, role: 'fondateur', guildId: '1', guildName: 'Sunset FA', permissions: [] },
  '/api/tickets': { tickets: [1, 2, 3, 4, 5, 6].map(i => ticket(i)), total: 6, page: 1, pages: 1 },
  '/api/tickets/1': { ...ticket(1), participants: [], stages: { open: true, waiting: true, in_progress: true }, transcript: null,
    rating: { rating: 4, comment: 'Très rapide, merci !', rated_at: iso(5) } },
  '/api/tickets/1/notes': [
    { id: 1, ticket_id: 1, author_id: '20', author_tag: 'membre1', content: 'Bonjour, je n\'arrive pas à payer.', source: 'user', created_at: iso(50) },
    { id: 2, ticket_id: 1, author_id: '1', author_tag: 'Daryu', content: 'On regarde ça tout de suite.', source: 'reply', created_at: iso(40) },
    { id: 3, ticket_id: 1, author_id: '1', author_tag: 'Daryu', content: 'Note interne : vérifier Stripe', source: 'web', created_at: iso(30), pinned_at: iso(20), pinned_by_tag: 'Daryu' },
    { id: 4, ticket_id: 1, author_id: '2', author_tag: 'membre1', content: 'Voici la capture\nhttps://cdn.discordapp.com/attachments/111111111111111111/222222222222222222/capture.png?ex=ffffffff', source: 'user', created_at: iso(10) }],
  '/api/templates': [{ id: 1, name: 'Remboursement', content: 'Bonjour {{username}}', subject: 'paiement', scope: 'shared', suggested: true, mine: true, created_by_id: '1', created_by_tag: 'Daryu', use_count: 3 }],
  '/api/dashboard/stats': { unclaimedTickets: 3, openTickets: 8, closedToday: 4, avgRating: 4.6, totalTickets: 120, priorityBreakdown: { low: 2, normal: 5, urgent: 1 } },
  '/api/dashboard/activity': { opened: days(14), closed: days(14), unclaimed: days(14) },
  '/api/dashboard/heatmap': Array.from({ length: 24 }, (_, hour) => ({ hour, count: (hour * 3) % 7 })),
  '/api/analytics/volume': { opened: days(30), closed: days(30) },
  '/api/analytics/hourly': Array.from({ length: 24 }, (_, hour) => ({ hour, count: (hour * 5) % 9 })),
  '/api/analytics/subjects': [{ subject: 'Paiement', count: 12 }, { subject: 'Connexion', count: 7 }, { subject: 'Autre', count: 3 }],
  '/api/analytics/response-trend': days(30).map(d => ({ date: d.date, avgMinutes: d.count * 4 })),
  '/api/audit': { rows: [{ id: 1, actor_id: '1', actor_tag: 'Daryu', action: 'ticket_close', source: 'dashboard', ticket_id: 1, details: { reason: 'résolu' }, created_at: iso(5) }], total: 1, page: 1, pages: 1 },
  '/api/staff/me/activity': { days: 30, closed: 18, replies: 64, tickets: 22, notes: 9, openAssigned: 3,
    firstResponse: { medianMinutes: 42, count: 15, teamMedianMinutes: 55 },
    rating: { average: 4.6, count: 12, teamAverage: 4.3, distribution: [{ rating: 1, count: 0 }, { rating: 2, count: 1 }, { rating: 3, count: 0 }, { rating: 4, count: 2 }, { rating: 5, count: 9 }] },
    team: { closedPerMember: 14 },
    comments: [{ ticket_id: 7, rating: 5, comment: 'Très rapide, merci !', rated_at: iso(300) }],
    weekly: Array.from({ length: 12 }, (_, i) => ({ week: new Date(now - (11 - i) * 7 * 864e5).toISOString().slice(0, 10), replies: (i * 7) % 11, closed: i % 4, rating: i % 3 ? 4 + (i % 2) * 0.5 : null })) },
  '/api/incidents': [{ id: 1, title: 'Paiements par carte indisponibles', message: 'Notre prestataire est en panne, ne réessaie pas pour l’instant.', subjects: ['Paiement'], notify_on_resolve: true, created_by_tag: 'Daryu', created_at: iso(90), resolved_at: null, members: 7, tickets: 8 },
    { id: 2, title: 'Connexion lente', message: 'Résolu', subjects: null, notify_on_resolve: false, created_by_tag: 'Daryu', created_at: iso(5000), resolved_at: iso(4000), resolved_by_tag: 'Daryu', members: 3, tickets: 3 }],
  '/api/config': { ticketSubjects: ['Paiement', 'Compte', 'Autre'] },
  '/api/member/guilds': [{ id: '123456789012345678', name: 'Sunset FA', icon: null, color: '#e67e22', welcome: 'Bienvenue sur le support Sunset, réponse sous 24 h.' }],
  '/api/member/guilds/123456789012345678/faq': [
    { id: 1, question: 'Comment changer mon mot de passe ?', answer: 'Va dans Réglages > Sécurité.' },
    { id: 2, question: 'Mon paiement est refusé', answer: 'Vérifie que ta carte autorise les paiements en ligne.' }],
  '/api/member/guilds/123456789012345678/form': { subjects: ['Paiement', 'Compte'], fields: [{ id: 1, label: 'N° de commande', type: 'number', required: true }], questions: ['Moyen de paiement ?'] },
  '/api/v1/openapi.json': { openapi: '3.0.3', info: { title: 'API', version: '1', description: 'Accès aux tickets avec une clé `Authorization: Bearer`.' },
    servers: [{ url: 'https://ticket.example/api/v1' }],
    paths: { '/tickets/{id}': { get: { summary: 'Détail d’un ticket', description: 'Le ticket et ses messages.\n\nPermission', 'x-permission': 'read_tickets',
      parameters: [{ name: 'id', in: 'path', required: true, description: 'Numéro du ticket', schema: { type: 'integer' } }],
      responses: { 200: { content: { 'application/json': { example: { id: 42, status: 'open' } } } } } } } } },
  '/api/profile/whats-new': { seen: 'v2.15' },
  '/api/procedures': [{ id: 1, title: 'Vérification d’un paiement', subject: 'Paiement', active: true, steps: [{ id: 'a1b2c3d4', text: 'Demander la capture' }, { id: 'b2c3d4e5', text: 'Vérifier sur le tableau Stripe' }] }],
  '/api/tickets/1/procedures': [{ id: 1, title: 'Vérification d’un paiement', subject: 'Paiement', done: 1, total: 2, steps: [
    { id: 'a1b2c3d4', text: 'Demander la capture', checked: true, checked_by_tag: 'Daryu', checked_at: iso(20) }, { id: 'b2c3d4e5', text: 'Vérifier sur le tableau Stripe', checked: false }] }],
  '/api/tickets/1/time': { total: 3725, mine: 1800, running: { id: 3, seconds: 125, running: true }, byUser: [{ user_id: '1', user_tag: 'Daryu', seconds: 1925 }, { user_id: '2', user_tag: 'Collègue', seconds: 1800 }], entries: [] },
  '/api/tickets/time/running': { id: 3, ticket_id: 1, elapsed: 125, subject: 'Problème de paiement 1' },
  '/api/analytics/time': { days: 30, scope: 'team', total: 18000, byUser: [{ user_id: '1', user_tag: 'Daryu', seconds: 12000, tickets: 8, perTicket: 1500 }], bySubject: [{ subject: 'Paiement', seconds: 9000, tickets: 5, perTicket: 1800 }], top: [{ ticket_id: 1, subject: 'Paiement', seconds: 3725 }] },
  '/api/profiles': { members: [{ member_id: '200000000000000005', tag: 'membre1', tickets: 4, open: 1, notes: 2, last_at: iso(30), labels: ['VIP'] }], total: 1, page: 1, pages: 1 },
  '/api/profiles/200000000000000005': { member_id: '200000000000000005', tag: 'membre1', avatar: null, labels: ['VIP', 'Déjà remboursé'], fields: [{ label: 'N° de commande', value: '4242' }],
    stats: { tickets: 4, open: 1, first: iso(90000), last: iso(30), ratingAvg: 4.5, ratings: 2, timeSeconds: 5400, notes: 2 }, blacklist: null,
    tickets: [{ id: 1, subject: 'Problème de paiement 1', status: 'open' }] },
  '/api/profiles/200000000000000005/posts': [{ id: 1, member_id: '200000000000000005', author_id: '1', author_tag: 'Daryu', content: 'Déjà remboursé deux fois, vérifier avant tout geste commercial.', pinned: true, created_at: iso(500), replies: [
    { id: 2, member_id: '200000000000000005', parent_id: 1, author_id: '2', author_tag: 'Collègue', content: 'Noté, merci.', created_at: iso(400) }] }],
  '/api/guest-invites': [{ id: 1, label: 'Maître Dupont', ticket_ids: [12, 45], include_notes: false, expires_at: new Date(now + 864e5).toISOString(), revoked_at: null, created_by_tag: 'Daryu', created_at: iso(60), last_used_at: iso(10), uses: 2, live: true }],
  '/api/guest/me': { label: 'Maître Dupont', expiresAt: new Date(now + 864e5).toISOString(), includeNotes: false, guildName: 'Sunset FA' },
  '/api/guest/tickets': [{ id: 12, subject: 'Litige commande', status: 'closed', owner_tag: 'membre1', created_at: iso(9000) }],
  '/api/status': { overall: 'degraded', components: { bot: 'operational', dashboard: 'degraded', database: 'operational' }, uptime: 99.82,
    current: [{ id: 2, kind: 'incident', component: 'dashboard', severity: 'minor', title: 'Lenteurs du dashboard', message: 'On regarde.', started_at: iso(30) }],
    history: [{ id: 1, kind: 'maintenance', component: 'all', severity: 'minor', title: 'Mise à jour', message: null, started_at: iso(5000), resolved_at: iso(4980) }],
    days: Array.from({ length: 90 }, (_, i) => ({ date: new Date(now - (89 - i) * 864e5).toISOString().slice(0, 10), level: i === 70 ? 'maintenance' : i === 89 ? 'degraded' : 'operational' })), checkedAt: iso(0) },
  '/api/sa/status-events': [{ id: 2, kind: 'incident', component: 'dashboard', severity: 'minor', title: 'Lenteurs du dashboard', started_at: iso(30), resolved_at: null, auto: 0 }],
  '/api/member/me': { id: '9', username: 'membre9', avatar: null },
  '/api/member/tickets': [{ guild: { id: '123456789012345678', name: 'Sunset FA', icon: null }, tickets: [
    { id: 1, subject: 'Problème de paiement', status: 'open', stage: 'waiting', created_at: iso(120), closed_at: null, assigned: true, participant: false },
    { id: 2, subject: 'Ancienne commande', status: 'closed', stage: 'open', created_at: iso(9000), closed_at: iso(8000), assigned: true, participant: false, rating: 5 },
  ] }],
  '/api/member/tickets/123456789012345678/1': { guild: { id: '123456789012345678', name: 'Sunset FA', icon: null, color: '#e67e22', welcome: 'Bienvenue sur le support Sunset, réponse sous 24 h.' },
    ticket: { id: 1, subject: 'Problème de paiement', status: 'open', stage: 'waiting', created_at: iso(120), assigned: true, participant: false },
    messages: [
      { id: 1, kind: 'me', author: null, content: 'Bonjour, je n’arrive pas à payer.', created_at: iso(120) },
      { id: 2, kind: 'staff', author: 'Support', content: 'Colis renvoyé, voici le suivi : https://example.com/suivi', created_at: iso(60) },
      { id: 3, kind: 'event', author: null, content: 'Ticket mis en attente', created_at: iso(50) },
    ] },
  '/api/config/history': { entries: [
    { id: 2, actor_id: '1', actor_tag: 'Daryu', source: 'settings', created_at: iso(10), changes: { maxTicketsPerDay: { before: 3, after: 5 }, webhookSecret: { secret: true } } },
    { id: 1, actor_id: '1', actor_tag: 'Daryu', source: 'import', created_at: iso(60), changes: { welcomeMessage: { before: null, after: 'Bienvenue !' } } },
  ], total: 2, page: 1, pages: 1 },
  '/api/tickets/presence': { 1: [{ userId: '2', username: 'Collègue', avatar: null, since: now }] },
  '/api/tickets/search': { results: [{ ticket: { id: 1, owner_tag: 'membre1', subject: 'Problème de paiement 1', status: 'open' }, hits: 2,
    match: { id: 11, author_tag: 'membre1', source: 'user', created_at: iso(30), snippet: 'Mon remboursement n’est pas arrivé' } }], total: 1, page: 1, pages: 1, terms: ['rembours'] },
  '/api/audit/meta': { actions: { ticket_close: { label: 'Ticket fermé', category: 'tickets' } }, categories: { tickets: 'Tickets' }, sources: { dashboard: 'Dashboard' } },
  '/api/sa/auth/me': { id: 1, username: 'root', type: 'superadmin' },
  '/api/sa/stats': { guilds: { total: 3, active: 2, pending: 1, suspended: 0 }, managers: 1, errors24h: 4,
    totals: { tickets: 340, openTickets: 12, opened30d: 80, closed30d: 75, staff: 9 },
    daily: Array.from({ length: 30 }, (_, i) => ({ day: new Date(now - (29 - i) * 864e5).toISOString().slice(0, 10), opened: (i * 7) % 6, closed: (i * 5) % 5 })),
    perGuild: [{ guild_id: '1', guild_name: 'Sunset FA', status: 'active', maintenance_mode: false, openTickets: 9, max_tickets: 10, staff: 5, max_agents: 0, opened30d: 50, avgRating: 4.5, transcript_retention_days: 90 }] },
};

// 1×1 image served for attachment previews
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// [name, path, text that must be visible, anonymous visitor]
const PAGES = [
  ['login', '/login', 'Discord', true],
  ['dashboard', '/', 'Nouveautés depuis ta dernière visite'],
  ['tickets', '/tickets', 'Problème de paiement 1'],
  ['ticket', '/tickets/1', 'Voici la capture'],
  ['settings', '/settings', 'Paramètres'],
  ['analytics', '/analytics', 'Analytiques'],
  ['audit', '/audit', "Journal d'activité"],
  ['equipe', '/equipe', 'Équipe'],
  ['activite', '/activite', 'Très rapide, merci'],
  ['incidents', '/incidents', '7 membre(s) touché(s)'],
  ['acces-invites', '/acces-invites', 'Maître Dupont'],
  ['invite', '/invite', 'Litige commande', true],
  ['status', '/status', 'Service perturbé', true],
  ['sa-status', '/sa/status', 'Statut public'],
  ['profils', '/profils', 'Profils des membres'],
  ['profil', '/profils/200000000000000005', 'Déjà remboursé deux fois'],
  ['procedures', '/procedures', 'Vérifier sur le tableau Stripe'],
  ['patchnotes', '/patchnotes', 'Patchnotes'],
  ['docs-api', '/docs-api', 'Documentation de l'],
  ['sa', '/sa/overview', "Vue d'ensemble"],
  ['espace-login', '/espace', 'Se connecter avec Discord', true],
  ['espace', '/espace', 'Ancienne commande'],
  ['espace-ticket', '/espace/123456789012345678/1', 'Colis renvoyé'],
  ['espace-aide', '/espace/aide', 'Comment changer mon mot de passe'],
  ['espace-nouveau', '/espace/nouveau', 'Ouvrir le ticket'],
];
// EventSource has no mock: its connection errors are expected
const IGNORED = /EventSource|text\/event-stream|MIME type|\/api\/events|status of 401/;

const server = await preview({ preview: { port: 4175, strictPort: true }, logLevel: 'error' });
const base = 'http://127.0.0.1:4175';
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const failures = [];

// Desktop in both themes, then a phone: on the phone no page may scroll sideways
const RUNS = [
  { run: 'dark', theme: 'dark', viewport: { width: 1440, height: 900 } },
  { run: 'light', theme: 'light', viewport: { width: 1440, height: 900 } },
  { run: 'mobile', theme: 'dark', viewport: { width: 390, height: 844 }, mobile: true },
];

for (const { run: theme, theme: colorTheme, viewport, mobile } of RUNS) {
  const page = await browser.newPage({ viewport, isMobile: !!mobile, hasTouch: !!mobile, locale: 'fr-FR' });
  await page.addInitScript(t => localStorage.setItem('theme', t), colorTheme);
  page.on('console', m => { if (m.type() === 'error' && !IGNORED.test(m.text())) failures.push(`[${theme}] console: ${m.text()}`); });
  page.on('pageerror', e => failures.push(`[${theme}] page: ${e.message}`));
  let anonymous = false;
  await page.route('**/api/**', route => {
    const u = new URL(route.request().url());
    if (anonymous && (u.pathname.endsWith('/auth/me') || u.pathname === '/api/member/me')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    if (u.pathname === '/api/attachment') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    const body = u.pathname.endsWith('/presence') && route.request().method() === 'POST'
      ? { viewers: [{ userId: '2', username: 'Collègue', avatar: null, since: now }] }
      : MOCK[u.pathname] ?? (route.request().method() === 'GET' ? [] : { ok: true });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  for (const [name, p, text, anon = false] of PAGES) {
    anonymous = anon;
    await page.goto(base + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600); // chart entry animations (1.5 s)
    const visible = await page.getByText(text, { exact: false }).locator('visible=true').first().isVisible().catch(() => false);
    if (!visible) failures.push(`[${theme}] ${name}: « ${text} » introuvable`);
    if (mobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) failures.push(`[${theme}] ${name}: la page déborde de ${overflow} px en largeur`);
    }
    await page.screenshot({ path: path.join(OUT, `${theme}-${name}.png`) });
    await page.addScriptTag({ content: AXE });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] })).violations
      .map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map(n => `${n.target.join(' ')} ${(n.any[0]?.message || '').replace(/\s+/g, ' ').slice(0, 140)}`) })));
    for (const v of violations.filter(x => A11Y_IMPACTS.has(x.impact))) failures.push(`[${theme}] ${name} a11y ${v.impact} ${v.id} — ${v.help} : ${v.nodes.join(' | ')}`);
    console.log(`${visible ? 'PASS' : 'FAIL'}  ${theme} ${name}`);
  }

  // Searching inside messages shows the matching excerpt
  if (theme === 'dark') {
    anonymous = false;
    await page.goto(base + '/tickets', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Messages', exact: true }).click();
    await page.getByLabel('Rechercher dans les messages').fill('rembours');
    const found = await page.getByText('n’est pas arrivé').first().isVisible({ timeout: 3000 }).catch(() => false)
      || await page.getByText('n’est pas arrivé').first().waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (!found) failures.push(`[${theme}] recherche dans les messages : extrait introuvable`);
    await page.screenshot({ path: path.join(OUT, `${theme}-search.png`) });
    await page.getByRole('button', { name: 'Sujets', exact: true }).click();
    console.log(`${found ? 'PASS' : 'FAIL'}  ${theme} recherche messages`);
  }

  // A reply typed on a ticket is still there after leaving the page
  if (theme === 'dark') {
    anonymous = false;
    const DRAFT = 'Brouillon de test 42';
    await page.goto(base + '/tickets/1', { waitUntil: 'networkidle' });
    await page.locator('textarea').first().fill(DRAFT);
    await page.goto(base + '/tickets', { waitUntil: 'networkidle' });
    await page.goto(base + '/tickets/1', { waitUntil: 'networkidle' });
    const kept = await page.locator('textarea').first().inputValue().catch(() => '');
    if (kept !== DRAFT) failures.push(`[${theme}] brouillon perdu (« ${kept} »)`);
    console.log(`${kept === DRAFT ? 'PASS' : 'FAIL'}  ${theme} brouillon`);
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

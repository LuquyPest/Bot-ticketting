// Screenshots of the README (docs/images/): the production build with a fake API full of
// realistic data, in headless Chromium.   npm run build && npm run docs:screenshots
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { now, iso, days, MOCK, PNG } from './fixtures.mjs';
import { VERSIONS } from '../src/data/patchnotes.js';

const OUT = path.resolve('../docs/images');
mkdirSync(OUT, { recursive: true });

const STAFF = [{ user_id: '1', username: 'Alex', avatar: null }, { user_id: '2', username: 'Inès', avatar: null }, { user_id: '3', username: 'Tom', avatar: null }];
const SUBJECTS = [
  ['Remboursement non reçu', 'lucas.m', 'urgent', 'open'], ['Impossible de me connecter', 'sarah_k', 'normal', 'in_progress'],
  ['Commande #4821 incomplète', 'enzo', 'normal', 'waiting'], ['Signalement d\'un joueur', 'maya', 'urgent', 'open'],
  ['Changer mon pseudo', 'noah.l', 'low', 'open'], ['Facture en double', 'jade', 'normal', 'in_progress'],
  ['Question sur l\'abonnement', 'hugo', 'low', 'waiting'], ['Bug sur la boutique', 'chloe', 'normal', 'open'],
  ['Compte suspendu par erreur', 'nathan', 'urgent', 'in_progress'], ['Demande de partenariat', 'lea.p', 'low', 'open'],
];
const tk = (i, [subject, owner, priority, stage]) => ({
  id: 140 + i, owner_id: `20000000000000${String(i).padStart(4, '0')}`, owner_tag: owner, channel_id: `9${i}`, claimed_by: null,
  status: 'open', stage, stage_changed_at: iso(25 * (i + 1)), subject, priority, last_message_at: iso(7 * (i + 1)), created_at: iso(45 * (i + 1)), closed_at: null,
  assignees: i % 3 === 2 ? [] : [STAFF[i % 2]],
  sla: i === 0 || i === 8 ? { hours: 2, elapsedMinutes: 150, state: 'breached', since: iso(150) } : i === 3 ? { hours: 2, elapsedMinutes: 100, state: 'warning', since: iso(100) } : { hours: 4, elapsedMinutes: 60, state: 'ok', since: iso(60) },
});
const TICKETS = SUBJECTS.map((s, i) => tk(i, s));
const T = TICKETS[0];

const DATA = {
  ...MOCK,
  '/api/auth/me': { id: '1', username: 'Alex', avatar: null, role: 'fondateur', guildId: '1', guildName: 'Sunset FA', permissions: [] },
  '/api/profile/whats-new': { seen: VERSIONS[0].version },
  '/api/profile/prefs': { splitView: false, tourDone: 'v1', newAgent: false },
  '/api/tickets': { tickets: TICKETS, total: 37, page: 1, pages: 2 },
  '/api/tickets/staff': STAFF.map(s => ({ ...s, role: 'support', availability: s.user_id === '3' ? 'away' : 'available', vacation_mode: 0 })),
  [`/api/tickets/${T.id}`]: { ...T, participants: [], stages: { open: true, waiting: true, in_progress: true }, transcript: null, rating: null, following: true, voiceUrl: null,
    assignees: [STAFF[0]], links: [], fields: [{ id: 1, label: 'N° de commande', value: '4821' }] },
  [`/api/tickets/${T.id}/notes`]: [
    { id: 1, author_id: T.owner_id, author_tag: T.owner_tag, content: 'Bonjour, j\'ai demandé un remboursement il y a 10 jours et je n\'ai toujours rien reçu.', source: 'user', created_at: iso(140) },
    { id: 2, author_id: '1', author_tag: 'Alex', content: 'Bonjour Lucas, je regarde ça tout de suite. Peux-tu m\'envoyer le numéro de ta commande ?', source: 'reply', created_at: iso(130), editable: true },
    { id: 3, author_id: T.owner_id, author_tag: T.owner_tag, content: 'C\'est la commande #4821, payée par carte.', source: 'user', created_at: iso(120) },
    { id: 4, author_id: '2', author_tag: 'Inès', content: '@Alex le paiement apparaît bien sur Stripe, le remboursement est parti hier.', source: 'web', created_at: iso(100), pinned_at: iso(90), pinned_by_tag: 'Alex' },
    { id: 5, author_id: '1', author_tag: 'Alex', content: 'Le remboursement a été envoyé hier : il arrive sous 3 à 5 jours ouvrés selon ta banque.', source: 'reply', created_at: iso(60), editable: true },
    { id: 6, author_id: T.owner_id, author_tag: T.owner_tag, content: 'Super, merci beaucoup pour votre réactivité !', source: 'user', created_at: iso(15) },
  ],
  [`/api/tickets/${T.id}/time`]: { total: 1520, mine: 1200, running: null, byUser: [{ user_id: '1', user_tag: 'Alex', seconds: 1200 }, { user_id: '2', user_tag: 'Inès', seconds: 320 }], entries: [] },
  [`/api/tickets/${T.id}/procedures`]: [{ id: 1, title: 'Vérification d’un remboursement', subject: 'Remboursement', done: 2, total: 3, steps: [
    { id: 'a', text: 'Retrouver la commande', checked: true, by: 'Alex', at: iso(110) }, { id: 'b', text: 'Vérifier sur Stripe', checked: true, by: 'Inès', at: iso(100) }, { id: 'c', text: 'Confirmer au membre', checked: false }] }],
  [`/api/tickets/${T.id}/similar`]: [],
  '/api/tickets/presence': { [T.id]: [{ userId: '2', username: 'Inès', avatar: null, since: now }] },
  '/api/tickets/queue': { scope: 'mine', tickets: TICKETS.slice(0, 6).map((t, i) => ({ ...t, reasons: i === 0 ? [{ type: 'breached', minutes: 30 }, { type: 'urgent' }] : i === 1 ? [{ type: 'member_waiting', minutes: 42 }] : i === 3 ? [{ type: 'warning', minutes: 20 }, { type: 'urgent' }] : [] })) },
  '/api/dashboard/stats': { openTickets: 37, closedTickets: 1284, unclaimedTickets: 5, avgRating: 4.7, totalRatings: 412, avgResponseSeconds: 1260, avgResolutionSeconds: 15600,
    claimRate: 92, openedToday: 14, closedToday: 11, priorityBreakdown: { low: 9, normal: 21, urgent: 7 } },
  '/api/dashboard/activity': { opened: days(14).map((d, i) => ({ ...d, count: 8 + ((i * 5) % 7) })), closed: days(14).map((d, i) => ({ ...d, count: 7 + ((i * 3) % 6) })), unclaimed: days(14).map((d, i) => ({ ...d, count: (i * 2) % 4 })) },
  '/api/dashboard/recent': TICKETS.slice(0, 8).map(t => ({ id: t.id, owner_tag: t.owner_tag, subject: t.subject, status: t.status, priority: t.priority, created_at: t.created_at })),
  '/api/dashboard/pending': TICKETS.slice(0, 3),
  '/api/dashboard/top-staff': [['1', 'Alex', 48, 52, 40, 190], ['2', 'Inès', 41, 45, 33, 158], ['3', 'Tom', 29, 31, 20, 92]].map(([admin_id, admin_tag, tickets_closed, tickets_claimed, total_ratings, s]) => ({ admin_id, admin_tag, tickets_closed, tickets_claimed, total_ratings, avgRating: (s / total_ratings).toFixed(1), updated_at: iso(5) })),
  '/api/dashboard/leaderboard': { enabled: true, staff: [{ userId: '1', username: 'Alex', ticketsHandled: 52, avgRating: 4.8 }, { userId: '2', username: 'Inès', ticketsHandled: 45, avgRating: 4.7 }, { userId: '3', username: 'Tom', ticketsHandled: 31, avgRating: 4.6 }] },
  '/api/analytics/compare': { period: 'month',
    current: { from: new Date(now - 28 * 864e5).toISOString(), to: new Date(now).toISOString(), opened: 312, closed: 298, replies: 1104, reopened: 9, firstResponseMedianMin: 18, resolutionMedianHours: 3.2, satisfaction: 4.7, ratings: 141 },
    previous: { from: new Date(now - 59 * 864e5).toISOString(), to: new Date(now - 31 * 864e5).toISOString(), opened: 276, closed: 251, replies: 930, reopened: 14, firstResponseMedianMin: 27, resolutionMedianHours: 4.1, satisfaction: 4.5, ratings: 118 } },
  '/api/kanban': [],
  '/api/tickets/time/running': null,
};

const SHOTS = [
  // [file, path, { theme, viewport, after }]
  ['dashboard', '/'],
  ['tickets', '/tickets'],
  ['ticket', `/tickets/${T.id}`],
  ['split-view', '/tickets', { prefs: { splitView: true }, after: async page => { await page.locator('table tr', { hasText: T.subject }).first().click(); await page.waitForTimeout(1200); } }],
  ['queue', '/queue'],
  ['kanban', '/kanban'],
  ['analytics-compare', '/analytics', { after: async page => { await page.click('button:has-text("Comparaison")'); await page.waitForTimeout(900); } }],
  ['health', '/sante'],
  ['member-portal', '/espace/123456789012345678/1'],
  ['dashboard-light', '/', { theme: 'light' }],
  ['ticket-mobile', `/tickets/${T.id}`, { viewport: { width: 390, height: 844 }, mobile: true }],
  ['login', '/login', { anonymous: true }],
];

const server = await preview({ preview: { host: '127.0.0.1', port: 4176, strictPort: true, proxy: {} }, logLevel: 'error' });
const base = 'http://127.0.0.1:4176';
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

for (const [name, p, o = {}] of SHOTS) {
  const page = await browser.newPage({ viewport: o.viewport || { width: 1440, height: 900 }, isMobile: !!o.mobile, hasTouch: !!o.mobile, locale: 'fr-FR', deviceScaleFactor: o.mobile ? 2 : 1 });
  await page.addInitScript(t => { localStorage.setItem('theme', t); localStorage.setItem('uiLang', 'fr'); }, o.theme || 'dark');
  await page.route('**/api/**', route => {
    const u = new URL(route.request().url());
    if (o.anonymous && (u.pathname.endsWith('/auth/me') || u.pathname === '/api/member/me')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    if (u.pathname === '/api/attachment') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (u.pathname === '/api/profile/prefs' && o.prefs) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...DATA['/api/profile/prefs'], ...o.prefs }) });
    const closedList = u.pathname === '/api/tickets' && u.searchParams.get('status') === 'closed';
    const body = u.pathname.endsWith('/presence') && route.request().method() === 'POST'
      ? { viewers: [{ userId: '2', username: 'Inès', avatar: null, since: now }] }
      : closedList ? { tickets: [], total: 0, page: 1, pages: 1 }
        : u.pathname in DATA ? DATA[u.pathname] : (route.request().method() === 'GET' ? [] : { ok: true });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(base + p, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  if (o.after) await o.after(page);
  // Pages that follow the latest message open scrolled down: shown from the top
  await page.evaluate(() => document.querySelectorAll('main, main section, main [class*="overflow-y-auto"]').forEach(el => el.scrollTo(0, 0)));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('✓', name);
  await page.close();
}

await browser.close();
await server.close();

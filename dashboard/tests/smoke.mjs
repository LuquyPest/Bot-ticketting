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

import { now, MOCK, PNG } from './fixtures.mjs';

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
  ['sante', '/sante', 'Gérer les rôles'],
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

const server = await preview({ preview: { host: '127.0.0.1', port: 4175, strictPort: true, proxy: {} }, logLevel: 'error' });
// proxy: {} — no backend here; the « leave the ticket » beacon (keepalive) escapes page.route
const base = 'http://127.0.0.1:4175';
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const failures = [];

// Desktop in both themes, then a phone: on the phone no page may scroll sideways
const RUNS = [
  { run: 'dark', theme: 'dark', viewport: { width: 1440, height: 900 } },
  { run: 'light', theme: 'light', viewport: { width: 1440, height: 900 } },
  { run: 'mobile', theme: 'dark', viewport: { width: 390, height: 844 }, mobile: true },
  { run: 'en', theme: 'dark', viewport: { width: 1440, height: 900 }, lang: 'en' },
];

for (const { run: theme, theme: colorTheme, viewport, mobile, lang } of RUNS) {
  const page = await browser.newPage({ viewport, isMobile: !!mobile, hasTouch: !!mobile, locale: 'fr-FR' });
  await page.addInitScript(([t, l]) => { localStorage.setItem('theme', t); if (l) localStorage.setItem('uiLang', l); }, [colorTheme, lang]);
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
  // Dashboard in English: interface translated, what people wrote and the public pages untouched
  if (lang === 'en') {
    const EN = [
      ['settings', '/settings', ['Settings', 'Ticket prefix'], ['Préfixe des tickets']],
      ['tickets', '/tickets', ['ticket(s) found', 'Save the view'], ['Enregistrer la vue']],
      // the pinned note is staff writing: it stays as written
      ['ticket', '/tickets/1', ['Reply', 'Note interne : vérifier Stripe'], ['Répondre']],
      // sidebar labels (the « What's new » card quotes the release notes as written: not checked)
      ['dashboard', '/', ['Release notes', 'My queue', 'My activity'], ['Ma file', 'Mon activité']],
    ];
    for (const [name, p, wanted, absent] of EN) {
      await page.goto(base + p, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      const text = await page.evaluate(() => document.body.innerText);
      const missing = wanted.filter(w => !text.includes(w));
      const left = absent.filter(a => text.includes(a));
      if (missing.length || left.length) failures.push(`[en] ${name}: manquant ${JSON.stringify(missing)}, encore en français ${JSON.stringify(left)}`);
      await page.screenshot({ path: path.join(OUT, `en-${name}.png`) });
      console.log(`${missing.length || left.length ? 'FAIL' : 'PASS'}  en ${name}`);
    }
    anonymous = true;
    await page.goto(base + '/espace', { waitUntil: 'networkidle' });
    const portalFr = await page.getByText('Se connecter avec Discord').first().isVisible().catch(() => false);
    if (!portalFr) failures.push('[en] espace membre traduit alors qu\'il suit la langue du membre');
    console.log(`${portalFr ? 'PASS' : 'FAIL'}  en espace membre inchangé`);
    await page.close();
    continue;
  }

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

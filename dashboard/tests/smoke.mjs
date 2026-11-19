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

// [name, path, text that must be visible, anonymous visitor, desktop only]
const PAGES = [
  ['login', '/login', 'Discord', true],
  ['reset-password', '/reset-password', 'Mot de passe oublié', true],
  ['installation', '/installation', 'Créer le compte du propriétaire', true],
  ['invitation', '/invitation?token=x', 'Rejoindre l\'équipe', true],
  ['dashboard', '/', 'Nouveautés depuis ta dernière visite'],
  ['tickets', '/tickets', 'Problème de paiement 1'],
  ['ticket', '/tickets/1', 'Voici la capture'],
  ['ticket-taches', '/tickets/1', 'Rembourser la commande en double', false, true],
  // side panel of the ticket view: on a phone it is a drawer behind the « Infos du ticket » button
  ['ticket-validation', '/tickets/1', 'Rembourser 120 € hors délai', false, true],
  ['ticket-copies', '/tickets/8', 'adjoint@ext.test', false, true],
  ['ticket-resoudre', '/tickets/1', 'Résoudre', false, true],
  ['ticket-matrice', '/tickets/1', 'Forcer la priorité', false, true],
  ['settings-matrice', '/settings', 'Calculer la priorité'],
  ['settings-horaires', '/settings?tab=horaires', 'Ajouter les jours fériés'],
  ['settings-escalade', '/settings?tab=horaires', 'Monter la priorité'],
  ['settings-regles', '/settings?tab=regles', 'Arrêter après cette règle'],
  ['settings-regles-temps', '/settings?tab=regles', 'en heures ouvrées'],
  ['settings-notifications', '/settings?tab=notifications', 'Messages envoyés au demandeur'],
  ['settings-slack-teams', '/settings?tab=integrations', 'Interactivity → Request URL'],
  ['organisations', '/organisations', 'Domaines d\'adresse e-mail'],
  ['settings-catalogue', '/settings?tab=catalogue', 'Afficher seulement si'],
  ['settings-recurrents', '/settings?tab=catalogue', 'Attendre que le précédent soit fermé'],
  ['settings-modeles-taches', '/settings?tab=catalogue', 'Nouveau modèle de tâches'],
  ['planning', '/planning', 'Préparer le poste de Léa'],
  ['couts', '/couts', 'Acme'],
  ['tableaux', '/tableaux', 'Ouverts sans attribution'],
  ['problemes', '/problemes/1', 'Commander 50 licences de plus'],
  ['changements', '/changements/1', 'Ta validation est demandée'],
  ['ticket-changement', '/tickets/1', 'Migration de la base de données', false, true],
  ['ticket-probleme', '/tickets/1', 'Se reconnecter sur vpn2.example.com', false, true],
  ['ticket-cout', '/tickets/1', 'Remboursement des frais de port', false, true],
  ['tickets-colonnes', '/tickets', 'Organisation', false, true],
  ['espace-taches', '/espace/123456789012345678/1', 'Rembourser la commande'],
  ['equipes-ola', '/equipe?tab=equipes', 'Objectif interne (OLA)'],
  ['ticket-resolu', '/tickets/8', 'Accès rétabli sur le partage Compta', false, true],
  ['settings', '/settings', 'Paramètres'],
  ['settings-salons', '/settings?tab=salons', 'Statistiques publiques'],
  ['settings-tickets', '/settings?tab=tickets', 'Tickets sur Discord'],
  ['settings-statuts', '/settings?tab=tickets', 'Attente fournisseur'],
  ['settings-categories', '/settings', 'Remboursement'],
  ['kanban-statuts', '/kanban', 'Attente fournisseur'],
  ['equipes', '/equipe?tab=equipes', 'Reçoit les tickets des sujets'],
  ['file-equipe', '/queue', 'Équipe Paiements'],
  ['settings-sauvegarde', '/settings?tab=sauvegarde', 'Importer depuis un autre bot'],
  ['settings-integrations', '/settings?tab=integrations', 'Tickets par e-mail'],
  ['settings-widget', '/settings?tab=integrations', 'Voir le formulaire'],
  ['settings-adresses', '/settings?tab=integrations', 'Autres adresses'],
  ['analytics', '/analytics', 'Analytiques'],
  ['analytics-rapports', '/analytics?tab=reports', 'Sans équipe'],
  ['tickets-types', '/tickets', 'Tous types'],
  ['settings-types', '/settings', 'Nom des incidents'],
  ['audit', '/audit', "Journal d'activité"],
  ['equipe', '/equipe', 'Équipe'],
  ['activite', '/activite', 'Très rapide, merci'],
  ['incidents', '/incidents', '7 membre(s) touché(s)'],
  ['acces-invites', '/acces-invites', 'Maître Dupont'],
  ['sante', '/sante', 'Gérer les rôles'],
  ['invite', '/invite', 'Litige commande', true],
  ['profils', '/profils', 'Une fiche par personne'],
  ['profil', '/profils/200000000000000005', 'Déjà remboursé deux fois'],
  ['procedures', '/procedures', 'Vérifier sur le tableau Stripe'],
  ['patchnotes', '/patchnotes', 'Patchnotes'],
  ['profile', '/profile', 'Dernière utilisation'],
  ['docs-api', '/docs-api', 'Corps de la requête'],
  ['roles', '/roles', 'Comptabilité'],
  ['instance', '/instance/overview', "Vue d'ensemble"],
  ['instance-serveurs', '/instance/guilds', 'Daryu'],
  ['instance-blocages', '/instance/blocked', 'Aucune adresse bloquée'],
  ['instance-sante', '/instance/health', 'Mettre à jour'],
  ['instance-connexion', '/instance/login', 'Adresse de retour à déclarer'],
  ['instance-boites-email', '/instance/login', 'Enregistrer les applications e-mail'],
  ['email-oauth', '/settings?tab=integrations', 'Identifiant et mot de passe'],
  ['email-webhook', '/settings?tab=integrations', 'Adresse de réception, à coller chez'],
  ['email-apparence', '/settings?tab=integrations', 'Apparence des e-mails'],
  ['email-quarantaine', '/settings?tab=integrations', 'Gagnez un voyage'],
  ['profil-signature', '/profile', 'Enregistrer la signature'],
  ['login-fournisseurs', '/login', 'Continuer avec', true],
  ['confidentialite', '/confidentialite', 'Données enregistrées', true],
  ['validation', '/validation#abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG', 'Geste commercial de 50 €', true],
  ['solution', '/solution#123456789012345678.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG', 'Le remboursement de 50 €', true],
  ['espace-login', '/espace', 'Recevoir un lien de connexion', true],
  ['espace', '/espace', 'Ancienne commande'],
  ['espace-organisation', '/espace', 'Imprimante du 2e étage'],
  ['espace-ticket', '/espace/123456789012345678/1', 'Colis renvoyé'],
  ['espace-fichiers', '/espace/123456789012345678/1', 'facture-1287.pdf'],
  ['espace-solution', '/espace/123456789012345678/1', 'Paiement validé de notre côté'],
  ['espace-aide', '/espace/aide', 'Comment changer mon mot de passe'],
  ['espace-nouveau', '/espace/nouveau', 'Signaler une panne'],
  ['aide-publique', '/aide/123456789012345678', 'Comment suivre ma livraison', true],
  ['aide-article', '/aide/123456789012345678/3', 'dès l\'envoi du colis', true],
  ['faq', '/faq', 'Base de connaissances publique'],
  ['faq-retours', '/faq', 'Il manque le lien vers le transporteur'],
  ['aide-avis', '/aide/123456789012345678/3', 'Cet article t\'a-t-il aidé ?', true],
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
  { run: 'dark', theme: 'dark', viewport: { width: 1440, height: 900 }, skin: 'classic' },
  { run: 'light', theme: 'light', viewport: { width: 1440, height: 900 }, skin: 'classic' },
  { run: 'mobile', theme: 'dark', viewport: { width: 390, height: 844 }, mobile: true },
  { run: 'en', theme: 'dark', viewport: { width: 1440, height: 900 }, lang: 'en' },
  { run: 'pro', theme: 'dark', viewport: { width: 1440, height: 900 } },
  { run: 'pro-light', theme: 'light', viewport: { width: 1440, height: 900 }, skin: 'pro' },
];
// SMOKE_RUNS=dark,light… runs only these passes (the CI runs each one on its own machine, in parallel)
const ONLY = (process.env.SMOKE_RUNS || '').split(',').map(x => x.trim()).filter(Boolean);
const unknown = ONLY.filter(r => !RUNS.some(x => x.run === r));
if (unknown.length) { console.error(`SMOKE_RUNS inconnus : ${unknown.join(', ')}`); process.exit(1); }

for (const { run: theme, theme: colorTheme, viewport, mobile, lang, skin } of RUNS.filter(r => !ONLY.length || ONLY.includes(r.run))) {
  const page = await browser.newPage({ viewport, isMobile: !!mobile, hasTouch: !!mobile, locale: 'fr-FR' });
  await page.addInitScript(([t, l, sk]) => { localStorage.setItem('theme', t); if (l) localStorage.setItem('uiLang', l); if (sk) localStorage.setItem('uiSkinV2', sk); }, [colorTheme, lang, skin]);
  let expect403 = false; // a test that asks for a refusal on purpose
  page.on('console', m => { if (m.type() === 'error' && !IGNORED.test(m.text()) && !(expect403 && /status of 403/.test(m.text()))) failures.push(`[${theme}] console: ${m.text()}`); });
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
      // sidebar labels (group titles are shown in capitals; the « What's new » card quotes the release notes as written: not checked)
      ['dashboard', '/', ['ADMINISTRATION', 'My queue', 'TRACKING'], ['Ma file', 'SUIVI']],
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

  for (const [name, p, text, anon = false, desktopOnly = false] of PAGES) {
    if (desktopOnly && mobile) continue;
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

  // With and without a linked Discord server: the Discord features only show when there is one
  if (theme === 'dark') {
    anonymous = false;
    for (const discord of [true, false]) {
      const me = { ...MOCK['/api/auth/me'], discord };
      await page.route('**/api/auth/me', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(me) }));
      await page.goto(base + '/settings', { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      const panels = await page.locator('a[href="/panels"]').count();
      const salons = await page.getByRole('tab', { name: 'Salons' }).count();
      await page.goto(base + '/settings?tab=acces', { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const roles = await page.getByText('Rôles d\'accès').count();
      await page.goto(base + '/settings?tab=tickets', { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const sla = await page.getByText('Délai « Ouvert » (heures)', { exact: false }).count();
      await page.goto(base + '/panels', { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const notice = await page.getByText('Fonction Discord').count();
      const ok = discord ? panels > 0 && salons > 0 && roles > 0 && sla > 0 && notice === 0 : panels === 0 && salons === 0 && roles === 0 && sla > 0 && notice > 0;
      if (!ok) failures.push(`[${theme}] ${discord ? 'avec' : 'sans'} Discord : panels ${panels}, onglet Salons ${salons}, rôles d'accès ${roles}, délais ${sla}, page Discord ${notice}`);
      await page.screenshot({ path: path.join(OUT, `${theme}-${discord ? 'avec' : 'sans'}-discord.png`) });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${theme} espace ${discord ? 'relié à Discord' : 'sans Discord'}`);
      await page.unroute('**/api/auth/me');
    }
  }

  // Sign-in: the owner of the instance gets the server list, anyone else with a single server goes
  // straight to its dashboard
  if (theme === 'dark') {
    anonymous = false;
    const one = [{ id: '1', name: 'Sunset FA', icon: null, iconUrl: null, status: 'active' }];
    for (const owner of [false, true]) {
      let selected = false;
      const me = { ...MOCK['/api/auth/me'], guildId: null, isOwner: owner };
      await page.route('**/api/auth/me', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(me) }));
      await page.route('**/api/auth/guilds', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(owner ? [...one, { id: '2', name: 'Autre serveur', icon: null, status: 'not_added' }] : one) }));
      await page.route('**/api/auth/select-guild', r => { selected = true; me.guildId = '1'; r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
      await page.goto(base + '/select-guild', { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      const listed = await page.getByText('Mes espaces').first().isVisible().catch(() => false);
      const ok = owner ? listed && !selected && await page.getByText('Inviter le bot').first().isVisible().catch(() => false) : selected && !page.url().includes('/select-guild');
      if (!ok) failures.push(`[${theme}] choix du serveur (${owner ? 'propriétaire : liste attendue' : 'utilisateur : connexion directe attendue'}) — url ${page.url()}, liste ${listed}, sélection ${selected}`);
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${theme} choix du serveur ${owner ? 'propriétaire (liste)' : 'utilisateur (direct)'}`);
      await page.unroute('**/api/auth/me'); await page.unroute('**/api/auth/guilds'); await page.unroute('**/api/auth/select-guild');
    }
  }

  // /demo opens the demonstration straight away (link from the docs site)
  if (theme === 'dark') {
    anonymous = false;
    let started = false;
    await page.route('**/api/demo/start', r => { started = true; r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
    await page.goto(base + '/demo', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const ok = started && new URL(page.url()).pathname === '/';
    if (!ok) failures.push(`[${theme}] /demo : démonstration non ouverte (${page.url()})`);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${theme} /demo ouvre la démonstration`);
    await page.unroute('**/api/demo/start');
    expect403 = true;
    await page.route('**/api/demo/start', r => r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"La démonstration est désactivée"}' }));
    await page.goto(base + '/demo', { waitUntil: 'networkidle' });
    const off = await page.getByText('La démonstration est désactivée').isVisible().catch(() => false);
    if (!off) failures.push(`[${theme}] /demo désactivée : message absent`);
    console.log(`${off ? 'PASS' : 'FAIL'}  ${theme} /demo désactivée`);
    await page.unroute('**/api/demo/start');
    expect403 = false;
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

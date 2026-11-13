import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

const REPO = 'https://github.com/LuquyPest/Bot-ticketting';
// GitHub Pages serves the project under /Bot-ticketting/; DOCS_BASE=/ for a custom domain
const base = process.env.DOCS_BASE || '/Bot-ticketting/';

const guide = [
  {
    text: 'Démarrer',
    items: [
      { text: 'Présentation', link: '/guide/' },
      { text: 'Installation', link: '/guide/installation' },
      { text: 'Configuration', link: '/guide/configuration' },
      { text: 'Premiers pas', link: '/guide/premiers-pas' },
    ],
  },
  {
    text: 'Utiliser',
    items: [
      { text: 'Tickets', link: '/guide/tickets' },
      { text: 'Équipe et permissions', link: '/guide/equipe' },
      { text: 'Commandes Discord', link: '/guide/commandes' },
      { text: 'Espace membre', link: '/guide/espace-membre' },
      { text: 'Automatismes', link: '/guide/automatismes' },
      { text: 'Intégrations', link: '/guide/integrations' },
    ],
  },
  {
    text: 'Administrer',
    items: [
      { text: 'Section Instance', link: '/guide/instance' },
      { text: 'Sauvegardes', link: '/guide/sauvegardes' },
      { text: 'Mises à jour', link: '/guide/mise-a-jour' },
      { text: 'Sécurité', link: '/guide/securite' },
      { text: 'Problèmes fréquents', link: '/guide/problemes' },
    ],
  },
  {
    text: 'Projet',
    items: [
      { text: 'Versions', link: '/guide/versions' },
      { text: 'Contribuer', link: '/guide/contribuer' },
      { text: 'Signaler une faille', link: '/guide/signaler-une-faille' },
    ],
  },
];

export default withMermaid(defineConfig({
  base,
  lang: 'fr-FR',
  title: 'Ticket Bot',
  description: 'Le support Discord par messages privés, piloté depuis un dashboard web. Logiciel libre, à héberger soi-même.',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['**/node_modules/**', 'README.md'],
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#2f6feb' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Ticket Bot — support Discord par messages privés' }],
    ['meta', { property: 'og:description', content: 'Tickets Discord en MP, dashboard web temps réel, à héberger soi-même. Libre (AGPL-3.0).' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '^/guide/' },
      { text: 'Installation', link: '/guide/installation' },
      { text: 'Versions', link: '/guide/versions' },
      { text: 'English', link: '/en/installation' },
    ],
    sidebar: {
      '/guide/': guide,
      '/en/': [{ text: 'English', items: [{ text: 'Installation', link: '/en/installation' }, { text: 'French guide', link: '/guide/' }] }],
    },
    socialLinks: [{ icon: 'github', link: REPO }],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Rechercher', buttonAriaLabel: 'Rechercher' },
          modal: {
            noResultsText: 'Aucun résultat pour',
            resetButtonTitle: 'Effacer',
            footer: { selectText: 'ouvrir', navigateText: 'naviguer', closeText: 'fermer' },
          },
        },
      },
    },
    editLink: { pattern: `${REPO}/edit/main/docs/:path`, text: 'Modifier cette page sur GitHub' },
    lastUpdated: { text: 'Mis à jour le', formatOptions: { dateStyle: 'long' } },
    docFooter: { prev: 'Page précédente', next: 'Page suivante' },
    outline: { level: [2, 3], label: 'Sur cette page' },
    returnToTopLabel: 'Haut de page',
    sidebarMenuLabel: 'Menu',
    darkModeSwitchLabel: 'Thème',
    lightModeSwitchTitle: 'Thème clair',
    darkModeSwitchTitle: 'Thème sombre',
    footer: {
      message: 'Logiciel libre sous licence <a href="https://github.com/LuquyPest/Bot-ticketting/blob/main/LICENSE">AGPL-3.0</a>.',
      copyright: `<a href="${REPO}">LuquyPest/Bot-ticketting</a>`,
    },
  },
  mermaid: { theme: 'neutral' },
}));

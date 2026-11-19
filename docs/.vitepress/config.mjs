import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

const REPO = 'https://github.com/LuquyPest/datick';
// Published on GitHub Pages under the custom domain docs.bot.daryu.xyz (site root). Without a custom
// domain the project would live under /datick/: DOCS_BASE=/datick/
const base = process.env.DOCS_BASE || '/';

const guide = [
  {
    text: 'Démarrer',
    items: [
      { text: 'Présentation', link: '/guide/' },
      { text: 'Installation', link: '/guide/installation' },
      { text: 'Portainer, Coolify, Unraid…', link: '/guide/outils' },
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
    text: 'Guides',
    items: [
      { text: 'Venir de GLPI', link: '/guide/venir-de-glpi' },
      { text: 'Venir de Zendesk ou Freshdesk', link: '/guide/venir-de-zendesk' },
      { text: 'Mettre en place un SLA', link: '/guide/mettre-en-place-un-sla' },
      { text: 'Brancher son Active Directory', link: '/guide/active-directory' },
    ],
  },
  {
    text: 'Administrer',
    items: [
      { text: 'Section Instance', link: '/guide/instance' },
      { text: 'Sauvegardes', link: '/guide/sauvegardes' },
      { text: 'Mises à jour', link: '/guide/mise-a-jour' },
      { text: 'Passer à la v4', link: '/guide/passer-a-la-v4' },
      { text: 'Sécurité', link: '/guide/securite' },
      { text: 'Problèmes fréquents', link: '/guide/problemes' },
    ],
  },
  {
    text: 'Projet',
    items: [
      { text: 'Versions', link: '/guide/versions' },
      { text: 'Contribuer', link: '/guide/contribuer' },
      { text: 'Aider à traduire', link: '/guide/traduire' },
      { text: 'Signaler une faille', link: '/guide/signaler-une-faille' },
    ],
  },
];

// English guide (docs/en/): same pages, flat URLs
const guideEn = [
  {
    text: 'Getting started',
    items: [
      { text: 'Overview', link: '/en/overview' },
      { text: 'Installation', link: '/en/installation' },
      { text: 'Portainer, Coolify, Unraid…', link: '/en/tools' },
      { text: 'Configuration', link: '/en/configuration' },
      { text: 'First steps', link: '/en/first-steps' },
    ],
  },
  {
    text: 'Using it',
    items: [
      { text: 'Tickets', link: '/en/tickets' },
      { text: 'Team and permissions', link: '/en/team' },
      { text: 'Discord commands', link: '/en/commands' },
      { text: 'Member space', link: '/en/member-space' },
      { text: 'Automations', link: '/en/automations' },
      { text: 'Integrations', link: '/en/integrations' },
    ],
  },
  {
    text: 'Guides',
    items: [
      { text: 'Coming from GLPI', link: '/en/from-glpi' },
      { text: 'Coming from Zendesk or Freshdesk', link: '/en/from-zendesk' },
      { text: 'Setting up an SLA', link: '/en/setting-up-sla' },
      { text: 'Connecting your Active Directory', link: '/en/active-directory' },
    ],
  },
  {
    text: 'Running it',
    items: [
      { text: 'Instance section', link: '/en/instance' },
      { text: 'Backups', link: '/en/backups' },
      { text: 'Updates', link: '/en/updates' },
      { text: 'Upgrading to v4', link: '/en/upgrade-to-v4' },
      { text: 'Security', link: '/en/security' },
      { text: 'Troubleshooting', link: '/en/troubleshooting' },
    ],
  },
  {
    text: 'Project',
    items: [
      { text: 'Versions', link: '/en/versions' },
      { text: 'Contributing', link: '/en/contributing' },
      { text: 'Help translate', link: '/en/translate' },
      { text: 'Report a vulnerability', link: '/en/report-a-vulnerability' },
    ],
  },
];

export default withMermaid(defineConfig({
  base,
  lang: 'fr-FR',
  title: 'Datick',
  description: 'Système de tickets complet à héberger soi-même : Discord, e-mail, web et API dans un seul dashboard. Logiciel libre.',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['**/node_modules/**', 'README.md'],
  sitemap: { hostname: 'https://docs.bot.daryu.xyz' },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#2f6feb' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Datick — un système de tickets complet : Discord, e-mail, web, API' }],
    ['meta', { property: 'og:description', content: 'Chaque demande devient un ticket, quel que soit le canal, traité depuis un dashboard temps réel. À héberger soi-même, libre (AGPL-3.0).' }],
    ['meta', { property: 'og:image', content: 'https://docs.bot.daryu.xyz/images/social-preview.png' }],
    ['meta', { property: 'og:image:width', content: '1280' }],
    ['meta', { property: 'og:image:height', content: '640' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '^/guide/' },
      { text: 'Installation', link: '/guide/installation' },
      { text: 'Versions', link: '/guide/versions' },
      { text: 'Démo', link: 'https://ticket.sunset-fa.fr/demo' },
    ],
    sidebar: { '/guide/': guide },
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
        locales: {
          en: { translations: { button: { buttonText: 'Search', buttonAriaLabel: 'Search' }, modal: { noResultsText: 'No results for', resetButtonTitle: 'Clear', footer: { selectText: 'open', navigateText: 'navigate', closeText: 'close' } } } },
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
      message: 'Logiciel libre sous licence <a href="https://github.com/LuquyPest/datick/blob/main/LICENSE">AGPL-3.0</a>.',
      copyright: `<a href="${REPO}">LuquyPest/datick</a>`,
    },
  },
  locales: {
    root: { label: 'Français', lang: 'fr-FR' },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'Datick',
      description: 'A complete self-hosted ticketing system: Discord, e-mail, web and API in one dashboard. Free software.',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/en/overview', activeMatch: '^/en/(?!$)' },
          { text: 'Installation', link: '/en/installation' },
          { text: 'Versions', link: '/en/versions' },
          { text: 'Demo', link: 'https://ticket.sunset-fa.fr/demo' },
        ],
        sidebar: { '/en/': guideEn },
        editLink: { pattern: `${REPO}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
        lastUpdated: { text: 'Updated on', formatOptions: { dateStyle: 'long' } },
        docFooter: { prev: 'Previous page', next: 'Next page' },
        outline: { level: [2, 3], label: 'On this page' },
        returnToTopLabel: 'Back to top',
        sidebarMenuLabel: 'Menu',
        darkModeSwitchLabel: 'Theme',
        lightModeSwitchTitle: 'Light theme',
        darkModeSwitchTitle: 'Dark theme',
        footer: {
          message: 'Free software under the <a href="https://github.com/LuquyPest/datick/blob/main/LICENSE">AGPL-3.0</a> licence.',
          copyright: `<a href="${REPO}">LuquyPest/datick</a>`,
        },
      },
    },
  },
  mermaid: { theme: 'neutral' },
}));

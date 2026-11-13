---
layout: home
title: Ticket Bot
titleTemplate: Support Discord par messages privés

hero:
  name: Ticket Bot
  text: Le support Discord par messages privés.
  tagline: Les membres écrivent au bot en MP, ton équipe répond depuis Discord ou un dashboard web temps réel. Tu l'installes chez toi, tu y branches ton bot Discord, il ne dépend de personne.
  image:
    src: /images/dashboard.png
    alt: Tableau de bord de Ticket Bot
  actions:
    - theme: brand
      text: Installer en 20 minutes
      link: /guide/installation
    - theme: alt
      text: Découvrir
      link: /guide/
    - theme: alt
      text: GitHub
      link: https://github.com/LuquyPest/Bot-ticketting

features:
  - title: Tickets en message privé
    details: Sujets, formulaires, FAQ proposée avant d'ouvrir, salon ou fil privé côté staff, transcripts et notation en fin de ticket.
    link: /guide/tickets
    linkText: Le cycle d'un ticket
  - title: Dashboard temps réel
    details: Ma file, Kanban, recherche plein texte, vue fractionnée, notes internes, modèles et macros, statistiques et rapports PDF.
    link: /guide/tickets#cote-staff
    linkText: Côté staff
  - title: Équipe et permissions
    details: Grades aux droits fins, rôles rattachés à des tags, tickets confidentiels, synchronisation avec les rôles Discord.
    link: /guide/equipe
    linkText: Organiser l'équipe
  - title: À toi, sans intermédiaire
    details: Le propriétaire de l'application Discord administre son instance. Pas de compte à créer, sauvegardes chiffrées, mises à jour en une commande.
    link: /guide/instance
    linkText: La section Instance
  - title: Sécurité sérieuse
    details: 2FA imposable, secrets et transcripts chiffrés, journal de chaque action, alerte de nouvel appareil, audits OWASP corrigés.
    link: /guide/securite
    linkText: Les mesures
  - title: Libre et ouvert
    details: Licence AGPL-3.0, API documentée, webhooks, panels Discord, interface en français et en anglais, accessible (WCAG 2.1 AA).
    link: /guide/integrations
    linkText: Intégrations
---

<div class="tb-section">

## En images

<p>Captures de l'interface Pro du dashboard. Elle existe aussi en version « Classique », en thème clair et sombre.</p>

<Gallery />

## Trois commandes

<p>Il faut un serveur avec Docker, un nom de domaine et une application Discord.</p>

<div class="tb-steps">
  <div><b>1. Récupérer</b><p><code>git clone</code> du dépôt sur ton serveur.</p></div>
  <div><b>2. Configurer</b><p><code>scripts/setup.sh</code> pose quelques questions et génère tous les secrets.</p></div>
  <div><b>3. Démarrer</b><p><code>docker compose up -d</code> — HTTPS automatique, sauvegardes chiffrées chaque nuit.</p></div>
</div>

<div class="tb-more">

[Le guide d'installation complet →](/guide/installation)

</div>

</div>

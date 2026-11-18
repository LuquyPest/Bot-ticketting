---
layout: home
title: Datick
titleTemplate: Système de tickets complet, à héberger soi-même

hero:
  name: Datick
  text: Un système de tickets complet.
  tagline: Discord, e-mail, formulaire web, API — chaque demande devient un ticket, et ton équipe les traite toutes depuis un seul dashboard temps réel. Tu l'installes chez toi, il ne dépend de personne. Discord est un canal parmi d'autres, et il est facultatif.
  image:
    src: /images/dashboard.png
    alt: Tableau de bord de Datick
  actions:
    - theme: brand
      text: Installer en 20 minutes
      link: /guide/installation
    - theme: alt
      text: Essayer la démo
      link: https://ticket.sunset-fa.fr/demo
    - theme: alt
      text: Découvrir
      link: /guide/
    - theme: alt
      text: GitHub
      link: https://github.com/LuquyPest/datick

features:
  - title: Tous tes canaux, un seul outil
    details: Messages privés et panels Discord, adresses e-mail de support, espace membre web, widget à coller sur ton site, API et webhooks. Une fiche contact par personne, quel que soit le canal.
    link: /guide/integrations#tickets-par-e-mail
    linkText: Les canaux
  - title: Un vrai outil de support
    details: Catégories et sous-catégories, statuts personnalisés, délais (SLA), équipes et attribution automatique, validations, base de connaissances publique, transcripts et notation.
    link: /guide/tickets
    linkText: Le cycle d'un ticket
  - title: Dashboard temps réel
    details: Ma file, Kanban, recherche plein texte, vue fractionnée, notes internes, modèles et macros, rapports par équipe, catégorie et canal, export CSV et PDF.
    link: /guide/tickets#cote-staff
    linkText: Côté staff
  - title: Équipe et permissions
    details: Grades aux droits fins, équipes et files, rôles rattachés à des tags, tickets confidentiels, invitations par e-mail ou synchronisation avec les rôles Discord.
    link: /guide/equipe
    linkText: Organiser l'équipe
  - title: À toi, sans intermédiaire
    details: Logiciel libre (AGPL-3.0) sur ton serveur : tes moyens de connexion (Discord, Google, Microsoft, OpenID Connect, mot de passe), sauvegardes chiffrées, mises à jour en un clic, interface accessible (WCAG 2.1 AA).
    link: /guide/instance
    linkText: La section Instance
  - title: Sécurité sérieuse
    details: 2FA imposable, secrets et transcripts chiffrés, journal de chaque action, alerte de nouvel appareil, audits OWASP corrigés.
    link: /guide/securite
    linkText: Les mesures
---

<div class="tb-section">

## En images

<p>Captures de l'interface Pro du dashboard. Elle existe aussi en version « Classique », en thème clair et sombre.</p>

<Gallery />

## Trois commandes

<p>Il faut un serveur avec Docker et un nom de domaine. Une application Discord seulement si tu veux le canal Discord.</p>

<div class="tb-steps">
  <div><b>1. Récupérer</b><p><code>git clone</code> du dépôt sur ton serveur.</p></div>
  <div><b>2. Configurer</b><p><code>scripts/setup.sh</code> pose quelques questions et génère tous les secrets.</p></div>
  <div><b>3. Démarrer</b><p><code>docker compose up -d</code> — HTTPS automatique, sauvegardes chiffrées chaque nuit.</p></div>
</div>

<div class="tb-more">

[Le guide d'installation complet →](/guide/installation)

</div>

</div>

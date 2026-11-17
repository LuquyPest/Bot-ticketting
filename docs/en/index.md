---
layout: home
title: Datick
titleTemplate: Discord support through direct messages

hero:
  name: Datick
  text: Discord support through direct messages.
  tagline: Members DM the bot, your team answers from Discord or from a real-time web dashboard. You host it yourself, plug in your own Discord bot, and it depends on no one.
  image:
    src: /images/dashboard.png
    alt: Datick dashboard
  actions:
    - theme: brand
      text: Install in 20 minutes
      link: /en/installation
    - theme: alt
      text: Try the demo
      link: https://ticket.sunset-fa.fr/demo
    - theme: alt
      text: Overview
      link: /en/overview
    - theme: alt
      text: GitHub
      link: https://github.com/LuquyPest/Bot-ticketting

features:
  - title: Tickets in direct messages
    details: Subjects, forms, FAQ suggested before opening, private channel or thread for the staff, transcripts and rating when the ticket closes.
    link: /en/tickets
    linkText: The life of a ticket
  - title: Real-time dashboard
    details: My queue, Kanban, full-text search, split view, internal notes, templates and macros, statistics and PDF reports.
    link: /en/tickets#staff-side
    linkText: Staff side
  - title: Team and permissions
    details: Grades with fine-grained rights, roles tied to tags, confidential tickets, sync with Discord roles.
    link: /en/team
    linkText: Organise the team
  - title: Yours, no middleman
    details: The owner of the Discord application runs their instance. No account to create, encrypted backups, one-click updates.
    link: /en/instance
    linkText: The Instance section
  - title: Serious security
    details: Enforceable 2FA, encrypted secrets and transcripts, a log of every action, new-device alerts, OWASP audits fixed.
    link: /en/security
    linkText: The measures
  - title: Free and open
    details: AGPL-3.0 licence, documented API, webhooks, Discord panels, dashboard in English and French, member messages in six languages, accessible (WCAG 2.1 AA).
    link: /en/integrations
    linkText: Integrations
---

<div class="tb-section">

## Screenshots

<p>The Pro interface of the dashboard. A « Classic » interface exists too, in light and dark themes. Screenshots show the French interface; the dashboard follows your browser language.</p>

<Gallery />

## Three commands

<p>You need a server with Docker, a domain name and a Discord application.</p>

<div class="tb-steps">
  <div><b>1. Get it</b><p><code>git clone</code> the repository on your server.</p></div>
  <div><b>2. Configure</b><p><code>scripts/setup.sh --lang en</code> asks a few questions and generates every secret.</p></div>
  <div><b>3. Start</b><p><code>docker compose up -d</code> — automatic HTTPS, encrypted backups every night.</p></div>
</div>

<div class="tb-more">

[The full installation guide →](/en/installation)

</div>

</div>

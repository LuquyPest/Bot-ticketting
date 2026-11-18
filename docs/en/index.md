---
layout: home
title: Datick
titleTemplate: A complete, self-hosted ticketing system

hero:
  name: Datick
  text: A complete ticketing system.
  tagline: Discord, e-mail, web form, API — every request becomes a ticket, and your team handles them all from one real-time dashboard. You host it yourself, and it depends on no one. Discord is one channel among others, and it is optional.
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
      link: https://github.com/LuquyPest/datick

features:
  - title: All your channels, one tool
    details: Discord direct messages and panels, support e-mail addresses, web member space, a widget to paste on your site, API and webhooks. One contact card per person, whatever the channel.
    link: /en/integrations#tickets-by-e-mail
    linkText: The channels
  - title: A real support tool
    details: Categories and sub-categories, custom statuses, SLAs, teams and automatic assignment, approvals, public knowledge base, transcripts and ratings.
    link: /en/tickets
    linkText: The life of a ticket
  - title: Real-time dashboard
    details: My queue, Kanban, full-text search, split view, internal notes, templates and macros, reports by team, category and channel, CSV and PDF exports.
    link: /en/tickets#staff-side
    linkText: Staff side
  - title: Team and permissions
    details: Grades with fine-grained rights, teams and queues, roles tied to tags, confidential tickets, invitations by e-mail or sync with Discord roles.
    link: /en/team
    linkText: Organise the team
  - title: Yours, no middleman
    details: Free software (AGPL-3.0) on your server: your ways to sign in (Discord, Google, Microsoft, OpenID Connect, password), encrypted backups, one-click updates, accessible interface (WCAG 2.1 AA).
    link: /en/instance
    linkText: The Instance section
  - title: Serious security
    details: Enforceable 2FA, encrypted secrets and transcripts, a log of every action, new-device alerts, OWASP audits fixed.
    link: /en/security
    linkText: The measures
---

<div class="tb-section">

## Screenshots

<p>The Pro interface of the dashboard. A « Classic » interface exists too, in light and dark themes. Screenshots show the French interface; the dashboard follows your browser language.</p>

<Gallery />

## Three commands

<p>You need a server with Docker and a domain name. A Discord application only if you want the Discord channel.</p>

<div class="tb-steps">
  <div><b>1. Get it</b><p><code>git clone</code> the repository on your server.</p></div>
  <div><b>2. Configure</b><p><code>scripts/setup.sh --lang en</code> asks a few questions and generates every secret.</p></div>
  <div><b>3. Start</b><p><code>docker compose up -d</code> — automatic HTTPS, encrypted backups every night.</p></div>
</div>

<div class="tb-more">

[The full installation guide →](/en/installation)

</div>

</div>

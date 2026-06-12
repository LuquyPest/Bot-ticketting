import React, { useState } from 'react';
import { ScrollText, ChevronDown, ChevronUp } from 'lucide-react';

const TAG = {
  new:  { label: 'Nouveau',     cls: 'bg-indigo-600/20 text-primary-light border-primary/30' },
  fix:  { label: 'Correction',  cls: 'bg-red-600/20    text-red-400    border-red-600/30' },
  impr: { label: 'Amélioration',cls: 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30' },
  tech: { label: 'Technique',   cls: 'bg-white/[0.06] text-ink-2 border-white/[0.08]' },
};

const VERSIONS = [
  {
    version: 'v2.7',
    date: '12 juin 2026',
    title: 'Correctifs de sécurité — pentest round 2',
    changes: [
      { type: 'fix',  text: 'Session fixation sur le panel SuperAdmin : session.regenerate() ajouté après validation TOTP (totp-setup et totp-verify), conformément au flux OAuth utilisateur' },
      { type: 'fix',  text: 'SSRF via souscription Web Push : l\'endpoint est désormais validé contre une allowlist des origines push connues (FCM, Mozilla, Apple, Windows) avant stockage' },
      { type: 'fix',  text: 'DNS rebinding sur les webhooks sortants : le hostname est résolu une seule fois et l\'IP est pinée directement dans https.request — une seconde résolution DNS hostile ne peut plus hijacker la connexion' },
      { type: 'fix',  text: 'URL de photo de profil : validation du scheme HTTPS obligatoire (javascript: et http:// rejetés)' },
      { type: 'fix',  text: 'Validation stricte du format snowflake Discord (^\d{17,20}$) dans getDbName — protège le DROP DATABASE lors de la suppression d\'un serveur' },
      { type: 'fix',  text: 'Longueur maximum sur la recherche analytics fixée à 100 caractères (les wildcards LIKE étaient déjà échappés)' },
      { type: 'tech', text: 'Header Permissions-Policy ajouté : camera, microphone, géolocalisation, paiement et USB désactivés explicitement' },
    ]
  },
  {
    version: 'v2.6',
    date: '11 juin 2026',
    title: 'Refonte graphique — design tokens WCAG, accessibilité et polish UI',
    changes: [
      { type: 'impr', text: 'Tokens de couleur mis à niveau WCAG AA : ink-3 et ink-4 recalculés pour atteindre les ratios de contraste minimaux (5:1 et 3:1) en mode sombre et clair' },
      { type: 'impr', text: 'Tokens sémantiques ajoutés : --color-success, --color-warning, --color-danger avec variantes light — mappés dans Tailwind (success, warning, danger)' },
      { type: 'impr', text: 'prefers-reduced-motion : bloc @media complet désactivant toutes les animations pour les utilisateurs qui le demandent' },
      { type: 'impr', text: 'Classes réutilisables dans @layer components : .btn, .btn-primary, .btn-secondary, .btn-danger, .btn-ghost, .card, .input-base (min-height 44px touch target)' },
      { type: 'impr', text: 'StatCard redesignée : ligne accent 2px dégradée en haut, nombre en text-2rem, icône avec ring lumineux, glow dynamique au survol via onMouseEnter/Leave' },
      { type: 'impr', text: 'Badge avec animation pulse (dot-pulse keyframe) sur le statut ouvert uniquement, role="status" et aria-label pour les lecteurs d\'écran' },
      { type: 'impr', text: 'Dashboard : médailles emoji (🥇🥈🥉) remplacées par des badges numérotés HTML avec classes de couleur or/argent/bronze — conforme P4 no-emoji-icons' },
      { type: 'impr', text: 'Tooltips des graphiques : couleurs de fond et de texte remplacées par des variables CSS (var(--color-surface-elevated), var(--color-ink-1)) pour s\'adapter au mode clair/sombre' },
      { type: 'impr', text: 'Sidebar : aria-label, aria-expanded et aria-controls sur le bouton hamburger ; aria-hidden sur toutes les icônes décoratives ; transition réduite à 200ms ease-out' },
      { type: 'impr', text: 'Sidebar : aria-label sur tous les boutons icon-only — ⌘K, thème, déconnexion, avatar profil' },
      { type: 'fix',  text: 'NotificationBell : balise <button> imbriquée dans une autre <button> (HTML invalide) — restructuré en <li> avec deux boutons séparés (item + dismiss)' },
      { type: 'fix',  text: 'NotificationBell : aria-label dynamique sur la cloche (compte de notifications non lues), aria-expanded, aria-controls, aria-live="polite" sur le panel' },
      { type: 'tech', text: 'Police Inter : passage à la variable font complète (opsz + wght 100–900), ajout de crossorigin sur les deux preconnect, font-display:optional pour supprimer le FOIT' },
    ]
  },
  {
    version: 'v2.5',
    date: '10 juin 2026',
    title: 'Embeds Discord enrichis — 10 types de messages refactorisés',
    changes: [
      { type: 'impr', text: 'Boutons du ticket : labels renommés "🔒 Fermer le ticket" et "📋 Transcript", ordre inversé (fermeture en premier)' },
      { type: 'impr', text: 'Embed d\'ouverture : setAuthor "Nouveau ticket", titre "#ID", description avec mention de l\'utilisateur, 3 champs en ligne (Utilisateur / Sujet / Priorité), footer horodaté' },
      { type: 'impr', text: 'Relay DM utilisateur → ticket : passage de texte brut (`--- tag : message`) à un EmbedBuilder avec auteur, contenu, heure et champ pièce jointe' },
      { type: 'impr', text: 'Réponse staff /reply : embed indigo avec badge "Staff", description, heure et champ pièce jointe — envoyé en DM et dans le canal' },
      { type: 'impr', text: 'Claim : embed vert (0x1abc9c) "✋ Ticket pris en charge" avec mention staff et heure' },
      { type: 'impr', text: 'Unclaim : embed gris (0x4e5058) "↩️ Ticket désattribué" avec mention staff et heure' },
      { type: 'impr', text: 'Note interne : embed jaune (0xfee75c) avec bandeau "🔒 Note interne — visible staff uniquement" et footer auteur/heure' },
      { type: 'impr', text: 'Changement de priorité : embed coloré dynamiquement (vert Faible / indigo Normal / rouge Urgent) avec 3 champs et message épinglé automatiquement' },
      { type: 'impr', text: 'Log de fermeture : embed violet (0x6366f1) avec durée calculée depuis l\'ouverture, mention utilisateur, staff, sujet et ID transcript' },
      { type: 'impr', text: 'DM de fermeture : embed séparé avec durée et staff, puis embed de notation indépendant pour le propriétaire du ticket uniquement' },
      { type: 'impr', text: 'DM de bienvenue : embed avec titre "🎫 Ticket #ID créé", message de bienvenue configuré, champ sujet si présent' },
      { type: 'impr', text: 'Réouverture : embed enrichi avec 3 champs + DM embed envoyé au propriétaire du ticket' },
    ]
  },
  {
    version: 'v2.4',
    date: '9 juin 2026',
    title: 'Panels Discord, formulaires d\'intake et identité bot par serveur',
    changes: [
      { type: 'new',  text: 'Panels visuels : création de boutons Discord persistants dans n\'importe quel salon pour ouvrir un ticket — titre, description, couleur, emoji et sujet pré-rempli configurables' },
      { type: 'new',  text: 'Formulaires d\'intake : chaque panel peut être associé à un formulaire Discord (modal) avec jusqu\'à 5 champs personnalisés (court/long, obligatoire ou non, placeholder)' },
      { type: 'new',  text: 'Déploiement des panels : bouton "Publier" depuis le dashboard envoie le message avec bouton(s) dans le canal Discord cible' },
      { type: 'new',  text: 'Identité bot par serveur : le fondateur peut modifier le pseudo et l\'avatar du bot spécifiquement pour son serveur depuis les Paramètres' },
      { type: 'tech', text: 'Nouvelles tables : ticket_panels, intake_forms, intake_form_fields, intake_form_responses' },
      { type: 'tech', text: 'Nouveaux événements Discord : boutons de panel routés vers l\'event panelTicket.js, création de ticket avec champs pré-remplis depuis le formulaire' },
    ]
  },
  {
    version: 'v2.3',
    date: '8 juin 2026',
    title: 'UX avancée — Command palette, notifications, raccourcis clavier',
    changes: [
      { type: 'new',  text: 'Command palette ⌘K / Ctrl+K : recherche globale des pages avec navigation clavier (flèches, Entrée, Esc), filtrage par rôle' },
      { type: 'new',  text: 'Notifications in-app : cloche dans la sidebar avec badge animé, dropdown horodaté et navigation directe vers le ticket (via SSE)' },
      { type: 'new',  text: 'Indicateur de statut SSE : dot vert/orange/rouge sur le logo de la sidebar selon l\'état de la connexion temps réel' },
      { type: 'new',  text: 'Raccourcis clavier Tickets : J/K ou flèches pour naviguer, Entrée pour ouvrir, / pour la recherche, Esc pour reset' },
      { type: 'new',  text: 'Raccourcis clavier TicketDetail : R = focus réponse, N = focus note interne, Esc = retour à /tickets' },
      { type: 'new',  text: 'Filtre date range sur la page Tickets (Du/Au) avec indicateur actif et effacement rapide' },
      { type: 'new',  text: 'Badges SLA sur les tickets ouverts : durée sans réponse (ambre ≥4h, rouge ≥3j) avec icône alerte' },
      { type: 'new',  text: 'Bulk actions étendues : Assigner staff + Ajouter tag en plus du changement de priorité' },
      { type: 'new',  text: 'Dashboard support personnalisé : cartes KPI (fermetures, claims, tps réponse, note) et barre de progression dans le classement équipe' },
      { type: 'new',  text: 'Avatars Discord réels dans le chat TicketDetail si l\'image de profil est disponible' },
      { type: 'new',  text: 'Sidebar responsive mobile : bouton hamburger, slide-in/out, overlay de fermeture' },
      { type: 'impr', text: 'Skeleton loaders (shimmer) sur Dashboard, Tickets et Staff au lieu du spinner plein écran' },
      { type: 'impr', text: 'Confirmation des actions destructives via toast interactif (non-bloquant) au lieu de window.confirm()' },
      { type: 'tech', text: 'Architecture SSE refactorisée : une seule connexion EventSource partagée via SSEContext + bus EventTarget' },
      { type: 'tech', text: 'Lazy loading React.lazy() + Suspense sur toutes les routes pour un chargement initial plus rapide' },
      { type: 'tech', text: 'ErrorBoundary par page : capture les erreurs sans planter toute l\'interface' },
    ]
  },
  {
    version: 'v2.2',
    date: '7 juin 2026',
    title: 'Correctifs & UX',
    changes: [
      { type: 'fix',  text: 'Fusion des pages "Staff" et "Utilisateurs" en une seule page "Équipe" avec deux onglets : Gestion et Statistiques' },
      { type: 'fix',  text: 'Messages programmés retirés de l\'interface (fonctionnalité interne uniquement)' },
      { type: 'fix',  text: 'Chargement des grades rendu tolérant aux pannes : les utilisateurs restent accessibles même si la route /grades échoue' },
      { type: 'fix',  text: 'Tags : ajout d\'une page de gestion dédiée (fondateur) pour créer, modifier et supprimer les tags avant de les assigner aux tickets' },
      { type: 'impr', text: 'Sidebar fondateur nettoyée : navigation plus concise, entrées dupliquées supprimées' },
    ]
  },
  {
    version: 'v2.1',
    date: '7 juin 2026',
    title: 'Système de grades, kanban, tags et nouvelles fonctionnalités',
    changes: [
      { type: 'new',  text: 'Système de grades hiérarchiques : création, modification, suppression avec héritage de permissions' },
      { type: 'new',  text: '10 permissions granulaires par grade : voir tickets, claim, répondre, fermer, gérer participants, transcripts, utilisateurs, grades, paramètres, audit' },
      { type: 'new',  text: 'Page Audit : journal complet de toutes les actions effectuées sur les grades et permissions' },
      { type: 'new',  text: 'Vue Kanban : 3 colonnes (Non claim / En cours / Fermés) avec mise à jour en temps réel via SSE' },
      { type: 'new',  text: 'Tags colorés libres sur les tickets : assignation et retrait depuis la vue détaillée du ticket' },
      { type: 'new',  text: 'Rapport hebdomadaire automatique : embed Discord chaque lundi à 9h avec les stats de la semaine' },
      { type: 'new',  text: 'Blacklist temporaire : durées sélectionnables (1j / 7j / 30j / permanent) avec expiration automatique' },
      { type: 'new',  text: 'Mode vacances par agent : désactive les assignations automatiques pendant l\'absence' },
      { type: 'new',  text: 'Historique des tickets par utilisateur : consulter tous les tickets passés d\'un membre depuis la vue ticket' },
      { type: 'new',  text: 'Réouverture avec motif : un champ raison est demandé avant de rouvrir un ticket fermé' },
      { type: 'new',  text: 'Alerte anti-spam : le fondateur est notifié sur Discord quand un utilisateur atteint la limite quotidienne de tickets' },
      { type: 'impr', text: 'Dashboard enrichi : taux de claim, heatmap 24h, top 3 staff, section tickets stale, filtre par statut sur les récents, donut de priorité' },
      { type: 'impr', text: 'Graphique d\'activité : 3ème courbe "Non claimés" ajoutée en plus de Ouverts/Fermés' },
      { type: 'tech', text: 'Nouvelles tables : grades, grade_permissions, user_grades, audit_log, ticket_tags, ticket_tag_assignments' },
      { type: 'tech', text: 'Migrations : expires_at sur blacklist, vacation_mode sur dashboard_users, visibility_grade_id sur tickets' },
    ]
  },
  {
    version: 'v2.0',
    date: '7 juin 2026',
    title: 'Temps réel, templates, aging et topic Discord',
    changes: [
      { type: 'new',  text: 'SSE (Server-Sent Events) : notes et réponses apparaissent instantanément sans recharger la page' },
      { type: 'new',  text: 'Templates de réponse : création, suppression et insertion en un clic depuis la boîte de composition' },
      { type: 'new',  text: 'Édition du sujet du ticket en ligne depuis la sidebar du dashboard (crayon au survol)' },
      { type: 'new',  text: 'Indicateurs de messages non-lus : point bleu sur les tickets avec activité non consultée' },
      { type: 'new',  text: 'Aging coloré : durée depuis le dernier message (ex. "3j sans réponse") en ambre/rouge' },
      { type: 'new',  text: 'Notifications navigateur à la création d\'un nouveau ticket' },
      { type: 'impr', text: 'Topic de salon Discord mis à jour automatiquement après claim, unclaim, changement de priorité ou de sujet' },
      { type: 'impr', text: 'Embed EmbedBuilder pour le message de bienvenue à la création du ticket (couleurs, champs structurés)' },
      { type: 'impr', text: 'Mise à jour SSE en temps réel sur la liste des tickets (priorité, claim, statut)' },
      { type: 'new',  text: 'Route PATCH /api/tickets/:id/subject et API /api/templates (GET, POST, DELETE)' },
      { type: 'tech', text: 'Table reply_templates ajoutée en base de données' },
      { type: 'tech', text: 'utils/sse.js : singleton de diffusion SSE partagé entre toutes les routes et les events Discord' },
    ]
  },
  {
    version: 'v1.9',
    date: '7 juin 2026',
    title: 'Refonte complète du dashboard — design SaaS professionnel',
    changes: [
      { type: 'impr', text: 'Refonte totale de l\'interface : palette dark slate/indigo, typographie serrée, espacement cohérent' },
      { type: 'impr', text: 'TicketDetail : layout 2 colonnes — timeline à gauche, sidebar sticky à droite' },
      { type: 'impr', text: 'Timeline colorée par source : indigo (Discord), vert (réponse), gris (note interne)' },
      { type: 'impr', text: 'Boîte de composition avec onglets Note interne / Répondre et toggle Anonyme/Identifié' },
      { type: 'impr', text: 'Liste des tickets : dot de priorité inline, bordure rouge sur les tickets urgents' },
      { type: 'impr', text: 'Badges arrondis avec dot coloré pour statut et priorité' },
      { type: 'impr', text: 'Sidebar navigation : accent left-border sur l\'onglet actif, largeur réduite et compacte' },
      { type: 'impr', text: 'Toutes les actions ticket dans la sidebar (claim, priorité, participants, renommer, déplacer)' },
    ]
  },
  {
    version: 'v1.8',
    date: '7 juin 2026',
    title: 'Parité complète Discord ↔ Dashboard',
    changes: [
      { type: 'new',  text: 'Claim / unclaim depuis le dashboard — message envoyé dans le salon Discord' },
      { type: 'new',  text: 'Réponse au membre (Reply) depuis le dashboard avec option anonyme' },
      { type: 'new',  text: 'Ajout et retrait de participants DM depuis le dashboard' },
      { type: 'new',  text: 'Déplacement de ticket dans une catégorie Discord depuis le dashboard' },
      { type: 'new',  text: 'Renommage du salon Discord depuis le dashboard' },
      { type: 'impr', text: 'Résolution des noms d\'utilisateur Discord pour les participants dans la vue ticket' },
      { type: 'impr', text: 'Synchronisation complète : toutes les actions Discord disponibles sur le dashboard et vice-versa' },
      { type: 'tech', text: 'Route /api/discord/categories pour lister les catégories Discord disponibles' },
    ]
  },
  {
    version: 'v1.7',
    date: '6 juin 2026',
    title: 'Infrastructure Docker & fonctionnalités backend',
    changes: [
      { type: 'new',  text: 'Docker Compose : stack complète bot + MariaDB 11 avec healthcheck' },
      { type: 'new',  text: 'Dockerfile multi-stage : build du dashboard React inclus dans l\'image de production' },
      { type: 'new',  text: 'Accès uniquement via reverse proxy — port interne non exposé publiquement' },
      { type: 'new',  text: 'Graceful shutdown : fermeture propre du bot et du serveur web sur SIGTERM/SIGINT' },
      { type: 'new',  text: 'Logs JSON structurés (logger.js) pour l\'audit des requêtes mutantes' },
      { type: 'new',  text: 'Endpoint GET /api/health avec vérification de la connexion base de données' },
      { type: 'new',  text: 'Notes internes staff : visibles uniquement sur le dashboard, relayées dans le salon Discord' },
      { type: 'new',  text: 'Synchronisation bidirectionnelle : messages Discord enregistrés comme notes dans le dashboard' },
      { type: 'new',  text: 'Export CSV des tickets (fondateur) avec tous les champs' },
      { type: 'impr', text: 'Auto-refresh du dashboard toutes les 15–30 secondes sur les pages tickets et dashboard' },
      { type: 'impr', text: 'Tri configurable dans la page Staff (fermetures, claims, note, temps de réponse)' },
      { type: 'tech', text: 'Refactoring général : nettoyage des imports, séparation des responsabilités' },
    ]
  },
  {
    version: 'v1.6',
    date: '6 juin 2026',
    title: 'Correctifs de sécurité (pentest)',
    changes: [
      { type: 'fix',  text: 'CSRF : protection via header X-Requested-With sur toutes les requêtes mutantes (POST, PATCH, DELETE)' },
      { type: 'fix',  text: 'Session : secret obligatoire (erreur fatale si absent), session.regenerate() au login, cookie HttpOnly + SameSite + Secure' },
      { type: 'fix',  text: 'Sessions persistées en MySQL (express-mysql-session) — suppression du MemoryStore' },
      { type: 'fix',  text: 'Rôle rechargé depuis la base à chaque requête — révocation immédiate sans déconnexion' },
      { type: 'fix',  text: 'IDOR : support limité à ses propres tickets (claimed_by = session.user.id) sur toutes les routes' },
      { type: 'fix',  text: 'IDOR : dashboard/recent filtré par claimed_by pour les membres support' },
      { type: 'fix',  text: 'Notation Discord : ownership vérifié en base, closedById non lu depuis le customId, double notation bloquée (index UNIQUE)' },
      { type: 'fix',  text: 'OAuth : state aléatoire ajouté pour protéger le callback contre le CSRF' },
      { type: 'fix',  text: 'CSP stricte sur les pages transcript + headers Helmet (X-Content-Type-Options, X-Frame-Options, etc.)' },
      { type: 'fix',  text: 'GET /api/config en allowlist stricte — token, DB credentials et guildId non exposés' },
      { type: 'fix',  text: 'Validation des entrées : regex snowflake sur userId, longueurs max, types par champ' },
      { type: 'fix',  text: 'Validation du sujet Discord contre la liste ticketSubjects configurée' },
      { type: 'tech', text: 'Ajout de helmet et express-rate-limit (20 req/15min sur /auth, 200 req/min sur /api)' },
    ]
  },
  {
    version: 'v1.5',
    date: '6 juin 2026',
    title: 'Système de rôles dashboard & fusion des serveurs web',
    changes: [
      { type: 'new',  text: 'Rôles dashboard : nouveau / support / fondateur stockés en base de données' },
      { type: 'new',  text: 'Fondateur défini par webFounderId dans config.json — connexion Discord OAuth uniquement' },
      { type: 'new',  text: 'Page "En attente" pour les utilisateurs sans rôle (nouveau)' },
      { type: 'new',  text: 'Page de gestion des utilisateurs réservée au fondateur' },
      { type: 'new',  text: 'Badge "Suggéré" si l\'utilisateur a le rôle Discord support — attribution manuelle uniquement' },
      { type: 'impr', text: 'Fusion du serveur de transcripts et du dashboard sur un seul port (webServerPort)' },
      { type: 'impr', text: 'Navigation filtrée par rôle dans la sidebar' },
      { type: 'impr', text: 'Support : accès limité aux stats générales et ses propres stats staff' },
      { type: 'impr', text: 'Fondateur : accès complet (blacklist, transcripts, paramètres, utilisateurs)' },
      { type: 'tech', text: 'Nouveau flag webEnabled (true/false) pour activer/désactiver tout le système web' },
      { type: 'tech', text: 'Suppression de l\'auth par mot de passe — uniquement Discord OAuth' },
      { type: 'tech', text: 'Table dashboard_users ajoutée en base de données' },
    ]
  },
  {
    version: 'v1.4',
    date: '6 juin 2026',
    title: 'Interface web d\'administration (Dashboard)',
    changes: [
      { type: 'new',  text: 'Dashboard React + Vite + Tailwind CSS — interface moderne dark theme' },
      { type: 'new',  text: 'Backend Express unifié avec API REST complète' },
      { type: 'new',  text: 'Page Dashboard : stats globales + graphique d\'activité 7/14/30 jours' },
      { type: 'new',  text: 'Page Tickets : liste filtrée par statut/priorité/sujet + vue détaillée' },
      { type: 'new',  text: 'Page Staff : statistiques par agent (claims, fermetures, temps de réponse, notes)' },
      { type: 'new',  text: 'Page Blacklist : gestion complète via interface graphique' },
      { type: 'new',  text: 'Page Transcripts : consultation et téléchargement de tous les transcripts archivés' },
      { type: 'new',  text: 'Page Paramètres : modification de config.json via formulaire' },
      { type: 'new',  text: 'Authentification Discord OAuth2' },
      { type: 'tech', text: 'config.example.json avec tous les champs documentés' },
    ]
  },
  {
    version: 'v1.3',
    date: '6 juin 2026',
    title: '11 nouvelles fonctionnalités',
    changes: [
      { type: 'tech', text: 'Migration SQL : nouvelles tables blacklist, ticket_ratings et colonnes sur tickets/admin_stats' },
      { type: 'new',  text: 'Message de bienvenue DM configurable via welcomeMessage dans config.json' },
      { type: 'new',  text: 'Menu de sujets de ticket en DM avant création (ticketSubjects)' },
      { type: 'new',  text: 'Notation de satisfaction 1–5 étoiles envoyée en DM après fermeture' },
      { type: 'new',  text: 'Commande /priority : changer la priorité d\'un ticket (Faible/Normal/Urgent)' },
      { type: 'new',  text: 'Fermeture automatique des tickets inactifs avec avertissement préalable' },
      { type: 'new',  text: 'Commande /blacklist : bannir/débannir/lister les utilisateurs' },
      { type: 'new',  text: 'Commande /reopen : rouvrir le dernier ticket fermé d\'un utilisateur' },
      { type: 'impr', text: '/staffstats : ajout du temps de réponse moyen et de la note moyenne' },
      { type: 'new',  text: 'Anti-spam DM : limite quotidienne de tickets par utilisateur (maxTicketsPerDay)' },
      { type: 'new',  text: 'Rate limiting sur /reply et /areply (replyRateLimitSeconds)' },
    ]
  },
  {
    version: 'v1.2',
    date: '6 juin 2026',
    title: 'Système de transcripts web',
    changes: [
      { type: 'new',  text: 'Serveur HTTP intégré hébergeant les transcripts comme pages web temporaires (10 min)' },
      { type: 'impr', text: 'Bouton Transcript et /gettranscript envoient désormais un lien web au lieu d\'un fichier' },
      { type: 'new',  text: 'Page HTML stylisée : sidebar infos ticket, aperçu images/vidéos, téléchargement fichiers' },
      { type: 'tech', text: 'Tokens UUID uniques par transcript, expiration automatique' },
      { type: 'tech', text: 'webServerPort et webServerBaseUrl ajoutés à config.json' },
    ]
  },
  {
    version: 'v1.1',
    date: '6 juin 2026',
    title: 'Refactor & corrections de bugs',
    changes: [
      { type: 'tech', text: 'Refactoring complet : système de relay DM multi-participants' },
      { type: 'fix',  text: 'Transmission des pièces jointes DM vers le canal ticket' },
      { type: 'fix',  text: 'Alimentation de admin_stats pour que /staffstats fonctionne' },
      { type: 'fix',  text: 'Fermeture du ticket orphelin si son canal Discord a été supprimé' },
      { type: 'fix',  text: 'Race condition à la création de tickets (double création impossible)' },
      { type: 'fix',  text: 'deferReply sur le bouton Transcript pour éviter le timeout d\'interaction' },
      { type: 'fix',  text: 'Suppression du handler raw en doublon dans index.js' },
      { type: 'fix',  text: 'guild.channels.fetch() dans /moveticket au lieu du cache' },
      { type: 'fix',  text: '/claim bloqué si le ticket est déjà pris par quelqu\'un d\'autre' },
      { type: 'fix',  text: 'Avatars dans les transcripts : utilisation de displayAvatarURL()' },
      { type: 'fix',  text: 'Message d\'erreur actionnable dans /adduser si la cible a déjà un ticket ouvert' },
      { type: 'tech', text: 'Mise à jour de sécurité ws 8.20.0 → 8.21.0' },
    ]
  },
  {
    version: 'v1.0',
    date: '15 avril 2026',
    title: 'Version initiale',
    changes: [
      { type: 'new',  text: 'Bot Discord de tickets via message privé → salon dédié par ticket' },
      { type: 'new',  text: 'Relay bidirectionnel : DM membre ↔ canal staff' },
      { type: 'new',  text: 'Commandes : /reply, /areply, /adduser, /removeuser, /rename' },
      { type: 'new',  text: 'Commandes : /claim, /unclaim, /moveticket, /oldtickets' },
      { type: 'new',  text: 'Commandes : /gettranscript, /staffstats' },
      { type: 'new',  text: 'Boutons : Transcript, Fermer et enregistrer le transcript' },
      { type: 'new',  text: 'Système de logs (fermeture, claim, déplacement, ajout/retrait utilisateur)' },
      { type: 'new',  text: 'Base de données MariaDB : tickets, participants, admin_stats, transcript_snapshots' },
      { type: 'new',  text: 'bootstrap.js : vérification complète de l\'environnement au démarrage' },
    ]
  }
];

function VersionCard({ v }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="bg-surface-card border border-white/[0.06] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-surface/40 transition-colors text-left"
      >
        <span className="px-2.5 py-1 rounded-lg bg-indigo-600/20 border border-primary/30 text-primary-light text-xs font-bold font-mono flex-shrink-0">
          {v.version}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-1">{v.title}</p>
          <p className="text-xs text-ink-3 mt-0.5">{v.date}</p>
        </div>
        <span className="text-xs text-ink-4 flex-shrink-0">{v.changes.length} changement(s)</span>
        {open ? <ChevronUp size={15} className="text-ink-4 flex-shrink-0" /> : <ChevronDown size={15} className="text-ink-4 flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-5 py-4 space-y-2">
          {v.changes.map((c, i) => {
            const tag = TAG[c.type];
            return (
              <div key={i} className="flex items-start gap-3">
                <span className={`mt-0.5 flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium border ${tag.cls}`}>
                  {tag.label}
                </span>
                <p className="text-sm text-ink-2 leading-relaxed">{c.text}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Patchnotes() {
  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/15 text-primary-light flex items-center justify-center flex-shrink-0">
          <ScrollText size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-ink-1">Patchnotes</h1>
          <p className="text-sm text-ink-3 mt-0.5">Historique de toutes les modifications depuis le lancement</p>
        </div>
      </div>

      <div className="space-y-3">
        {VERSIONS.map(v => <VersionCard key={v.version} v={v} />)}
      </div>
    </div>
  );
}

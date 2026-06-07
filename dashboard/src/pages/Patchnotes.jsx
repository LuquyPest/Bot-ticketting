import React, { useState } from 'react';
import { ScrollText, ChevronDown, ChevronUp } from 'lucide-react';

const TAG = {
  new:  { label: 'Nouveau',     cls: 'bg-indigo-600/20 text-indigo-400 border-indigo-600/30' },
  fix:  { label: 'Correction',  cls: 'bg-red-600/20    text-red-400    border-red-600/30' },
  impr: { label: 'Amélioration',cls: 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30' },
  tech: { label: 'Technique',   cls: 'bg-slate-600/20  text-slate-400  border-slate-600/30' },
};

const VERSIONS = [
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
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-800/40 transition-colors text-left"
      >
        <span className="px-2.5 py-1 rounded-lg bg-indigo-600/20 border border-indigo-600/30 text-indigo-400 text-xs font-bold font-mono flex-shrink-0">
          {v.version}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-100">{v.title}</p>
          <p className="text-xs text-slate-500 mt-0.5">{v.date}</p>
        </div>
        <span className="text-xs text-slate-600 flex-shrink-0">{v.changes.length} changement(s)</span>
        {open ? <ChevronUp size={15} className="text-slate-600 flex-shrink-0" /> : <ChevronDown size={15} className="text-slate-600 flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-slate-800 px-5 py-4 space-y-2">
          {v.changes.map((c, i) => {
            const tag = TAG[c.type];
            return (
              <div key={i} className="flex items-start gap-3">
                <span className={`mt-0.5 flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium border ${tag.cls}`}>
                  {tag.label}
                </span>
                <p className="text-sm text-slate-300 leading-relaxed">{c.text}</p>
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
        <div className="w-10 h-10 rounded-lg bg-indigo-600/15 text-indigo-400 flex items-center justify-center flex-shrink-0">
          <ScrollText size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-100">Patchnotes</h1>
          <p className="text-sm text-slate-500 mt-0.5">Historique de toutes les modifications depuis le lancement</p>
        </div>
      </div>

      <div className="space-y-3">
        {VERSIONS.map(v => <VersionCard key={v.version} v={v} />)}
      </div>
    </div>
  );
}

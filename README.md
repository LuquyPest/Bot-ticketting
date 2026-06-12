# Bot Ticketing Discord — Multi-Tenant

Bot Discord de support par tickets avec **dashboard web d'administration**. Architecture **multi-tenant** : un seul bot peut servir plusieurs serveurs Discord simultanément, chaque serveur ayant sa propre base de données isolée et son propre dashboard.

---

## Sommaire

- [Architecture](#architecture)
- [Stack technique](#stack-technique)
- [Fonctionnement — cycle de vie d'un ticket](#fonctionnement--cycle-de-vie-dun-ticket)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration config.json](#configuration-configjson)
- [Activation d'un serveur](#activation-dun-serveur)
- [Dashboard web](#dashboard-web)
- [Panel Superadmin](#panel-superadmin)
- [Commandes Discord](#commandes-discord)
- [Fonctionnalités avancées](#fonctionnalités-avancées)
- [Panels Discord](#panels-discord)
- [Push Notifications Web](#push-notifications-web)
- [Gestion des sessions](#gestion-des-sessions)
- [Webhooks sortants](#webhooks-sortants)
- [API Keys](#api-keys)
- [Base de données](#base-de-données)
- [Structure des fichiers](#structure-des-fichiers)
- [Sécurité](#sécurité)
- [Problèmes fréquents](#problèmes-fréquents)

---

## Architecture

```
                    ┌─────────────────────────────────┐
                    │         ticketbot_global         │
                    │  guilds · superadmins · managers │
                    │  web_sessions · login_logs       │
                    │  user_totp · sa_auth_logs        │
                    └─────────────┬───────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
   ticketbot_guild_111  ticketbot_guild_222  ticketbot_guild_333
   tickets · staff      tickets · staff      tickets · staff
   grades · badges      grades · badges      grades · badges
   config · …           config · …           config · …
```

Un serveur Discord qui ajoute le bot est enregistré en statut **pending** dans `ticketbot_global`. Un superadmin valide la demande depuis le panel `/sa`, ce qui crée la base de données dédiée et active le serveur.

---

## Stack technique

| Couche | Technologies |
|--------|-------------|
| Bot Discord | Node.js 20, Discord.js 14 |
| API / serveur web | Express 5, express-session, Helmet, express-rate-limit |
| Base de données | MariaDB 11 (mysql2, architecture multi-tenant) |
| Authentification | OAuth2 Discord, TOTP 2FA (otplib), bcrypt |
| Temps réel | Server-Sent Events (SSE) |
| Notifications push | Web Push API (VAPID, web-push) |
| File de jobs | Redis 7 + BullMQ (rapports, vérifications async) |
| Dashboard frontend | React + Vite + Tailwind CSS |
| Déploiement | Docker (multi-stage), Docker Compose, Traefik |

---

## Fonctionnement — cycle de vie d'un ticket

### Côté membre

1. Le membre envoie un **message privé** au bot
2. Si le membre est dans plusieurs serveurs utilisant le bot → sélecteur de serveur
3. Si des **sujets de ticket** sont configurés → menu de boutons
4. Si la **FAQ automatique** est activée → réponse automatique selon les mots-clés (avec option d'ouvrir un ticket quand même)
5. Si un **formulaire d'intake** est activé → questionnaire étape par étape avant création
6. Un salon privé est créé dans le serveur Discord
7. Les messages et fichiers suivants sont relayés dans ce salon
8. Le membre reçoit les réponses du staff en DM
9. À la fermeture → le membre reçoit un **bouton de notation** (1–5 étoiles)

### Côté staff

- Répond via `/reply` (identifié), `/areply` (anonyme comme "Support") ou depuis le **dashboard web**
- Les messages tapés directement dans le salon Discord sont enregistrés comme notes mais **ne sont pas envoyés** au membre
- Le ticket se ferme via le bouton Discord ou depuis le dashboard (transcript généré automatiquement)
- Tableau de bord en **temps réel** via SSE — les nouvelles notes apparaissent sans recharger la page

### Automatismes

| Mécanisme | Description |
|-----------|-------------|
| Inactivité ticket | Avertissement puis fermeture auto si le membre ne répond plus |
| Inactivité utilisateur | Avertissement puis fermeture auto si le staff ne répond pas |
| Rappel staff | DM au staff si un ticket réclamé n'a pas eu de réponse depuis N heures |
| Escalade | Alerte + fermeture auto des tickets urgents sans réponse prolongée |
| Messages programmés | Envoi différé à une date/heure précise |
| Rapport hebdomadaire | Embed Discord automatique chaque semaine (stats + classement) |

---

## Prérequis

- **Docker** et **Docker Compose v2**
- Un **bot Discord** configuré (token + OAuth2)
- Un serveur avec domaine public et **Traefik** (inclus dans la stack) ou tout autre reverse proxy HTTPS
- **Redis 7** — inclus dans le `docker-compose.yml` (service `redis`), utilisé par BullMQ pour la file de jobs asynchrones et les rapports hebdomadaires

---

## Installation

### 1. Cloner le projet

```bash
git clone https://github.com/LuquyPest/Bot-ticketting.git
cd Bot-ticketting
```

### 2. Créer le fichier `.env`

```bash
cp .env.example .env
```

```env
DB_ROOT_PASSWORD=mot_de_passe_root_fort
DB_PASSWORD=mot_de_passe_botuser
```

`DB_PASSWORD` doit correspondre exactement à `config.json → database.password`.

### 3. Créer `config.json`

```bash
cp config.example.json config.json
```

Édite `config.json` — voir la section [Configuration](#configuration-configjson).

### 4. Démarrer

```bash
docker compose up -d --build
```

`bootstrap.js` s'exécute automatiquement au démarrage et effectue :
1. Validation de `config.json` (champs requis, session secret ≥ 32 chars)
2. Connexion MariaDB — création de `ticketbot_global` et de ses tables
3. Vérification du token Discord
4. Déploiement des commandes slash
5. Lancement du bot + serveur web

```bash
# Voir les logs en direct
docker compose logs -f bot

# Redémarrer après modification de config.json
docker compose up -d --build
```

---

## Configuration config.json

Le `config.json` contient **uniquement les informations techniques de démarrage** — ce qui est nécessaire avant que le bot puisse se connecter à la base de données. Tout le reste (rôles Discord, catégories, messages, limites, webhooks…) se configure depuis le **dashboard web** et est stocké en base de données.

```json
{
  "token": "TON_TOKEN_BOT_DISCORD",
  "clientId": "ID_APPLICATION_BOT",

  "vapid": {
    "publicKey":  "GENERE_AVEC_node_-e_require('web-push').generateVAPIDKeys()",
    "privateKey": "GENERE_AVEC_node_-e_require('web-push').generateVAPIDKeys()",
    "contact":    "admin@ton-domaine.com"
  },

  "webEnabled": true,
  "webServerPort": 3000,
  "webServerBaseUrl": "https://ton-domaine.com",

  "dashboard": {
    "sessionSecret": "GENERE_AVEC_openssl_rand_-hex_32",
    "discordClientSecret": "SECRET_OAUTH2_APP_DISCORD",
    "discordCallbackUrl": "https://ton-domaine.com/api/auth/discord/callback"
  },

  "database": {
    "host": "db",
    "port": 3306,
    "user": "botuser",
    "password": "MEME_VALEUR_QUE_DB_PASSWORD_DANS_ENV",
    "database": "ticketbot_global"
  }
}
```

| Champ | Description |
|-------|-------------|
| `token` | Token du bot Discord — identité unique du bot, commun à tous les serveurs |
| `clientId` | ID de l'application Discord — nécessaire pour OAuth2 et le déploiement global des commandes slash |
| `vapid.publicKey` | Clé publique VAPID pour les push notifications — générer avec `node -e "console.log(require('web-push').generateVAPIDKeys())"` |
| `vapid.privateKey` | Clé privée VAPID (à conserver secrète) |
| `vapid.contact` | Adresse e-mail de contact incluse dans les requêtes push (ex. `admin@ton-domaine.com`) |
| `webEnabled` | `true` pour activer le dashboard et l'API |
| `webServerPort` | Port interne du serveur Express (3000 par défaut) |
| `webServerBaseUrl` | URL publique du dashboard (avec `https://`) |
| `dashboard.sessionSecret` | Clé secrète sessions — **min. 32 chars**, générer avec `openssl rand -hex 32` |
| `dashboard.discordClientSecret` | Secret OAuth2 depuis le portail développeur Discord |
| `dashboard.discordCallbackUrl` | Doit correspondre exactement à l'URL configurée dans le portail Discord |
| `database.host` | Doit être `db` (nom du service Docker Compose, pas `localhost`) |
| `database.password` | Doit correspondre à `DB_PASSWORD` dans `.env` |

### Configurer le bot Discord

1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. Onglet **Bot** → copier le Token
3. Activer : **Presence Intent**, **Server Members Intent**, **Message Content Intent**
4. **OAuth2** → ajouter l'URL callback → copier le **Client Secret**
5. **OAuth2 → URL Generator** : scopes `bot` + `applications.commands`, permissions :  
   `Manage Channels` · `Send Messages` · `Read Message History` · `Embed Links` · `Attach Files` · `View Channel`

---

## Activation d'un serveur

Lorsqu'un propriétaire de serveur Discord ajoute le bot :

1. Le bot est **enregistré automatiquement** dans `ticketbot_global.guilds` avec le statut `pending`
2. Le propriétaire reçoit un **DM de confirmation** avec le lien du dashboard
3. Un **superadmin** valide la demande depuis le panel `/sa` → statut `active`
4. La base de données dédiée `ticketbot_guild_{id}` est créée automatiquement
5. Le propriétaire peut désormais se connecter au dashboard et configurer son serveur

> Sans validation superadmin, aucune fonctionnalité n'est disponible pour le serveur.

---

## Dashboard web

Accessible sur `https://ton-domaine.com` après connexion via Discord OAuth.

### Système de rôles

| Rôle | Accès |
|------|-------|
| `nouveau` | Page d'attente — aucun accès fonctionnel |
| `support` | Dashboard · Tickets · Staff · Analytics · Grades |
| `fondateur` | Accès complet + Paramètres · Blacklist · Transcripts · Utilisateurs · Clés API |

Le fondateur est désigné via le système de rôles staff configuré dans les paramètres. Les nouveaux membres reçoivent `nouveau` et attendent une attribution depuis la page **Utilisateurs**.

### 2FA pour les comptes dashboard

Les utilisateurs peuvent activer la **double authentification TOTP** depuis leur profil. Une fois activée, un code TOTP est requis après chaque connexion Discord OAuth.

### Pages disponibles

| Page | Rôles | Description |
|------|-------|-------------|
| **Dashboard** | support, fondateur | Stats globales, graphique d'activité, tickets récents |
| **Tickets** | support, fondateur | Liste avec filtres, indicateurs non-lus, aging, vue détaillée SSE |
| **Staff** | support, fondateur | Statistiques par agent (claims, fermetures, temps de réponse, notes) |
| **Analytics** | support, fondateur | Graphiques avancés — volume, SLA, satisfaction, activité par heure |
| **Grades** | support, fondateur | Hiérarchie de rôles avec permissions granulaires |
| **Badges** | support, fondateur | Badges débloqués par le staff selon leur activité |
| **Objectifs** | support, fondateur | Objectifs mensuels par agent |
| **Tags** | support, fondateur | Tags sur les tickets pour organisation |
| **Messages** | support, fondateur | Messages personnalisés (accueil, fermeture…) |
| **Journaux de connexion** | fondateur | Historique des connexions au dashboard |
| **Audit** | fondateur | Journal des actions effectuées sur le dashboard |
| **Blacklist** | fondateur | Gestion des utilisateurs bannis |
| **Transcripts** | fondateur | Consultation et téléchargement des transcripts HTML/TXT |
| **Utilisateurs** | fondateur | Attribution des rôles dashboard |
| **Rôles staff** | fondateur | Configuration des rôles Discord mappés au bot |
| **Newsletter** | fondateur | Envoi de DM en masse aux membres avec des tickets |
| **Clés API** | fondateur | Génération de clés API pour intégrations externes |
| **Panels** | fondateur | Création et publication de panels de boutons Discord pour ouvrir des tickets |
| **Paramètres** | fondateur | Configuration complète du serveur via interface graphique |

### Fonctionnalités dans la vue ticket

- **Temps réel (SSE)** : nouvelles notes et réponses sans rechargement de page
- **Répondre au membre** : mode *Répondre* (DM envoyé) ou *Note interne* (staff seulement)
- **Réponse anonyme** : toggle "Anonyme/Identifié" masquant le pseudo du staff
- **Templates** : réponses prédéfinies insérables en un clic
- **Messages programmés** : planification d'un message à une date/heure précise
- **Claim / Unclaim** : prise en charge depuis le dashboard ou depuis Discord
- **Priorité** : Faible / Normal / Urgent — met à jour le topic du salon Discord
- **Participants** : ajout/retrait d'utilisateurs liés en DM
- **Déplacer / Renommer** : actions sur le salon Discord depuis le dashboard
- **Indicateurs non-lus** : point bleu sur les tickets avec messages non consultés
- **Aging** : durée depuis le dernier message, colorée selon l'urgence

---

## Panel Superadmin

Accessible sur `/sa` — interface séparée du dashboard guild, avec ses propres comptes.

### Authentification

- Connexion par **identifiant + mot de passe** (bcrypt)
- **TOTP 2FA** requis après configuration initiale
- Les tentatives échouées sont loguées dans `sa_auth_logs`
- Rate limiting : 20 tentatives / 15 min sur les endpoints d'auth SA

### Fonctionnalités

| Section | Description |
|---------|-------------|
| **Guilds** | Lister, approuver, suspendre, réactiver, supprimer des serveurs |
| **Maintenance** | Activer/désactiver le mode maintenance d'un serveur |
| **Managers** | Créer des comptes managers avec accès restreint à certains serveurs |
| **Stats globales** | Vue d'ensemble de tous les serveurs actifs |

### Rôles dans le panel SA

| Rôle | Accès |
|------|-------|
| `superadmin` | Accès complet à toutes les guilds et tous les managers |
| `manager` | Accès restreint aux guilds qui lui sont assignées |

---

## Commandes Discord

Toutes les commandes sont réservées au staff (rôle Support ou Chef Support).

| Commande | Rôle | Description |
|----------|------|-------------|
| `/reply` | Support | Répond au membre avec ton pseudo (texte et/ou fichier) |
| `/areply` | Support | Répond anonymement (affiché comme "Support") |
| `/claim` | Support | Prend en charge le ticket |
| `/unclaim` | Support | Retire la prise en charge |
| `/priority` | Support | Définit la priorité : Faible / Normal / Urgent |
| `/adduser` | Support | Ajoute un participant lié au ticket en DM |
| `/removeuser` | Support | Retire un participant |
| `/rename` | Support | Renomme le salon du ticket |
| `/moveticket` | Support | Déplace le ticket dans une autre catégorie Discord |
| `/reopen` | Support | Réouvre le dernier ticket fermé d'un utilisateur |
| `/oldtickets` | Support | Historique paginé des tickets d'un utilisateur |
| `/gettranscript` | Support | Génère un lien temporaire (10 min) vers un transcript HTML |
| `/note` | Support | Ajoute une note interne (non envoyée au membre) |
| `/blacklist` | Chef Support | Gestion de la liste noire (add / remove / list) |
| `/staffstats` | Chef Support | Statistiques détaillées par agent |

### Topic du salon Discord

Le topic est mis à jour automatiquement à chaque changement d'état :

```
#42 · utilisateur · 🔴 Urgente · staffMembre · sujet du ticket
```

---

## Fonctionnalités avancées

### FAQ automatique

Règles de réponse automatique par mots-clés. Si le message d'un membre correspond, une réponse préformatée est envoyée en DM. Optionnellement, un bouton "Ouvrir un ticket quand même" peut être proposé.

Configuration depuis **Paramètres → FAQ** dans le dashboard.

### Formulaires d'intake

Avant la création d'un ticket, un questionnaire étape par étape peut être déclenché. Les réponses sont intégrées au contenu initial du ticket.

- Déclenchement global ou par sujet de ticket
- Types de champs : texte, nombre, choix multiple
- Configuration depuis **Paramètres → Formulaires** dans le dashboard

### Système de grades

Hiérarchie de rôles personnalisée avec permissions granulaires — indépendant des rôles Discord natifs.

**Permissions disponibles :**

| Permission | Description |
|------------|-------------|
| `view_tickets` | Voir la liste des tickets |
| `claim_ticket` | Prendre en charge un ticket |
| `reply_ticket` | Répondre à un ticket |
| `close_ticket` | Fermer un ticket |
| `manage_participants` | Gérer les participants |
| `view_transcripts` | Consulter les transcripts |
| `manage_users` | Gérer les utilisateurs dashboard |
| `manage_grades` | Gérer les grades |
| `manage_settings` | Modifier les paramètres |
| `view_audit` | Voir le journal d'audit |

Un grade peut avoir un `parent_id` — les membres d'un grade voient aussi les tickets visibles par leurs grades enfants (héritage hiérarchique).

### Système de badges

Badges débloqués automatiquement par le staff selon leur activité (fermetures, claims, notes de satisfaction…). Les triggers et seuils sont configurables depuis le dashboard.

### Objectifs mensuels

Objectifs de tickets fermés par agent et par mois, avec suivi depuis le dashboard.

### Escalade (tickets urgents)

Pour les tickets priorité **Urgent** sans réponse staff depuis N heures :
1. Alerte dans un salon configuré
2. Fermeture automatique si l'inactivité persiste au-delà d'un second seuil

Configuré via `escalation_alert_hours` et `escalation_close_hours` dans les paramètres.

### Rappel staff

Si un ticket réclamé n'a pas reçu de réponse depuis N heures (configurable), le staff assigné reçoit un DM de rappel. Anti-spam : max un rappel toutes les 24h par ticket.

### Inactivité utilisateur

Si le staff a répondu mais que l'utilisateur est silencieux depuis N heures :
1. Avertissement DM + mention dans le salon
2. Fermeture automatique si toujours silencieux après un second délai

### Rapport hebdomadaire

Embed Discord automatique envoyé chaque semaine dans un salon configuré. Contient : tickets ouverts/fermés, temps de réponse moyen, classement du staff.

---

## Panels Discord

Les panels permettent de poster dans un salon Discord un **embed avec des boutons** configurables — les membres peuvent ouvrir un ticket directement en cliquant sur un bouton, sans passer par les DMs.

Chaque panel comprend :
- Un **embed** personnalisable (titre, description, couleur, image, footer)
- Des **boutons** (jusqu'à 25, répartis en lignes de 5) avec label, emoji, style et sujet optionnel
- Un lien optionnel vers un **formulaire d'intake** (modal Discord) déclenché au clic

Le fondateur peut créer, modifier, publier et retirer des panels depuis **Dashboard → Panels**. La publication envoie ou met à jour le message Discord dans le salon cible ; la suppression du panel retire le message automatiquement.

**Tables associées :** `ticket_panels`, `panel_buttons`

---

## Push Notifications Web

Les agents du dashboard peuvent s'abonner aux **notifications push navigateur** (Web Push API). Une notification est envoyée lors de l'arrivée d'un nouveau ticket ou d'un nouveau message.

**Configuration dans `config.json` :**
```json
"vapid": {
  "publicKey":  "...",
  "privateKey": "...",
  "contact":    "admin@ton-domaine.com"
}
```

Générer les clés VAPID :
```bash
node -e "const wp = require('web-push'); const k = wp.generateVAPIDKeys(); console.log(JSON.stringify(k, null, 2));"
```

Si le bloc `vapid` est absent de `config.json`, le push est simplement désactivé — le reste du bot fonctionne normalement.

**Sécurité :** les endpoints push enregistrés sont validés contre une liste blanche des origines connues (FCM, Mozilla, Windows, Apple) — aucun endpoint arbitraire ne peut être souscrit.

**Table associée :** `push_subscriptions` (dans `ticketbot_global`)

---

## Gestion des sessions

Les utilisateurs peuvent consulter et révoquer leurs sessions actives depuis leur **profil dashboard** (`/profile`).

| Action | Endpoint | Description |
|--------|----------|-------------|
| Lister les sessions | `GET /api/sessions` | IP, user-agent, dates de création et dernière activité |
| Révoquer une session | `DELETE /api/sessions/:sessionId` | Déconnecte une session spécifique |
| Révoquer toutes les autres | `DELETE /api/sessions` | Ferme toutes les sessions sauf la courante |

La session courante est identifiée dans la liste pour éviter une auto-déconnexion accidentelle.

**Table associée :** `user_sessions` (dans `ticketbot_global`)

---

## Webhooks sortants

Notifie une URL externe (HTTPS uniquement) lors d'événements tickets.

**Événements disponibles :** `ticket_open`, `ticket_close`, `ticket_claim`

**Sécurité intégrée :**
- Résolution DNS + vérification anti-SSRF (bloque loopback, RFC1918, link-local, multicast…)
- Signature HMAC-SHA256 via `X-TicketBot-Signature-256` si un secret est configuré
- Timeout 5 secondes
- Header `X-TicketBot-Event` pour identifier l'événement

Configuration depuis **Paramètres → Webhooks** dans le dashboard.

---

## API Keys

Clés d'API générées par le fondateur pour des intégrations externes. Chaque clé a un préfixe lisible, des permissions granulaires et une date d'expiration optionnelle. Seul le hash bcrypt est stocké, jamais la clé en clair.

---

## Base de données

### Base globale — `ticketbot_global`

| Table | Description |
|-------|-------------|
| `guilds` | Registre de tous les serveurs (pending / active / suspended) |
| `superadmins` | Comptes du panel SA |
| `managers` | Comptes managers avec guilds assignées |
| `web_sessions` | Sessions express-session (MySQL store) |
| `user_sessions` | Suivi des sessions actives par utilisateur (IP, user-agent, timestamps) |
| `user_totp` | Secrets TOTP des utilisateurs dashboard |
| `login_logs` | Historique des connexions OAuth Discord |
| `sa_auth_logs` | Historique des tentatives d'auth superadmin |
| `push_subscriptions` | Abonnements push navigateur (endpoint VAPID + clés par utilisateur/guild) |

### Par serveur — `ticketbot_guild_{guildId}`

| Table | Description |
|-------|-------------|
| `tickets` | Tickets (sujet, priorité, claims, timestamps) |
| `ticket_participants` | Utilisateurs ajoutés via `/adduser` |
| `ticket_notes` | Toutes les notes (DM entrants, réponses staff, notes internes, Discord) |
| `transcript_snapshots` | Transcripts HTML + TXT archivés |
| `ticket_ratings` | Notes de satisfaction (1–5 étoiles) |
| `admin_stats` | Statistiques cumulées par agent |
| `blacklist` | Utilisateurs bannis (avec expiration optionnelle) |
| `dashboard_users` | Comptes dashboard avec rôles et profil |
| `reply_templates` | Templates de réponse rapide |
| `grades` | Hiérarchie de rôles personnalisée |
| `grade_permissions` | Permissions par grade |
| `user_grades` | Association utilisateurs ↔ grades |
| `badge_definitions` | Définitions des badges (trigger, seuil, icône) |
| `user_badges` | Badges obtenus par les agents |
| `monthly_goals` | Objectifs mensuels par agent |
| `api_keys` | Clés API (hash + permissions) |
| `faq_rules` | Règles de réponse automatique par mots-clés |
| `intake_forms` | Formulaires d'intake |
| `intake_form_fields` | Champs des formulaires |
| `scheduled_messages` | Messages planifiés |
| `staff_notes` | Notes internes isolées (commande `/note`) |
| `staff_roles` | Rôles Discord mappés avec niveaux et permissions |
| `guild_config` | Configuration complète du serveur |
| `audit_log` | Journal d'audit de toutes les actions dashboard |
| `ticket_panels` | Panels de boutons Discord (embed + métadonnées, message_id publié) |
| `panel_buttons` | Boutons associés à un panel (label, emoji, style, sujet, formulaire) |

---

## Structure des fichiers

```
Bot-ticketting/
├── Dockerfile                      # Build multi-stage (React + bot)
├── docker-compose.yml              # Bot + MariaDB + Traefik labels
├── docker/
│   └── mariadb-init.sql            # Droits SQL initiaux pour botuser
├── .env                            # Variables secret (à créer depuis .env.example)
├── .env.example                    # Template .env versionné
│
├── bootstrap.js                    # Vérification config + DB + token → lance index.js
├── index.js                        # Client Discord + chargement commandes/events
├── deploy-commands.js              # Enregistrement des slash commands
│
├── commands/                       # Slash commands Discord
│   ├── reply.js / areply.js        # Réponse identifiée / anonyme
│   ├── claim.js / unclaim.js       # Prise en charge
│   ├── note.js                     # Note interne
│   ├── priority.js                 # Changement de priorité
│   ├── adduser.js / removeuser.js  # Gestion des participants
│   ├── blacklist.js                # Liste noire
│   ├── moveticket.js / rename.js   # Déplacement / renommage
│   ├── reopen.js                   # Réouverture de ticket
│   ├── oldtickets.js               # Historique paginé
│   ├── gettranscript.js            # Lien transcript temporaire
│   └── staffstats.js               # Stats par agent
│
├── events/                         # Handlers Discord
│   ├── interactionCreate.js        # Boutons, slash commands, rating, oldtickets
│   ├── messageCreate.js            # DM → ticket + FAQ + intake + relay
│   ├── panelTicket.js              # Ouverture de ticket depuis un bouton de panel Discord
│   ├── guildCreate.js              # Enregistrement nouveau serveur
│   ├── guildDelete.js              # Suspension serveur
│   └── ready.js                    # Log connexion bot
│
├── utils/
│   ├── db.js                       # Pool global (ticketbot_global)
│   ├── globalDb.js                 # Pool global lazy + globalQuery()
│   ├── tenantDb.js                 # Pool par guild + getTenantDb()
│   ├── tenantSchema.js             # Schéma SQL complet des tables per-guild
│   ├── ticketManager.js            # Toute la logique tickets (factory par guild)
│   ├── guildScan.js                # Scan multi-guild pour un utilisateur
│   ├── permissions.js              # Vérification rôles staff Discord
│   ├── gradePermissions.js         # Système de grades + permissions + audit
│   ├── components.js               # Boutons Discord (ActionRowBuilder)
│   ├── embeds.js                   # Embeds réutilisables (staff)
│   ├── dmEmbeds.js                 # Embeds DM centralisés via EmbedBuilder (membre)
│   ├── transcript.js               # Génération HTML/TXT
│   ├── transcriptServer.js         # Pages temporaires (TTL 10 min)
│   ├── notePrefix.js               # Préfixe des notes internes Discord
│   ├── sanitize.js                 # Sanitisation des noms de salons
│   ├── rateLimit.js                # Cooldowns in-memory commandes Discord
│   ├── sse.js                      # Registre SSE guild-aware
│   ├── webhookEmitter.js           # Webhooks sortants + anti-SSRF
│   ├── redis.js                    # Client Redis lazy (ioredis)
│   ├── jobQueue.js                 # File BullMQ : rapports hebdo, vérifications async
│   ├── logger.js                   # Logger JSON structuré (stdout)
│   ├── inactiveTicketChecker.js    # Fermeture auto tickets inactifs
│   ├── userInactiveChecker.js      # Fermeture auto si utilisateur inactif
│   ├── staffReminderChecker.js     # Rappel DM au staff
│   ├── escalationChecker.js        # Escalade tickets urgents
│   ├── scheduledMessages.js        # Envoi des messages planifiés
│   └── weeklyReport.js             # Rapport hebdomadaire Discord
│
├── web/
│   ├── server.js                   # Express : sessions, CSP, rate limit, routes
│   ├── middleware/
│   │   ├── guild.js                # Résolution guild depuis session → req.guildDb
│   │   ├── role.js                 # Vérification rôle dashboard + permissions grade
│   │   └── superadmin.js           # Auth SA
│   └── routes/
│       ├── auth.js                 # OAuth Discord, TOTP login, select-guild
│       ├── profile.js              # Profil utilisateur, 2FA TOTP
│       ├── superadmin.js           # Panel SA (guilds, managers, stats)
│       ├── tickets.js              # CRUD tickets + SSE broadcast
│       ├── dashboard.js            # Stats globales
│       ├── staff.js                # Stats staff
│       ├── analytics.js            # Analytiques avancées
│       ├── config.js               # Paramètres du serveur
│       ├── users.js                # Gestion utilisateurs dashboard
│       ├── grades.js               # Grades et permissions
│       ├── badges.js               # Badges + débloquage automatique
│       ├── goals.js                # Objectifs mensuels
│       ├── blacklist.js            # Liste noire
│       ├── transcripts.js          # Transcripts
│       ├── templates.js            # Templates de réponse
│       ├── tags.js                 # Tags sur tickets
│       ├── messages.js             # Messages personnalisés
│       ├── staffRoles.js           # Rôles Discord mappés
│       ├── discord.js              # Catégories Discord
│       ├── events.js               # Endpoint SSE
│       ├── panels.js               # Panels Discord (CRUD + publish/unpublish)
│       ├── forms.js                # Formulaires d'intake (CRUD champs)
│       ├── push.js                 # Push notifications (VAPID, subscribe/unsubscribe)
│       ├── sessions.js             # Gestion des sessions actives (liste + révocation)
│       ├── loginLogs.js            # Journaux de connexion
│       ├── audit.js                # Journal d'audit
│       ├── apiKeys.js              # Clés API
│       └── newsletter.js           # Envoi DM en masse
│
└── dashboard/                      # Frontend React + Vite + Tailwind
    ├── public/
    │   └── sw.js                   # Service Worker pour les push notifications
    └── src/
        ├── pages/                  # Dashboard, Tickets, TicketDetail, Panels, Paramètres…
        ├── components/             # Composants UI réutilisables
        ├── hooks/
        │   ├── useSSE.js           # Abonnement SSE
        │   ├── useAutoRefresh.js   # Rafraîchissement automatique des données
        │   └── usePushNotifications.js  # Abonnement / désabonnement push navigateur
        └── utils/                  # Helpers frontend (dates, durées…)
```

---

## Sécurité

| Mesure | Description |
|--------|-------------|
| **CSP** | Content-Security-Policy strict via Helmet (script-src self, no inline) |
| **Sessions** | Cookie `Secure` + `HttpOnly` + `SameSite: Lax`, store MySQL |
| **Session secret** | Rejeté au démarrage si < 32 caractères |
| **TOTP 2FA** | Disponible pour les utilisateurs dashboard et activable pour les SA |
| **Rate limiting** | 20 req/15 min sur les endpoints d'auth, 200 req/min sur l'API générale |
| **CSRF** | Toutes les mutations (POST/PATCH/DELETE/PUT) exigent `X-Requested-With: XMLHttpRequest` |
| **SSRF** | Webhooks sortants : résolution DNS + blocage de tous les ranges privés/réservés |
| **Audit SA** | Toutes les tentatives de connexion SA (succès, échec, TOTP) loguées dans `sa_auth_logs` |
| **Audit dashboard** | Toutes les mutations du dashboard loguées dans `audit_log` |
| **Brute-force TOTP** | Lockout session après 5 tentatives TOTP incorrectes |
| **Docker** | Exécution en tant qu'utilisateur `node` (non-root), `NODE_ENV=production` |
| **Maintenance** | Mode maintenance par serveur — bloque toutes les requêtes API de la guild |
| **Push endpoint allowlist** | Les endpoints push enregistrés sont validés contre une liste blanche des origines connues (FCM, Mozilla, Windows, Apple) — bloque tout endpoint arbitraire |

---

## Problèmes fréquents

**Le bot ne reçoit pas les DMs**  
→ Active **Message Content Intent** dans le portail développeur Discord (onglet Bot → Privileged Gateway Intents).

**Les commandes slash n'apparaissent pas**  
→ Attends 1–2 minutes. Si ça persiste : `docker compose restart bot`.

**MariaDB refuse la connexion**  
→ `database.host` doit être `db` (nom du service Docker Compose, pas `localhost`).  
→ Vérifie que `DB_PASSWORD` dans `.env` correspond à `database.password` dans `config.json`.

**Mon serveur est bloqué en "pending"**  
→ Un superadmin doit valider la demande depuis le panel `/sa`. Sans validation, aucune fonctionnalité n'est active.

**Les SSE (temps réel) ne fonctionnent pas derrière un reverse proxy**  
→ Ajoute ces directives dans ta config Nginx :
```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 3600s;
```

**Erreur "dashboard.sessionSecret trop court"**  
→ Génère une clé : `openssl rand -hex 32`, et mets-la dans `config.json → dashboard.sessionSecret`.

**Je suis bloqué sur la page d'attente (rôle "nouveau")**  
→ Le fondateur du serveur doit t'attribuer un rôle depuis **Dashboard → Utilisateurs**.

**Le superadmin est bloqué en "2fa_required"**  
→ Lance le setup TOTP via `POST /api/sa/auth/totp-setup` et scanne le QR code avec une app d'authentification (Authy, Google Authenticator…).

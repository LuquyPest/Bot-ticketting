# Bot Ticketing Discord
Bot Discord de support par tickets avec **interface web d'administration**. L'utilisateur ouvre son ticket en **message privé** au bot, le staff gère tout depuis un salon privé sur le serveur et depuis le **dashboard web**.

---

## Sommaire

- [Fonctionnement](#fonctionnement)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration config.json](#configuration-configjson)
- [Préparer le serveur Discord](#préparer-le-serveur-discord)
- [Démarrage](#démarrage)
- [Dashboard web](#dashboard-web)
- [Commandes Discord](#commandes-discord)
- [Base de données](#base-de-données)
- [Structure des fichiers](#structure-des-fichiers)
- [Problèmes fréquents](#problèmes-fréquents)

---

## Fonctionnement

### Côté membre
- Le membre envoie un **message privé** au bot
- Si des **sujets de ticket** sont configurés, un menu de boutons s'affiche en DM
- Si aucun ticket n'est ouvert, le bot crée un salon dans le serveur
- Les messages suivants (texte et fichiers) sont relayés dans ce salon
- Le membre reçoit les réponses du staff en DM
- Après fermeture, le membre reçoit un **bouton de notation** (1–5 étoiles)

### Côté staff
- Le staff lit et gère les tickets depuis des salons privés Discord ou depuis le **dashboard web**
- Il répond via `/reply` (avec son pseudo), `/areply` (anonymement) ou depuis le dashboard
- Les messages tapés directement dans le salon **ne sont pas** envoyés au membre
- Le ticket se ferme via le bouton **Fermer et enregistrer le transcript** ou depuis le dashboard

---

## Prérequis

- **Docker** et **Docker Compose** (v2)
- Un **bot Discord** configuré (token + OAuth2)
- Un serveur accessible depuis internet (pour le dashboard et les transcripts)

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

Édite `.env` et renseigne les deux variables :

```env
DB_ROOT_PASSWORD=un_mot_de_passe_root_fort
DB_PASSWORD=mot_de_passe_botuser
```

### 3. Créer `config.json`

```bash
cp config.example.json config.json
```

Édite `config.json` — voir la section [Configuration](#configuration-configjson) ci-dessous.  
Le fichier est monté en lecture seule dans le conteneur via bind-mount.

### 4. Démarrer

```bash
docker compose up -d --build
```

Docker va :
1. Builder l'image (compilation du dashboard React incluse)
2. Démarrer MariaDB et attendre qu'elle soit prête
3. Lancer le bot — `bootstrap.js` vérifie la config, crée les tables et déploie les commandes slash

Vérifier que tout tourne :
```bash
docker compose ps
docker compose logs -f bot
```

---

## Configuration config.json

### Champs obligatoires

```json
{
  "token": "TON_TOKEN_BOT_DISCORD",
  "clientId": "ID_APPLICATION_BOT",
  "guildId": "ID_SERVEUR_DISCORD",

  "ticketCategoryId": "ID_CATEGORIE_TICKETS",
  "supportRoleId": "ID_ROLE_SUPPORT",
  "chiefSupportRoleId": "ID_ROLE_CHEF_SUPPORT",
  "ticketPrefix": "ticket",

  "webServerPort": 3000,
  "webServerBaseUrl": "https://ton-domaine.com",

  "database": {
    "host": "db",
    "port": 3306,
    "user": "botuser",
    "password": "mot_de_passe_botuser",
    "database": "discord_tickets"
  }
}
```

> **Important** : `database.host` doit être `db` (nom du service Docker Compose), pas `localhost`.  
> `database.password` doit correspondre à `DB_PASSWORD` dans `.env`.

### Champs optionnels

| Champ | Défaut | Description |
|-------|--------|-------------|
| `welcomeMessage` | Message par défaut | Message DM envoyé à la création du ticket |
| `ticketSubjects` | *(désactivé)* | Liste de sujets affichés en menu bouton avant création |
| `maxTicketsPerDay` | `3` | Nombre max de tickets ouverts par utilisateur par jour |
| `inactiveWarningHours` | `24` | Heures d'inactivité avant avertissement |
| `inactiveHours` | `48` | Heures d'inactivité avant fermeture automatique |
| `replyRateLimitSeconds` | `3` | Délai minimum entre deux `/reply` d'un même staff |
| `closeLogChannelId` | *(désactivé)* | Salon de log des fermetures |
| `claimLogChannelId` | *(désactivé)* | Salon de log des claims |
| `moveLogChannelId` | *(désactivé)* | Salon de log des déplacements |
| `addUserLogChannelId` | *(désactivé)* | Salon de log des ajouts d'utilisateur |
| `removeUserLogChannelId` | *(désactivé)* | Salon de log des retraits d'utilisateur |

### Configuration du dashboard web

```json
"webEnabled": true,
"webServerPort": 3000,
"webServerBaseUrl": "https://ton-domaine.com",
"webFounderId": "TON_DISCORD_USER_ID",

"dashboard": {
  "sessionSecret": "STRING_ALEATOIRE_LONGUE",
  "discordClientSecret": "SECRET_OAUTH_APP_DISCORD",
  "discordCallbackUrl": "https://ton-domaine.com/api/auth/discord/callback"
}
```

| Champ | Description |
|-------|-------------|
| `webEnabled` | `true` pour activer le dashboard |
| `webFounderId` | Ton ID Discord — accès fondateur automatique à la connexion |
| `dashboard.sessionSecret` | Clé secrète aléatoire pour les sessions (min. 32 caractères) |
| `dashboard.discordClientSecret` | Secret OAuth2 de l'application Discord |
| `dashboard.discordCallbackUrl` | Doit correspondre exactement à ce qui est configuré dans le portail Discord |

---

## Préparer le serveur Discord

### 1. Activer le mode développeur
**Paramètres → Apparence → Mode développeur** → Activer.

### 2. Créer le bot
1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. Onglet **Bot** → copier le **Token** → le mettre dans `config.json`
3. Activer : **Presence Intent**, **Server Members Intent**, **Message Content Intent**

### 3. Configurer OAuth2 (pour le dashboard)
Dans le portail développeur → **OAuth2** :
- Ajouter l'URL de callback : `https://ton-domaine.com/api/auth/discord/callback`
- Copier le **Client Secret** → `config.dashboard.discordClientSecret`

### 4. Inviter le bot
**OAuth2 → URL Generator** : scopes `bot` + `applications.commands`, permissions :  
`Manage Channels`, `Send Messages`, `Read Message History`, `Embed Links`, `Attach Files`, `View Channel`

### 5. Reverse proxy (recommandé)

Le conteneur expose le port `3000` en interne uniquement (`expose`, pas `ports`).  
Configure un reverse proxy (Nginx, Caddy, Traefik…) vers `bot:3000`.

Exemple Nginx minimal :

```nginx
server {
    listen 443 ssl;
    server_name ton-domaine.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Nécessaire pour les Server-Sent Events (SSE)
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }
}
```

> Le header `proxy_buffering off` est indispensable pour que les mises à jour **temps réel** (SSE) fonctionnent.

---

## Démarrage

```bash
# Démarrer (ou redémarrer après modification de config.json)
docker compose up -d --build

# Voir les logs
docker compose logs -f bot

# Arrêter
docker compose down

# Arrêter et supprimer la base de données
docker compose down -v
```

`bootstrap.js` s'exécute au démarrage du conteneur et effectue automatiquement :
1. Validation du `config.json`
2. Connexion MariaDB + création des tables
3. Vérification des IDs Discord (serveur, catégorie, rôles)
4. Déploiement des commandes slash
5. Lancement du bot + serveur web

---

## Dashboard web

Interface accessible sur `https://ton-domaine.com` après connexion Discord OAuth.

### Système de rôles

| Rôle | Accès |
|------|-------|
| `nouveau` | Page d'attente — aucun accès |
| `support` | Dashboard · Tickets (les siens) · Stats staff |
| `fondateur` | Accès complet + Blacklist · Transcripts · Paramètres · Utilisateurs |

- Le **fondateur** (`webFounderId`) reçoit son rôle automatiquement à la connexion.
- Les autres reçoivent `nouveau` et attendent que le fondateur leur attribue un rôle depuis la page **Utilisateurs**.

### Pages disponibles

| Page | Rôles | Description |
|------|-------|-------------|
| **Dashboard** | support, fondateur | Stats globales, graphique d'activité, tickets récents |
| **Tickets** | support, fondateur | Liste avec filtres, indicateurs non-lus, aging, vue détaillée |
| **Staff** | support, fondateur | Statistiques par agent |
| **Blacklist** | fondateur | Gérer les utilisateurs bannis |
| **Transcripts** | fondateur | Consulter et télécharger les transcripts |
| **Utilisateurs** | fondateur | Gérer les rôles dashboard |
| **Paramètres** | fondateur | Modifier `config.json` via interface graphique |

### Fonctionnalités dashboard

- **Temps réel (SSE)** : notes et réponses apparaissent instantanément sans recharger la page
- **Répondre au membre** : mode *Répondre* (DM envoyé) ou *Note interne* (staff uniquement)
- **Réponse anonyme** : toggle "Anonyme/Identifié" dans la boîte de composition
- **Templates** : réponses sauvegardées, insérables en un clic (gestion par le fondateur)
- **Édition du sujet** : clic sur le crayon dans la sidebar du ticket
- **Indicateurs non-lus** : point bleu sur les tickets avec messages non consultés
- **Aging** : durée depuis le dernier message ("3j sans réponse") colorée selon l'urgence
- **Notifications navigateur** : alerte à la création d'un nouveau ticket
- **Claim/Unclaim** : prise en charge depuis Discord ou le dashboard
- **Gestion des participants** : ajouter/retirer des utilisateurs liés au ticket en DM
- **Déplacer / Renommer** : actions sur le salon Discord depuis le dashboard

---

## Commandes Discord

Toutes les commandes sont réservées au staff (**Support** ou **Chef Support**).

| Commande | Description |
|----------|-------------|
| `/reply` | Répond au membre avec ton pseudo (texte et/ou fichier) |
| `/areply` | Répond anonymement (affiché comme "Support") |
| `/claim` | Prend en charge le ticket — met à jour le topic du salon |
| `/unclaim` | Retire la prise en charge — met à jour le topic du salon |
| `/priority` | Définit la priorité (Faible / Normal / Urgent) — met à jour le topic |
| `/adduser` | Ajoute un participant DM lié au ticket |
| `/removeuser` | Retire un participant DM |
| `/rename` | Renomme le salon ticket |
| `/moveticket` | Déplace le ticket dans une autre catégorie |
| `/reopen` | Réouvre le dernier ticket fermé d'un utilisateur |
| `/oldtickets` | Historique des tickets d'un utilisateur (paginé) |
| `/gettranscript` | Génère un lien temporaire (10 min) vers un transcript |
| `/blacklist add/remove/list` | Gestion de la liste noire (Chef Support) |
| `/staffstats` | Statistiques par agent (Chef Support) |

### Topic de salon Discord

À la création du ticket et après chaque changement de priorité, claim ou sujet, le topic du salon est mis à jour automatiquement :

```
#42 · username · 🔴 Urgente · staffName
```

---

## Base de données

Tables créées automatiquement au démarrage.

| Table | Description |
|-------|-------------|
| `tickets` | Tous les tickets (sujet, priorité, timestamps) |
| `ticket_participants` | Utilisateurs ajoutés via `/adduser` |
| `ticket_notes` | Notes internes, réponses et messages Discord |
| `transcript_snapshots` | Transcripts HTML + TXT archivés |
| `admin_stats` | Statistiques par agent |
| `blacklist` | Utilisateurs bannis |
| `ticket_ratings` | Notes de satisfaction (1–5 étoiles) |
| `dashboard_users` | Comptes dashboard avec rôles |
| `reply_templates` | Templates de réponse sauvegardés |

---

## Structure des fichiers

```
Bot-ticketting/
├── Dockerfile                    # Build multi-stage (dashboard + bot)
├── docker-compose.yml            # Bot + MariaDB
├── docker/
│   └── mariadb-init.sql          # Droits initiaux pour botuser
├── .env                          # DB_ROOT_PASSWORD, DB_PASSWORD (à créer)
├── bootstrap.js                  # Vérification + lancement automatique
├── index.js                      # Client Discord
├── deploy-commands.js            # Enregistrement des slash commands
├── config.json                   # Configuration (à créer, non versionné)
├── config.example.json           # Exemple complet
│
├── commands/                     # Slash commands
├── events/                       # Handlers Discord (messages, boutons)
│
├── utils/
│   ├── db.js                     # Pool MariaDB
│   ├── ticketManager.js          # Logique tickets (création, claim, topic…)
│   ├── sse.js                    # Singleton Server-Sent Events
│   ├── transcript.js             # Génération HTML/TXT
│   ├── transcriptServer.js       # Pages temporaires
│   ├── inactiveTicketChecker.js  # Fermeture auto tickets inactifs
│   ├── permissions.js            # Vérification rôles staff
│   └── components.js             # Boutons Discord
│
├── web/
│   ├── server.js                 # Express : API + dashboard + transcripts
│   ├── middleware/
│   └── routes/
│       ├── auth.js               # OAuth Discord
│       ├── tickets.js            # API tickets (CRUD + SSE broadcasts)
│       ├── events.js             # Endpoint SSE (/api/events)
│       ├── templates.js          # API templates de réponse
│       ├── dashboard.js          # Stats
│       ├── staff.js              # Stats staff
│       ├── discord.js            # Catégories Discord
│       ├── blacklist.js
│       ├── transcripts.js
│       ├── config.js
│       └── users.js
│
└── dashboard/                    # Frontend React + Vite + Tailwind
    └── src/
        ├── hooks/
        │   ├── useSSE.js         # Hook EventSource temps réel
        │   └── useAutoRefresh.js
        ├── pages/
        │   ├── Dashboard.jsx     # Stats + notifications navigateur
        │   ├── Tickets.jsx       # Liste + unread + aging
        │   ├── TicketDetail.jsx  # Timeline SSE + templates + sujet
        │   └── …
        └── components/
```

---

## Problèmes fréquents

**Le bot ne reçoit pas les DMs**  
→ Vérifie que **Message Content Intent** est activé dans le portail développeur.

**Les commandes slash n'apparaissent pas**  
→ Attends quelques minutes. Si ça persiste : `docker compose restart bot`.

**MariaDB refuse la connexion**  
→ `database.host` doit être `db` (pas `localhost`) dans `config.json`.  
→ Vérifie que `DB_PASSWORD` dans `.env` correspond à `database.password` dans `config.json`.

**Les SSE (temps réel) ne fonctionnent pas derrière un reverse proxy**  
→ Ajoute `proxy_buffering off;` et `proxy_read_timeout 3600s;` dans ta config Nginx.

**Le dashboard est inaccessible**  
→ Vérifie `webEnabled: true` dans `config.json` et que le reverse proxy pointe bien sur le port `3000`.

**Connexion Discord refusée — "not_in_guild"**  
→ L'utilisateur doit être membre du serveur configuré dans `guildId`.

**Je suis bloqué sur la page d'attente**  
→ Le fondateur doit t'attribuer un rôle depuis la page **Utilisateurs** du dashboard.

**Le fondateur ne peut pas se connecter**  
→ Vérifie que `webFounderId` contient bien ton **ID Discord** (pas ton nom d'utilisateur).

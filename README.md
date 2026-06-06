# Bot Ticketing Discord

Bot Discord de support par tickets avec **interface web d'administration**. L'utilisateur ouvre son ticket en **message privé** au bot, le staff gère tout depuis un salon privé sur le serveur.

---

## Sommaire

- [Fonctionnement](#fonctionnement)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration config.json](#configuration-configjson)
- [Préparer le serveur Discord](#préparer-le-serveur-discord)
- [Démarrage](#démarrage)
- [Dashboard web](#dashboard-web)
- [Commandes](#commandes)
- [Boutons ticket](#boutons-ticket)
- [Base de données](#base-de-données)
- [Logs](#logs)
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
- Le staff lit et gère les tickets depuis des salons privés
- Il répond avec `/reply` (avec son pseudo) ou `/areply` (anonymement)
- Les messages tapés directement dans le salon **ne sont pas** envoyés au membre
- Le ticket se ferme uniquement via le bouton **Fermer et enregistrer le transcript**

---

## Prérequis

- **Node.js** v18 ou supérieur
- **MariaDB** (ou MySQL) accessible
- Un **bot Discord** avec les permissions nécessaires
- Un **serveur accessible depuis internet** pour le serveur web (transcripts + dashboard sur le même port)

---

## Installation

```bash
# 1. Cloner le projet
git clone https://github.com/LuquyPest/Bot-ticketting.git
cd Bot-ticketting

# 2. Installer les dépendances du bot
npm install

# 3. Builder le dashboard
cd dashboard && npm install && npm run build && cd ..

# 4. Créer la configuration
cp config.example.json config.json
# Éditer config.json avec tes valeurs

# 5. Lancer
npm start
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
  "webServerBaseUrl": "http://TON_IP:3000",

  "database": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "ton_user_db",
    "password": "ton_mdp_db",
    "database": "discord_tickets"
  }
}
```

### Champs optionnels

| Champ | Défaut | Description |
|-------|--------|-------------|
| `welcomeMessage` | Message par défaut | Message DM envoyé à la création du ticket |
| `ticketSubjects` | *(désactivé)* | Liste de sujets affichés en menu bouton avant création |
| `maxTicketsPerDay` | `3` | Nombre max de tickets ouverts par utilisateur par jour |
| `inactiveWarningHours` | `24` | Heures d'inactivité avant avertissement |
| `inactiveHours` | `48` | Heures d'inactivité avant fermeture automatique |
| `replyRateLimitSeconds` | `3` | Délai minimum en secondes entre deux `/reply` d'un même staff |
| `closeLogChannelId` | *(désactivé)* | Salon de log des fermetures |
| `claimLogChannelId` | *(désactivé)* | Salon de log des claims |
| `moveLogChannelId` | *(désactivé)* | Salon de log des déplacements |
| `addUserLogChannelId` | *(désactivé)* | Salon de log des ajouts d'utilisateur |
| `removeUserLogChannelId` | *(désactivé)* | Salon de log des retraits d'utilisateur |

### Configuration du serveur web et dashboard

Le serveur web (transcripts + dashboard) est activé via `webEnabled`. Tous les services tournent sur le même port (`webServerPort`).

```json
"webEnabled": true,
"webServerPort": 3000,
"webServerBaseUrl": "http://ton-domaine.com:3000",
"webFounderId": "TON_DISCORD_USER_ID",

"dashboard": {
  "sessionSecret": "STRING_ALEATOIRE_LONGUE",
  "discordClientSecret": "SECRET_OAUTH_APP_DISCORD",
  "discordCallbackUrl": "http://ton-domaine.com:3000/api/auth/discord/callback"
}
```

| Champ | Description |
|-------|-------------|
| `webEnabled` | `true` pour activer le serveur web, `false` pour tout désactiver |
| `webFounderId` | ID Discord du compte fondateur — accès automatique complet à la connexion |
| `dashboard.sessionSecret` | Clé secrète pour les sessions — génère une chaîne aléatoire longue |
| `dashboard.discordClientSecret` | Secret OAuth2 de l'application Discord (portail développeur → OAuth2) |
| `dashboard.discordCallbackUrl` | URL de callback OAuth — doit correspondre exactement à ce qui est configuré dans le portail Discord |

---

## Préparer le serveur Discord

### 1. Activer le mode développeur
**Paramètres → Apparence → Mode développeur** → Activer.  
Clic droit sur n'importe quel élément pour copier son ID.

### 2. Créer le bot
1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. Onglet **Bot** → copier le **Token** → le mettre dans `config.json`
3. Activer : **Presence Intent**, **Server Members Intent**, **Message Content Intent**

### 3. Configurer OAuth2 (pour le dashboard)
Dans le portail développeur → **OAuth2** :
- Ajouter l'URL de callback : `http://ton-domaine.com:3000/api/auth/discord/callback`
- Copier le **Client Secret** → le mettre dans `config.dashboard.discordClientSecret`

### 4. Inviter le bot
**OAuth2 → URL Generator** : scopes `bot` + `applications.commands`, permissions :  
`Manage Channels`, `Send Messages`, `Read Message History`, `Embed Links`, `Attach Files`, `View Channel`

### 5. Ouvrir le port
Un seul port à ouvrir : `webServerPort` (ex: `3000`).  
Il sert à la fois les transcripts temporaires (`/t/...`) et le dashboard web (`/`).

---

## Démarrage

```bash
npm start
```

Le script vérifie automatiquement :
1. Validité du `config.json`
2. Dépendances installées
3. Connexion MariaDB + création des tables
4. Vérification des IDs Discord
5. Déploiement des commandes slash
6. Lancement du bot + serveur web (si `webEnabled: true`)

---

## Dashboard web

Interface web d'administration accessible sur `http://ton-ip:PORT`.

### Système de rôles

Tous les accès au dashboard sont gérés par un système de rôles stocké en base de données.

| Rôle | Accès |
|------|-------|
| `nouveau` | Connexion bloquée — page d'attente, aucun accès |
| `support` | Dashboard (stats générales) · Tickets (lecture) · Ses propres stats staff |
| `fondateur` | Accès complet : tout ce que support voit + Blacklist · Transcripts · Paramètres · Gestion des utilisateurs |

### Attribution des rôles

- **Fondateur** : l'ID Discord défini dans `webFounderId` reçoit automatiquement le rôle `fondateur` à chaque connexion.
- **Autres utilisateurs** : reçoivent le rôle `nouveau` à leur première connexion, quel que soit leur rôle Discord. Le fondateur leur attribue ensuite le rôle approprié depuis la page **Utilisateurs**.
- **Suggestion** : si un utilisateur possède le rôle Support ou Chef Support Discord, un badge 💡 **Suggéré** apparaît dans la page Utilisateurs pour guider le fondateur — l'attribution reste manuelle.

### Authentification

Uniquement via **Discord OAuth**. Le bot utilise le même `clientId` que l'application Discord.

L'utilisateur doit être membre du serveur Discord configuré dans `guildId`. S'il ne l'est pas, la connexion est refusée.

### Pages disponibles

| Page | Rôles | Description |
|------|-------|-------------|
| **Dashboard** | support, fondateur | Stats globales, graphique d'activité 7/14/30 jours, tickets récents |
| **Tickets** | support, fondateur | Liste filtrée, vue détaillée, changement de priorité (fondateur) |
| **Staff** | support, fondateur | Support : ses propres stats · Fondateur : tous les agents |
| **Blacklist** | fondateur | Ajouter, retirer, consulter les utilisateurs bannis |
| **Transcripts** | fondateur | Consulter et télécharger tous les transcripts archivés |
| **Utilisateurs** | fondateur | Gérer les rôles dashboard, voir les suggestions de promotion |
| **Paramètres** | fondateur | Modifier `config.json` via interface graphique |

### Builder le dashboard

```bash
cd dashboard
npm install
npm run build
```

Le dashboard est buildé dans `dashboard/dist/` et servi automatiquement par le backend Express.

**Mode développement** (hot reload) :
```bash
# Terminal 1 — bot
npm start

# Terminal 2 — frontend
cd dashboard && npm run dev   # accessible sur localhost:5173
```

---

## Commandes

Toutes les commandes sont réservées au staff (**Support** ou **Chef Support**).

### `/reply`
Envoie une réponse **avec ton pseudo** aux membres du ticket.

| Option | Type | Requis |
|--------|------|--------|
| `message` | Texte | Non |
| `fichier` | Fichier | Non |

> Rate limit configurable via `replyRateLimitSeconds`.

---

### `/areply`
Envoie une réponse **anonyme** (affiché comme "Support").

| Option | Type | Requis |
|--------|------|--------|
| `message` | Texte | Non |
| `fichier` | Fichier | Non |

---

### `/priority`
Change la priorité du ticket.

| Option | Valeurs |
|--------|---------|
| `priorite` | `Faible`, `Normal`, `Urgent` |

---

### `/blacklist`
Gestion de la liste noire. **Chef Support uniquement.**

| Sous-commande | Description |
|---------------|-------------|
| `add` | Bannit un utilisateur |
| `remove` | Retire un utilisateur de la blacklist |
| `list` | Affiche la liste actuelle |

---

### `/reopen`
Réouvre le dernier ticket fermé d'un utilisateur.

| Option | Type | Requis |
|--------|------|--------|
| `userid` | ID Discord | Oui |

---

### `/adduser`
Ajoute un utilisateur comme participant DM lié au ticket.

| Option | Type | Requis |
|--------|------|--------|
| `utilisateur` | Mention Discord | Oui |

---

### `/removeuser`
Retire un participant DM lié au ticket.

| Option | Type | Requis |
|--------|------|--------|
| `utilisateur` | Mention Discord | Oui |

---

### `/rename`
Renomme le salon ticket.

---

### `/claim` / `/unclaim`
Marque/retire la prise en charge du ticket par le staff.

---

### `/moveticket`
Déplace le ticket dans une autre catégorie Discord.

---

### `/oldtickets`
Affiche l'historique des tickets d'un utilisateur (paginé, 5 par page).

---

### `/gettranscript`
Génère un lien web temporaire (10 min) vers un transcript enregistré.

---

### `/staffstats`
Statistiques par agent : claims, fermetures, temps de réponse moyen, note moyenne.  
**Chef Support uniquement.**

---

## Boutons ticket

### `Transcript`
Génère une page web temporaire (10 min) avec tous les messages du salon.

### `Fermer et enregistrer le transcript`
1. Demande confirmation
2. Ferme le ticket
3. Enregistre le transcript final
4. Notifie les membres en DM
5. Envoie un **bouton de notation** (⭐ à ⭐⭐⭐⭐⭐) en DM au propriétaire
6. Supprime le salon

---

## Base de données

Tables créées automatiquement au démarrage.

| Table | Description |
|-------|-------------|
| `tickets` | Tous les tickets avec subject, priority, timestamps |
| `ticket_participants` | Utilisateurs ajoutés via `/adduser` |
| `transcript_snapshots` | Transcripts HTML + TXT archivés |
| `admin_stats` | Statistiques par agent (claims, fermetures, notes, temps de réponse) |
| `blacklist` | Utilisateurs bannis |
| `ticket_ratings` | Notes de satisfaction (1–5 étoiles) |
| `dashboard_users` | Comptes du dashboard avec leurs rôles (`nouveau`, `support`, `fondateur`) |

---

## Logs

| Champ config | Ce qui est loggé |
|-------------|-----------------|
| `closeLogChannelId` | Fermeture (propriétaire, staff, transcript ID) |
| `claimLogChannelId` | Claim d'un ticket |
| `moveLogChannelId` | Déplacement dans une autre catégorie |
| `addUserLogChannelId` | Ajout d'un participant DM |
| `removeUserLogChannelId` | Retrait d'un participant DM |

---

## Structure des fichiers

```
Bot-ticketting/
├── bootstrap.js              # Vérification complète + lancement automatique
├── index.js                  # Client Discord + chargement events/commandes
├── deploy-commands.js        # Enregistrement des slash commands
├── config.json               # Configuration (à créer, non versionné)
├── config.example.json       # Exemple de configuration complet
│
├── commands/
│   ├── reply.js              # Réponse avec pseudo (+ rate limit)
│   ├── areply.js             # Réponse anonyme (+ rate limit)
│   ├── adduser.js
│   ├── removeuser.js
│   ├── rename.js
│   ├── claim.js
│   ├── unclaim.js
│   ├── moveticket.js
│   ├── oldtickets.js
│   ├── gettranscript.js
│   ├── priority.js           # Priorité d'un ticket
│   ├── blacklist.js          # Gestion blacklist
│   ├── reopen.js             # Réouverture d'un ticket fermé
│   └── staffstats.js         # Stats staff (notes + temps de réponse)
│
├── events/
│   ├── messageCreate.js      # Réception DMs, menu sujet, anti-spam
│   └── interactionCreate.js  # Commandes, boutons (sujet, notation, ticket)
│
├── utils/
│   ├── db.js                 # Pool de connexions MariaDB
│   ├── ticketManager.js      # Logique principale des tickets
│   ├── transcript.js         # Génération HTML/TXT
│   ├── transcriptServer.js   # Pages temporaires (Map token → html)
│   ├── inactiveTicketChecker.js  # Fermeture auto tickets inactifs
│   ├── permissions.js        # Vérification des rôles staff
│   ├── embeds.js             # Embeds Discord
│   └── components.js         # Boutons Discord (sujet, notation)
│
├── web/                      # Serveur web unifié (Express)
│   ├── server.js             # Transcripts (/t/:token) + API + dashboard
│   ├── middleware/
│   │   ├── auth.js           # Vérification de session
│   │   └── role.js           # Contrôle d'accès par rôle
│   └── routes/
│       ├── auth.js           # OAuth Discord, session, logout
│       ├── dashboard.js      # Stats et graphique d'activité
│       ├── tickets.js        # Lecture/modification tickets
│       ├── staff.js          # Stats staff (filtrées par rôle)
│       ├── blacklist.js      # Gestion blacklist
│       ├── transcripts.js    # Consultation transcripts archivés
│       ├── config.js         # Lecture/écriture config.json
│       └── users.js          # Gestion des rôles dashboard
│
└── dashboard/                # Frontend React + Vite + Tailwind
    ├── src/
    │   ├── pages/
    │   │   ├── Login.jsx     # Connexion Discord OAuth
    │   │   ├── Pending.jsx   # Page d'attente (rôle nouveau)
    │   │   ├── Dashboard.jsx # Stats + graphique
    │   │   ├── Tickets.jsx   # Liste + filtres
    │   │   ├── TicketDetail.jsx
    │   │   ├── Staff.jsx
    │   │   ├── Blacklist.jsx
    │   │   ├── Transcripts.jsx
    │   │   ├── Users.jsx     # Gestion des rôles (fondateur)
    │   │   └── Settings.jsx
    │   └── components/
    │       ├── Sidebar.jsx   # Navigation filtrée par rôle
    │       ├── StatCard.jsx
    │       ├── Badge.jsx
    │       └── Pagination.jsx
    └── dist/                 # Build de production (npm run build)
```

---

## Problèmes fréquents

**Le bot ne reçoit pas les DMs**  
→ Vérifie que **Message Content Intent** est activé dans le portail développeur.

**Les commandes slash n'apparaissent pas**  
→ Lance `npm run deploy`. Attends jusqu'à 1h pour la propagation Discord.

**MariaDB refuse la connexion**  
→ Vérifie `systemctl status mariadb`, les droits de l'utilisateur, et l'hôte.

**Le lien de transcript ne s'ouvre pas**  
→ Vérifie que `webServerPort` est ouvert dans le firewall et que `webServerBaseUrl` est correct.

**Le dashboard est inaccessible**  
→ Vérifie que `webEnabled: true` est dans `config.json` et que `webServerPort` est ouvert.

**Connexion Discord refusée — "not_in_guild"**  
→ L'utilisateur doit être membre du serveur configuré dans `guildId`.

**Je suis bloqué sur la page d'attente**  
→ Le fondateur doit te donner un rôle depuis la page **Utilisateurs** du dashboard.

**Le fondateur ne peut pas se connecter**  
→ Vérifie que `webFounderId` contient bien ton ID Discord (et non un nom d'utilisateur).

**"Impossible de trouver la catégorie" dans /moveticket**  
→ Le nom doit correspondre **exactement** (casse incluse) au nom de la catégorie Discord.

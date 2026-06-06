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
- [Transcripts web](#transcripts-web)
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
- Un **serveur accessible depuis internet** pour le serveur web (transcripts + dashboard)

---

## Installation

```bash
# 1. Cloner le projet
git clone https://github.com/LuquyPest/Bot-ticketting.git
cd Bot-ticketting

# 2. Installer les dépendances du bot
npm install

# 3. Builder le dashboard (optionnel mais recommandé)
cd dashboard && npm install && npm run build && cd ..

# 4. Créer la configuration
cp config.example.json config.json
# Éditer config.json avec tes valeurs

# 5. Lancer le bot (+ dashboard si config.dashboard est présent)
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

### Configuration dashboard (optionnel)

Ajouter ce bloc dans `config.json` pour activer l'interface web d'administration :

```json
"dashboard": {
  "port": 3001,
  "sessionSecret": "STRING_ALEATOIRE_LONGUE",
  "authMethods": ["discord", "password"],
  "allowedRoleId": "ID_ROLE_AUTORISE",
  "password": "ton_mot_de_passe_ou_hash_bcrypt",
  "discordClientId": "MEME_QUE_clientId",
  "discordClientSecret": "SECRET_OAUTH_APP",
  "discordCallbackUrl": "http://ton-domaine.com:3001/api/auth/discord/callback"
}
```

| Champ | Description |
|-------|-------------|
| `port` | Port d'écoute du dashboard (défaut: `3001`) |
| `sessionSecret` | Clé secrète pour les sessions — change-la ! |
| `authMethods` | Méthodes autorisées : `"discord"` et/ou `"password"` |
| `allowedRoleId` | ID du rôle Discord donnant accès au dashboard via OAuth |
| `password` | Mot de passe admin en clair ou hash bcrypt (`$2b$...`) |
| `discordClientSecret` | Secret OAuth2 de l'application Discord (onglet OAuth2 du portail) |
| `discordCallbackUrl` | URL de callback OAuth — doit être ajoutée dans le portail Discord |

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
- Ajouter l'URL de callback : `http://ton-domaine.com:3001/api/auth/discord/callback`
- Copier le **Client Secret** → le mettre dans `config.dashboard.discordClientSecret`

### 4. Inviter le bot
**OAuth2 → URL Generator** : scopes `bot` + `applications.commands`, permissions :  
`Manage Channels`, `Send Messages`, `Read Message History`, `Embed Links`, `Attach Files`, `View Channel`

### 5. Ouvrir les ports
- **Port transcripts** (`webServerPort`, ex: `3000`) — pour les liens de transcript temporaires
- **Port dashboard** (`dashboard.port`, ex: `3001`) — pour l'interface web d'administration

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
6. Lancement du bot + serveur transcripts + dashboard (si configuré)

---

## Dashboard web

Interface web d'administration accessible sur `http://ton-ip:3001` (ou le port configuré).

### Fonctionnalités

| Page | Description |
|------|-------------|
| **Dashboard** | Stats globales (tickets ouverts/fermés, temps de réponse moyen, note moyenne), graphique d'activité sur 7/14/30 jours |
| **Tickets** | Liste complète avec filtres (statut, priorité, sujet), vue détaillée par ticket |
| **Staff** | Statistiques par agent (fermetures, claims, temps de réponse moyen, note moyenne) |
| **Blacklist** | Gestion des utilisateurs bannis (ajouter, retirer, consulter) |
| **Transcripts** | Consultation et téléchargement de tous les transcripts archivés |
| **Paramètres** | Modification de `config.json` via interface graphique |

### Authentification

Deux méthodes disponibles (configurables via `authMethods`) :

- **Discord OAuth** : connexion avec compte Discord — accès accordé si l'utilisateur a le rôle `allowedRoleId`
- **Mot de passe** : mot de passe défini dans `config.dashboard.password` (clair ou hash bcrypt)

### Builder le dashboard

```bash
cd dashboard
npm install
npm run build
```

Le dashboard est buildé dans `dashboard/dist/` et servi automatiquement par le backend.

**Mode développement** (avec hot reload) :
```bash
# Terminal 1 — bot
npm start

# Terminal 2 — dashboard dev
cd dashboard && npm run dev
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
Change la priorité du ticket. **Support et Chef Support.**

| Option | Valeurs |
|--------|---------|
| `priorite` | `Faible`, `Normal`, `Urgent` |

---

### `/blacklist`
Gestion de la liste noire. **Chef Support uniquement.**

| Sous-commande | Description |
|---------------|-------------|
| `add` | Bannit un utilisateur (plus aucun ticket possible) |
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
Ajoute un utilisateur comme **participant DM lié** au ticket.

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
Génère une page web temporaire (10 min) avec tous les messages du salon à cet instant.

### `Fermer et enregistrer le transcript`
1. Demande confirmation
2. Ferme le ticket
3. Enregistre le transcript final
4. Notifie les membres en DM
5. Envoie un **bouton de notation** (⭐ à ⭐⭐⭐⭐⭐) en DM au propriétaire
6. Supprime le salon

---

## Transcripts web

Les transcripts sont hébergés temporairement par le bot sur `webServerPort`.

### Fonctionnement
1. Snapshot HTML/TXT stocké en base de données à la fermeture
2. Les liens temporaires (bouton ou `/gettranscript`) durent **10 minutes**
3. Les snapshots archivés sont consultables en permanence via le dashboard

### Configuration requise
```json
"webServerPort": 3000,
"webServerBaseUrl": "http://TON_IP:3000"
```

---

## Base de données

Tables créées automatiquement au démarrage.

| Table | Description |
|-------|-------------|
| `tickets` | Tous les tickets (ouverts et fermés) avec subject, priority, timestamps |
| `ticket_participants` | Utilisateurs ajoutés via `/adduser` |
| `transcript_snapshots` | Transcripts HTML + TXT archivés |
| `admin_stats` | Statistiques par agent (claims, fermetures, notes, temps de réponse) |
| `blacklist` | Utilisateurs bannis |
| `ticket_ratings` | Notes de satisfaction (1–5 étoiles) laissées après fermeture |

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
├── config.example.json       # Exemple de configuration
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
│   ├── priority.js           # Changer la priorité d'un ticket
│   ├── blacklist.js          # Gestion de la blacklist
│   ├── reopen.js             # Réouverture d'un ticket fermé
│   └── staffstats.js         # Statistiques staff avec notes et temps de réponse
│
├── events/
│   ├── messageCreate.js      # Réception DMs, menu sujet, anti-spam
│   └── interactionCreate.js  # Commandes, boutons (sujet, notation, ticket)
│
├── utils/
│   ├── db.js                 # Pool de connexions MariaDB
│   ├── ticketManager.js      # Logique principale des tickets
│   ├── transcript.js         # Génération HTML/TXT
│   ├── transcriptServer.js   # Serveur HTTP transcripts temporaires
│   ├── inactiveTicketChecker.js  # Fermeture automatique des tickets inactifs
│   ├── permissions.js        # Vérification des rôles staff
│   ├── embeds.js             # Embeds Discord
│   └── components.js         # Boutons Discord (sujet, notation)
│
└── web/                      # Backend dashboard (Express)
│   ├── server.js             # Point d'entrée Express
│   ├── middleware/
│   │   └── auth.js           # Vérification de session
│   └── routes/
│       ├── auth.js           # Login, logout, OAuth Discord
│       ├── dashboard.js      # Stats et activité
│       ├── tickets.js        # CRUD tickets
│       ├── staff.js          # Statistiques staff
│       ├── blacklist.js      # Gestion blacklist
│       ├── transcripts.js    # Consultation transcripts
│       └── config.js         # Lecture/écriture config.json
│
└── dashboard/                # Frontend React + Vite + Tailwind
    ├── src/
    │   ├── pages/            # Login, Dashboard, Tickets, Staff, Blacklist...
    │   └── components/       # Sidebar, StatCard, Badge, Pagination
    └── dist/                 # Build de production (généré par npm run build)
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
→ Vérifie que `config.dashboard` est présent dans `config.json` et que le port `dashboard.port` est ouvert.

**Erreur OAuth Discord "not_in_guild"**  
→ L'utilisateur doit être membre du serveur configuré dans `guildId`.

**Erreur OAuth Discord "no_permission"**  
→ L'utilisateur n'a pas le rôle `allowedRoleId`. Assigne-lui le rôle ou change `allowedRoleId`.

**"Impossible de trouver la catégorie" dans /moveticket**  
→ Le nom doit correspondre **exactement** (casse incluse) au nom de la catégorie Discord.

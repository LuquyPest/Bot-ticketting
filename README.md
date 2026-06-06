# Bot Ticketing Discord

Bot Discord de support par tickets. L'utilisateur ouvre son ticket en **message privé** au bot, le staff gère tout depuis un salon privé sur le serveur.

---

## Sommaire

- [Fonctionnement](#fonctionnement)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration config.json](#configuration-configjson)
- [Préparer le serveur Discord](#préparer-le-serveur-discord)
- [Démarrage](#démarrage)
- [Commandes](#commandes)
- [Boutons ticket](#boutons-ticket)
- [Transcripts web](#transcripts-web)
- [Base de données](#base-de-données)
- [Logs](#logs)
- [Structure des fichiers](#structure-des-fichiers)

---

## Fonctionnement

### Côté membre
- Le membre envoie un **message privé** au bot
- Si aucun ticket n'est ouvert, le bot crée un salon dans le serveur
- Les messages suivants (texte et fichiers) sont relayés dans ce salon
- Le membre reçoit les réponses du staff en DM

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
- Un **serveur accessible depuis internet** pour héberger les pages de transcript (port ouvert ou reverse proxy)

---

## Installation

```bash
# 1. Cloner ou extraire le projet
git clone https://github.com/LuquyPest/Bot-ticketting.git
cd Bot-ticketting

# 2. Installer les dépendances
npm install

# 3. Créer le fichier de configuration
cp config.example.json config.json   # ou copier manuellement l'exemple ci-dessous
# Puis éditer config.json avec tes valeurs

# 4. Lancer le bot
npm start
```

---

## Configuration config.json

Crée un fichier `config.json` à la racine du projet avec la structure suivante :

```json
{
  "token": "TON_TOKEN_BOT_DISCORD",
  "clientId": "ID_APPLICATION_BOT",
  "guildId": "ID_SERVEUR_DISCORD",

  "ticketPrefix": "ticket",
  "ticketCategoryId": "ID_CATEGORIE_TICKETS",

  "supportRoleId": "ID_ROLE_SUPPORT",
  "chiefSupportRoleId": "ID_ROLE_CHEF_SUPPORT",

  "webServerPort": 3000,
  "webServerBaseUrl": "http://TON_IP_OU_DOMAINE:3000",

  "closeLogChannelId": "ID_SALON_LOG_FERMETURE",
  "claimLogChannelId": "ID_SALON_LOG_CLAIM",
  "moveLogChannelId": "ID_SALON_LOG_DEPLACEMENT",
  "addUserLogChannelId": "ID_SALON_LOG_AJOUT_USER",
  "removeUserLogChannelId": "ID_SALON_LOG_RETRAIT_USER",

  "database": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "ton_utilisateur_db",
    "password": "ton_mot_de_passe_db",
    "database": "bot_tickets"
  }
}
```

### Détail des champs

| Champ | Description |
|-------|-------------|
| `token` | Token du bot Discord (portail développeur → Bot → Reset Token) |
| `clientId` | ID de l'application Discord (portail développeur → General Information) |
| `guildId` | ID de ton serveur Discord (clic droit sur le serveur → Copier l'identifiant) |
| `ticketPrefix` | Préfixe du nom de salon (ex: `ticket` → salon `ticket-pseudo`) |
| `ticketCategoryId` | ID de la catégorie Discord où créer les salons ticket |
| `supportRoleId` | ID du rôle Support |
| `chiefSupportRoleId` | ID du rôle Chef Support |
| `webServerPort` | Port du serveur web local pour les transcripts (ex: `3000`) |
| `webServerBaseUrl` | URL publique complète du serveur (ex: `http://192.168.1.10:3000`) |
| `closeLogChannelId` | Salon de log des fermetures de ticket *(optionnel)* |
| `claimLogChannelId` | Salon de log des claims *(optionnel)* |
| `moveLogChannelId` | Salon de log des déplacements *(optionnel)* |
| `addUserLogChannelId` | Salon de log des ajouts d'utilisateur *(optionnel)* |
| `removeUserLogChannelId` | Salon de log des retraits d'utilisateur *(optionnel)* |
| `database.host` | Hôte MariaDB (souvent `127.0.0.1`) |
| `database.port` | Port MariaDB (par défaut `3306`) |
| `database.user` | Utilisateur MariaDB |
| `database.password` | Mot de passe MariaDB |
| `database.database` | Nom de la base de données (sera créée automatiquement) |

> **Les champs de log sont optionnels.** Si tu ne les mets pas, les logs correspondants seront simplement désactivés.

---

## Préparer le serveur Discord

### 1. Activer le mode développeur
Dans Discord : **Paramètres → Apparence → Mode développeur** → Activer.  
Clic droit sur n'importe quel élément pour copier son ID.

### 2. Créer le bot
1. Aller sur [discord.com/developers/applications](https://discord.com/developers/applications)
2. **New Application** → donner un nom
3. Onglet **Bot** → **Add Bot**
4. Copier le **Token** → le mettre dans `config.json`
5. Activer les intents : **Presence Intent**, **Server Members Intent**, **Message Content Intent**

### 3. Inviter le bot sur le serveur
Dans le portail développeur → **OAuth2 → URL Generator** :
- Scopes : `bot`, `applications.commands`
- Permissions : `Manage Channels`, `Send Messages`, `Read Message History`, `Embed Links`, `Attach Files`, `View Channel`

Copier l'URL générée et l'ouvrir dans un navigateur pour inviter le bot.

### 4. Créer les éléments Discord nécessaires

| Élément | Description |
|---------|-------------|
| **Catégorie tickets** | Catégorie où les salons ticket seront créés |
| **Rôle Support** | Rôle donné aux agents de support |
| **Rôle Chef Support** | Rôle avec accès aux statistiques staff |
| **Salons de log** | Salons optionnels pour recevoir les logs du bot |

Récupère les IDs de chaque élément (clic droit → Copier l'identifiant) et remplis `config.json`.

### 5. Ouvrir le port du serveur web
Le bot héberge un serveur web local pour afficher les transcripts.  
Il faut que le port défini dans `webServerPort` soit **accessible depuis l'extérieur**.

- **VPS/serveur dédié** : ouvrir le port dans le firewall (`ufw allow 3000`)
- **Reverse proxy Nginx** : proxyfier vers `http://127.0.0.1:3000` et utiliser ton domaine dans `webServerBaseUrl`
- **Réseau local uniquement** : mettre l'IP locale, mais les liens ne fonctionneront que sur le même réseau

---

## Démarrage

```bash
npm start
```

Le script vérifie automatiquement dans l'ordre :
1. Validité du `config.json`
2. Présence des fichiers principaux
3. Dépendances installées
4. Connexion MariaDB
5. Création de la base et des tables si elles n'existent pas
6. Vérification du schéma de la base
7. Vérification des IDs Discord (serveur, rôles, catégorie, salons)
8. Déploiement des commandes slash
9. Lancement du bot + serveur web transcripts

En cas d'erreur à n'importe quelle étape, le script affiche clairement ce qui manque et s'arrête.

---

## Commandes

Toutes les commandes sont réservées au staff (**Support** ou **Chef Support**).

### `/reply`
Envoie une réponse au(x) membre(s) du ticket **avec ton pseudo**.

| Option | Type | Requis |
|--------|------|--------|
| `message` | Texte | Non |
| `fichier` | Fichier | Non |

Au moins un message ou un fichier est requis.

---

### `/areply`
Envoie une réponse **anonyme** au(x) membre(s) du ticket (le nom affiché est "Support").

| Option | Type | Requis |
|--------|------|--------|
| `message` | Texte | Non |
| `fichier` | Fichier | Non |

---

### `/adduser`
Ajoute un utilisateur comme **participant DM lié** au ticket.  
L'utilisateur ajouté reçoit les réponses du staff en DM et ses propres messages sont relayés dans le ticket.

| Option | Type | Requis |
|--------|------|--------|
| `utilisateur` | Mention Discord | Oui |

> L'utilisateur cible ne doit pas avoir de ticket ouvert. Si c'est le cas, il faut d'abord fermer son ticket.

---

### `/removeuser`
Retire un participant DM lié au ticket.

| Option | Type | Requis |
|--------|------|--------|
| `utilisateur` | Mention Discord | Oui |

> Le propriétaire principal du ticket ne peut pas être retiré.

---

### `/rename`
Renomme le salon ticket.

| Option | Type | Requis |
|--------|------|--------|
| `name` | Texte | Oui |

---

### `/claim`
Marque le ticket comme **pris en charge** par le staff qui exécute la commande.  
Si le ticket est déjà claim par quelqu'un d'autre, une erreur est affichée.

---

### `/unclaim`
Retire la prise en charge du ticket.

---

### `/moveticket`
Déplace le ticket dans une autre catégorie Discord.

| Option | Type | Requis |
|--------|------|--------|
| `categorie` | Nom exact de la catégorie | Oui |

Exemple : `/moveticket categorie:En cours`

---

### `/oldtickets`
Affiche l'historique des tickets d'un utilisateur dans un embed paginé (5 par page).

| Option | Type | Requis |
|--------|------|--------|
| `userid` | ID Discord (texte) | Oui |

---

### `/gettranscript`
Génère un **lien web temporaire** (valable 10 minutes) vers un transcript déjà enregistré.

| Option | Type | Requis |
|--------|------|--------|
| `transcriptid` | Numéro du transcript | Oui |

---

### `/staffstats`
Affiche les statistiques du staff (claims et fermetures par agent).  
**Réservé au Chef Support.**

---

## Boutons ticket

Chaque ticket possède deux boutons dans le message d'ouverture :

### `Transcript`
- Récupère tous les messages du salon à cet instant
- Enregistre le snapshot en base de données
- Génère un **lien web temporaire** valable **10 minutes**
- Plusieurs membres du staff peuvent générer leur propre lien simultanément

### `Fermer et enregistrer le transcript`
- Demande une confirmation avant d'agir
- Ferme le ticket (status → `closed`)
- Enregistre le transcript final en base
- Notifie tous les membres liés au ticket en DM
- Supprime le salon ticket

---

## Transcripts web

Les transcripts sont affichés comme une **page web hébergée temporairement** par le bot lui-même.

### Fonctionnement
1. Le staff clique sur le bouton Transcript (ou utilise `/gettranscript`)
2. Le bot génère la page HTML et la stocke **en mémoire** avec un token unique
3. Un lien est envoyé en réponse éphémère : `http://ton-ip:3000/abc123...`
4. La page est accessible pendant **10 minutes**, puis automatiquement supprimée
5. 10 demandes simultanées = 10 liens différents, tous indépendants

### Ce qu'affiche la page
- Sidebar avec les infos du ticket (ID, propriétaire, dates, nombre de messages)
- Compte à rebours d'expiration en temps réel
- Messages groupés par auteur (comme Discord)
- Badges **STAFF** / **BOT** sur les auteurs concernés
- Aperçu des images intégré, lecteur pour les vidéos/audio
- Liens de téléchargement pour les autres fichiers

### Configuration requise
```json
"webServerPort": 3000,
"webServerBaseUrl": "http://TON_IP:3000"
```

Si tu utilises un reverse proxy, `webServerBaseUrl` peut être `https://transcripts.tondomaine.com`.

---

## Base de données

Le bot crée et gère automatiquement les tables suivantes dans MariaDB.

### `tickets`
Contient tous les tickets (ouverts et fermés).

| Colonne | Description |
|---------|-------------|
| `id` | Identifiant unique |
| `channel_id` | ID du salon Discord |
| `owner_id` | ID Discord du propriétaire |
| `owner_tag` | Tag Discord du propriétaire |
| `claimed_by` | ID Discord du staff qui a claim |
| `status` | `open` ou `closed` |
| `created_at` | Date de création |
| `closed_at` | Date de fermeture |
| `closed_by_tag` | Tag du staff qui a fermé |

### `ticket_participants`
Utilisateurs ajoutés en DM lié via `/adduser`.

### `transcript_snapshots`
Transcripts enregistrés via le bouton ou à la fermeture.  
> Les messages **ne sont pas** enregistrés en temps réel. Seul le snapshot final est stocké.

### `admin_stats`
Statistiques par agent de support.

| Colonne | Description |
|---------|-------------|
| `admin_id` | ID Discord de l'agent |
| `admin_tag` | Tag Discord de l'agent |
| `tickets_claimed` | Nombre de tickets claim |
| `tickets_closed` | Nombre de tickets fermés |

---

## Logs

Tous les salons de log sont **optionnels**. Les laisser vides dans `config.json` désactive simplement le log correspondant.

| Champ config | Ce qui est loggé |
|-------------|-----------------|
| `closeLogChannelId` | Fermeture de ticket (ID, propriétaire, staff, transcript ID) |
| `claimLogChannelId` | Claim d'un ticket |
| `moveLogChannelId` | Déplacement d'un ticket dans une autre catégorie |
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
├── commands/
│   ├── reply.js
│   ├── areply.js
│   ├── adduser.js
│   ├── removeuser.js
│   ├── rename.js
│   ├── claim.js
│   ├── unclaim.js
│   ├── moveticket.js
│   ├── oldtickets.js
│   ├── gettranscript.js
│   └── staffstats.js
├── events/
│   ├── messageCreate.js      # Réception des DMs (via raw event)
│   └── interactionCreate.js  # Gestion des commandes et boutons
└── utils/
    ├── db.js                 # Pool de connexions MariaDB
    ├── ticketManager.js      # Logique principale des tickets
    ├── transcript.js         # Génération HTML/TXT des transcripts
    ├── transcriptServer.js   # Serveur HTTP + pages temporaires
    ├── permissions.js        # Vérification des rôles staff
    ├── embeds.js             # Embeds Discord
    └── components.js         # Boutons Discord
```

---

## Problèmes fréquents

**Le bot ne reçoit pas les DMs**  
→ Vérifie que l'intent **Message Content Intent** est activé dans le portail développeur.

**Les commandes slash n'apparaissent pas**  
→ Lance `npm run deploy` pour forcer le redéploiement. Attends jusqu'à 1 heure pour la propagation.

**MariaDB refuse la connexion**  
→ Vérifie que le service tourne (`systemctl status mariadb`), que l'utilisateur a les droits sur la base, et que l'hôte est correct.

**Le lien de transcript ne s'ouvre pas**  
→ Vérifie que le port `webServerPort` est ouvert dans ton firewall et que `webServerBaseUrl` contient la bonne IP/domaine accessible depuis l'extérieur.

**"Impossible de trouver la catégorie" dans moveticket**  
→ Le nom doit correspondre **exactement** (casse incluse) au nom de la catégorie Discord.

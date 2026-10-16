# Bot Ticketing Discord

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
- [Tests](#tests)
- [Problèmes fréquents](#problèmes-fréquents)

---

## Architecture

```
                    ┌─────────────────────────────────┐
                    │         ticketbot_global         │
                    │  guilds · superadmins · managers │
                    │  login_logs · user_totp          │
                    │  sa_auth_logs · user_sessions    │
                    └─────────────┬───────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
   ticketbot_guild_111  ticketbot_guild_222  ticketbot_guild_333
   tickets · staff      tickets · staff      tickets · staff
   grades · panels      grades · panels      grades · panels
   config · …           config · …           config · …
```

Un serveur Discord qui ajoute le bot est enregistré en statut **pending** dans `ticketbot_global`. Un superadmin valide la demande depuis le panel `/sa`, ce qui crée la base de données dédiée et active le serveur. Tant qu'un serveur n'est pas actif (en attente, suspendu ou en maintenance), le bot n'y répond pas.

---

## Stack technique

| Couche | Technologies |
|--------|-------------|
| Bot Discord | Node.js 22, Discord.js 14 |
| API / serveur web | Express 5, express-session, Helmet, express-rate-limit |
| Base de données | MariaDB 11 (mysql2, architecture multi-tenant) |
| Authentification | OAuth2 Discord, TOTP 2FA (otplib, secrets chiffrés AES-256-GCM), bcrypt |
| Temps réel | Server-Sent Events (SSE) |
| Notifications push | Web Push API (VAPID, web-push) |
| Sessions & jobs | Redis 7 (sessions express-session via connect-redis, file BullMQ) |
| Dashboard frontend | React 18, React Router 7, Vite, Tailwind CSS |
| Déploiement | Docker (multi-stage), Docker Compose, Traefik |

---

## Fonctionnement — cycle de vie d'un ticket

### Côté membre

1. Le membre envoie un **message privé** au bot
2. S'il a déjà des tickets ouverts → le bot lui demande, **à chaque message**, dans quel ticket l'envoyer, ou s'il veut **ouvrir un nouveau ticket** (un membre peut avoir plusieurs tickets, dans la limite quotidienne)
3. Nouveau ticket : si le membre est dans plusieurs serveurs utilisant le bot → choix du serveur
4. Le bot demande ensuite le **sujet du ticket** : boutons si des sujets sont configurés (+ « Autre sujet »), sinon réponse libre. Sans réponse sous 10 minutes, le ticket est ouvert sans sujet
5. Si un **formulaire d'intake** est activé → questionnaire étape par étape avant création
6. Un salon privé est créé dans le serveur Discord, **nommé d'après le sujet**
7. Les messages et fichiers suivants sont relayés dans le ticket choisi
8. Le membre reçoit les réponses du staff en DM (embed indiquant le serveur et le ticket)
9. À la fermeture → le membre reçoit un **bouton de notation** (1–5 étoiles)

Le membre peut aussi ouvrir un ticket en cliquant sur un **panel** publié dans un salon (voir [Panels Discord](#panels-discord)). Un utilisateur blacklisté sur un serveur ne peut pas y ouvrir de ticket (la blacklist est propre à chaque serveur).

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
- Un serveur avec domaine public et un reverse proxy HTTPS — le `docker-compose.yml` est prévu pour **Traefik** (réseau Docker externe `proxy`, labels déjà présents)
- **Redis 7** — inclus dans le `docker-compose.yml` (service `redis`), utilisé pour les sessions du dashboard et la file de jobs BullMQ

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
SA_USERNAME=admin
SA_PASSWORD=mot_de_passe_superadmin_12_caracteres_min
```

`DB_PASSWORD` doit correspondre exactement à `config.json → database.password`.
`SA_USERNAME` / `SA_PASSWORD` créent le premier compte superadmin au démarrage (uniquement si aucun n'existe) — retire-les du `.env` une fois le compte créé. Seules ces deux variables sont transmises au conteneur du bot.

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
2. Connexion MariaDB — création/migration de `ticketbot_global` et de ses tables
3. Création du compte superadmin initial (si `SA_USERNAME`/`SA_PASSWORD` sont définis)
4. Vérification du token Discord
5. Déploiement des commandes slash (réservées aux serveurs, pas en DM)
6. Lancement du bot + serveur web — au démarrage, les migrations des bases par serveur sont appliquées à tous les serveurs actifs

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
  "trustProxyHops": 1,

  "dashboard": {
    "sessionSecret": "GENERE_AVEC_openssl_rand_-hex_32",
    "encryptionKey": "GENERE_AVEC_openssl_rand_-hex_32",
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
| `trustProxyHops` | Nombre de reverse proxies devant l'app (défaut `1` = Traefik ; `2` si Cloudflare + Traefik). Sert à déterminer la vraie IP client (rate limiting, allowlist IP, logs) |
| `dashboard.sessionSecret` | Clé secrète sessions — **min. 32 chars**, générer avec `openssl rand -hex 32` |
| `dashboard.encryptionKey` | Clé AES-256 (64 caractères hex, `openssl rand -hex 32`) qui chiffre les secrets 2FA en base. Optionnelle : à défaut, dérivée de `sessionSecret` — **changer l'une ou l'autre rend les 2FA existantes inutilisables** |
| `dashboard.discordClientSecret` | Secret OAuth2 depuis le portail développeur Discord |
| `dashboard.discordCallbackUrl` | Doit correspondre exactement à l'URL configurée dans le portail Discord |
| `database.host` | Doit être `db` (nom du service Docker Compose, pas `localhost`) |
| `database.password` | Doit correspondre à `DB_PASSWORD` dans `.env` |

### Configurer le bot Discord

1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. Onglet **Bot** → copier le Token
3. Activer : **Server Members Intent**, **Message Content Intent**
4. **OAuth2** → ajouter l'URL callback → copier le **Client Secret**
5. Le lien d'invitation est généré par le dashboard (sélection du serveur). Permissions demandées (`248976`) :  
   `Manage Channels` · `View Channel` · `Send Messages` · `Read Message History` · `Embed Links` · `Attach Files` · `View Audit Log` (identifier qui a invité le bot) · `Mention Everyone` (pinger les rôles support en « Urgent »). Le bot ne mentionne que les utilisateurs par défaut : `@everyone` ne peut jamais être déclenché.

---

## Activation d'un serveur

Lorsqu'un membre (avec la permission *Gérer le serveur*) ajoute le bot :

1. Le bot est **enregistré automatiquement** dans `ticketbot_global.guilds` avec le statut `pending` (les serveurs où le bot est déjà présent sont aussi enregistrés au démarrage)
2. La personne qui a invité le bot (lue dans le journal d'audit, à défaut le propriétaire) reçoit un **DM de confirmation**
3. Un **superadmin** valide la demande depuis le panel `/sa` → statut `active`, création de la base `ticketbot_guild_{id}`
4. L'invitant devient **fondateur** et reçoit un DM d'activation avec le lien du dashboard

> Sans validation superadmin, aucune fonctionnalité n'est disponible pour le serveur.
> Si le bot est retiré puis ré-invité, le serveur est réactivé automatiquement ; une suspension décidée par un superadmin, elle, est conservée.

---

## Dashboard web

Accessible sur `https://ton-domaine.com` après connexion via Discord OAuth.

### Système de rôles

| Rôle | Accès |
|------|-------|
| `nouveau` | Page d'attente — aucun accès fonctionnel |
| `support` | Dashboard · Tickets · Staff · Analytics — chaque action est soumise aux permissions de ses grades (voir ci-dessous) |
| `fondateur` | Accès complet + Paramètres · Blacklist · Transcripts · Utilisateurs · Clés API |

Le fondateur est la personne qui a invité le bot (ou, à défaut, le propriétaire du serveur), désignée à l'approbation du serveur ; il peut promouvoir d'autres fondateurs. Les nouveaux membres reçoivent `nouveau` et attendent l'attribution d'un grade depuis la page **Équipe**.

**Accès automatique par rôle Discord :** les membres qui ont un des rôles *support* ou *chef support* choisis dans **Paramètres → Rôles d'accès** voient le serveur dans « Mes serveurs » et obtiennent un compte `support` à leur connexion, avec le grade associé à leur rôle (par défaut les grades **Support** et **Chef support**, créés automatiquement et modifiables ; *Chef support* est parent de *Support*). S'ils perdent le rôle Discord, l'accès est retiré (vérifié à la connexion puis toutes les 5 minutes). Les fondateurs et les comptes gérés à la main depuis **Équipe** ne sont jamais modifiés par cette synchronisation.

Un `support` n'a aucun droit sans grade. Permissions de grade appliquées par l'API :

| Permission | Autorise |
|------------|----------|
| `view_tickets` | Voir les tickets, notes, historique, recherche, messages programmés, notifications temps réel/push |
| `reply_ticket` | Répondre, ajouter des notes, programmer des messages, renommer/déplacer/changer le sujet, tags |
| `claim_ticket` | Prendre en charge / libérer un ticket |
| `close_ticket` | Fermer / rouvrir un ticket |
| `manage_participants` | Ajouter / retirer des participants |
| `view_transcripts` | Consulter les transcripts |
| `manage_users` | Attribuer des grades (pas à soi-même, ni un grade aux permissions supérieures aux siennes) |
| `manage_grades` | Créer/éditer les grades (pas ceux qu'on possède) et restreindre la visibilité d'un ticket |
| `manage_settings` | Gérer les tags |
| `view_audit` | Consulter le journal d'audit |

Un ticket restreint à un grade n'est visible (liste, détail, recherche, SSE, push, transcripts) que par ce grade, ses grades parents et le fondateur.

### 2FA pour les comptes dashboard

Les utilisateurs peuvent activer la **double authentification TOTP** depuis leur profil. Une fois activée, un code TOTP est requis après chaque connexion Discord OAuth. Un même code n'est jamais accepté deux fois, et les secrets sont chiffrés en base (AES-256-GCM).

À l'activation, **10 codes de secours** à usage unique sont affichés une seule fois (format `xxxxx-xxxxx`) ; ils remplacent le code TOTP sur l'écran de vérification en cas de perte du téléphone. Ils peuvent être régénérés depuis le profil.

Comptes superadmin/manager : verrouillage de 15 min après 5 échecs (mot de passe ou TOTP), déconnexion automatique après 30 min d'inactivité, mot de passe manager de 12 caractères minimum.

### Pages disponibles

| Page | Accès | Description |
|------|-------|-------------|
| **Dashboard** | support, fondateur | Stats globales, activité, tickets récents, objectif mensuel |
| **Tickets** / **Kanban** | `view_tickets` | Liste filtrable (vue « Ouverts » par défaut, vues personnelles enregistrables) ou colonnes par étape, détail en temps réel |
| **Mes stats** | support | Statistiques personnelles (claims, fermetures, temps de réponse) |
| **Analytiques** / **Recherche** | support, fondateur | Volume, SLA, satisfaction ; recherche plein texte (respecte la visibilité) |
| **Programmés** | `reply_ticket` | Messages planifiés dans un ticket |
| **Connexions** | support, fondateur | Historique de ses connexions (le fondateur voit celles des membres de son serveur) |
| **Grades** | fondateur, `manage_grades` | Hiérarchie de grades et permissions |
| **Journal** | fondateur, `view_audit` | Journal de toutes les actions (dashboard, Discord, API, automatismes, super-admin) avec filtres, export CSV et onglet Analytique |
| **Transcripts** | fondateur, `view_transcripts` | Consultation et téléchargement HTML/TXT |
| **Équipe** | fondateur | Membres du dashboard, rôles, grades, mode vacances |
| **Tags** | fondateur | Tags pour organiser les tickets |
| **Blacklist** | fondateur | Utilisateurs bloqués — propre à chaque serveur |
| **Panels** / **Formulaires** | fondateur | Panels de boutons Discord et formulaires associés |
| **Paramètres** | fondateur | Configuration du serveur (salons, rôles, messages, automatismes, webhooks, allowlist IP…) |
| **Clés API** | fondateur | Clés pour l'API publique v1 |
| **Newsletter** | fondateur | DM groupé au staff |
| **Patchnotes** | fondateur | Historique des versions |
| **Profil** | tous | Bio, photo (CDN Discord), 2FA, codes de secours, sessions actives, notifications push |

### Journal d'activité

Chaque action est enregistrée dans `audit_log` avec son **acteur**, sa **source** (Dashboard, Discord, Automatique, API, Super-admin), le **ticket** concerné et des détails lisibles : ouverture, fermeture (y compris automatique, avec la raison), réouverture, réponses et notes, attributions, étapes, priorité, titre, renommage, participants, tags, notation, escalade, messages programmés, blacklist, connexions au dashboard, accès accordés / retirés par rôle Discord, grades, fondateurs, paramètres, panels, formulaires, tags, modèles, clés API, newsletter.

La page **Journal** filtre par catégorie, action, source, acteur, ticket, période et texte, exporte en CSV, et son onglet **Analytique** montre l'activité par jour et par catégorie, les actions les plus fréquentes, les membres les plus actifs, l'origine des actions et l'activité par heure (7, 30 ou 90 jours, avec les mêmes filtres).

### Messages privés

Chaque message privé lié à un ticket (réponse du staff, message programmé, accueil, ajout comme participant, avertissement d'inactivité, fermeture, réouverture) est un embed dont l'en-tête indique **le serveur, le numéro et le titre du ticket** — indispensable quand un membre a des tickets ouverts sur plusieurs serveurs.

### Vues de la liste des tickets

La liste s'ouvre sur la vue **Ouverts**. Vues prédéfinies : Ouverts, Mes tickets, Non attribués, En attente, En cours, Urgents, Fermés, Tous. Chaque membre peut enregistrer ses propres vues (filtres statut, priorité, étape, attribué à, dates, tag, recherche), en définir une comme vue par défaut, et les supprimer — elles sont personnelles.

### Fonctionnalités dans la vue ticket

- **Temps réel (SSE)** : nouvelles notes et réponses sans rechargement de page
- **Répondre au membre** : mode *Répondre* (DM envoyé) ou *Note interne* (staff seulement)
- **Réponse anonyme** : toggle "Anonyme/Identifié" masquant le pseudo du staff
- **Templates** : réponses prédéfinies insérables en un clic
- **Attribué à** : un ticket peut être attribué à plusieurs membres du staff ; « M'attribuer », attribuer quelqu'un d'autre, retirer (permission `claim_ticket`). La première personne assignée reste le responsable principal (stats, rappels, notation)
- **Étapes** : Ouvert / En attente / En cours — chaque étape correspond à une catégorie Discord choisie dans **Paramètres → Rôles d'accès**, changer d'étape déplace le salon
- **Priorité** : Faible / Normal / Urgent — met à jour le topic du salon Discord
- **Participants** : ajout/retrait d'utilisateurs liés en DM
- **Titre** : modifiable dans l'en-tête ; le salon Discord est renommé pareil (Discord limite à 2 renommages par 10 minutes : au-delà, le renommage du salon est différé)
- **Indicateurs non-lus** : point bleu sur les tickets avec messages non consultés
- **Aging** : durée depuis le dernier message, colorée selon l'urgence

---

## Panel Superadmin

Accessible sur `/sa` — interface séparée du dashboard guild, avec ses propres comptes.

### Authentification

- Connexion par **identifiant + mot de passe** (bcrypt)
- **TOTP 2FA** requis après configuration initiale
- Les tentatives échouées sont loguées dans `sa_auth_logs`
- Rate limiting : 20 tentatives / 15 min par IP sur les endpoints d'auth SA
- Verrouillage du compte 15 min après 5 échecs (mot de passe ou TOTP), quelle que soit l'IP
- Déconnexion automatique après 30 min d'inactivité

### Fonctionnalités

| Section | Description |
|---------|-------------|
| **Guilds** | Lister, approuver, suspendre, réactiver, supprimer des serveurs (la suppression efface la base du serveur et fait quitter le serveur Discord au bot) |
| **Maintenance** | Activer/désactiver le mode maintenance d'un serveur |
| **Fondateurs** | Voir les fondateurs d'un serveur ; le superadmin peut en nommer par ID Discord (DM envoyé) ou en retirer (le dernier fondateur est protégé). Actions tracées dans l'audit du serveur |
| **Managers** | Créer des comptes managers avec accès restreint à certains serveurs |
| **Blocages** | Comptes super-admin / manager verrouillés après trop d'échecs et adresses IP limitées (connexion : 20 / 15 min, API : 200 / min), avec déblocage manuel — superadmin uniquement |
| **Stats globales** | Vue d'ensemble de tous les serveurs actifs |

Routes d'administration sans écran dédié (appelables avec une session SA) : `GET /api/sa/stats`, `PATCH /api/sa/guilds/:guildId/limits` (`max_tickets`, `max_agents`, `transcript_retention_days`) et `GET /api/sa/error-logs` (superadmin uniquement).

### Rôles dans le panel SA

| Rôle | Accès |
|------|-------|
| `superadmin` | Accès complet à toutes les guilds et tous les managers |
| `manager` | Accès restreint aux guilds qui lui sont assignées |

---

## Commandes Discord

Toutes les commandes sont réservées au staff (rôles Discord Support ou Chef Support configurés dans les paramètres) et utilisables uniquement sur un serveur actif. `/gettranscript` et `/oldtickets` masquent les tickets restreints à un grade que l'utilisateur ne peut pas voir.

| Commande | Rôle | Description |
|----------|------|-------------|
| `/reply` | Support | Répond au membre avec ton pseudo (texte et/ou fichier) |
| `/areply` | Support | Répond anonymement (affiché comme "Support") |
| `/claim` | Support | S'ajoute aux personnes assignées au ticket (plusieurs personnes possibles) |
| `/unclaim` | Support | Se retire des personnes assignées |
| `/priority` | Support | Définit la priorité : Faible / Normal / Urgent |
| `/adduser` | Support | Ajoute un participant lié au ticket en DM |
| `/removeuser` | Support | Retire un participant |
| `/rename` | Support | Change le titre du ticket — le salon Discord porte toujours le même nom que le titre |
| `/moveticket` | Support | Change l'étape du ticket : Ouvert / En attente / En cours (déplace le salon dans la catégorie associée) |
| `/reopen` | Support | Réouvre le dernier ticket fermé d'un utilisateur |
| `/oldtickets` | Support | Historique paginé des tickets d'un utilisateur |
| `/gettranscript` | Support | Génère un lien temporaire (10 min) vers un transcript HTML |
| `/note` | Support | Ajoute une note interne (non envoyée au membre, exclue des transcripts) |
| `/blacklist` | Chef Support | Gestion de la liste noire (add / remove / list) |
| `/staffstats` | Chef Support | Statistiques détaillées par agent |

### Topic du salon Discord

Le topic est mis à jour automatiquement à chaque changement d'état :

```
#42 · utilisateur · 🔴 Urgente · staffMembre · sujet du ticket
```

---

## Fonctionnalités avancées

### Formulaires d'intake

Avant la création d'un ticket, un questionnaire étape par étape peut être déclenché. Les réponses sont intégrées au contenu initial du ticket.

- Déclenchement global ou par sujet de ticket (DM), ou au clic sur un bouton de panel (modal Discord, 5 champs max)
- Types de champs : texte court ou paragraphe, avec longueur min/max et placeholder
- Configuration depuis la page **Formulaires** du dashboard

### Système de grades

Hiérarchie de rôles personnalisée avec permissions granulaires — indépendant des rôles Discord natifs.

Les permissions sont détaillées dans [Système de rôles](#système-de-rôles).

Un grade peut avoir un `parent_id` — les membres d'un grade voient aussi les tickets visibles par leurs grades enfants (héritage hiérarchique).

### Objectifs mensuels

Quand l'option est activée dans les paramètres, chaque agent voit sur le dashboard sa progression vers un objectif de 50 tickets traités dans le mois.

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

Au clic, si le bouton n'a pas de sujet prédéfini, une fenêtre demande le **sujet du ticket** (avec les champs du formulaire associé, 5 champs au total). Un clic ouvre toujours un nouveau ticket (dans la limite quotidienne).

Chaque panel comprend :
- Un **embed** personnalisable (titre, description, couleur, image, footer)
- Des **boutons** (jusqu'à 25, répartis en lignes de 5) avec label, emoji, style et sujet optionnel
- Un lien optionnel vers un **formulaire d'intake** (modal Discord) déclenché au clic

Le fondateur peut créer, modifier, publier et retirer des panels depuis **Dashboard → Panels**. La publication envoie ou met à jour le message Discord dans le salon cible ; la suppression du panel retire le message automatiquement.

**Tables associées :** `ticket_panels`, `panel_buttons`

---

## Push Notifications Web

Les agents du dashboard peuvent s'abonner aux **notifications push navigateur** (Web Push API) depuis leur profil. Une notification est envoyée quand un membre du staff répond à un ticket depuis le dashboard, uniquement aux agents autorisés à voir ce ticket.

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

Clés d'API générées par le fondateur pour des intégrations externes (l'option doit être activée dans les paramètres). Chaque clé a des permissions granulaires et une date d'expiration optionnelle. Seul le hash SHA-256 est stocké, jamais la clé en clair.

Format : `tb_<guildId>_<64 hex>`. Envoyer la clé dans l'en-tête `Authorization: Bearer <clé>`.

| Méthode | Route | Permission |
|---------|-------|------------|
| `GET` | `/api/v1/tickets?status=open\|closed&page=1` | `read_tickets` |
| `GET` | `/api/v1/tickets/:id` (ticket + messages) | `read_tickets` |
| `POST` | `/api/v1/tickets/:id/close` | `close_tickets` |
| `GET` | `/api/v1/stats` | `read_stats` |

---

## Base de données

### Base globale — `ticketbot_global`

| Table | Description |
|-------|-------------|
| `guilds` | Registre de tous les serveurs (pending / active / suspended) |
| `superadmins` | Comptes du panel SA (TOTP chiffré, compteur d'échecs) |
| `managers` | Comptes managers avec guilds assignées |
| `error_logs` | Erreurs centralisées (tous serveurs) |
| `user_sessions` | Suivi des sessions actives par utilisateur (IP, user-agent, timestamps) |
| `user_totp` | Secrets TOTP chiffrés, dernier pas utilisé, codes de secours hachés |
| `login_logs` | Historique des connexions OAuth Discord |
| `sa_auth_logs` | Historique des tentatives d'auth superadmin |
| `push_subscriptions` | Abonnements push navigateur (endpoint VAPID + clés par utilisateur/guild) |

### Par serveur — `ticketbot_guild_{guildId}`

| Table | Description |
|-------|-------------|
| `tickets` | Tickets (sujet, priorité, étape, responsable principal, timestamps) |
| `ticket_assignees` | Membres du staff assignés à chaque ticket |
| `ticket_views` | Vues de la liste des tickets enregistrées par utilisateur |
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
| `monthly_goals` | Objectifs mensuels par agent |
| `api_keys` | Clés API (hash + permissions) |
| `intake_forms` | Formulaires d'intake |
| `intake_form_fields` | Champs des formulaires |
| `scheduled_messages` | Messages planifiés |
| `staff_notes` | Notes internes isolées (commande `/note`) |
| `guild_config` | Configuration complète du serveur |
| `audit_log` | Journal de toutes les actions (acteur, source, ticket, détails) |
| `ticket_panels` | Panels de boutons Discord (embed + métadonnées, message_id publié) |
| `panel_buttons` | Boutons associés à un panel (label, emoji, style, sujet, formulaire) |

---

## Structure des fichiers

```
Bot-ticketting/
├── Dockerfile                      # Build multi-stage (React + bot)
├── docker-compose.yml              # Bot + MariaDB + Redis + labels Traefik
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
│   ├── messageCreate.js            # DM → ticket + intake + relay (limité par utilisateur)
│   ├── panelTicket.js              # Ouverture de ticket depuis un bouton de panel Discord
│   ├── guildCreate.js              # Enregistrement nouveau serveur
│   ├── guildDelete.js              # Suspension serveur
│   └── ready.js                    # Synchro des serveurs + migrations au démarrage
│
├── utils/
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
│   ├── notePrefix.js               # Marqueurs des notes internes (exclues des transcripts)
│   ├── jsonField.js                # Lecture tolérante des colonnes JSON
│   ├── discordGuard.js             # Salons/rôles limités au serveur courant
│   ├── secretBox.js                # Chiffrement AES-256-GCM des secrets
│   ├── totp.js                     # TOTP anti-rejeu + codes de secours
│   ├── csv.js                      # Échappement CSV (anti-formules)
│   ├── sanitize.js                 # Sanitisation des noms de salons
│   ├── rateLimit.js                # Cooldowns + limiteur de DM
│   ├── sse.js                      # Registre SSE guild-aware
│   ├── webhookEmitter.js           # Webhooks sortants + anti-SSRF
│   ├── redis.js                    # Client Redis lazy (ioredis)
│   ├── jobQueue.js                 # File BullMQ : rapports hebdomadaires
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
│       ├── users.js                # Membres du dashboard (page Équipe)
│       ├── grades.js               # Grades et permissions
│       ├── goals.js                # Objectif mensuel de l'utilisateur
│       ├── blacklist.js            # Liste noire
│       ├── transcripts.js          # Transcripts
│       ├── templates.js            # Templates de réponse
│       ├── tags.js                 # Tags sur tickets
│       ├── messages.js             # Messages programmés
│       ├── discord.js              # Catégories Discord
│       ├── events.js               # Endpoint SSE
│       ├── panels.js               # Panels Discord (CRUD + publish/unpublish)
│       ├── forms.js                # Formulaires d'intake (CRUD champs)
│       ├── push.js                 # Push notifications (VAPID, subscribe/unsubscribe)
│       ├── sessions.js             # Gestion des sessions actives (liste + révocation)
│       ├── loginLogs.js            # Journaux de connexion
│       ├── audit.js                # Journal d'audit
│       ├── apiKeys.js              # Gestion des clés API
│       ├── apiV1.js                # API publique v1 (auth par clé)
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
| **Sessions** | Cookie `Secure` + `HttpOnly` + `SameSite: Lax`, store Redis, régénérées à chaque élévation de privilège, révocables depuis le profil |
| **Session secret** | Rejeté au démarrage si < 32 caractères |
| **TOTP 2FA** | Optionnelle pour le dashboard (codes de secours), obligatoire pour les SA ; anti-rejeu, secrets chiffrés |
| **Contrôle d'accès** | Permissions de grade et visibilité par grade appliquées côté API, temps réel, push et commandes Discord |
| **Isolation multi-tenant** | Base par serveur ; salons, rôles, blacklist et journaux de connexion ne débordent jamais sur un autre serveur |
| **Allowlist IP** | Par serveur, sur la vraie IP client (`trustProxyHops`), IPv4/IPv6 et CIDR |
| **Rate limiting** | 20 req/15 min sur les endpoints d'auth, 200 req/min sur l'API générale |
| **CSRF** | Toutes les mutations (POST/PATCH/DELETE/PUT) exigent `X-Requested-With: XMLHttpRequest` |
| **SSRF** | Webhooks sortants : résolution DNS + blocage de tous les ranges privés/réservés |
| **Audit SA** | Toutes les tentatives de connexion SA (succès, échec, TOTP) loguées dans `sa_auth_logs` |
| **Audit dashboard** | Toutes les mutations du dashboard loguées dans `audit_log` |
| **Brute-force** | 5 tentatives TOTP par session ; comptes SA verrouillés 15 min après 5 échecs ; 8 DM / 30 s par utilisateur côté bot |
| **Docker** | Utilisateur `node` (non-root), `no-new-privileges`, `cap_drop: ALL`, `NODE_ENV=production` ; `botuser` limité aux bases `ticketbot_*` |
| **Base de données** | Requêtes paramétrées, `stringifyObjects` activé (pas d'injection via objets JSON) |
| **Maintenance / suspension** | Bloque l'API du serveur et rend le bot inactif sur ce serveur |
| **Push endpoint allowlist** | Les endpoints push enregistrés sont validés contre une liste blanche des origines connues (FCM, Mozilla, Windows, Apple) — bloque tout endpoint arbitraire |

---

## Tests

Suite d'intégration (`tests/integration/harness.js`) : elle démarre le vrai serveur web et la logique du bot contre une base MariaDB et un Redis, avec un faux client Discord, et vérifie les permissions, la visibilité, l'isolation entre serveurs, la 2FA, le journal, le parcours des messages privés, etc.

```bash
npm run test:integration   # lance MariaDB + Redis jetables (Docker), exécute la suite, nettoie
```

La configuration de test est générée à la volée (variable `TICKETBOT_CONFIG`) : le `config.json` de production n'est jamais lu. La même suite tourne à chaque push via **GitHub Actions** (`.github/workflows/ci.yml`), avec le build du dashboard et `npm audit`.

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
→ Le fondateur du serveur doit t'attribuer un grade depuis la page **Équipe**.

**Un membre du staff ne voit pas le serveur ou n'arrive sur rien**  
→ Vérifie que son rôle Discord est bien dans **Paramètres → Rôles d'accès** (support ou chef support), puis qu'il se reconnecte.

**Un support voit « Permission insuffisante » partout**  
→ Un support n'a aucun droit sans grade : vérifie le grade associé à son rôle dans **Paramètres**, ou attribue-lui un grade avec au moins `view_tickets` (page **Équipe**).

**Première connexion superadmin**  
→ Après l'identifiant et le mot de passe, le panel affiche un QR code TOTP à scanner (Authy, Google Authenticator…), puis demande un code pour confirmer.

**Compte superadmin verrouillé**  
→ Attends 15 minutes après 5 échecs. Un superadmin peut réinitialiser le mot de passe (et la 2FA) d'un manager depuis le panel.

**J'ai perdu mon téléphone (2FA dashboard)**  
→ Utilise un de tes codes de secours sur l'écran de vérification, puis désactive/réactive la 2FA depuis ton profil.

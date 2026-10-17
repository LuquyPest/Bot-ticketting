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
3 bis. Si la **FAQ automatique** est activée et que le message correspond à des entrées (mots-clés, mots de la question), le bot propose jusqu'à 3 réponses avec « ✅ La réponse N m'a aidé » (aucun ticket n'est ouvert) ou « 📩 Ouvrir un ticket quand même ». Un nouveau message à ce moment ouvre aussi le ticket
4. Le bot demande ensuite le **sujet du ticket** : boutons si des sujets sont configurés (+ « Autre sujet »), sinon réponse libre. Sans réponse sous 10 minutes, le ticket est ouvert sans sujet. Les conversations en cours (sujet, choix du serveur ou du ticket, formulaire) sont gardées dans Redis : un redémarrage du bot ne fait perdre aucune réponse
5. Si un **formulaire d'intake** est activé → questionnaire étape par étape avant création
6. Un salon privé est créé dans le serveur Discord, **nommé d'après le sujet**
7. Les messages et fichiers suivants sont relayés dans le ticket choisi
8. Le membre reçoit les réponses du staff en DM (embed indiquant le serveur et le ticket). Le message de bienvenue et les réponses portent un bouton **« Fermer mon ticket »** (propriétaire du ticket uniquement, avec confirmation) : le ticket est fermé avec transcript, et la fermeture n'est pas comptée dans les statistiques du staff
9. À la fermeture → le membre reçoit un **bouton de notation** (1–5 étoiles), puis peut **ajouter un commentaire** libre (1 000 caractères), visible dans la fiche du ticket

Le membre peut aussi ouvrir un ticket en cliquant sur un **panel** publié dans un salon (voir [Panels Discord](#panels-discord)). Un utilisateur blacklisté sur un serveur ne peut pas y ouvrir de ticket (la blacklist est propre à chaque serveur).

**Langue des messages** (Paramètres → Identité du bot) : français, anglais, ou automatique (langue Discord du membre, mémorisée à sa dernière interaction avec le bot, sinon langue du serveur). Elle s'applique à tout ce que le bot envoie aux membres : questions, bienvenue, réponses du staff (cadre et boutons), notifications, fermeture, notation, FAQ, panels. Les textes personnalisés (bienvenue, fermeture, FAQ, réponses du staff) restent tels qu'écrits ; le dashboard et les messages destinés au staff restent en français. Le message de fermeture personnalisé des paramètres est désormais bien utilisé dans le MP de fermeture.

### Côté staff

- Répond via `/reply` (identifié), `/areply` (anonyme comme "Support") ou depuis le **dashboard web** ; depuis le dashboard, un **fichier** (8 Mo max) peut être joint : il arrive en pièce jointe dans le MP du membre et dans le salon
- Les messages tapés directement dans le salon Discord sont enregistrés comme notes mais **ne sont pas envoyés** au membre
- Le ticket se ferme via le bouton Discord ou depuis le dashboard (transcript généré automatiquement)
- Tableau de bord en **temps réel** via SSE — les nouvelles notes apparaissent sans recharger la page

### Automatismes

Tous les automatismes sont des tâches planifiées **BullMQ** (Redis) : chacune s'exécute une seule fois même avec plusieurs instances du bot, et le planning survit aux redémarrages (`utils/jobQueue.js`).

| Mécanisme | Description |
|-----------|-------------|
| Inactivité ticket | Avertissement puis fermeture auto si le membre ne répond plus |
| Inactivité utilisateur | Avertissement puis fermeture auto si le staff ne répond pas |
| Rappel staff | DM au staff si un ticket réclamé n'a pas eu de réponse depuis N heures |
| Escalade | Alerte + fermeture auto des tickets urgents sans réponse prolongée |
| Messages programmés | Envoi différé à une date/heure précise |
| Rapport hebdomadaire | Embed Discord automatique chaque lundi à 9 h (stats + classement) |
| Questions sans réponse | Toutes les 15 s : ouvre sans sujet les tickets dont la question du sujet a expiré |
| Alerte d'erreurs | Toutes les 5 min : prévient le super-admin si les erreurs dépassent le seuil configuré |
| Rétention | Chaque nuit : purge des journaux anciens (connexions, erreurs, audit, sessions) et des transcripts au-delà de la durée fixée par le super-admin |

---

### État partagé (Redis)

Tout l'état « vivant » est dans Redis : sessions, conversations MP en cours, tâches planifiées (BullMQ), limiteurs (connexion, API, cooldown des commandes, anti-flood des MP), verrou de création de ticket et événements temps réel (pub/sub `sse:events`). Un redémarrage ne perd rien, et ces briques fonctionnent déjà avec plusieurs instances.

Limite actuelle : le processus héberge à la fois la connexion Discord (gateway) et le dashboard, qui appelle directement ce client. Lancer deux instances ouvrirait deux connexions Discord et chaque événement serait traité deux fois. Monter en charge demandera de séparer un processus « bot » (gateway, éventuellement shardé au-delà de ~2 500 serveurs) et des processus « web » qui lui délèguent les appels Discord.

---

## Prérequis

- **Docker** et **Docker Compose v2**
- Un **bot Discord** configuré (token + OAuth2)
- Un serveur avec domaine public et un reverse proxy HTTPS — le `docker-compose.yml` est prévu pour **Traefik** (réseau Docker externe `proxy`, labels déjà présents)
- **Redis 7** — inclus dans le `docker-compose.yml` (service `redis`), utilisé pour les sessions du dashboard, les conversations MP en cours et les tâches BullMQ

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
| `retention.*` | Optionnel. Durées de conservation en jours (0 = jamais purgé) : `loginLogsDays` (90), `saAuthLogsDays` (90), `errorLogsDays` (30), `auditLogDays` (365), `sessionsDays` (7). Purge chaque nuit à 4 h 30 ; les transcripts suivent la limite `transcript_retention_days` de chaque serveur |
| `database.host` | Doit être `db` (nom du service Docker Compose, pas `localhost`) |
| `database.password` | Doit correspondre à `DB_PASSWORD` dans `.env` |

### Configurer le bot Discord

1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. Onglet **Bot** → copier le Token
3. Activer : **Server Members Intent**, **Message Content Intent**
4. **OAuth2** → ajouter l'URL callback → copier le **Client Secret**
5. Le lien d'invitation est généré par le dashboard (sélection du serveur). Permissions demandées (`268684432`) :  
   `Manage Channels` · `Manage Roles` (masquer le salon d'un ticket restreint à certains grades) · `View Channel` · `Send Messages` · `Read Message History` · `Embed Links` · `Attach Files` · `View Audit Log` (identifier qui a invité le bot) · `Mention Everyone` (pinger les rôles support en « Urgent »). Le bot ne mentionne que les utilisateurs par défaut : `@everyone` ne peut jamais être déclenché.

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

Sur Discord, le salon d'un ticket restreint est masqué aux rôles support / chef support et ouvert individuellement aux membres du staff autorisés (fondateurs et grades concernés). Les droits du salon sont recalculés quand la restriction est levée et quand les grades, leurs permissions ou les comptes du staff changent. Le bot a besoin de la permission **Gérer les rôles** : sans elle, la restriction ne s'applique qu'au dashboard et un avertissement est affiché (pour un serveur invité avant cette version, réinviter le bot ou lui ajouter la permission).

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
| **Analytiques** / **Recherche** | support, fondateur | Volume, SLA, satisfaction ; onglet **Qualité** : temps de première réponse (médiane, part sous 1 h / 4 h / 24 h, sans réponse), respect des délais par étape (passages mesurés, durée médiane, hors délai, taux de respect), répartition des notes et commentaires des membres ; recherche plein texte (respecte la visibilité) |
| **Programmés** | `reply_ticket` | Messages planifiés dans un ticket |
| **Connexions** | support, fondateur | Historique de ses connexions (le fondateur voit celles des membres de son serveur) |
| **Grades** | fondateur, `manage_grades` | Hiérarchie de grades et permissions |
| **Journal** | fondateur, `view_audit` | Journal de toutes les actions (dashboard, Discord, API, automatismes, super-admin) avec filtres, export CSV et onglet Analytique |
| **Transcripts** | fondateur, `view_transcripts` | Consultation et téléchargement HTML/TXT |
| **Équipe** | fondateur | Membres du dashboard, rôles, grades, mode vacances |
| **Données membres** | fondateur | RGPD : ce que le serveur conserve sur un membre (par ID Discord), export JSON complet, suppression définitive de ses tickets (messages, transcripts, notes, tags), de ses messages et participations dans les tickets d'autres personnes et de sa blacklist ; salons des tickets ouverts supprimés, journal anonymisé. Les tickets des autres membres ne sont jamais touchés ; impossible sur un compte du staff. Accessible aussi depuis la fiche ticket |
| **FAQ** | fondateur, `manage_settings` | Entrées de la FAQ automatique (question, réponse, mots-clés), activation, test d'un message, statistiques (proposée / a résolu) |
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

La liste s'ouvre sur la vue **Ouverts**. Vues prédéfinies : Ouverts, Mes tickets, Non attribués, En attente, En cours, Urgents, Hors délai, Fermés, Tous. Chaque membre peut enregistrer ses propres vues (filtres statut, priorité, étape, attribué à, dates, tag, recherche, hors délai), en définir une comme vue par défaut, et les supprimer — elles sont personnelles.

### Fonctionnalités dans la vue ticket

- **Temps réel (SSE)** : nouvelles notes et réponses sans rechargement de page
- **Répondre au membre** : mode *Répondre* (DM envoyé) ou *Note interne* (staff seulement)
- **Réponse anonyme** : toggle "Anonyme/Identifié" masquant le pseudo du staff
- **Modèles de réponse** : réponses prédéfinies insérables en un clic, avec variables (`{{username}}`, `{{ticket_id}}`, `{{date}}`, `{{staff_name}}`, `{{subject}}`). Tout membre ayant `reply_ticket` peut enregistrer le texte en cours **pour lui seul** ou **pour tout le staff**, et le lier au sujet du ticket : il est alors **suggéré** au-dessus de la zone de réponse sur les tickets dont le sujet correspond (sans tenir compte des accents ni de la casse). Les modèles les plus utilisés remontent en tête. Seul l'auteur (ou un fondateur) peut modifier ou supprimer un modèle.
- **Mentions** : dans une note interne, `@pseudo` (suggestions à la frappe) prévient le collègue s'il peut voir le ticket : notification du dashboard, push, et MP Discord avec le lien vers le ticket (désactivable dans **Profil**)
- **Macros** : un modèle peut aussi porter des actions appliquées à l'envoi : m'attribuer le ticket, changer la priorité, ajouter un tag, changer d'étape, fermer le ticket. Le texte reste modifiable avant l'envoi ; chaque action exige sa permission (`claim_ticket` pour s'attribuer, `close_ticket` pour fermer) et une action refusée est signalée sans bloquer la réponse
- **Attribué à** : un ticket peut être attribué à plusieurs membres du staff ; « M'attribuer », attribuer quelqu'un d'autre, retirer (permission `claim_ticket`). La première personne assignée reste le responsable principal (stats, rappels, notation). Quand quelqu'un d'autre t'attribue un ticket, tu es prévenu : notification sur le dashboard (cloche + bandeau), push navigateur si activé, et MP Discord avec le lien vers le ticket (désactivable dans **Profil**)
- **Étapes** : Ouvert / En attente / En cours — chaque étape correspond à une catégorie Discord choisie dans **Paramètres → Rôles d'accès**, changer d'étape déplace le salon
- **SLA par étape** : un délai maximal (en heures, 0 = aucun) peut être fixé pour chaque étape dans les paramètres. Le temps compte depuis le dernier changement d'étape ; la liste et la fiche affichent le temps restant (orange à 75 %), puis « Hors délai » avec le dépassement, et la vue **Hors délai** regroupe les tickets en retard ; le temps restant figure aussi sur les cartes du Kanban
- **Fusion** : deux tickets ouverts du même membre peuvent être fusionnés (`close_ticket` + `reply_ticket`) : l'historique, les participants, les attributions, les tags et les messages programmés rejoignent le ticket cible, le ticket source est archivé (transcript), fermé et son salon supprimé, et le membre est prévenu en MP
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
| **Vue d'ensemble** | Serveurs actifs / en attente, tickets ouverts, tickets ouverts et fermés par jour sur 30 jours, staff, erreurs des dernières 24 h, et tableau par serveur (utilisation par rapport aux limites, note moyenne, conservation des transcripts). Un manager ne voit que ses serveurs |
| **Guilds** | Lister, approuver, suspendre, réactiver, supprimer des serveurs (la suppression efface la base du serveur et fait quitter le serveur Discord au bot) |
| **Limites** | Par serveur : tickets ouverts simultanés (`max_tickets`), membres du staff (`max_agents`), conservation des transcripts en jours (`transcript_retention_days`) — 0 = illimité |
| **Maintenance** | Activer/désactiver le mode maintenance d'un serveur |
| **Fondateurs** | Voir les fondateurs d'un serveur ; le superadmin peut en nommer par ID Discord (DM envoyé) ou en retirer (le dernier fondateur est protégé). Actions tracées dans l'audit du serveur |
| **Managers** | Créer des comptes managers avec accès restreint à certains serveurs |
| **Blocages** | Comptes super-admin / manager verrouillés après trop d'échecs et adresses IP limitées (connexion : 20 / 15 min, API : 200 / min par défaut, `rateLimits.apiPerMinute` dans `config.json`), avec déblocage manuel — superadmin uniquement |
| **Erreurs** | Journal centralisé des erreurs (bot, dashboard, automatismes) : filtres par période, serveur, source et texte, trace complète, erreurs par heure, sources fréquentes, suppression unitaire ou selon les filtres — superadmin uniquement. **Alerte** configurable : au-delà d'un seuil d'erreurs sur une fenêtre donnée, MP Discord aux IDs choisis et/ou webhook (embed pour un webhook Discord, JSON sinon), une alerte par heure au plus, bouton de test |

Le journal d'erreurs est alimenté par `logger.error`, `console.error`, les réponses HTTP 5xx (avec la route), les échecs des tâches planifiées et les rejets non gérés. Les erreurs Discord attendues (membre aux MP fermés, interaction expirée ou déjà traitée, message déjà supprimé) sont ignorées. Un même message n'est enregistré qu'une fois par minute (60 entrées / min au plus) ; la purge de rétention supprime les entrées de plus de 30 jours.

### Rôles dans le panel SA

| Rôle | Accès |
|------|-------|
| `superadmin` | Accès complet à toutes les guilds et tous les managers |
| `manager` | Accès restreint aux guilds qui lui sont assignées |

---

## Commandes Discord

Les commandes sont réservées au staff et utilisables uniquement sur un serveur actif. Elles appliquent les mêmes règles que le dashboard : le compte (synchronisé depuis les rôles Discord support / chef support, ou géré depuis **Équipe**) doit être `support` ou `fondateur`, et un `support` doit avoir la **permission de grade** indiquée. Dans le salon d'un ticket restreint à un grade, seuls les membres autorisés à le voir peuvent agir. Les fondateurs ont tous les droits, même sans rôle Discord. `/gettranscript` et `/oldtickets` masquent les tickets restreints que l'utilisateur ne peut pas voir.

| Commande | Permission | Description |
|----------|------------|-------------|
| `/reply` | `reply_ticket` | Répond au membre avec ton pseudo (texte et/ou fichier) |
| `/areply` | `reply_ticket` | Répond anonymement (affiché comme "Support") |
| `/claim` | `claim_ticket` | S'ajoute aux personnes assignées au ticket (plusieurs personnes possibles) |
| `/unclaim` | `claim_ticket` | Se retire des personnes assignées |
| `/priority` | `reply_ticket` | Définit la priorité : Faible / Normal / Urgent |
| `/adduser` | `manage_participants` | Ajoute un participant lié au ticket en DM |
| `/removeuser` | `manage_participants` | Retire un participant |
| `/rename` | `reply_ticket` | Change le titre du ticket — le salon Discord porte toujours le même nom que le titre |
| `/moveticket` | `reply_ticket` | Change l'étape du ticket : Ouvert / En attente / En cours (déplace le salon dans la catégorie associée) |
| `/reopen` | `close_ticket` | Réouvre le dernier ticket fermé d'un utilisateur (même s'il a d'autres tickets ouverts) |
| `/oldtickets` | `view_tickets` | Historique paginé des tickets d'un utilisateur |
| `/gettranscript` | `view_transcripts` | Génère un lien temporaire (10 min) vers un transcript HTML |
| `/note` | `reply_ticket` | Ajoute une note interne (non envoyée au membre, exclue des transcripts) |
| `/blacklist` | Rôle Chef Support | Gestion de la liste noire (add / remove / list) |
| `/staffstats` | Rôle Chef Support | Statistiques détaillées par agent |
| `/template` | `reply_ticket` | Envoie un modèle de réponse (autocomplétion : modèles du sujet du ticket en tête, partagés et personnels) ; variables résolues, actions appliquées si c'est une macro, option anonyme |
| `/merge` | `close_ticket` + `reply_ticket` | Fusionne le ticket du salon dans un autre ticket ouvert du même membre (autocomplétion) |
| `/mestickets` | Membre, en MP avec le bot | État de ses tickets ouverts sur tous les serveurs (« en attente de ta réponse », « en cours de traitement »…). Aussi accessible par le bouton **📋 Mes tickets** des MP |

Boutons du salon : **Transcript** demande `view_transcripts`, **Fermer** demande `close_ticket`.

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
| `ticket_ratings` | Notes de satisfaction (1–5 étoiles) et commentaire du membre |
| `admin_stats` | Statistiques cumulées par agent |
| `blacklist` | Utilisateurs bannis (avec expiration optionnelle) |
| `dashboard_users` | Comptes dashboard avec rôles et profil |
| `faq_entries` | FAQ automatique (question, réponse, mots-clés, compteurs) |
| `reply_templates` | Modèles de réponse (personnels ou partagés, sujet associé, compteur d'utilisation) |
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
│   ├── jobQueue.js                 # Tâches planifiées BullMQ (tous les automatismes)
│   ├── pendingStore.js             # États des conversations MP (Redis)
│   ├── errorLog.js                 # Journal d'erreurs centralisé (error_logs)
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
│       ├── superadmin.js           # Panel SA (guilds, managers, stats, limites, erreurs)
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
cd dashboard && npm run build && npm run test:smoke   # pages principales du dashboard dans Chromium headless (API simulée)
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

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
- [Espace membre web](#espace-membre-web)
- [Fonctionnalités avancées](#fonctionnalités-avancées)
- [Panels Discord](#panels-discord)
- [Push Notifications Web](#push-notifications-web)
- [Gestion des sessions](#gestion-des-sessions)
- [Webhooks sortants](#webhooks-sortants)
- [API Keys](#api-keys)
- [Base de données](#base-de-données)
- [Structure des fichiers](#structure-des-fichiers)
- [Sécurité](#sécurité)
- [Rotation de la clé de chiffrement](#rotation-de-la-clé-de-chiffrement)
- [Migrations des bases](#migrations-des-bases)
- [Tests](#tests)
- [Problèmes fréquents](#problèmes-fréquents)

---

## Architecture

```
                    ┌─────────────────────────────────┐
                    │         ticketbot_global         │
                    │  guilds · plans · superadmins    │
                    │  managers · user_totp · sessions │
                    │  journaux · annonces · erreurs   │
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
| API / serveur web | Express 5, express-session, Helmet, express-rate-limit, multer (fichiers), pdfkit (rapports) |
| Base de données | MariaDB 11 (mysql2, une base par serveur, migrations versionnées, index FULLTEXT) |
| Authentification | OAuth2 Discord, TOTP 2FA (otplib), bcrypt ; secrets 2FA et transcripts chiffrés AES-256-GCM avec rotation de clé |
| Temps réel | Server-Sent Events (SSE) relayés entre instances par Redis pub/sub |
| Notifications push | Web Push API (VAPID, web-push) |
| Sessions, état & jobs | Redis 7 (sessions via connect-redis, états des conversations MP, présence, BullMQ pour les tâches planifiées) |
| Dashboard frontend | React 19, React Router 7, Vite 8, Tailwind CSS 4, Recharts 3, lucide-react |
| Tests | Suite d'intégration (vrai serveur + faux client Discord), test de fumée Playwright + axe-core, test de charge |
| Déploiement | Docker (multi-stage), Docker Compose, Traefik ; CI GitHub Actions, Dependabot |

---

## Fonctionnement — cycle de vie d'un ticket

### Côté membre

1. Le membre envoie un **message privé** au bot
2. S'il a déjà des tickets ouverts → le bot lui demande, **à chaque message**, dans quel ticket l'envoyer, ou s'il veut **ouvrir un nouveau ticket** (un membre peut avoir plusieurs tickets, dans la limite quotidienne)
3. Nouveau ticket : si le membre est dans plusieurs serveurs utilisant le bot → choix du serveur
3 bis. Si la **FAQ automatique** est activée et que le message correspond à des entrées (mots-clés, mots de la question), le bot propose jusqu'à 3 réponses avec « ✅ La réponse N m'a aidé » (aucun ticket n'est ouvert) ou « 📩 Ouvrir un ticket quand même ». Un nouveau message à ce moment ouvre aussi le ticket
4. Le bot demande ensuite le **sujet du ticket** : boutons si des sujets sont configurés (+ « Autre sujet »), sinon réponse libre. Sans réponse sous 10 minutes, le ticket est ouvert sans sujet. Les conversations en cours (sujet, choix du serveur ou du ticket, formulaire) sont gardées dans Redis : un redémarrage du bot ne fait perdre aucune réponse
**Demande confidentielle** : au moment du choix du sujet (MP) ou dans le formulaire de l'espace membre, le membre peut demander un ticket confidentiel (signalement d'un membre du staff, harcèlement…). Le ticket n'est alors visible que des **fondateurs** : liste, fiche, recherche, temps réel, notifications, commandes Discord, et salon Discord fermé au staff avant que le moindre message n'y soit posté. Le membre en est informé dans le message de bienvenue ; seul un fondateur peut lever ou poser la confidentialité (bloc « Visibilité » de la fiche), et aucune règle automatique ne la modifie. Techniquement, le ticket porte une valeur de visibilité réservée (`-1`) qu'aucun grade ne peut avoir.

À la création, les **règles automatiques par sujet** (Paramètres → Sujets de ticket) s'appliquent : ajouter un tag, fixer une priorité, réserver le ticket à un grade (salon Discord compris). Une règle se déclenche soit par **sujet** (comparé sans accents ni majuscules : « paiement » couvre « Problème de paiement »), soit par **mots-clés** du premier message du membre (liste séparée par des virgules, comparée depuis le début des mots : « rembours » couvre « remboursé », « carte refusée » couvre « Carte Refusee »).

4 bis. Si des **champs personnalisés** sont définis (page **Champs** : n° de commande, pseudo en jeu… ; texte ou nombre, obligatoire ou non, pour tous les sujets ou un sujet précis), le bot les demande un par un ; les valeurs sont enregistrées, rappelées dans le salon, modifiables dans la fiche et utilisables comme filtre dans la liste des tickets
5. Si un **formulaire d'intake** est activé → questionnaire étape par étape avant création
6. Un salon privé est créé dans le serveur Discord, **nommé d'après le sujet**
7. Les messages et fichiers suivants sont relayés dans le ticket choisi
8. Le membre reçoit les réponses du staff en DM (embed indiquant le serveur et le ticket). Le message de bienvenue et les réponses portent un bouton **« Fermer mon ticket »** (propriétaire du ticket uniquement, avec confirmation) : le ticket est fermé avec transcript, et la fermeture n'est pas comptée dans les statistiques du staff
9. À la fermeture → le membre reçoit un **bouton de notation** (1–5 étoiles), puis peut **ajouter un commentaire** libre (1 000 caractères), visible dans la fiche du ticket. Une note basse (2 étoiles ou moins par défaut, réglable, 0 = désactivé) prévient les fondateurs et les chefs support (notification, push, MP avec le lien) ; depuis la fiche, « Recontacter le membre » lui envoie un MP (avec le bouton de réouverture s'il est encore possible) et marque le suivi comme fait. Le MP de fermeture porte aussi un bouton **« Rouvrir mon ticket »** valable quelques jours (7 par défaut, réglable dans les paramètres, 0 = désactivé) : le ticket est rouvert avec son historique, dans la limite de tickets ouverts du serveur

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
| Rapport mensuel | Le 1er du mois à 9 h : PDF du mois écoulé (volume, délais, respect des délais par étape, satisfaction, classement du staff, sujets fréquents) dans le salon choisi |
| Rapport hebdomadaire | Embed Discord automatique chaque lundi à 9 h (stats + classement) |
| Rappels personnels | Toutes les minutes : envoie les rappels échus |
| Surveillance Discord | Toutes les minutes : alerte le super-admin si le bot est déconnecté de Discord depuis trop longtemps, puis à la reconnexion |
| Questions sans réponse | Toutes les 15 s : ouvre sans sujet les tickets dont la question du sujet a expiré |
| Limites des serveurs | Toutes les heures : prévient les fondateurs d'un serveur proche d'une limite (80 %) ou qui l'a atteinte |
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
| `dashboard.encryptionKey` | Clé AES-256 (64 caractères hex, `openssl rand -hex 32`) qui chiffre les secrets 2FA et les transcripts en base. Optionnelle : à défaut, dérivée de `sessionSecret`. Pour la changer, suivre la procédure de rotation ci-dessous |
| `dashboard.previousEncryptionKeys` | Anciennes clés encore acceptées en lecture pendant une rotation (liste, optionnelle) |
| `dashboard.discordClientSecret` | Secret OAuth2 depuis le portail développeur Discord |
| `dashboard.discordCallbackUrl` | Doit correspondre exactement à l'URL configurée dans le portail Discord |
| `retention.*` | Optionnel. Durées de conservation en jours (0 = jamais purgé) : `loginLogsDays` (90), `saAuthLogsDays` (90), `errorLogsDays` (30), `auditLogDays` (365), `sessionsDays` (7). Purge chaque nuit à 4 h 30 ; les transcripts suivent la limite `transcript_retention_days` de chaque serveur |
| `database.host` | Doit être `db` (nom du service Docker Compose, pas `localhost`) |
| `database.password` | Doit correspondre à `DB_PASSWORD` dans `.env` |
| `database.tenantConnectionLimit` | Connexions MariaDB max par serveur Discord (5 par défaut ; voir le test de charge) |

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

**Sauvegarde et transfert** (Paramètres) : export JSON de la configuration (paramètres, grades et permissions, tags, formulaires, panels, champs personnalisés, FAQ, modèles partagés, règles par sujet et par mots-clés, procédures) et import sur le même serveur ou un autre. L'import fusionne par nom sans rien supprimer ; les secrets ne sont jamais exportés, l'obligation de 2FA n'est pas transférée, et les salons et rôles Discord ne sont repris que si la case est cochée. Les panels importés doivent être republiés.

**Incidents** (`manage_settings`) : pour un problème connu (panne d'un prestataire…), un incident a un titre, un message et éventuellement des sujets. Tant qu'il est ouvert, chaque nouveau ticket concerné (tous si aucun sujet) reçoit ce message en MP juste après le message de bienvenue, une ligne est ajoutée à l'historique du ticket, et le compteur de membres touchés augmente ; un bandeau le rappelle au staff en haut de la liste des tickets. À la résolution, les membres touchés peuvent recevoir un message (option par incident). 10 incidents ouverts au plus.

**Historique des modifications** (Paramètres, `manage_settings`) : chaque enregistrement des paramètres, import ou restauration garde qui l'a fait, quand, et l'ancienne et la nouvelle valeur de chaque réglage modifié (noms des salons, rôles et grades affichés). « Revenir à l'état d'avant » remet les paramètres tels qu'ils étaient juste avant ce changement, en annulant aussi les suivants ; la restauration est elle-même tracée (donc annulable) et repasse par les mêmes vérifications qu'un enregistrement. Le secret du webhook n'est jamais stocké en clair : il apparaît comme « modifié » et n'est pas restauré. Les 500 dernières modifications sont conservées.

**2FA obligatoire par serveur** (Paramètres → Sécurité) : non imposée, imposée aux fondateurs, ou à tout le staff. Un compte concerné sans 2FA est redirigé vers son profil pour l'activer et n'accède à rien d'autre ; il ne peut pas la désactiver tant que l'obligation est en place. Un fondateur doit avoir activé sa propre 2FA avant de l'imposer.

Comptes superadmin/manager : verrouillage de 15 min après 5 échecs (mot de passe ou TOTP), déconnexion automatique après 30 min d'inactivité, mot de passe manager de 12 caractères minimum.

### Pages disponibles

| Page | Accès | Description |
|------|-------|-------------|
| **Dashboard** | support, fondateur | Stats globales, activité, tickets récents, classement, objectif mensuel (option) |
| **Mon activité** | support, fondateur | Ses propres chiffres sur 7, 30 ou 90 jours : réponses envoyées, tickets fermés, temps de première réponse médian, note moyenne reçue et répartition, tickets ouverts attribués, chacun comparé à l'équipe ; évolution des réponses et de la note sur 12 semaines ; derniers commentaires des membres |
| **Ma file** | `view_tickets` | Mes tickets du plus urgent au moins urgent (hors délai, proche de l'échéance, membre qui attend une réponse, priorité), avec la raison affichée ; onglet « Non attribués » avec bouton « Prendre » ; mise à jour en temps réel |
| **Tickets** / **Kanban** | `view_tickets` | Liste filtrable (vue « Ouverts » par défaut, vues personnelles enregistrables) ou colonnes par étape, détail en temps réel |
| **Mes stats** | support | Compteurs cumulés (prises en charge, fermetures, temps de réponse) |
| **Analytiques** / **Recherche** | support, fondateur | Volume, SLA, satisfaction ; bouton **Rapport mensuel** (PDF d'un mois au choix, fondateurs et `view_audit`) ; onglet **Qualité** : temps de première réponse (médiane, part sous 1 h / 4 h / 24 h, sans réponse), respect des délais par étape (passages mesurés, durée médiane, hors délai, taux de respect), répartition des notes et commentaires des membres ; **Recherche** : plein texte dans tous les messages (membre, réponses du staff, notes internes), les sujets et les pseudos — mots de 3 lettres ou plus cherchés par préfixe via un index FULLTEXT, filtre par auteur et par statut, extrait surligné, clic = fiche ouverte sur le message trouvé ; respecte la visibilité |
| **Programmés** | `reply_ticket` | Messages planifiés dans un ticket |
| **Connexions** | support, fondateur | Historique de ses connexions (le fondateur voit celles des membres de son serveur) |
| **Grades** | fondateur, `manage_grades` | Hiérarchie de grades et permissions |
| **Journal** | fondateur, `view_audit` | Journal de toutes les actions (dashboard, Discord, API, automatismes, super-admin) avec filtres, export CSV et onglet Analytique |
| **Transcripts** | fondateur, `view_transcripts` | Consultation et téléchargement HTML/TXT |
| **Équipe** | fondateur | Membres du dashboard, rôles, grades, mode vacances |
| **Données membres** | fondateur | RGPD : ce que le serveur conserve sur un membre (par ID Discord), export JSON complet, suppression définitive de ses tickets (messages, transcripts, notes, tags), de ses messages et participations dans les tickets d'autres personnes et de sa blacklist ; salons des tickets ouverts supprimés, journal anonymisé. Les tickets des autres membres ne sont jamais touchés ; impossible sur un compte du staff. Accessible aussi depuis la fiche ticket |
| **Champs** | fondateur, `manage_settings` | Champs personnalisés demandés au membre (texte ou nombre, obligatoires ou non, par sujet) |
| **Procédures** | fondateur, `manage_settings` | Listes d'étapes à cocher par sujet (ou pour tous les tickets) : affichées dans la fiche avec leur avancement, qui a coché et quand, synchronisées en direct ; fermer un ticket avec des étapes restantes demande une confirmation. Les cases cochées survivent aux modifications de la procédure |
| **Incidents** | fondateur, `manage_settings` | Problèmes connus annoncés aux nouveaux tickets, compteur de membres touchés, message de résolution |
| **FAQ** | fondateur, `manage_settings` | Entrées de la FAQ automatique (question, réponse, mots-clés), activation, test d'un message, statistiques (proposée / a résolu) |
| **Tags** | fondateur | Tags pour organiser les tickets |
| **Blacklist** | fondateur | Utilisateurs bloqués — propre à chaque serveur |
| **Panels** / **Formulaires** | fondateur | Panels de boutons Discord et formulaires associés |
| **Paramètres** | fondateur | Configuration du serveur (salons, rôles, messages, automatismes, webhooks, allowlist IP…) |
| **Clés API** / **Documentation API** | fondateur | Clés pour l'API publique v1 ; documentation générée depuis le code (`/docs-api`) |
| **Newsletter** | fondateur | DM groupé au staff |
| **Patchnotes** | fondateur | Historique des versions (`dashboard/src/data/patchnotes.js`). Les fondateurs voient en haut du dashboard un encart **Nouveautés** avec les ajouts depuis leur dernière visite (dernière version vue enregistrée par compte), et un badge « Nouveau » sur l'entrée Patchnotes ; « J'ai vu » ou l'ouverture du Patchnotes les marque comme lus |
| **Profil** | tous | Bio, photo (CDN Discord), 2FA, codes de secours, sessions actives, notifications push |

### Journal d'activité

Chaque action est enregistrée dans `audit_log` avec son **acteur**, sa **source** (Dashboard, Discord, Automatique, API, Super-admin), le **ticket** concerné et des détails lisibles : ouverture, fermeture (y compris automatique, avec la raison), réouverture, réponses et notes, attributions, étapes, priorité, titre, renommage, participants, tags, notation, escalade, messages programmés, blacklist, connexions au dashboard, accès accordés / retirés par rôle Discord, grades, fondateurs, paramètres, panels, formulaires, tags, modèles, clés API, newsletter.

La page **Journal** filtre par catégorie, action, source, acteur, ticket, période et texte, exporte en CSV, et son onglet **Analytique** montre l'activité par jour et par catégorie, les actions les plus fréquentes, les membres les plus actifs, l'origine des actions et l'activité par heure (7, 30 ou 90 jours, avec les mêmes filtres).

### Messages privés

Chaque message privé lié à un ticket (réponse du staff, message programmé, accueil, ajout comme participant, avertissement d'inactivité, fermeture, réouverture) est un embed dont l'en-tête indique **le serveur, le numéro et le titre du ticket** — indispensable quand un membre a des tickets ouverts sur plusieurs serveurs.

### Vues de la liste des tickets

La liste s'ouvre sur la vue **Ouverts**. Vues prédéfinies : Ouverts, Mes tickets, Non attribués, En attente, En cours, Urgents, Hors délai, Fermés, Tous. Chaque membre peut enregistrer ses propres vues (filtres statut, priorité, étape, attribué à, dates, tag, recherche, hors délai), en définir une comme vue par défaut, et les supprimer — elles sont personnelles. La barre de recherche bascule entre **Sujets** (filtre de la liste) et **Messages** (recherche plein texte, mêmes résultats que la page Recherche).

### Fonctionnalités dans la vue ticket

- **Temps réel (SSE)** : nouvelles notes et réponses sans rechargement de page
- **Répondre au membre** : mode *Répondre* (DM envoyé) ou *Note interne* (staff seulement)
- **Réponse anonyme** : toggle "Anonyme/Identifié" masquant le pseudo du staff
- **Modèles de réponse** : réponses prédéfinies insérables en un clic, avec variables (`{{username}}`, `{{ticket_id}}`, `{{date}}`, `{{staff_name}}`, `{{subject}}`) et celles des **champs personnalisés** : chaque champ a une variable dérivée de son libellé (« N° de commande » → `{{commande}}`), modifiable dans la page Champs ; elle est remplacée par la valeur saisie par le membre, dans le dashboard comme avec `/template`. Tout membre ayant `reply_ticket` peut enregistrer le texte en cours **pour lui seul** ou **pour tout le staff**, et le lier au sujet du ticket : il est alors **suggéré** au-dessus de la zone de réponse sur les tickets dont le sujet correspond (sans tenir compte des accents ni de la casse). Les modèles les plus utilisés remontent en tête. Seul l'auteur (ou un fondateur) peut modifier ou supprimer un modèle.
- **Disponibilité** : chaque membre du staff choisit son statut (disponible, occupé, absent) sous son nom dans le menu ; il est affiché dans la liste « Attribuer à… » avec le mode vacances, et attribuer un ticket à une personne absente ou en vacances demande confirmation
- **Tickets liés** : relier un ticket à un autre (même problème, autre membre) sans les fusionner ; le lien apparaît des deux côtés, cliquable, en respectant la visibilité par grade
- **Rappels personnels** : « Me le rappeler » dans la fiche (dans 1 h, 4 h, demain, 2 jours, 1 semaine, avec une note) ; à l'échéance, notification, push et MP avec le lien. Chacun ne voit que ses rappels
- **Brouillons** : une réponse ou une note commencée reste dans la fiche si on change de page ou ferme l'onglet (stockée dans le navigateur, par compte, serveur et ticket, effacée à l'envoi ou après 30 jours) ; « Brouillon restauré » s'affiche au retour et un crayon marque le ticket dans la liste
- **Rédaction en cours** : quand un collègue écrit une réponse ou une note sur le même ticket, un bandeau « X est en train d'écrire » s'affiche au-dessus de la zone de réponse (signal temps réel, limité à ceux qui voient le ticket)
- **Tickets similaires** : sur un ticket ouvert, la fiche propose jusqu'à 3 tickets fermés qui parlent du même problème (mots distinctifs du sujet et des premiers messages du membre, pertinence plein texte, bonus au même sujet et aux tickets bien notés), avec la dernière réponse du staff et **Reprendre cette réponse** qui la place dans la zone de saisie. Les tickets fusionnés et ceux qu'on ne peut pas voir sont exclus
- **MP modifiés ou supprimés** : si le membre modifie un MP déjà transmis, le message du ticket prend le nouveau texte, marqué « Modifié » avec les versions précédentes dépliables (10 au plus) ; s'il le supprime, le message reste visible pour le staff, marqué « Supprimé par le membre ». Le salon Discord du ticket est prévenu dans les deux cas ; dans l'espace membre, un message supprimé apparaît comme tel. Le lien entre un MP et le message du ticket est gardé 30 jours (Redis)
- **Aperçu des pièces jointes** : les images et vidéos envoyées par le membre ou le staff s'affichent dans la conversation (fiche ticket et espace membre), les autres fichiers en lien. Les liens Discord expirent après environ 24 h : l'affichage passe par `/api/attachment`, qui demande à Discord un lien re-signé quand il le faut (mis en cache dans Redis) ; seuls les liens de pièces jointes Discord sont acceptés, et seulement pour un utilisateur connecté
- **Temps passé** : chronomètre par ticket dans la fiche (un seul en cours par personne : en démarrer un autre arrête le précédent ; visible dans la barre latérale avec un bouton d'arrêt), temps ajouté à la main avec une note, détail par membre ; un chrono oublié compte 8 h au plus et ceux d'un ticket s'arrêtent à sa fermeture (le temps suit le ticket en cas de fusion). Onglet **Temps passé** d'Analytique (par membre, par sujet, tickets les plus longs ; le détail des autres demande fondateur ou `view_audit`) et total dans « Mon activité »
- **Notes épinglées** : une note interne peut être épinglée (5 au plus par ticket) ; elle reste visible en haut de la conversation, avec qui l'a épinglée, et un clic y ramène. Épingler demande `reply_ticket` et est tracé dans le journal
- **Qui regarde ce ticket** : les collègues qui ont la fiche ouverte apparaissent dans son en-tête (avatars, noms au survol), et un œil le signale dans la liste des tickets. Battement toutes les 20 s, départ signalé à la fermeture de la page, entrée oubliée après 45 s ; état dans Redis, donc partagé entre instances, et filtré par visibilité
- **Anti double réponse** : à l'envoi, si un collègue a répondu au membre depuis que tu as commencé ta réponse, ou écrit une réponse au même moment, une confirmation est demandée
- **Mentions** : dans une note interne, `@pseudo` (suggestions à la frappe) prévient le collègue s'il peut voir le ticket : notification du dashboard, push, et MP Discord avec le lien vers le ticket (désactivable dans **Profil**)
- **Macros** : un modèle peut aussi porter des actions appliquées à l'envoi : m'attribuer le ticket, changer la priorité, ajouter un tag, changer d'étape, fermer le ticket. Le texte reste modifiable avant l'envoi ; chaque action exige sa permission (`claim_ticket` pour s'attribuer, `close_ticket` pour fermer) et une action refusée est signalée sans bloquer la réponse
- **Attribué à** : un ticket peut être attribué à plusieurs membres du staff ; « M'attribuer », attribuer quelqu'un d'autre, retirer (permission `claim_ticket`). La première personne assignée reste le responsable principal (stats, rappels, notation). Quand quelqu'un d'autre t'attribue un ticket, tu es prévenu : notification sur le dashboard (cloche + bandeau), push navigateur si activé, et MP Discord avec le lien vers le ticket (désactivable dans **Profil**)
- **Étapes** : Ouvert / En attente / En cours — chaque étape correspond à une catégorie Discord choisie dans **Paramètres → Rôles d'accès**, changer d'étape déplace le salon
- **Prévenir le membre des changements d'étape** (option, Paramètres → Fonctionnalités) : MP « Ton ticket est en cours de traitement », « en attente » ou « de nouveau en file d'attente », dans sa langue
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
| **Formules** | Jeux de limites nommés (tickets, staff, conservation des transcripts) à attribuer aux serveurs depuis la fenêtre « Limites » : l'attribution copie les limites, modifier une formule met à jour tous ses serveurs, modifier les valeurs à la main repasse le serveur en « personnalisé ». Les fondateurs d'un serveur reçoivent un MP à 80 % puis à 100 % d'une limite (une fois par jour au plus, événement dans le journal du serveur) — superadmin uniquement |
| **Limites** | Par serveur : tickets ouverts simultanés (`max_tickets`), membres du staff (`max_agents`), conservation des transcripts en jours (`transcript_retention_days`) — 0 = illimité |
| **Maintenance** | Activer/désactiver le mode maintenance d'un serveur |
| **Fondateurs** | Voir les fondateurs d'un serveur ; le superadmin peut en nommer par ID Discord (DM envoyé) ou en retirer (le dernier fondateur est protégé). Actions tracées dans l'audit du serveur |
| **Managers** | Créer des comptes managers avec accès restreint à certains serveurs |
| **Blocages** | Comptes super-admin / manager verrouillés après trop d'échecs et adresses IP limitées (connexion : 20 / 15 min, API : 200 / min par défaut, `rateLimits.apiPerMinute` dans `config.json`), avec déblocage manuel — superadmin uniquement |
| **Journal** | Toutes les modifications faites depuis le panel (serveurs, limites, fondateurs, managers, blocages, erreurs, alertes, formules) : compte, action, serveur concerné, paramètres (secrets masqués, URL de webhook réduite à leur origine), IP ; filtres par compte, action et serveur — superadmin uniquement, conservé 2 ans |
| **Annonces** | Message aux fondateurs de tous les serveurs : bandeau sur leur dashboard (jusqu'à une date choisie, masquable) et/ou MP Discord envoyé une fois par personne ; information ou avertissement — superadmin uniquement |
| **Santé** | État de Discord (connexion, latence), de la base et de Redis (temps de réponse), des tâches planifiées (dernière exécution, durée, résultat, prochaine exécution, retards signalés), du processus (mémoire, durée de fonctionnement) et version de schéma de chaque base — superadmin uniquement, actualisé toutes les 15 s |
| **Erreurs** | Journal centralisé des erreurs (bot, dashboard, automatismes, et plantages JavaScript des navigateurs — source `navigateur`, ou `navigateur-anonyme` hors session et exclue des alertes, avec la page, le type, le composant React, le compte et le navigateur ; bruit des extensions et erreurs réseau exclus, 10 rapports par page et 20 par IP toutes les 10 min au plus) : filtres par période, serveur, source et texte, trace complète, erreurs par heure, sources fréquentes, suppression unitaire ou selon les filtres — superadmin uniquement. **Alerte** configurable : au-delà d'un seuil d'erreurs sur une fenêtre donnée, MP Discord aux IDs choisis et/ou webhook (embed pour un webhook Discord, JSON sinon), une alerte par heure au plus, bouton de test. **Déconnexion Discord** : vérifiée chaque minute ; si le bot reste déconnecté plus de N minutes (5 par défaut, 0 = jamais), les mêmes destinataires sont prévenus une fois, puis à la reconnexion avec la durée de la coupure (le webhook est le canal fiable pendant une panne de Discord) |

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
| `/note` | `reply_ticket` | Ajoute une note interne (non envoyée au membre, exclue des transcripts), visible dans la fiche du dashboard comme une note écrite depuis le site |
| `/blacklist` | Rôle Chef Support ou fondateur | Gestion de la liste noire (add / remove / list) |
| `/staffstats` | Rôle Chef Support ou fondateur | Statistiques détaillées par agent |
| `/template` | `reply_ticket` | Envoie un modèle de réponse (autocomplétion : modèles du sujet du ticket en tête, partagés et personnels) ; variables résolues, actions appliquées si c'est une macro, option anonyme |
| `/merge` | `close_ticket` + `reply_ticket` | Fusionne le ticket du salon dans un autre ticket ouvert du même membre (autocomplétion) |
| `/mestickets` | Membre, en MP avec le bot | État de ses tickets ouverts sur tous les serveurs (« en attente de ta réponse », « en cours de traitement »…). Aussi accessible par le bouton **📋 Mes tickets** des MP |

Boutons du salon : **Transcript** demande `view_transcripts`, **Fermer** demande `close_ticket`.

### Espace membre web

Les membres se connectent sur **`/espace`** (ex. `https://ticket.sunset-fa.fr/espace`) avec Discord et retrouvent tous leurs tickets, ouverts et fermés, sur chaque serveur ; ils peuvent aussi y répondre, ouvrir un ticket et consulter l'aide : statut formulé pour eux (« en attente de ta réponse », « pris en charge »…), conversation avec le staff, note donnée, et téléchargement de l'échange en HTML. Ils voient aussi les tickets où ils ont été ajoutés comme participants.

- **Ce qui est montré** : uniquement ce que le membre a reçu ou envoyé en MP (ses messages, les réponses du staff, les messages programmés, les événements). Jamais les notes internes, les messages tapés par le staff dans le salon Discord du ticket, ni le nom derrière une réponse anonyme (affichée « Support »). Le transcript du salon Discord n'est pas proposé, puisqu'il contient les échanges internes.
- **Connexion** : Discord avec le seul scope `identify`, via la même URL de retour que le dashboard (rien à ajouter dans le portail développeur). La session membre ne donne aucun accès au dashboard ; un membre du staff déjà connecté au dashboard est reconnu directement.
- **Aux couleurs du serveur** : logo (image importée, réduite à 256 px et stockée dans la configuration, sinon l'icône Discord du serveur), couleur d'accent (boutons et bandeau ; le texte passe en blanc ou en noir selon le contraste, et les Paramètres signalent une couleur peu lisible) et message d'accueil affiché en haut des pages de ce serveur.
- **Option par serveur** : « Espace membre web » dans Paramètres → Fonctionnalités, **activée par défaut**. Désactivée, les tickets du serveur disparaissent de l'espace.
- **Répondre depuis le web** : sur un ticket ouvert, une zone de réponse envoie le message au staff exactement comme un MP (même salon, même historique, mêmes limites anti-flood et blacklist). La conversation se met à jour toute seule toutes les 15 s.
- **Ouvrir un ticket** : onglet « Ouvrir un ticket » : serveur (ceux dont le membre fait partie), sujet, champs personnalisés et questions du formulaire d'ouverture de ce sujet, puis la demande. Le ticket suit le même parcours qu'en MP (message de bienvenue en MP, règles par sujet, incidents…) avec les mêmes limites (par jour, par serveur, blacklist). Pendant la saisie, les entrées de FAQ qui ressemblent à la demande sont proposées.
- **Aide** : la FAQ de chaque serveur, consultable et cherchable (sans accent ni casse), avec un lien pour ouvrir un ticket si la réponse n'y est pas.
- **Lien** : bouton « Voir sur le web » sous chaque MP lié à un ticket (propriétaire et participants), qui ouvre directement la page du ticket ; aussi dans le MP de fermeture, dans `/mestickets` et sur la page de connexion du dashboard.

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

Quand l'option est activée dans les paramètres, chaque agent voit sur le dashboard sa progression vers 50 tickets traités dans le mois (tickets où il a répondu ou laissé une note).

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

**Documentation** : la description OpenAPI 3 est publique sur `GET /api/v1/openapi.json`, et la page **Documentation API** du dashboard (lien depuis « Clés API », `/docs-api`) l'affiche avec, pour chaque route, ses paramètres, la permission requise, un exemple `curl` et un exemple de réponse. Les deux sont générés depuis la déclaration des routes dans `web/routes/apiV1.js` (helper `endpoint()`), et un test vérifie que chaque route y est décrite.

---

## Base de données

### Base globale — `ticketbot_global`

| Table | Description |
|-------|-------------|
| `guilds` | Registre des serveurs (pending / active / suspended), maintenance, limites, formule |
| `plans` | Formules (limites de tickets, d'agents, rétention) appliquées aux serveurs |
| `superadmins` / `managers` | Comptes du panel SA (mot de passe bcrypt, TOTP chiffré, verrouillage) |
| `sa_auth_logs` | Tentatives de connexion au panel SA |
| `sa_audit_log` | Journal des actions du panel SA |
| `sa_settings` | Réglages du panel SA (alerte d'erreurs, déconnexion Discord…) |
| `announcements` | Annonces du super-admin aux fondateurs |
| `error_logs` | Erreurs centralisées (bot, dashboard, tâches, navigateurs) |
| `user_sessions` | Sessions actives par utilisateur (IP, user-agent) |
| `user_totp` | Secrets TOTP chiffrés, dernier pas utilisé, codes de secours hachés |
| `login_logs` | Historique des connexions au dashboard |
| `push_subscriptions` | Abonnements push navigateur |

### Par serveur — `ticketbot_guild_{guildId}`

| Table | Description |
|-------|-------------|
| `schema_migrations` | Versions de schéma appliquées (voir [Migrations des bases](#migrations-des-bases)) |
| `guild_config` | Configuration complète du serveur |
| `config_history` | Historique des paramètres (avant/après, auteur, restauration) |
| `tickets` | Tickets (sujet, priorité, étape, visibilité, fusion, suivi, timestamps) |
| `ticket_assignees` / `ticket_participants` | Staff assigné / membres ajoutés à un ticket |
| `ticket_notes` | Tous les messages : MP du membre, réponses, notes internes (épinglables), salon Discord, événements ; versions modifiées par le membre ; index FULLTEXT |
| `transcript_snapshots` | Transcripts HTML + TXT, chiffrés |
| `ticket_ratings` | Notes de satisfaction (1–5) et commentaires |
| `ticket_tags` / `ticket_tag_assignments` | Tags et leur affectation |
| `ticket_links` | Tickets liés entre eux |
| `ticket_reminders` | Rappels personnels |
| `ticket_views` | Vues enregistrées de la liste des tickets |
| `ticket_fields` / `ticket_field_values` | Champs personnalisés et valeurs |
| `subject_rules` | Règles automatiques par sujet ou par mots-clés du message |
| `ticket_time` | Temps passé (chronos et ajouts manuels) |
| `procedures` / `ticket_procedure_checks` | Procédures par sujet et étapes cochées sur chaque ticket |
| `incidents` / `incident_tickets` | Incidents et tickets auxquels ils ont été annoncés |
| `faq_entries` | FAQ (question, réponse, mots-clés, compteurs) |
| `reply_templates` | Modèles de réponse et macros |
| `intake_forms` / `intake_form_fields` | Formulaires d'ouverture |
| `scheduled_messages` | Messages programmés |
| `ticket_panels` / `panel_buttons` | Panels de boutons Discord |
| `grades` / `grade_permissions` / `user_grades` | Grades, permissions et attributions |
| `dashboard_users` | Comptes dashboard (rôle, profil, disponibilité, vacances) |
| `admin_stats` | Statistiques cumulées par agent |
| `blacklist` | Membres bloqués (expiration optionnelle) |
| `api_keys` | Clés API (hash + permissions) |
| `audit_log` | Journal de toutes les actions |

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
│   ├── template.js                 # Modèle de réponse ou macro (autocomplétion par sujet)
│   ├── claim.js / unclaim.js       # Prise en charge
│   ├── note.js                     # Note interne (visible dans la fiche)
│   ├── priority.js                 # Changement de priorité
│   ├── adduser.js / removeuser.js  # Gestion des participants
│   ├── merge.js                    # Fusion avec un autre ticket du membre
│   ├── blacklist.js                # Liste noire
│   ├── moveticket.js / rename.js   # Étape / titre
│   ├── reopen.js                   # Réouverture
│   ├── oldtickets.js               # Historique paginé d'un membre
│   ├── gettranscript.js            # Lien transcript temporaire
│   ├── mestickets.js               # État de ses tickets (membre, en MP)
│   └── staffstats.js               # Stats par agent
│
├── events/                         # Handlers Discord
│   ├── interactionCreate.js        # Boutons, menus, slash commands, notes, réouverture
│   ├── messageCreate.js            # MP → ticket (sujet, champs, formulaire, FAQ) + salon → historique
│   ├── messageEdits.js             # MP modifiés ou supprimés par le membre
│   ├── guildCreate.js / guildDelete.js  # Arrivée / départ d'un serveur
│   └── ready.js                    # Synchro des serveurs + migrations au démarrage
│
├── scripts/
│   └── rotate-encryption-key.js    # Rechiffrement des secrets 2FA et des transcripts
│
├── utils/
│   │  — Bases et configuration
│   ├── config.js                   # Chargement de config.json
│   ├── globalDb.js / tenantDb.js   # Pool global / pool par serveur
│   ├── tenantSchema.js             # Schéma de base des tables par serveur
│   ├── tenantMigrations.js         # Migrations versionnées (schema_migrations)
│   ├── redis.js / pendingStore.js  # Redis ; états des conversations MP
│   │  — Tickets
│   ├── ticketManager.js            # Logique des tickets (création, relais, fermeture, étapes…)
│   ├── guildScan.js / panelTicket.js  # Tickets d'un membre sur tous les serveurs ; ouverture par panel
│   ├── discordReply.js / macroActions.js  # Réponse depuis Discord ; actions des macros
│   ├── ticketFields.js / subjectRules.js / subjectMatch.js  # Champs, règles et correspondance de sujet
│   ├── sla.js / stageStats.js      # Délais par étape et leur respect
│   ├── ticketPresence.js           # Qui a la fiche ouverte (Redis)
│   ├── ticketReminders.js / mentions.js / assignNotify.js  # Rappels, @mentions, notification d'attribution
│   ├── messageSearch.js / similarTickets.js  # Recherche plein texte ; tickets similaires
│   ├── dmEdits.js / discordAttachments.js  # MP modifiés ; liens de pièces jointes renouvelés
│   ├── incidents.js / lowRating.js / faq.js  # Incidents ; notes basses ; FAQ automatique
│   ├── memberPortal.js / memberTickets.js  # Espace membre web ; /mestickets
│   ├── i18n.js                     # Messages aux membres en français / anglais
│   ├── transcript.js / transcriptServer.js / transcriptCrypto.js  # Transcripts : génération, liens, chiffrement
│   ├── components.js / embeds.js / dmEmbeds.js / notePrefix.js  # Boutons et embeds
│   │  — Staff, droits, sécurité
│   ├── permissions.js / gradePermissions.js / staffSync.js / channelVisibility.js  # Droits, grades, rôles Discord, visibilité
│   ├── twoFactorPolicy.js / totp.js / secretBox.js  # 2FA obligatoire, TOTP, chiffrement
│   ├── discordGuard.js / sanitize.js / csv.js / jsonField.js / rateLimit.js / limits.js  # Garde-fous
│   ├── audit.js / saAudit.js / configHistory.js / configTransfer.js  # Journaux, historique et export de la configuration
│   ├── myActivity.js               # Chiffres de « Mon activité »
│   │  — Automatismes et supervision
│   ├── jobQueue.js                 # Tâches planifiées BullMQ
│   ├── inactiveTicketChecker.js / userInactiveChecker.js / staffReminderChecker.js / escalationChecker.js
│   ├── scheduledMessages.js / weeklyReport.js / monthlyReport.js / retention.js / quotaAlert.js
│   ├── errorLog.js / errorAlert.js / discordWatch.js / logger.js  # Erreurs, alertes, surveillance Discord
│   ├── announcements.js / saSettings.js  # Annonces et réglages du super-admin
│   ├── sse.js / webhookEmitter.js  # Temps réel ; webhooks sortants (anti-SSRF)
│
├── web/
│   ├── server.js                   # Express : sessions, CSP, CSRF, limites, routes, pièces jointes, erreurs navigateur
│   ├── rateLimiters.js             # Limiteurs (Redis) et IP bloquées
│   ├── middleware/                 # guild.js (serveur courant), role.js (rôle + grades), superadmin.js
│   └── routes/
│       ├── auth.js / profile.js / sessions.js / push.js  # Connexion, profil, 2FA, sessions, push
│       ├── memberPortal.js         # Espace membre (/api/member)
│       ├── tickets.js / ticketViews.js / templates.js / tags.js / messages.js / fields.js / subjectRules.js
│       ├── dashboard.js / staff.js / analytics.js / reports.js / goals.js / audit.js / loginLogs.js
│       ├── config.js / grades.js / users.js / members.js / blacklist.js / faq.js / incidents.js
│       ├── panels.js / forms.js / discord.js / events.js / transcripts.js / newsletter.js
│       ├── apiKeys.js / apiV1.js   # Clés API ; API publique v1 (+ openapi.json)
│       └── superadmin.js           # Panel SA
│
├── tests/
│   ├── integration/                # Suite d'intégration (npm run test:integration)
│   └── load/                       # Test de charge (npm run test:load)
│
└── dashboard/                      # Frontend React + Vite + Tailwind
    ├── public/
    │   └── sw.js                   # Service Worker pour les push notifications
    └── src/
        ├── pages/                  # Dashboard, Tickets, TicketDetail, Panels, Paramètres…
        ├── components/             # Composants UI réutilisables
        ├── hooks/
        │   ├── useDraft.js         # Brouillons de réponse par ticket
        │   ├── useSSE.js           # Abonnement SSE
        │   ├── useAutoRefresh.js   # Rafraîchissement automatique des données
        │   └── usePushNotifications.js  # Abonnement / désabonnement push navigateur
        └── utils/                  # Helpers frontend (dates, disponibilité, erreurs navigateur…)
    └── tests/smoke.mjs             # Test de fumée Playwright + axe-core
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
| **Rate limiting** | 20 req/15 min sur les endpoints d'auth (dashboard, SA, espace membre), 200 req/min sur l'API générale ; limites propres aux MP, à l'ouverture de tickets depuis le web et aux rapports d'erreur |
| **CSRF** | Toutes les mutations (POST/PATCH/DELETE/PUT) exigent `X-Requested-With: XMLHttpRequest` |
| **SSRF** | Webhooks sortants : résolution DNS + blocage de tous les ranges privés/réservés |
| **Audit SA** | Toutes les tentatives de connexion SA (succès, échec, TOTP) loguées dans `sa_auth_logs` |
| **Audit dashboard** | Toutes les mutations du dashboard loguées dans `audit_log` |
| **Brute-force** | 5 tentatives TOTP par session ; comptes SA verrouillés 15 min après 5 échecs ; 8 DM / 30 s par utilisateur côté bot |
| **Docker** | Utilisateur `node` (non-root), `no-new-privileges`, `cap_drop: ALL`, `NODE_ENV=production` ; `botuser` limité aux bases `ticketbot_*` |
| **Base de données** | Requêtes paramétrées, `stringifyObjects` activé (pas d'injection via objets JSON) |
| **Maintenance / suspension** | Bloque l'API du serveur et rend le bot inactif sur ce serveur |
| **Espace membre** | Session distincte (identité Discord seule, scope `identify`) sans aucun droit sur le dashboard ; chaque requête vérifie que le membre est propriétaire ou participant du ticket et membre du serveur ; jamais de note interne ni de message du salon staff |
| **Chiffrement au repos** | Secrets 2FA et transcripts (AES-256-GCM, rotation de clé, script de rechiffrement vérifié) |
| **Pièces jointes** | Relais `/api/attachment` limité aux liens de pièces jointes Discord et aux utilisateurs connectés |
| **Erreurs navigateur** | Rapports limités en taille et en nombre ; ceux envoyés sans session vont dans une source à part, exclue des alertes |
| **Postes partagés** | Les brouillons sont effacés à la déconnexion |
| **Dépendances** | `npm audit` en CI, mises à jour Dependabot testées avant fusion |
| **Push endpoint allowlist** | Les endpoints push enregistrés sont validés contre une liste blanche des origines connues (FCM, Mozilla, Windows, Apple) — bloque tout endpoint arbitraire |

---

## Rotation de la clé de chiffrement

Les secrets 2FA **et les transcripts** sont chiffrés (AES-256-GCM, les transcripts compressés avant) avec `dashboard.encryptionKey` et portent l'identifiant de la clé utilisée. Les messages des tickets restent en clair : les chiffrer rendrait impossibles la recherche plein texte et les tickets similaires. Pour changer de clé sans rien rendre illisible :

1. Générer une clé : `docker compose exec bot node scripts/rotate-encryption-key.js --generate`
2. Dans `config.json`, mettre l'ancienne clé dans `dashboard.previousEncryptionKeys` et la nouvelle dans `dashboard.encryptionKey`, puis redémarrer le bot
3. Rechiffrer tous les secrets et tous les transcripts de tous les serveurs : `docker compose exec bot node scripts/rotate-encryption-key.js` (rapport par table, relançable sans risque ; chaque transcript est relu avant d'être réécrit). Le même script chiffre aussi les transcripts écrits avant le chiffrement
4. Retirer l'ancienne clé de `previousEncryptionKeys` et redémarrer

La clé dérivée de `sessionSecret` (utilisée quand aucune clé n'est configurée) reste toujours acceptée en lecture.

## Migrations des bases

Chaque base de serveur enregistre les versions de schéma appliquées (table `schema_migrations`). Les migrations sont dans `utils/tenantMigrations.js` : elles s'appliquent une seule fois, dans l'ordre, au démarrage et à l'approbation d'un serveur ; une erreur arrête la migration (journalisée) au lieu d'être ignorée, et un verrou empêche deux instances de migrer la même base. Pour faire évoluer le schéma, ajouter une nouvelle version à la fin de la liste — ne jamais modifier une version déjà appliquée.

## Tests

Suite d'intégration (`tests/integration/harness.js`, 616 vérifications) : elle démarre le vrai serveur web et la logique du bot contre une base MariaDB et un Redis, avec un faux client Discord, et vérifie les permissions, la visibilité, l'isolation entre serveurs, la 2FA, le journal, le parcours des messages privés, l'espace membre, le chiffrement, etc. Un **tour complet** appelle chaque route de l'API (avec un compte autorisé, et un compte qui doit être refusé pour les routes sensibles) et exécute chaque commande Discord dans un salon de ticket.

```bash
npm run test:integration   # lance MariaDB + Redis jetables (Docker), exécute la suite, nettoie
cd dashboard && npm run build && npm run test:smoke   # pages du dashboard et de l'espace membre dans Chromium headless (API simulée)
npm run test:load          # test de charge sur MariaDB + Redis jetables
```

Le test de fumée passe aussi chaque page, en thème sombre et clair, à **axe-core** (WCAG 2.1 A/AA) : toute violation grave ou critique (contraste, bouton sans nom, champ sans libellé…) fait échouer le test. Une troisième passe simule un téléphone (390 px) et échoue si une page déborde en largeur.

**Test de charge** (`npm run test:load`, `tests/load/`) : sur une MariaDB et un Redis jetables (jamais ceux de production), avec le vrai serveur web dans un processus séparé et un faux client Discord, il mesure le volume de données (tickets et messages générés), la création de tickets en parallèle, les connexions temps réel ouvertes (et le délai de livraison d'un événement à toutes), puis la charge du dashboard (utilisateurs simultanés sur la liste, la fiche, les messages, la recherche, « Ma file » et les notes) : débit, latences p50/p95/p99, erreurs, CPU et mémoire du serveur, retard de la boucle d'événements. Réglages par variables : `TICKETS`, `MESSAGES`, `NEW_TICKETS`, `SSE`, `CONCURRENCY`, `DURATION`, `TENANT_POOL` ; `PROFILE=1` enregistre un profil CPU du serveur ; `MAX_P95_MS` et `MAX_ERROR_RATE` font échouer le test au-delà d'un seuil. Le rapport complet est écrit dans `tests/load/last-report.json`.

Mesure du 18/10/2026 (5 000 tickets, 30 000 messages, 200 connexions temps réel, 50 utilisateurs simultanés sur un même serveur pendant 30 s) : aucune erreur ; création de 300 tickets à ~370/s ; événement temps réel livré aux 200 connexions en 12 ms (p95) ; dashboard ~155 requêtes/s, p95 ~460 ms. La limite vient d'abord des **5 connexions MariaDB par serveur** (les requêtes d'un serveur très actif attendent une connexion libre) : 15 connexions donnent ~190 req/s (p95 ~375 ms), 30 connexions ~205 req/s (p95 ~340 ms), où le processus Node atteint alors un cœur de CPU. Réglable avec `database.tenantConnectionLimit` (5 par défaut ; total = serveurs actifs × limite, à garder sous `max_connections` de MariaDB).

La configuration de test est générée à la volée (variable `TICKETBOT_CONFIG`) : le `config.json` de production n'est jamais lu. La même suite tourne à chaque push via **GitHub Actions** (`.github/workflows/ci.yml`), avec le build du dashboard et `npm audit`. **Dependabot** (`.github/dependabot.yml`) propose chaque lundi les mises à jour npm du bot et du dashboard (correctifs et mineures regroupés, majeures une par une), et chaque mois celles des actions GitHub et de l'image Docker : chaque proposition est une pull request testée par la même CI avant fusion.

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

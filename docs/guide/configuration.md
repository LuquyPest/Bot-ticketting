# Configuration

Tout se règle dans le fichier **`.env`** à la racine du dépôt, créé par `scripts/setup.sh`. Chaque variable est aussi commentée dans [`.env.example`](https://github.com/LuquyPest/Bot-ticketting/blob/main/.env.example). Le reste — rôles, catégories, messages, délais, webhooks… — se règle depuis le **dashboard** et vit en base de données.

::: tip Après une modification
`docker compose up -d` suffit : seul le conteneur concerné redémarre.
:::

## Discord et adresse publique

| Variable | Rôle |
|---|---|
| `DISCORD_TOKEN` | Token du bot (portail développeur → *Bot* → *Reset Token*) |
| `DISCORD_CLIENT_ID` | ID de l'application (*General Information*) |
| `DISCORD_CLIENT_SECRET` | Secret OAuth2 (*OAuth2* → *Client Secret*) |
| `PUBLIC_HOST` | Domaine du dashboard, sans `https://` (`tickets.example.com`) |
| `PUBLIC_URL` | Adresse publique complète, en `https://`, sans barre finale |
| `DISCORD_CALLBACK_URL` | Facultatif : par défaut `PUBLIC_URL` + `/api/auth/discord/callback`, l'adresse à enregistrer dans le portail Discord |

## HTTPS et conteneurs

| Variable | Rôle |
|---|---|
| `COMPOSE_FILE` | Fichiers compose utilisés, séparés par `:`. Base : `docker-compose.yml` ; ajoute `docker-compose.caddy.yml` (Caddy inclus, Let's Encrypt) **ou** `docker-compose.traefik.yml` (ton Traefik), et `docker-compose.backup.yml` (sauvegardes) |
| `ACME_EMAIL` | E-mail pour Let's Encrypt (Caddy) |
| `TICKETBOT_VERSION` | Version de l'image : `latest`, ou une version précise (`v3.0.4`) pour ne mettre à jour que quand tu le décides |
| `BIND_ADDRESS` / `WEB_PORT` | Sans Caddy ni Traefik : adresse et port publiés sur la machine (`127.0.0.1:3000` par défaut, à mettre derrière ton propre proxy) |
| `TRUST_PROXY_HOPS` | Nombre de proxys devant l'application (1 ; 2 derrière Cloudflare), pour connaître la vraie adresse IP des visiteurs |
| `TRUSTED_PROXY_HOST` | Nom du proxy dont l'en-tête `X-Forwarded-For` est cru (posé tout seul par les fichiers Caddy et Traefik). Vide : l'en-tête n'est cru que venant d'une adresse locale ou privée |
| `TZ` | Fuseau horaire (heure des sauvegardes) |

## Secrets

Générés par `setup.sh` (`openssl rand -hex 32` à la main). **Garde une copie du `.env` hors du serveur** : sans `ENCRYPTION_KEY`, les transcripts et les secrets 2FA sont illisibles ; sans `BACKUP_KEY`, les sauvegardes aussi.

| Variable | Rôle |
|---|---|
| `DB_ROOT_PASSWORD` | Mot de passe administrateur de MariaDB — jamais transmis au bot |
| `DB_PASSWORD` | Mot de passe du compte `botuser`, limité aux bases du bot |
| `REDIS_PASSWORD` | Mot de passe de Redis |
| `SESSION_SECRET` | Clé des sessions du dashboard (32 caractères au moins) |
| `ENCRYPTION_KEY` | Clé AES-256 des secrets 2FA et des transcripts ([rotation](./securite#rotation-de-la-cle-de-chiffrement)) |
| `BACKUP_KEY` | Clé de chiffrement des [sauvegardes](./sauvegardes) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_CONTACT` | Notifications push du dashboard (facultatif) |

## Instance

| Variable | Rôle |
|---|---|
| `OWNER_IDS` | Comptes Discord co-propriétaires de l'instance, en plus du propriétaire de l'application (IDs séparés par des virgules) |
| `ALLOWED_GUILDS` | Si renseigné, seuls ces serveurs Discord sont acceptés : le bot quitte aussitôt tout autre serveur |
| `PRIVACY_URL` | Ta propre page de confidentialité (par défaut, la page intégrée `/confidentialite`) |
| `CONTACT_EMAIL` | E-mail de contact affiché sur la page de confidentialité |
| `TRANSCRIPT_RETENTION_DAYS` | Durée de conservation des transcripts, en jours (vide : indéfiniment) |
| `BACKUP_TIME` / `BACKUP_KEEP_DAYS` | Heure de la sauvegarde nocturne (03:00) et durée de conservation des archives (30 jours) |

## Base de données

Par défaut `db`, `3306`, `botuser`, `ticketbot_global` : les noms du compose. À ne changer que pour une base externe : `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_NAME`.

## Réglages rares : `config.json`

Quelques réglages n'ont pas de variable. Mets-les dans un `config.json` (modèle : [`config.example.json`](https://github.com/LuquyPest/Bot-ticketting/blob/main/config.example.json)) et monte-le dans le conteneur (lignes commentées de `docker-compose.yml`). Les variables d'environnement l'emportent toujours sur lui.

| Clé | Défaut | Rôle |
|---|---|---|
| `retention.loginLogsDays` | 90 | Conservation des connexions au dashboard (adresses IP) |
| `retention.errorLogsDays` | 30 | Conservation du journal d'erreurs |
| `retention.auditLogDays` | 365 | Conservation du journal de chaque serveur |
| `retention.sessionsDays` | 7 | Conservation du suivi des sessions |
| `retention.instanceAuditDays` | 730 | Conservation du journal de l'instance |
| `rateLimits.apiPerMinute` | 200 | Requêtes par minute et par adresse sur l'API |
| `dashboard.previousEncryptionKeys` | `[]` | Anciennes clés acceptées en lecture pendant une rotation |
| `database.tenantConnectionLimit` | 5 | Connexions MariaDB par serveur Discord (à augmenter pour un serveur très actif) |
| `webEnabled` | `true` | `false` : bot seul, sans dashboard |

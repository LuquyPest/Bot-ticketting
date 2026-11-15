# Portainer, Coolify, Unraid, CasaOS

Tu gères déjà tes services avec une interface ? Le dossier [`deploy/`](https://github.com/LuquyPest/Bot-ticketting/tree/main/deploy) du dépôt contient un fichier compose **autonome** : il n'a besoin d'aucun autre fichier du dépôt, il suffit de le coller dans ton outil et de remplir les variables.

| Fichier | Pour |
|---|---|
| [`deploy/docker-compose.standalone.yml`](https://github.com/LuquyPest/Bot-ticketting/blob/main/deploy/docker-compose.standalone.yml) | Portainer, Unraid (Compose Manager), Dockge, Synology Container Manager, tout outil qui accepte un fichier compose |
| [`deploy/coolify/docker-compose.yml`](https://github.com/LuquyPest/Bot-ticketting/blob/main/deploy/coolify/docker-compose.yml) | Coolify : domaine et mots de passe générés par Coolify |
| [`deploy/casaos/docker-compose.yml`](https://github.com/LuquyPest/Bot-ticketting/blob/main/deploy/casaos/docker-compose.yml) | CasaOS : le fichier autonome avec la fiche de l'application |

::: info Avant de commencer
Il te faut l'**application Discord** (Application ID, token, Client Secret) : [étape 3 de l'installation](./installation#etape-3-—-creer-le-bot-sur-discord). Discord n'accepte la connexion au dashboard qu'en **HTTPS** : le dashboard doit passer par un reverse proxy (Nginx Proxy Manager, Traefik, Caddy, SWAG…), sauf avec Coolify qui s'en charge.
:::

## Les variables

Chaque secret se génère avec `openssl rand -hex 32` (64 caractères hexadécimaux), ou avec un générateur de mots de passe pour les trois mots de passe.

| Variable | Valeur |
|---|---|
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Portail développeur Discord |
| `PUBLIC_URL` | Adresse HTTPS du dashboard, par exemple `https://tickets.example.com` |
| `DB_ROOT_PASSWORD`, `DB_PASSWORD`, `REDIS_PASSWORD` | Trois mots de passe différents |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` — **garde-la hors du serveur** : sans elle, les transcripts sont illisibles |
| `WEB_PORT` | Port du dashboard sur la machine (3000 par défaut), vers lequel pointe ton reverse proxy |
| `TICKETBOT_VERSION` | `latest`, ou une version précise |

Dans le portail Discord, ajoute ensuite `PUBLIC_URL` + `/api/auth/discord/callback` aux *Redirects* OAuth2.

## Portainer

1. **Stacks → Add stack**, nomme-la `ticketbot`.
2. **Web editor** : colle `deploy/docker-compose.standalone.yml`.
3. **Environment variables → Advanced mode** : colle les variables (une par ligne, `NOM=valeur`).
4. **Deploy the stack**, puis pointe ton reverse proxy vers le port `3000` de la machine.

## Unraid

Avec le plugin **Docker Compose Manager** (Community Applications) :

1. **Docker → Compose → Add new stack**, nomme-la `ticketbot`.
2. **Edit stack → Compose file** : colle `deploy/docker-compose.standalone.yml`.
3. **Edit stack → Env file** : les variables.
4. **Compose up**, puis ajoute le dashboard à ton reverse proxy (SWAG, Nginx Proxy Manager…).

## Coolify

1. **Project → New resource → Docker Compose Empty**, colle `deploy/coolify/docker-compose.yml`.
2. Coolify crée le domaine (`SERVICE_FQDN_BOT`) et les mots de passe. Dans **Environment Variables**, remplis `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` et `ENCRYPTION_KEY`.
3. **Deploy**. Le domaine affiché par Coolify est celui à utiliser dans le portail Discord (`/api/auth/discord/callback`).

## CasaOS

1. **App Store → Custom install → Import → Docker Compose**, colle `deploy/casaos/docker-compose.yml`.
2. Remplis les variables d'environnement des conteneurs `bot`, `db` et `redis`.
3. **Install**, puis mets le dashboard derrière HTTPS (Discord l'exige).

## Ce qui change par rapport à l'installation complète

Ces fichiers contiennent la base, Redis et le bot. Ils n'incluent **pas** les services facultatifs de l'[installation complète](./installation) : sauvegardes chiffrées nocturnes, copie hors du serveur et bouton de mise à jour. Sauvegarde le volume de la base avec les outils de ta plateforme (ou passe à l'installation complète pour en profiter), et mets à jour en redéployant la stack : la nouvelle image est tirée et les migrations s'appliquent au démarrage.

::: tip Testé, pas partout
Le fichier autonome est testé avec Docker Compose. Les interfaces de ces outils évoluent : si un écran ne correspond pas, [ouvre un ticket](https://github.com/LuquyPest/Bot-ticketting/issues) avec ce que tu vois.
:::

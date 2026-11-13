# Mettre à jour

Les versions sont publiées sur la page [Releases](https://github.com/LuquyPest/Bot-ticketting/releases) avec leurs notes (les mêmes que la page *Patchnotes* du dashboard). Chaque version a son image Docker : `ghcr.io/luquypest/bot-ticketting:v2.24`, et `latest` pointe sur la dernière.

## Mise à jour ordinaire

```bash
scripts/backup.sh                              # par prudence
docker compose pull && docker compose up -d    # nouvelle image, redémarrage du bot seul
docker compose logs -f bot                     # « Tout est prêt » = terminé
```

Les **migrations de base de données s'appliquent toutes seules** au démarrage, pour la base globale et pour chaque serveur Discord, une seule fois chacune et dans l'ordre. Aucune commande à lancer, aucune interruption pour les membres : le bot est indisponible le temps du redémarrage (quelques secondes), les messages privés reçus pendant ce temps sont lus à la reprise.

Pour rester sur une version précise, mets `TICKETBOT_VERSION=v2.24` dans `.env` au lieu de `latest` ; la mise à jour se fait alors en changeant cette valeur.

## Revenir en arrière

Une version antérieure ne connaît pas les migrations plus récentes mais les tolère presque toujours (colonnes en plus). Si une version pose problème : `TICKETBOT_VERSION=v2.23` dans `.env`, `docker compose up -d`. En cas de doute, restaure la sauvegarde faite avant la mise à jour : `scripts/restore.sh backups/ticketbot-<date>.sql.gz`.

## Installations faites avant la v2.24 (config.json + Traefik)

La v2.24 lit la configuration dans `.env` ; `config.json` reste accepté, mais le `docker-compose.yml` ne le monte plus par défaut et le Traefik n'y est plus. Deux options :

**A. Passer au `.env` (recommandé)** — recopie dans `.env` les valeurs de `config.json` :

| `config.json` | `.env` |
|---|---|
| `token` | `DISCORD_TOKEN` |
| `clientId` | `DISCORD_CLIENT_ID` |
| `dashboard.discordClientSecret` | `DISCORD_CLIENT_SECRET` |
| `webServerBaseUrl` | `PUBLIC_URL` (+ `PUBLIC_HOST` = le domaine seul) |
| `dashboard.sessionSecret` | `SESSION_SECRET` |
| `dashboard.encryptionKey` | `ENCRYPTION_KEY` — **indispensable**, sinon les transcripts et secrets 2FA deviennent illisibles |
| `vapid.publicKey` / `privateKey` / `contact` | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_CONTACT` |
| `database.password` | `DB_PASSWORD` (déjà présent) |
| `trustProxyHops` / `trustedProxyHost` | `TRUST_PROXY_HOPS` / `TRUSTED_PROXY_HOST` |

Ajoute `COMPOSE_FILE=docker-compose.yml:docker-compose.traefik.yml` (si tu utilises Traefik), puis `docker compose up -d`. Les réglages rares (`retention`, `rateLimits`, `previousEncryptionKeys`, `database.tenantConnectionLimit`) n'ont pas de variable : garde un `config.json` pour eux (option B) ; il peut ne contenir que ces clés.

**B. Garder `config.json`** — décommente dans `docker-compose.yml` les lignes `volumes` et `user` du service `bot` (ou mets-les dans un `docker-compose.override.yml` à toi), et ajoute `COMPOSE_FILE` + `PUBLIC_HOST` dans `.env` pour Traefik.

## Développement : construire l'image soi-même

`docker compose up -d --build` reconstruit l'image depuis les sources au lieu de la tirer. Le dépôt déclenche la publication d'une version avec `scripts/release.sh vX.Y` (tag Git → action *Release* : image amd64 + arm64 sur GHCR et release GitHub avec les notes des patchnotes).

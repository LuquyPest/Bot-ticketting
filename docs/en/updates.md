# Updates

Versions are published on the [Releases](https://github.com/LuquyPest/datick/releases) page with their notes (the same as the dashboard's *Patchnotes* page). Each version has its Docker image: `ghcr.io/luquypest/bot-ticketting:v3.1.0`, and `latest` points to the newest.

## Being told

Once a day, the instance looks at the latest version published on GitHub. When there is a new one, **Instance → Health** shows it with a link to its notes, and the owner gets a DM (once per version). `UPDATE_CHECK=off` in `.env` turns this check off: the instance then never calls GitHub.

## Update from the dashboard

With the `updater` service, an **Update** button shows up in **Instance → Health** when a version is available. One click: the image is downloaded, the bot restarts (about a minute) and the result is shown.

`scripts/setup.sh` turns it on by default. On an install made without it (or before v3.2.1):

1. In `.env`:
   ```bash
   echo "UPDATER_TOKEN=$(openssl rand -hex 32)" >> .env
   echo "PROJECT_DIR=$(pwd)" >> .env
   ```
2. Add `:docker-compose.updater.yml` at the end of `COMPOSE_FILE`, then `docker compose up -d`.

::: warning What this service can do
To restart the bot, the `updater` service has access to the Docker socket, which amounts to being administrator of the machine. So it is kept apart from the bot: it only asks the bot, over the internal Docker network and with `UPDATER_TOKEN`, whether an update was requested, then pulls the bot image and recreates that single container. It runs nothing the bot sends it. If you prefer, leave it out and update by hand.
:::

The button does not show with a pinned version (`DATICK_VERSION=v3.1.0`): change the value in `.env`. It only concerns the published image: if you build the image yourself from the sources, update with `git pull && docker compose up -d --build`.

## Updating by hand

```bash
scripts/backup.sh                              # to be safe
docker compose pull && docker compose up -d    # new image, only the bot restarts
docker compose logs -f bot                     # « Tout est prêt » (all set) = done
```

**Database migrations apply on their own** at start-up, for the global database and for each Discord server, once each and in order. No command to run, no interruption for members: the bot is unavailable for the restart (a few seconds), direct messages received meanwhile are read when it is back.

To stay on a precise version, set `DATICK_VERSION=v3.1.0` in `.env` instead of `latest`; updating then means changing that value.

## Going back

An earlier version does not know the newer migrations but almost always tolerates them (extra columns). If a version causes trouble: `DATICK_VERSION=` followed by the previous version in `.env`, then `docker compose up -d`. When in doubt, restore the backup made before the update: `scripts/restore.sh backups/ticketbot-<date>.sql.gz.enc`.

## Encrypted backups (v3.0.4)

Backups are encrypted since v3.0.4: add a key to `.env` before updating, otherwise the `backup` service refuses to start.

```bash
echo "BACKUP_KEY=$(openssl rand -hex 32)" >> .env
```

Old unencrypted `.sql.gz` archives can still be restored with `scripts/restore.sh`; delete them once an encrypted backup exists.

## From v2 to v3.0 (personal instance)

v3.0 drops the « service » model: no more super-admin panel, managers, plans, limits, announcements, public status page or server approval. **The owner of the Discord application runs the instance** from the **Instance** section of the dashboard, with their Discord sign-in.

Before updating:

1. Check in the Discord portal (*General Information*) that the owner of the application is your account. Otherwise, put your ID in `OWNER_IDS` (`.env`).
2. Servers still **« pending »** will be activated at start-up. If you do not want them, remove them first (v2 `/sa` panel → Delete: the bot leaves them).
3. Back up: `scripts/backup.sh`.

Then `docker compose pull && docker compose up -d`. Afterwards:

- remove `SA_USERNAME`, `SA_PASSWORD` and `AUTO_APPROVE_GUILDS` from `.env` (ignored);
- transcript retention is no longer a per-server limit: `TRANSCRIPT_RETENTION_DAYS` (empty = forever);
- the settings (error alert, demonstration) are kept; on a new install, the demonstration is off by default;
- add the nightly backup: `:docker-compose.backup.yml` at the end of `COMPOSE_FILE`.

The tables of the old model stay in the database, unused, to allow going back to v2.24: `superadmins`, `managers`, `plans`, `announcements`, `status_events`, `sa_auth_logs`, `sa_audit_log`, `sa_settings`. Once v3 is adopted, you can drop them:

```bash
docker compose exec db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" ticketbot_global -e "ALTER TABLE guilds DROP FOREIGN KEY IF EXISTS fk_guild_approver; DROP TABLE IF EXISTS managers, superadmins, plans, announcements, status_events, sa_auth_logs, sa_audit_log, sa_settings"'
```

## Installs made before v2.24 (config.json + Traefik)

v2.24 reads its configuration from `.env`; `config.json` is still accepted, but `docker-compose.yml` no longer mounts it by default and Traefik is no longer in it. Two options:

**A. Move to `.env` (recommended)** — copy the values of `config.json` into `.env`:

| `config.json` | `.env` |
|---|---|
| `token` | `DISCORD_TOKEN` |
| `clientId` | `DISCORD_CLIENT_ID` |
| `dashboard.discordClientSecret` | `DISCORD_CLIENT_SECRET` |
| `webServerBaseUrl` | `PUBLIC_URL` (+ `PUBLIC_HOST` = the domain only) |
| `dashboard.sessionSecret` | `SESSION_SECRET` |
| `dashboard.encryptionKey` | `ENCRYPTION_KEY` — **essential**, otherwise transcripts and 2FA secrets become unreadable |
| `vapid.publicKey` / `privateKey` / `contact` | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_CONTACT` |
| `database.password` | `DB_PASSWORD` (already there) |
| `trustProxyHops` / `trustedProxyHost` | `TRUST_PROXY_HOPS` / `TRUSTED_PROXY_HOST` |

Add `COMPOSE_FILE=docker-compose.yml:docker-compose.traefik.yml` (if you use Traefik), then `docker compose up -d`. Rare settings (`retention`, `rateLimits`, `previousEncryptionKeys`, `database.tenantConnectionLimit`) have no variable: keep a `config.json` for them (option B); it may hold only these keys.

**B. Keep `config.json`** — uncomment the `volumes` and `user` lines of the `bot` service in `docker-compose.yml` (or put them in a `docker-compose.override.yml` of your own), and add `COMPOSE_FILE` + `PUBLIC_HOST` to `.env` for Traefik.

## Development: building the image yourself

`docker compose up -d --build` rebuilds the image from the sources instead of pulling it. The repository publishes a version with `scripts/release.sh vX.Y.Z` (Git tag → *Release* action: amd64 + arm64 image on GHCR and GitHub release with the notes from the release notes file).

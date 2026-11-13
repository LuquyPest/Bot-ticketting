# Self-hosting Ticket Bot

One server, Docker, a domain name: twenty minutes. Every install is independent — your bot, your database, your data, no link to the author or to any other instance.

*Version française : [INSTALL.md](INSTALL.md).* The dashboard itself is available in French and English (per-user setting).

## 1. What you need

| | Why |
|---|---|
| A Linux server (1 GB of RAM is enough) with **Docker** and **Docker Compose v2** | everything runs in containers: MariaDB, Redis, the bot and its dashboard |
| A **domain name** pointing to that server (`tickets.example.com`) | Discord only allows signing in to the dashboard over HTTPS on a public address |
| **Ports 80 and 443** open | automatic HTTPS certificates (Let's Encrypt) — unless you already run a reverse proxy |
| A **Discord application** (step 2) | the bot itself and the "Sign in with Discord" button |

Installing Docker: <https://docs.docker.com/engine/install/>.

## 2. Create the Discord application

On <https://discord.com/developers/applications>:

1. **New Application**, name it after your bot.
2. **Bot** tab → **Reset Token** → copy the **token** (it is shown once).
3. Still under **Bot**, *Privileged Gateway Intents*: enable **Server Members Intent** and **Message Content Intent** (without them the bot cannot read direct messages).
4. **OAuth2** tab → copy the **Client Secret** (*Reset Secret* if needed). The **Application ID** is on *General Information*.
5. Still under **OAuth2** → *Redirects* → **Add Redirect**: `https://tickets.example.com/api/auth/discord/callback` (your domain, exactly this path). Save.

You now have three values: the token, the Application ID and the Client Secret.

## 3. Install

```bash
git clone https://github.com/LuquyPest/Bot-ticketting.git
cd Bot-ticketting
scripts/setup.sh
```

The script (prompts in French) asks for the token, the application ID, the client secret, your domain, your e-mail and the HTTPS mode, then generates every password and secret into `.env` (private file, `chmod 600`). It ends by printing the **super-admin** username and password: write them down.

Three HTTPS modes:

- **Bundled Caddy** (default): nothing to configure, automatic certificates. Needs ports 80 and 443.
- **Existing Traefik**: the bot joins the `proxy` Docker network with labels for the `web`/`websecure` entrypoints and the `letsencrypt` resolver; edit `docker-compose.traefik.yml` if your names differ.
- **None**: the dashboard listens on `127.0.0.1:3000`; put your own proxy in front (Nginx: `proxy_buffering off;` for the real-time stream) and set `TRUSTED_PROXY_HOST` or `TRUST_PROXY_HOPS` in `.env`.

Then:

```bash
docker compose pull          # published image (ghcr.io/luquypest/bot-ticketting)
docker compose up -d
docker compose logs -f bot   # « Tout est prêt » = running; Ctrl+C leaves the logs
```

The first visit to `https://tickets.example.com` may wait a minute for the certificate.

Without the script, copy `.env.example` to `.env` and fill it in by hand: every variable is commented.

## 4. First start

1. **Super-admin panel**: `https://tickets.example.com/sa`, with the username and password printed by the script. It asks you to scan a QR code (Google Authenticator, Authy, Bitwarden…): two-factor authentication is mandatory for this account.
2. **Invite the bot**: sign in to `https://tickets.example.com` with Discord → the server picker offers an invite link with the right permissions. You need *Manage Server* on the Discord server.
3. **Activation**: with `AUTO_APPROVE_GUILDS=true` (the script's default), the server is active as soon as the bot joins and the person who invited it becomes the dashboard **founder**. Otherwise approve it in `/sa` → Servers.
4. **Settings**: in the dashboard, *Paramètres* → access roles (which Discord roles are staff), ticket channel category, welcome messages… Everything else is done from the dashboard, nothing in files.

Then remove `SA_PASSWORD` from `.env` (the account exists, the line is no longer used) and restart: `docker compose up -d`.

## 5. Day to day

| Action | Command |
|---|---|
| Update | `docker compose pull && docker compose up -d` — see [UPGRADE.md](UPGRADE.md) |
| Back up | `scripts/backup.sh` (all databases → `backups/`, put it in a cron); also keep a copy of `.env` |
| Restore | `scripts/restore.sh backups/ticketbot-<date>.sql.gz` |
| Logs | `docker compose logs -f bot` |
| Restart | `docker compose restart bot` |
| Stop | `docker compose down` (data stays in the Docker volumes) |
| Remove everything | `docker compose down -v` — also deletes the databases |
| Pin a version | `TICKETBOT_VERSION=v2.24` in `.env` instead of `latest` |

## 6. Troubleshooting

**"Aucune configuration trouvée" at start** → `.env` is missing or empty; run `scripts/setup.sh` again.

**The bot ignores direct messages** → *Message Content Intent* is off (step 2.3). After enabling it, `docker compose restart bot`.

**"Invalid OAuth2 redirect_uri" when signing in** → the redirect URL in the Discord portal must be exactly `https://<your domain>/api/auth/discord/callback`, and `PUBLIC_URL` in `.env` must be `https://<your domain>` without a trailing slash.

**No HTTPS certificate** → DNS does not point to the server yet, or ports 80/443 are closed (firewall, router). `docker compose logs caddy` says why.

**My server stays "pending"** → `AUTO_APPROVE_GUILDS` is not `true`: approve it in `/sa`, or set the variable to `true` and restart (pending servers are then activated).

**Lost the super-admin password** → `SA_USERNAME`/`SA_PASSWORD` only create the very first account. Reset it in the database: `docker compose exec db mariadb -uroot -p"$DB_ROOT_PASSWORD" ticketbot_global -e "DELETE FROM superadmins"`, then restart with `SA_USERNAME`/`SA_PASSWORD` set.

**I want to keep a `config.json`** → still supported: mount it into the container (commented lines in `docker-compose.yml`). Environment variables override its values.

Questions: [GitHub Discussions](https://github.com/LuquyPest/Bot-ticketting/discussions); bugs: [open an issue](https://github.com/LuquyPest/Bot-ticketting/issues/new/choose).

# Installation

One server, Docker, a domain name: **about twenty minutes**, step by step. Every install is independent — your bot, your database, your data, no link to the author or to any other instance. You are its only administrator: no account to create, you sign in with your Discord account.

*Version française : [Installation](../guide/installation).* Screenshots show the French interface; the dashboard follows your browser language (English or French).

::: tip Using Portainer, Coolify, Unraid or CasaOS?
A standalone compose file can be pasted straight into your tool: [Portainer, Coolify, Unraid, CasaOS](./tools).
:::

## What you are setting up

![Your domain leads to your server, which runs the bot connected to Discord](/images/guide-overview.png)

Three things to connect: **your Discord application** (step 3), **your server** that runs the bot (steps 1, 4 and 5) and **your domain** that leads to it (step 2).

## What you need

| | Why |
|---|---|
| A **Linux server** (a VPS, 1 GB of RAM is enough) | The bot runs all the time; a machine at home works too if it stays on |
| A **domain name** (or a subdomain, like `tickets.example.com`) | Discord only allows signing in to the dashboard over HTTPS on a public address |
| **Ports 80 and 443** open | For the automatic HTTPS certificate |
| A **Discord account** | It becomes the owner of your instance |

## Step 1 — Install Docker

On the server, over SSH. The official method, for Debian or Ubuntu:

![Install Docker then check its version](/images/install-docker.png)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then log out and back in
```

::: tip Check
`docker compose version` must answer with a version number. Other systems: [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
:::

## Step 2 — Point the domain

At your domain provider (OVH, Gandi, Cloudflare, Namecheap…), open the **DNS zone** and add an **A** record to the IP address of the server:

![Add an A record in the DNS zone](/images/guide-dns.png)

| Type | Name | Value |
|---|---|---|
| `A` | `tickets` (for `tickets.example.com`) | the IPv4 address of the server |

::: tip Check
`ping tickets.example.com` must answer with the address of your server. Propagation takes from a few minutes to an hour.
:::

## Step 3 — Create the bot on Discord

Open the [Discord developer portal](https://discord.com/developers/applications) and sign in with the account that will administer the instance.

### Create the application

1. **New Application** → give it the name of your bot → **Create**.
2. **General Information** page: copy the **Application ID**.

![Developer portal: New Application, then copy the Application ID](/images/guide-discord-app.png)

### The bot

3. **Bot** tab:
   - **Reset Token** → copy the **token** (it will never be shown again);
   - untick **Public Bot**: only you will be able to invite the bot;
   - under *Privileged Gateway Intents*, enable **Server Members Intent** and **Message Content Intent**, then **Save Changes**.

![Bot tab: Reset Token, Public Bot off, intents on](/images/guide-discord-bot.png)

### Signing in to the dashboard

4. **OAuth2** tab:
   - **Reset Secret** → copy the **Client Secret**;
   - under *Redirects*, **Add Redirect**: `https://tickets.example.com/api/auth/discord/callback` (with your domain, exactly this ending) → **Save Changes**.

![OAuth2 tab: Reset Secret, redirect URL](/images/guide-discord-oauth.png)

You now have three values: the **Application ID**, the **token** and the **Client Secret**.

::: warning Never share the token or the Client Secret
They give control of your bot. If they leak: **Reset Token** / **Reset Secret** in the portal, then run `scripts/setup.sh` again.
:::

## Step 4 — Install and configure

```bash
git clone https://github.com/LuquyPest/Bot-ticketting.git
cd Bot-ticketting
scripts/setup.sh --lang en
```

The script asks a few questions and **generates everything else**: passwords, encryption keys, notification keys. The token and the Client Secret are typed without being shown.

![setup.sh asks its questions then writes the .env file](/images/install-setup.png)

| Question | Answer |
|---|---|
| Language | **2** English (or `--lang en` as above) |
| HTTPS | **1** (bundled Caddy) in most cases. **2** if you already run Traefik, **3** if you have your own reverse proxy |
| Back up every night | **y**: an encrypted backup of every database, every night, in `backups/` |
| Check every week | **y**: the latest archive is decrypted and tested on Sundays ([details](./backups#automatic-check)) |
| Copy off the server | Optional: the rclone wizard creates the destination (S3, Backblaze, SFTP…) — [details](./backups#off-the-server) |
| « Update » button | **y** (default): one-click updates from the dashboard — [what it implies](./updates#update-from-the-dashboard) |

Everything is written to the `.env` file, private (readable by you only). Keep a copy of it off the server: it holds the keys that decrypt the transcripts and the backups.

## Step 5 — Start

```bash
docker compose pull && docker compose up -d
docker compose logs -f bot
```

Docker downloads the published image and starts the database, Redis, the bot, Caddy and the backup. The bot checks its configuration and connects to Discord:

![Containers starting, then the bot](/images/install-start.png)

« **Connecté en tant que** » (signed in as): it works. `Ctrl+C` leaves the logs (the bot keeps running).

::: tip If it does not start
The error message says what is missing. The usual cases are in [Troubleshooting](./troubleshooting#installation).
:::

## Step 6 — Sign in

Open `https://tickets.example.com` (the first time, the HTTPS certificate can take a minute) and click **Sign in with Discord**, with the account that owns the application.

![Dashboard sign-in page](/images/install-login.png)

The dashboard carries the name and avatar of your bot. You are recognised as the **owner of the instance**.

## Step 7 — Invite the bot to your server

The **My servers** page lists the Discord servers where you have the *Manage Server* permission. Click **Invite the bot** on yours and confirm in the Discord window.

![My servers: « Invite the bot » on a server, « Open » on a server already active](/images/install-servers.png)

The server is **ready as soon as the bot joins**: you are its founder and you get a DM with the link to the dashboard. Click **Open**.

## Step 8 — Set the essentials

**On Discord**, the quickest: type `/setup` on your server. The wizard has you pick the staff roles, creates the ticket categories if you want, and posts a panel. Or, **in the dashboard**:

**Settings → Access and security**: pick the Discord roles of your staff.

![Settings → Access and security: support and chief support roles](/images/install-roles.png)

**Settings → Tickets**: pick the categories where tickets go, one per stage, then **Save**.

![Settings → Tickets: ticket format, categories and stage deadlines](/images/install-categories.png)

Then send a direct message to the bot from another account: the ticket shows up in **Tickets** and in the « Open » category of your server. **It is installed.**

What comes next — subjects, messages, grades, FAQ, panels: [First steps](./first-steps).

## Day to day

| Action | Command |
|---|---|
| Update | `docker compose pull && docker compose up -d` — [Updates](./updates) |
| Back up now | `scripts/backup.sh` — [Backups](./backups) |
| Restore | `scripts/restore.sh backups/ticketbot-<date>.sql.gz.enc` |
| Read the logs | `docker compose logs -f bot` |
| Restart the bot | `docker compose restart bot` |
| Stop everything | `docker compose down` (the data stays) |
| Stay on a version | `TICKETBOT_VERSION=v3.1.0` in `.env` instead of `latest` |

::: details Installing without the script
Copy `.env.example` to `.env` and fill it in: every variable is commented there, and all of them are described in [Configuration](./configuration). Generate each secret with `openssl rand -hex 32`.
:::

::: details Using your own reverse proxy (Nginx, Traefik…)
With choice **3**, the dashboard listens on `127.0.0.1:3000`: point your proxy at it. For Nginx, add `proxy_buffering off;` (real time). With an existing **Traefik** (choice **2**), the bot joins the Docker network `proxy` with the entrypoints `web` / `websecure` and the resolver `letsencrypt`: adapt `docker-compose.traefik.yml` if yours have other names.
:::

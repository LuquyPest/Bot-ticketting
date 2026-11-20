# Troubleshooting

## Installation

**« Aucune configuration trouvée » (no configuration found) at start-up**
`.env` is missing or empty: run `scripts/setup.sh` again.

**« Invalid OAuth2 redirect_uri » when signing in**
The redirect address in the Discord portal must be exactly `https://<your domain>/api/auth/discord/callback`, and `PUBLIC_URL` is `https://<your domain>` without a trailing slash.

**The HTTPS certificate does not come (Caddy)**
DNS does not point to the server yet, or ports 80 and 443 are closed: `docker compose logs caddy` says why.

**The `backup` service refuses to start**
`BACKUP_KEY` is missing from `.env`: `echo "BACKUP_KEY=$(openssl rand -hex 32)" >> .env`.

**MariaDB refuses the connection**
`DB_HOST` must stay `db`. With a `config.json`, its `database.password` must equal `DB_PASSWORD`.

## Discord bot

**The bot does not answer direct messages**
Turn on **Message Content Intent** in the Discord portal (*Bot* tab), then `docker compose restart bot`.

**Slash commands do not show up**
Wait a minute or two. Otherwise: `docker compose restart bot`.

**The bot leaves a server as soon as it joins**
`ALLOWED_GUILDS` is set and this server is not in it: add its ID or empty the variable.

**Channels of restricted tickets stay visible**
The bot lacks the **Manage Roles** permission: **Server health** reports it. Re-invite it or give it the permission.

## Checking Discord

**Instance → Health → Discord servers** reviews every server of the instance, read-only: its state (active, pending, suspended, and why), then for the active ones the problems of their **Server health** page: missing bot permissions, configured channels, categories and roles that no longer exist, full categories, and published **panels** whose channel or message is gone or where the bot can no longer write. **Check** runs it all again.

This diagnostic does not replace a real try. After a major update or a change on the server, go through this round, with a test account that is not staff:

1. **Panel**: click a button of a published panel → the form opens, the ticket is created (channel, thread or DM depending on the mode).
2. **DM**: write to the bot privately → it offers the subjects, then opens the ticket.
3. **Staff reply** from the dashboard → the member receives it (channel or DM); their answer comes back in the dashboard.
4. **Grade or confidential ticket** → the channel is visible to the right roles only.
5. **Closing** → transcript in the log channel, rating request to the member, channel deleted or archived.
6. **Commands** `/ticket` and `/close` in a ticket.

## Checking the connected services

Each third-party service has a button that makes a **real call** with the saved keys and says plainly what is wrong (token refused, missing rights, project not found, service silent):

| Service | Where | What the test does |
|---|---|---|
| HubSpot, Salesforce | Settings → Integrations → CRM → **Test** | Reads the contacts |
| GitHub, GitLab, Jira | Settings → Integrations → Jira, GitHub and GitLab → **Test** | Reads the repository or project; for Jira, the account and the issue type |
| Monitoring | Settings → Integrations → Monitoring → **Send a test alert** | Opens a « Alerte de test » ticket then closes it (or adds a note), like a real alert |
| Extensions | Settings → Integrations → Extensions → **Test the webhook** | Sends a signed `ping` event and shows the answer |
| SMS | Instance → Health → SMS → **Send a test SMS** | Number left empty: your own verified number |
| SAML | Instance → Sign-in → SAML 2.0 → **Check the settings**, **Test sign-in** | Reads the certificate (validity) and reaches the provider's address; the test sign-in shows what the provider sends back, without opening a session |

Ten tests at most per service every 10 minutes. After connecting a service with a real account, also try it for real: an issue created from a ticket and closed in the tracker (the note must appear), a CRM card on a ticket from a known customer, an alert from your monitoring tool, a SAML sign-in from an account of the allowed group.

## Dashboard

**I see neither the Instance section nor « Invite the bot »**
You are not signed in with the account that owns the Discord application. Add your ID to `OWNER_IDS` if that is intended, then `docker compose up -d`.

**Stuck on the waiting page (« New »)**
A founder has to give you a grade in **Team**.

**A staff member does not see the server**
Check that their Discord role is in **Settings → Access and security**, then that they sign in again.

**« Insufficient permission » everywhere**
A support has no rights without a grade: check the grade tied to their role, or give them a grade with at least `view_tickets`.

**I lost my phone (2FA)**
Use a backup code on the verification screen, then set up 2FA again from your profile.

**Real time does not work behind my own proxy**
Nginx: `proxy_buffering off;`, `proxy_cache off;`, `proxy_read_timeout 3600s;`.

## Still stuck?

Ask your question in the [Discussions](https://github.com/LuquyPest/datick/discussions), or open an [issue](https://github.com/LuquyPest/datick/issues/new/choose) with the version, the steps and the logs (`docker compose logs bot`) — **without any token or secret**. English is welcome.

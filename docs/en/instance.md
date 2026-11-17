# Instance section

The **instance** is your install: your Discord bot and every server it is on. It has one owner, and one place to manage it.

## The owner

The **owner of the instance** is the Discord account that owns the bot's application (developer portal → *General Information*). For a team application: the owner and the admins of the team. You can add co-owners with `OWNER_IDS` in `.env`.

- They sign in to the dashboard with their Discord account, like everyone: no separate account, no password.
- They are a **founder on every server** of the instance.
- Only they see the list of all servers at sign-in, get the bot's invite link and reach the **Instance** section (Administration menu, or `/instance`).

## Servers

A Discord server is **active as soon as the bot joins it**: its database is created, the person who invited the bot becomes its founder and gets a DM with the link to the dashboard. There is no approval step.

::: warning Private bot
In the Discord portal, *Bot* tab, untick **Public Bot**: otherwise anyone can add your bot to their server, and that server would be activated on your instance. `ALLOWED_GUILDS` further restricts the list of accepted servers; a warning shows at start-up if the bot is public without that list.
:::

**Several communities**: a reply template created with the **Every server** scope (ticket view → Templates) is offered to the staff of each of your servers, without being copied. The staff uses it, only you edit it; it cannot add a tag, since tags belong to each server.

**A space without Discord**: **Instance → Servers → Create a space**. It is a support space without a Discord server: tickets by [e-mail](./integrations#tickets-by-e-mail), member space, dashboard, with its own settings, team and journal, like a server. Its tickets have no channel (« No channel » format), and nothing is ever asked to Discord about it. You are its founder; it shows up in **My servers** whatever the way you sign in.

## Pages

| Page | |
|---|---|
| **Overview** | Servers, open tickets, tickets per day over 30 days, staff, errors of the last 24 hours, table per server |
| **Servers** | Suspend, reactivate, put in maintenance, delete (the bot leaves the server and its database is erased); name or remove founders |
| **Health** | Running version and [update](./updates), state of the [backups](./backups#monitoring-and-alerts), Discord connection, database, Redis, scheduled jobs, memory, schema version of each database; demonstration server, [Prometheus metrics](#monitoring-prometheus) |
| **Errors** | Central log of the errors of the bot, the dashboard and browsers, with filters; **alert** by DM (to the owner by default) or webhook beyond a threshold, and when the bot is disconnected from Discord |
| **Log** | Every change made from the section, with its author and the server concerned |
| **Blocks** | IP addresses blocked by the sign-in or API limits, with unblocking |

## Demonstration

A fictitious server filled with realistic data, open to everyone from the sign-in page (« Discover the dashboard ») or directly at the `/demo` address of your domain. **Off by default**, it is turned on in **Instance → Health**. Isolated from everything else: no DM leaves it, actions towards Discord and the outside are refused, and it is reset every night.

## E-mail of the instance

The sending server (SMTP) Datick uses to **write to people itself**: invitations, sign-in links, password resets. It is set in **Instance → Health → E-mail of the instance**: server, port (587, 465, 25 or 2525), optional username and password, sender address and name. **Send the test** checks it right away.

It is distinct from the support mailboxes of each space ([tickets by e-mail](./integrations#tickets-by-e-mail)), with the same protections: server with a public address only (`EMAIL_ALLOW_PRIVATE_HOSTS=true` for a server at home), password encrypted and never shown again, every change in the instance journal. E-mails go out in French or English depending on the person.

## Monitoring (Prometheus)

To follow the instance in **Prometheus**, **Grafana** or **Uptime Kuma**. **Off by default**: **Instance → Health → Prometheus metrics → Turn on** creates a token, shown only once (only its fingerprint is kept). The address `https://your-domain/metrics` then answers whoever presents this token, and `404` to everyone while it is off.

```yaml
scrape_configs:
  - job_name: ticketbot
    scheme: https
    authorization:
      credentials: tbm_…        # the token
    static_configs:
      - targets: ['tickets.example.com']
```

| Metric | Content |
|---|---|
| `ticketbot_tickets_open`, `_unassigned`, `_waiting` | Open tickets, with nobody assigned, waiting — per server (`guild_id`, `guild`) |
| `ticketbot_tickets_opened_24h`, `_closed_24h` | Opened and closed over 24 hours |
| `ticketbot_oldest_unanswered_ticket_seconds` | Age of the oldest open ticket without a staff answer |
| `ticketbot_discord_connected`, `_discord_ping_seconds` | Connection to Discord |
| `ticketbot_database_up`, `ticketbot_redis_up` (and `_latency_seconds`) | Database and Redis |
| `ticketbot_jobs{state}` | Scheduled jobs waiting, running, failed |
| `ticketbot_backup_last_success_timestamp_seconds{kind}`, `ticketbot_backup_problems` | [Backups](./backups): last success, check, off-site copy |
| `ticketbot_update_available`, `ticketbot_info{version}` | Version |

Numbers only: no ticket subject, no member name. Values are computed at most every 15 seconds. **Uptime Kuma**: *HTTP(s) - Keyword* monitor on `/metrics`, header `Authorization: Bearer tbm_…`, keyword `ticketbot_discord_connected 1`.

## Privacy

A privacy page is built in (`/confidentialite`, in French) and linked from the sign-in page and the member space: what is stored, why, who can access it, for how long. Give a contact e-mail with `CONTACT_EMAIL`, or replace the page with your own with `PRIVACY_URL`.

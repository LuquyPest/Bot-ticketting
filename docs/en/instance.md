# Instance section

The **instance** is your install: all its **spaces** (one per support team or community), with or without a linked Discord server. It has one owner, and one place to manage it.

## The owner

The **owner of the instance** is the Discord account that owns the bot's application (developer portal → *General Information*). For a team application: the owner and the admins of the team. You can add co-owners with `OWNER_IDS` in `.env`.

- They sign in to the dashboard like everyone, with the [ways to sign in](#ways-to-sign-in) of the instance.
- They are a **founder in every space** of the instance.
- Only they see the list of all spaces at sign-in, get the bot's invite link and reach the **Instance** section (Administration menu, or `/instance`).

## Spaces

A space is where tickets, a team and settings live (up to v3 it was called a « server »). Inviting the bot to a Discord server **creates a space linked to that server, active as soon as the bot arrives**: its database is created, the person who invited the bot becomes its founder and gets a DM with the link to the dashboard. There is no approval step.

::: warning Private bot
In the Discord portal, *Bot* tab, untick **Public Bot**: otherwise anyone can add your bot to their server, and that server would become a space of your instance. `ALLOWED_GUILDS` further restricts the list of accepted Discord servers; a warning shows at start-up if the bot is public without that list.
:::

**Several communities**: a reply template created with the **All spaces** scope (ticket view → Templates) is offered to the staff of each of your spaces, without being copied. The staff uses it, only you edit it; it cannot add a tag, since tags belong to each space.

**A space without Discord**: **Instance → Spaces → Create a space**. It is a support space without a Discord server: tickets by [e-mail](./integrations#tickets-by-e-mail), member space, dashboard, with its own settings, team and journal. Its tickets have no channel (« No channel » format), nothing is ever asked to Discord about it, and the dashboard hides the Discord features there (panels, roles, server health, newsletter, channels). You are its founder; it shows up in **My spaces** whatever the way you sign in.

**Linking or unlinking Discord**: on the row of a space without Discord, the **Link to Discord** button asks for the Discord server ID then gives the bot's invite link, valid for one hour. When the bot arrives, the space becomes the server's: tickets, settings, team and journal are kept, no new space is created. Conversely, **Unlink from Discord** (confirmed by typing the name) keeps the space and all its content: its open tickets go on without a channel, the format switches to « No channel », and the bot leaves the server. Inviting the bot to that server again links it again.

## Pages

| Page | |
|---|---|
| **Overview** | Spaces, open tickets, tickets per day over 30 days, staff, errors of the last 24 hours, table per space |
| **Spaces** | Create, link to Discord or unlink, suspend, reactivate, put in maintenance, delete (its database is erased, the bot leaves the linked Discord server); name or remove founders |
| **Sign-in** | The [ways to sign in](#ways-to-sign-in) to the dashboard: Discord, Google, Microsoft, OpenID Connect, LDAP / AD directory |
| **Health** | Running version and [update](./updates), state of the [backups](./backups#monitoring-and-alerts), Discord connection, database, Redis, scheduled jobs, memory, schema version of each database, **Discord servers** (diagnostic of each, below); demonstration space, [Prometheus metrics](#monitoring-prometheus) |
| **Errors** | Central log of the errors of the bot, the dashboard and browsers, with filters; **alert** by DM (to the owner by default) or webhook beyond a threshold, and when the bot is disconnected from Discord |
| **Log** | Every change made from the section, with its author and the space concerned |
| **Blocks** | IP addresses blocked by the sign-in or API limits, with unblocking |

## Ways to sign in

**Instance → Sign-in** chooses how people sign in to the dashboard. **E-mail address and password** always remain possible: it is the fallback if a provider is down.

| Provider | To set |
|---|---|
| **Discord** | Nothing: it uses the instance's Discord application. **On** for an instance coming from v3 |
| **Google** | Google Cloud console → APIs & Services → Credentials → *OAuth client ID* (Web application): paste the ID and the secret |
| **Microsoft** | Azure portal → Microsoft Entra ID → *App registrations* (Web platform), then *Certificates & secrets*. Directory: `common` (every account), `organizations` (work accounts) or your directory ID |
| **OpenID Connect** | Keycloak, Authentik, Okta, Zitadel…: a display name, the provider address (*issuer*, in `https://`), the ID and secret of a confidential client |

Each provider shows its **redirect address**, to declare as is on its side (`https://your-domain/api/auth/oidc/google/callback`, etc.). Secrets are encrypted in the database, never shown again, and masked in the instance journal.

**Who can sign in this way**: nobody gets an account by signing in; accounts come from [invitations](./team#accounts), from Discord or from the installation. At the first Google, Microsoft or OpenID Connect sign-in, the identity is linked to the account with **the same confirmed e-mail address**, and only if the provider vouches for that address. Otherwise everyone links it themselves from **Profile → Sign-in → Link**, once signed in. Microsoft does not vouch for its accounts' addresses: unless your application returns the optional claim `xms_edov`, everyone links Microsoft from their profile.

**Discord**: turning off the Discord sign-in does not turn off the integration (bot, DMs, channels, panels); the member space also keeps its Discord sign-in for requesters. You cannot turn off the last way to sign in of your own account: first set a password or link another provider in **Profile → Sign-in**.

### LDAP / Active Directory directory

Under the providers, **LDAP / Active Directory directory** lets the staff sign in with **their directory login and password** (a « Continue with… » form on the sign-in page). The **OpenLDAP** and **Active Directory** buttons fill in the usual values.

| Setting | Example |
|---|---|
| **Server address** | `ldaps://directory.example.com:636`, or `ldap://directory.example.com:389` with **StartTLS** ticked: never in clear |
| **Service account** | A read-only account (`cn=datick,ou=services,dc=example,dc=com`) and its password, encrypted in the database and never shown again |
| **Search base** | `ou=people,dc=example,dc=com` |
| **Login attribute** | `uid` (OpenLDAP), `sAMAccountName` (Active Directory) |
| **People filter** | `(objectClass=person)`; for Active Directory, disabled accounts are left out |
| **Allowed group** | Optional: only its members sign in (`member`, `uniqueMember` or `memberUid`) |
| **Authority certificate** | If the directory uses an internal authority. The server certificate is always checked, unless you untick the check (not advised) |

**Test** checks the service account and counts the people found, before saving. At sign-in, the person is looked up with the service account, then their password is checked by the directory itself: Datick does not keep it. As with the other providers, nobody gets an account: the directory account is linked to the account with **the same confirmed e-mail address**, then recognised by its stable identifier (`entryUUID`, `objectGUID`). The account's two-factor authentication applies; 10 failures in a quarter of an hour lock the login.

Founders also import the directory's people as **contacts**, attached to their organisation: **Settings → Backup → Import from another tool → LDAP / AD directory** (instance owner only), with the contacts base and filter set here.

**Sync**: pick a frequency (**every hour**, **every day**, or by hand) and the spaces that receive the contacts; the directory's people become contacts there, and those already imported are **updated** (name, organisation). **Sync now** runs it right away; the date and result of the last sync are shown below.

**Accounts created at sign-in** (off by default): a member of the **allowed group** without an account gets one at their first sign-in, with the directory address (taken as confirmed), and joins the chosen spaces with the **support** role (a founder then gives other rights). An allowed group is required; an address already taken by an account, even unconfirmed, does not get a second one. Each account created is written to the instance journal.

### Mailboxes (Gmail, Microsoft 365)

Below the ways to sign in, **Mailboxes** declares the applications the spaces use to connect their support mailbox [without a password](./integrations#gmail-and-microsoft-365-without-a-password). Each shows its redirect address (`https://your-domain/api/email/oauth/google/callback`, etc.); the secret is encrypted and never shown again.

| Provider | To set |
|---|---|
| **Google** | Google Cloud console: turn on the **Gmail API**, then *OAuth client ID* (Web application). For Google Workspace, audience **Internal**: in *Testing* mode, Google cuts the access after 7 days |
| **Microsoft** | Azure portal → Microsoft Entra ID → *App registrations* (Web platform), delegated permissions of *Office 365 Exchange Online*: `IMAP.AccessAsUser.All`, `SMTP.Send`, plus `offline_access`. Authenticated SMTP must be allowed on the mailbox. Directory: `common`, `organizations` or your directory's ID |

It can be the same application as for signing in to the dashboard, with both redirect addresses declared.

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

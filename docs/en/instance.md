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

## Pages

| Page | |
|---|---|
| **Overview** | Servers, open tickets, tickets per day over 30 days, staff, errors of the last 24 hours, table per server |
| **Servers** | Suspend, reactivate, put in maintenance, delete (the bot leaves the server and its database is erased); name or remove founders |
| **Health** | Running version and [update](./updates), state of the [backups](./backups#monitoring-and-alerts), Discord connection, database, Redis, scheduled jobs, memory, schema version of each database; demonstration server |
| **Errors** | Central log of the errors of the bot, the dashboard and browsers, with filters; **alert** by DM (to the owner by default) or webhook beyond a threshold, and when the bot is disconnected from Discord |
| **Log** | Every change made from the section, with its author and the server concerned |
| **Blocks** | IP addresses blocked by the sign-in or API limits, with unblocking |

## Demonstration

A fictitious server filled with realistic data, open to everyone from the sign-in page (« Discover the dashboard ») or directly at the `/demo` address of your domain. **Off by default**, it is turned on in **Instance → Health**. Isolated from everything else: no DM leaves it, actions towards Discord and the outside are refused, and it is reset every night.

## Privacy

A privacy page is built in (`/confidentialite`, in French) and linked from the sign-in page and the member space: what is stored, why, who can access it, for how long. Give a contact e-mail with `CONTACT_EMAIL`, or replace the page with your own with `PRIVACY_URL`.

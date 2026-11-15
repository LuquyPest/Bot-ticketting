# First steps

The bot has just joined your server and you are signed in to the dashboard as a **founder**. A few settings, and members can open their first tickets.

::: tip Quickest: `/setup` on Discord
The `/setup` command sets the staff roles, the categories (the bot can create them) and a panel in three clicks. Each setting is detailed below.
:::

## 1. Access roles and categories

**Settings → Access and security**:

- **Support roles** and **chief support roles**: Discord members with these roles get a dashboard account when they sign in, with the matching grade (*Support* or *Chef support*, created automatically). If they lose the role, their access is removed.

**Settings → Tickets**:

- **Stage categories**: one Discord category per stage (*Open*, *Waiting*, *In progress*). Changing the stage of a ticket moves its channel.
- **Ticket format on Discord**: one channel per ticket (default, with private threads beyond 500 channels), channels only, or private threads only.

::: warning Bot permissions
The bot needs **Manage Channels** and **Manage Roles** to create private channels and set their access. **Server health** (Configuration menu) checks all its permissions and reports what is missing.
:::

## 2. Ticket subjects

**Settings → General → Ticket subjects**: the list offered to the member as buttons (« Payment », « Account », « Report »…). For each subject, **automatic rules** can add a tag, set a priority or restrict the ticket to a grade. A rule fires on the subject or on keywords of the first message.

## 3. Messages and language

In **Settings → General**:
- **Messages**: welcome message sent by DM when the ticket opens, closing message;
- **Bot language**: language of the messages to members — English, French, Spanish, German, Italian, Portuguese, or automatic (their Discord language);
- **Bot appearance on this server**: nickname and picture of the bot, on this server only.

## 4. The team

- **Team**: the dashboard accounts, their grades, holiday mode and planned absences.
- **Grades**: create custom grades (Helper, Moderator…) and pick their permissions. See [Team and permissions](./team).

## 5. Going further

| Page | For |
|---|---|
| **FAQ** | Answer frequent questions before a ticket is even opened |
| **Fields** | Ask for an order number, an in-game name… when a ticket opens |
| **Forms** | A step-by-step questionnaire before the ticket is created |
| **Panels** | Post a message with buttons in a channel to open a ticket without going through DMs |
| **Tags** and **Roles** | Sort tickets, and reserve some tags to part of the team |
| **Settings → Channels** | Keep track of openings, closings and escalations in channels; public statistics |
| **Settings → Access and security** | Enforce 2FA, sign out after inactivity, see the backup key (owner) |

## 6. Test

Send a direct message to the bot from an account that is not staff: the ticket must show up in **Tickets** and in the *Open* category of your server. Reply from the ticket view: the reply arrives by DM.

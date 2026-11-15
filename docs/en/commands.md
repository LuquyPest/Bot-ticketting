# Discord commands

Commands are for the staff, on an active server. They follow the same rules as the dashboard: the account must be *support* or *founder*, a *support* needs the grade permission shown, and in the channel of a restricted ticket, only those who can see it can act. Founders have every right. Command names and replies are in French.

## Setting up the server: `/setup`

For **founders** (and the owner of the instance), visible to members who have *Manage Server*. A three-step wizard, in a message only you can see:

1. **Staff roles**: support roles and, optionally, chief support;
2. **Categories**: one per stage (*Open*, *Waiting*, *In progress*), existing ones or **created by the bot**, hidden from everyone but the staff;
3. **Panel**: a message with an « Open a ticket » button in the chosen channel, or nothing.

The settings go through the same checks as the dashboard and show up in **Settings → Backup → History** (source « /setup wizard »). The rest — subjects, messages, grades, FAQ — is set in the dashboard.

## In a ticket

| Command | Permission | Effect |
|---|---|---|
| `/reply` | `reply_ticket` | Replies to the member under your name (text and/or file) |
| `/areply` | `reply_ticket` | Replies anonymously, shown as « Support » |
| `/template` | `reply_ticket` | Sends a reply template (autocomplete, the subject's templates first); applies its actions if it is a macro |
| `/note` | `reply_ticket` | Adds an internal note, never sent to the member |
| `/claim` · `/unclaim` | `claim_ticket` | Adds yourself to the assignees, or removes yourself |
| `/priority` | `reply_ticket` | Low, Normal or Urgent |
| `/moveticket` | `reply_ticket` | Changes the stage: Open, Waiting, In progress (the channel changes category) |
| `/rename` | `reply_ticket` | Changes the title — the channel always carries the same name |
| `/adduser` · `/removeuser` | `manage_participants` | Adds or removes a participant, told by DM |
| `/vocal` | `reply_ticket` | Opens (or closes) the ticket's temporary voice channel |
| `/merge` | `close_ticket` + `reply_ticket` | Merges the ticket into another open ticket of the same member |

Channel buttons: **Transcript** needs `view_transcripts`, **Close** needs `close_ticket`.

## Elsewhere on the server

| Command | Permission | Effect |
|---|---|---|
| `/contact` | `create_ticket` | Opens a ticket to contact a member (message, optional subject) |
| Right-click a message → *Apps* → **Créer un ticket** | `create_ticket` | Turns a message from a public channel into a ticket with its author |
| `/reopen` | `close_ticket` | Reopens a member's last closed ticket |
| `/oldtickets` | `view_tickets` | Paged history of a member's tickets |
| `/gettranscript` | `view_transcripts` | Temporary link (10 minutes) to a transcript |
| `/blacklist` | chief support or founder | Add, remove, list the members blocked on this server |
| `/staffstats` | chief support or founder | Detailed statistics per staff member |

::: tip Hiding the right-click
Discord shows « Créer un ticket » to everyone. To reserve it to the staff: Server Settings → *Integrations* → your bot → *Créer un ticket* → allowed roles.
:::

## For members

| Command | Effect |
|---|---|
| `/mestickets` (in DM with the bot) | The state of their open tickets on every server — also through the **My tickets** button of the DMs |

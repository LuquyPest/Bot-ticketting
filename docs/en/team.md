# Team and permissions

## Accounts

| Role | Access |
|---|---|
| **New** | Waiting page, no access, until a grade is given to them |
| **Support** | The dashboard, limited to the **permissions of their grades** — without a grade, no rights |
| **Founder** | Everything, on their server: settings, team, blacklist, transcripts, API keys… |

The **founder** of a server is the person who invited the bot (failing that, the owner of the server); they can name others. The **owner of the instance** is a founder on every server.

**Access through a Discord role**: members who have a *support* or *chief support* role chosen in **Settings → Access and security** get an account when they sign in, with the associated grade. They lose it with the Discord role (checked at sign-in then every 5 minutes). Accounts managed by hand in **Team** are never touched by this sync.

At sign-in, a staff member with access to only one server lands straight on its dashboard.

**Inviting by e-mail**: **Team → Management → Invite by e-mail**, with the role (*Support* or *Founder*) and, for support, a grade, since without a grade they have no rights. The person gets a link valid for **7 days**, usable **once**:
- without an account, they create one (name and password), the address being confirmed by the link;
- with an account that already uses this address, they sign in first, then come back to the invitation;
- already signed in, that account joins the team.

The invitation leaves through the [instance e-mail](./instance), which must be set up. The list shows pending, accepted, revoked and expired invitations; **Revoke** cancels a link not used yet, and inviting the same address again replaces the pending invitation. Only a founder invites a founder; a member with the `manage_users` permission invites to the support role, with a grade whose permissions they already hold. An invited member is managed by hand: the Discord role sync never removes them.

## Grades

A grade is a set of permissions. Every action of the dashboard and of the Discord commands is checked on the server side.

| Permission | Allows |
|---|---|
| `view_tickets` | Seeing tickets, notes, history, search, notifications |
| `reply_ticket` | Replying, noting, scheduling, renaming, changing the stage or subject, tags |
| `claim_ticket` | Taking or releasing a ticket |
| `close_ticket` | Closing or reopening a ticket |
| `manage_participants` | Adding or removing participants |
| `create_ticket` | Opening a ticket for a member |
| `view_transcripts` | Reading transcripts |
| `manage_users` | Giving grades (not to oneself, nor a grade more powerful than one's own), inviting to the support role |
| `manage_grades` | Creating and editing grades, restricting who can see a ticket |
| `manage_settings` | Tags, FAQ, fields, checklists, incidents, server health |
| `view_audit` | Reading the log |

A grade can have a **parent**: members of the parent also see what the child grades see. A ticket **restricted to a grade** is only visible to that grade, its parents and the founders — on Discord too, where its channel is closed to the others.

## Roles tied to tags

**Roles** (founders): groups of staff members, tied to one or more **tags**. A ticket carrying one of these tags is only visible to the members of the role and to the founders, everywhere: list, ticket view, search, statistics, notifications, Discord commands, ticket channel. Useful for an Accounting, Moderation or Partnerships team…

## Teams and their queues

**Team → Teams** (founders) groups the staff into teams (« Billing », « Tech »…), up to 30:

| Setting | |
|---|---|
| **Members** | The space's staff who are part of it (a person can be in several teams) |
| **Subjects and tags** | A new ticket of one of these subjects, or carrying one of these tags (set by [subject rules](./tickets) or by an [e-mail address](./integrations#tickets-by-e-mail)), goes to the team |
| **Assignment** | *None*: the ticket waits in the team's queue. *In turn*: each member in turn. *By load*: to the member with the fewest open tickets |
| **Cap** | Open tickets per person at most; beyond it, the next one is chosen (0 = no cap) |

Automatic assignment skips members who are **away** or **on holiday**, those who **cannot see** the ticket (grade, roles tied to tags) and those at the cap; if nobody is available, the ticket stays in the team's queue. **Confidential** tickets are never routed. The assignment is noted in the ticket's journal and the person is told as for a manual assignment.

Each member finds the tickets of their teams in **My queue → My teams**. The ticket view shows its team and lets you change it (assign permission): giving the ticket to a team that assigns hands it right away to one of its members if nobody has it. The ticket list filters by team or « No team ». Deleting a team leaves its tickets, without a team.

## Two-factor authentication

- Everyone can turn on **2FA** (TOTP app) in their **Profile**, with 10 backup codes.
- A founder can **enforce** it for founders or for all the staff (**Settings → Access and security**).
- **Sign-out after inactivity**, adjustable (15 minutes to 8 hours).
- A sign-in from a **new device** sends a DM to the account holder.

## Day-to-day organisation

- **Availability** (available, busy, away) under one's name in the menu, **holiday mode** and **planned absences** (Profile for oneself, Team for others).
- **My activity**: one's figures over 7, 30 or 90 days compared with the team.
- **Analytics**: volume, response times, satisfaction, period comparison, reopenings, time spent, [reports](#reports), CSV exports and a monthly PDF report.

## Reports

**Analytics → Reports** groups the tickets opened over the period (7, 30, 90 or 365 days):

| Group | |
|---|---|
| **By team** | The [teams](#teams-and-their-queues), plus « No team » |
| **By category** | The subject's category: a sub-category (« Billing › Refund ») counts in its category |
| **By subject** | The full subject, sub-category included |
| **By channel** | Discord, e-mail, or web (member space and widget) |

For each group: tickets opened, closed, still open, median first response time, median time to close, average rating (and number of ratings), time spent. **Export (CSV)** downloads the same table, ready for a spreadsheet. The figures only count the tickets the person may see: a confidential ticket or one restricted to a grade stays out for the others; tickets merged into another are counted once.
- **Public statistics**: a message refreshed every hour in a channel of your choice — see [Automations](./automations#public-statistics).
- **Log**: every action, with its author and its source (dashboard, Discord, automation, API), filterable and exportable.

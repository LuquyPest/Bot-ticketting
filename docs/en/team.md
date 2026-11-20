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
| **Internal objective (OLA)** | The time the team gives itself for a ticket, counted **from when it came to the team**, in business hours of its hours, paused while waiting for the requester; with its escalation levels (for example « at 100 %, hand to the Level 2 team ») |

Automatic assignment skips members who are **away** or **on holiday**, those who **cannot see** the ticket (grade, roles tied to tags) and those at the cap; if nobody is available, the ticket stays in the team's queue. **Confidential** tickets are never routed. The assignment is noted in the ticket's journal and the person is told as for a manual assignment.

### Support levels and escalation

A team can have a **level** (1, 2, 3…: *Level* in its settings). On an open ticket, **Escalate to level N** (assign permission) hands it to the team of the **next level** — the lowest one above its team's; a ticket without a team, or whose team has no level, goes to the lowest level. A **reason** is asked for: it is written as an internal note and in the log. The assignees let go of the ticket (unless **Keep the assignees**), and the new team assigns it as it usually does. A [rule](./automations#automatic-rules) can escalate too (**Escalate to the next level** action). A confidential ticket never changes team.

In **Analytics → Reports**, the **Escalated** column counts, by team, the tickets it sent up and their share; for the other groupings, the tickets escalated at least once. It is in the exports.

### Skills and languages

**Team → Skills**: the founders create the skills of the space (« Network », « Accounting »…) and say who has which; everyone gives the **languages** they answer in. A ticket **asks for** skills: those of its **subject** (set further down on the same page; a category covers its sub-categories), those a [rule](./automations#automatic-rules) adds (**Skill asked for** action, to put before the **Team** action) and those added on the ticket view (**Reply** permission).

A team that assigns by itself first picks among the members who have **all** the skills asked for, then among them those who **speak the requester's language** (that of their messages, when the bot answers everyone in their own language). If nobody fits, the whole team stays possible, as before. Skills and subjects are part of the [configuration export](./integrations#backing-up-the-configuration); who has which skill stays specific to the space.

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

## Dashboards

**Boards** menu: everyone builds their **dashboards** out of **widgets** — a **counter** (open tickets, open and unassigned, my tickets, created or closed over the period, SLA objectives breached, waiting for the requester), a **curve** of tickets created and closed per day, a **list** of open tickets (urgent first), the rate of **SLA objectives met**, **satisfaction** (average, share of 4 or 5, distribution). Each widget has its **filters**: team, organisation (sub-organisations included), priority, period.

A board is **personal**, **shared with a team** you belong to, or (founders) **with all the staff**; only its author changes it. Figures are always computed for **whoever looks**, through what they are allowed to see: the same shared board does not show a confidential ticket to someone who cannot see it.

## Reports

**Analytics → Reports** groups the tickets opened over the period (7, 30, 90 or 365 days, or a **custom period** from … to …):

| Group | |
|---|---|
| **By team** | The [teams](#teams-and-their-queues), plus « No team » |
| **By category** | The subject's category: a sub-category (« Billing › Refund ») counts in its category |
| **By subject** | The full subject, sub-category included |
| **By channel** | Discord, e-mail, or web (member space and widget) |
| **By type** | Incidents and requests, if the space uses [types](./tickets#types-incident-or-request) |
| **By organisation** | The requesters' [organisations](./tickets#organisations), plus « No organisation » |
| **By person** | The first assigned person, plus « Unassigned » |
| **By priority** | Low, normal, urgent |

For each group: tickets opened, closed, still open, median first response time, median time to close, average rating (and number of ratings), time spent. The same table downloads as **CSV**, **XLSX** (Excel, LibreOffice, Numbers workbook) or **PDF**. **Scheduled reports** (founders and the **Audit log** permission) send it by e-mail **every Monday** or **on the 1st of the month**, at the chosen time, attached; computed with what their author sees; founders send them to any address, the others to their own verified address. The figures only count the tickets the person may see: a confidential ticket or one restricted to a grade stays out for the others; tickets merged into another are counted once.
- **Public statistics**: a message refreshed every hour in a channel of your choice — see [Automations](./automations#public-statistics).
- **Log**: every action, with its author and its source (dashboard, Discord, automation, API), filterable and exportable.

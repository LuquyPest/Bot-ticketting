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
| `manage_users` | Giving grades (not to oneself, nor a grade more powerful than one's own) |
| `manage_grades` | Creating and editing grades, restricting who can see a ticket |
| `manage_settings` | Tags, FAQ, fields, checklists, incidents, server health |
| `view_audit` | Reading the log |

A grade can have a **parent**: members of the parent also see what the child grades see. A ticket **restricted to a grade** is only visible to that grade, its parents and the founders — on Discord too, where its channel is closed to the others.

## Roles tied to tags

**Roles** (founders): groups of staff members, tied to one or more **tags**. A ticket carrying one of these tags is only visible to the members of the role and to the founders, everywhere: list, ticket view, search, statistics, notifications, Discord commands, ticket channel. Useful for an Accounting, Moderation or Partnerships team…

## Two-factor authentication

- Everyone can turn on **2FA** (TOTP app) in their **Profile**, with 10 backup codes.
- A founder can **enforce** it for founders or for all the staff (**Settings → Access and security**).
- **Sign-out after inactivity**, adjustable (15 minutes to 8 hours).
- A sign-in from a **new device** sends a DM to the account holder.

## Day-to-day organisation

- **Availability** (available, busy, away) under one's name in the menu, **holiday mode** and **planned absences** (Profile for oneself, Team for others).
- **My activity**: one's figures over 7, 30 or 90 days compared with the team.
- **Analytics**: volume, response times, satisfaction, period comparison, reopenings, time spent, CSV exports and a monthly PDF report.
- **Public statistics**: a message refreshed every hour in a channel of your choice — see [Automations](./automations#public-statistics).
- **Log**: every action, with its author and its source (dashboard, Discord, automation, API), filterable and exportable.

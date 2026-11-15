# Tickets

## Member side

1. The member sends a **direct message** to the bot. If they already have open tickets, the bot asks which one the message is for, or whether to open a new one.
2. If they are on several servers using the bot, they pick the server.
3. If the **automatic FAQ** recognises their question, the bot offers up to three answers; « Open a ticket anyway » stays possible.
4. The bot asks for the **subject** (buttons, or free text), then the **custom fields** and the **form**, if any. Without an answer within 10 minutes, the ticket opens without a subject. These conversations are kept in Redis: a restart loses nothing.
5. The ticket is created: a private channel (or thread), named after the subject. The member's next messages are relayed there.
6. Staff replies arrive by DM, with the server and the ticket number as a header, and a **Close my ticket** button.
7. When it closes: a 1 to 5 star **rating**, an optional comment, and a **Reopen my ticket** button for a few days (7 by default). A low rating alerts the founders and chief support.

The member can also open a ticket from a button **panel** posted in a channel, or from the web [member space](./member-space). A member blacklisted on a server cannot open a ticket there.

::: info Confidential request
When picking the subject, the member can ask for a **confidential** ticket (reporting a staff member, harassment…). Only the **founders** see it, everywhere: list, ticket view, search, statistics, notifications, Discord channel closed to the staff before the first message. Each view is written to the log.
:::

**Language**: the bot's messages follow the server setting (**Settings → General → Bot language**) — English, French, Spanish, German, Italian, Portuguese, or **automatic**: the member's Discord language if it is one of these, English otherwise. Custom texts (welcome, closing, FAQ) and staff replies stay as written.

## Staff side

- **Reply** from the ticket view in the dashboard (with a file up to 8 MB, or a pasted screenshot), with `/reply`, or anonymously with `/areply` (shown as « Support »). A message typed directly in the Discord channel stays an internal note, never sent to the member.
- **Contact a member** yourself: **New ticket** button on the Tickets page, `/contact`, or right-click a message → *Apps* → *Create a ticket*.
- **Ticket format**: one channel per ticket, with overflow categories beyond 50 channels and private threads beyond 500; or channels only; or private threads only.
- **Temporary voice channel** (**Voice** button or `/vocal`), reserved to the member and the staff who can see the ticket, deleted when it closes.
- **Close** from the channel or the dashboard: the transcript is generated automatically.

## The ticket view

| | |
|---|---|
| **Real time** | New messages without reloading; colleagues looking at the ticket or typing a reply shown live; confirmation if someone replied while you were typing |
| **Replies** | *Reply* or *Internal note* mode, anonymous or signed, preview of the Discord rendering, drafts kept when you change page, edit or withdraw a reply already sent |
| **Templates and macros** | Ready replies with variables (`{{username}}`, `{{ticket_id}}`, custom fields…), suggested by subject; for you, for the server's staff, or — owner of the instance — for **all your servers** at once; a macro also applies actions (assign yourself, priority, tag, stage, close) |
| **Organisation** | Assignment to several people, priority, stage, tags, title (the Discord channel follows), participants, linked tickets, merging two tickets of the same member |
| **Follow-up** | Follow a ticket without being in charge, personal reminders (« Remind me »), `@name` or `@grade` mentions in notes, pinned notes |
| **Help** | Similar tickets already solved with their answer, per-subject checklists, member profile (labels, history, staff thread) |
| **Time** | Per-ticket timer and time added by hand, per-stage deadline (SLA) with time left and an « Overdue » alert |

## The ticket list

- **Views**: Open, My tickets, Unassigned, Followed, Waiting, In progress, Urgent, Overdue, Closed, All — and your own saved views.
- **Search** in subjects with combinable operators: `tag:VIP`, `from:name`, `before:2026-10-01`, `after:2026-10-01`, `stage:waiting`, `priority:urgent`, `status:closed`, `assignee:me`, `subject:"password"` (the French forms work too). Switch to **Messages** to search the whole text of the conversations.
- **Bulk actions**: priority, stage, tags, assignment, template, closing — each according to your permissions.
- **Split view** (Profile → Display): the list on the left, the ticket on the right, on a screen at least 1,280 px wide.
- **My queue**: your tickets from most to least urgent, with the reason; **Kanban**: tickets in columns by stage.

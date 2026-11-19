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

### Categories and sub-categories

Subjects are arranged in **categories** and **sub-categories** (**Settings → General → Ticket subjects**): « Billing », then « Billing › Refund », « Billing › Plan change »… Two levels, up to 60 subjects; the subjects already there are categories. On Discord, the member picks the category, then the sub-category (or « other request » in the category); the member space and the widget list them with their path.

A sub-category **inherits** what is set on its category: subject rules, custom fields, intake form, procedures, suggested templates, incidents, team. What is set on the sub-category applies to it only. Each subject can have a **deadline**: it replaces that of each stage that has one (a stage without a deadline stays without), the sub-category taking its category's when it has none of its own.

## Staff side

- **Reply** from the ticket view in the dashboard (with a file up to 8 MB, or a pasted screenshot), with `/reply`, or anonymously with `/areply` (shown as « Support »). A message typed directly in the Discord channel stays an internal note, never sent to the member.
- **Contact a member** yourself: **New ticket** button on the Tickets page, `/contact`, or right-click a message → *Apps* → *Create a ticket*.
- **Ticket format**: one channel per ticket, with overflow categories beyond 50 channels and private threads beyond 500; or channels only; or private threads only; or **no channel**: tickets live only in the dashboard (the staff replies there, members carry on by DM or in the member space, the transcript comes from the history) — handy for a small server or a staff that only works on the web.
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
| **Help** | Similar tickets already solved with their answer, per-subject checklists, the requester's [contact card](#contacts) (labels, history, staff thread) |
| **Time** | Per-ticket timer and time added by hand, per-stage deadline (SLA) with time left and an « Overdue » alert |

## Types: incident or request

In **Settings → General → Types of tickets**, a space can tell **incidents** (something no longer works) from **requests** (someone asks for something: an access, equipment, information), and rename them (« Outage », « Order »…).

- **At the opening**, the type comes from the **subject** (set per subject; a sub-category takes its category's when it has none), otherwise it is a request. The [API v3](./integrations#public-api) can give it.
- The staff **changes it from the ticket view** (reply permission), in the log. The list **filters by type**, and [Analytics → Reports](./team#reports) groups **by type**.
- Turned off, only requests exist and no screen shows the type. An existing space keeps it off until it is turned on; a new space has it on.

## Resolution and closing

In **Settings → General → Resolution and closing**, a space **resolves before closing**:

1. The staff clicks **Resolve** (ticket view → Actions, close permission) and writes the **solution**. It goes to the requester on their channel; the ticket stays open, marked **Solved, waiting for the requester**, and its deadline (SLA) stops, as do the inactivity reminders.
2. The requester **confirms**: **It's solved** button in DM, banner of the [member space](./member-space), or a **single-use link** received by e-mail (it shows only the solution). The ticket closes as usual: transcript, rating request.
3. If they **write anything** (DM, reply to the e-mail, message on the web, **Not yet** button), the ticket **goes on**, with their message.
4. **Without an answer**, the ticket closes on its own after the set delay (7 days by default, 0 = never).

The staff can **cancel the resolution**. Every step is in the log. An existing space closes as before until it turns it on; a new space has it on. The [API v3](./integrations#public-api) can also propose a solution (`POST /tickets/:id/resolve`).

## Priority: urgency × impact

In **Settings → General → Priority: urgency × impact**, the priority is **computed**: the **urgency** (for the requester) and the **impact** (how many people, how serious), each from *Very low* to *Very high*, give through an adjustable **matrix** one of **6 levels**: Very low, Low, Medium, High, Very high, Major. On the ticket view, set urgency and impact, or **force** a level (*Major* is picked this way).

The **3 priorities** of before (low, normal, urgent) stay and follow the level: Very low and Low = low, Medium = normal, High and above = urgent. What uses them does not change (`/priority` on Discord, macros, subject rules, API v1 and v2, queue order); set the old way, they move the level (low → Low, normal → Medium, urgent → High) unless it is already in the right band. The [API v3](./integrations#public-api) accepts `urgency`, `impact` and `priority_level`. Off on an existing space until turned on; on for a new space.

## Opening hours

**Settings → Hours**: the support's **calendars**. Without a calendar, the support is open all the time (as before).

| Setting | |
|---|---|
| **Hours** | Per day of the week, up to 4 ranges (« 9:00 – 12:00, 14:00 – 18:00 »); a day without a range is closed |
| **Time zone** | The hours' time zone (`Europe/Paris`, `America/Montreal`…), daylight saving included |
| **Closed days** | The **public holidays** of a country (France, Belgium, Switzerland, Luxembourg, Canada, United States, United Kingdom, Germany), computed for this year and the next, Easter and Ascension included; **closing periods** (from … to …); each can be edited or removed |
| **Outside the hours** | A ticket opened while closed gets « the support is closed, we will answer as soon as we reopen, *Monday 9:00* », in the requester's language (or your own message) |

The space picks its calendar; a **team** can have its own (**Team → Teams → Hours of the team**), which applies to its tickets. The page shows live whether the support is open and when it reopens. Deadlines in business hours rely on these calendars.

## SLA objectives

**Settings → Hours → SLA objectives**: two deadlines per ticket, counted in business hours of its team's calendar (else the space's) or in full hours.

| Objective | |
|---|---|
| **First response** | Until the staff's first reply |
| **Resolution** | Until closing (or the proposed solution); **paused** while the ticket waits for the requester (« Waiting » stage) |

An objective applies to the tickets that meet **all** its criteria: priorities, types, subjects (a category covers its sub-categories), channels (Discord, e-mail, web); an empty criterion takes them all. When several fit, the **most precise** wins, then the first in the list (arrows for the order). Changing the priority, subject, type, team or a calendar recomputes the deadlines of open tickets.

The ticket view shows both deadlines (on time, due soon, breached, met, missed, paused); the list flags a breached objective and the **SLA breached** filter finds it; reports by subject, team or type give the **rate of met objectives** (and the CSV export). The per-stage delays (**Settings → Tickets**) stay separate.

### Escalation

Each objective has up to 6 **escalation levels**, at a share of its deadline (50 % = halfway, 100 % = the deadline, 150 % = overdue by half). A level reached takes one or more actions:

| Action | |
|---|---|
| **Notify** | Notification (dashboard and browser) to the assigned people, else the team, else the founders; only those who can see the ticket |
| **Raise the priority** | Low → normal → urgent |
| **Hand to a team** | The ticket changes team (never a confidential ticket); a team that assigns gives it to one of its members |
| **Watcher** | Adds staff members to the ticket's followers |
| **Escalation channel** | An alert in the Discord escalation channel (without the subject of a confidential ticket) |

The check runs every 5 minutes; each level plays **only once** per ticket, and it is noted in its journal. A paused resolution does not escalate. Teams also have their **internal objective** (OLA), with its own levels: see [Team](./team#teams-and-their-queues).

## Statuses

An open ticket is in a **status**: **Open**, **Waiting** or **In progress** by default. In **Settings → Tickets → Statuses**, a founder adds others of the space's own (« Waiting on supplier », « To approve »…), up to 20:

| Setting | |
|---|---|
| **Name and colour** | Shown everywhere: ticket view, Kanban (one column per status), list and filters, queue, journal, analytics |
| **For the requester** | The built-in status they see instead (Open, Waiting or In progress): in the member space, `/mestickets` and the stage-change DM. The internal name is never shown to them |
| **Discord category** | The ticket's channel moves there (as for the built-in statuses); without a category, only threads and tickets without a channel can enter it |
| **Deadline (SLA)** | Maximum time in this status before « Overdue », 0 = none; counted in the analytics and the monthly report |

The status changes from the ticket view, in bulk from the list, through a macro, or on Discord with `/moveticket` (the space's statuses are offered). The order is set with the arrows. **Deleting** a status puts its tickets back in its built-in status, without moving their channel. Every change is in the journal.

## Approvals

A ticket can ask for **a person's approval** before it moves on (a refund, an exceptional access…): **ticket view → Approval → Ask for an approval** (reply permission).

| | |
|---|---|
| **Who approves** | A **staff** member (told in the dashboard, by push notification and DM, and answers from the ticket view), or **someone by e-mail** (a manager outside the team: they get a link, valid 14 days and single-use, showing only the request, never the conversation) |
| **What is asked** | Free text, and optionally the **status** the ticket moves to once approved |
| **Answer** | **Grant** (the ticket moves to the chosen status) or **Refuse** (it stays where it is), with an optional comment. One answer only; the person who asked is told |
| **Reminder** | **Remind** by hand, once an hour at most; automatic reminder after 24 h without an answer, three times at most (by e-mail, with a new link: the old one stops working) |

One pending approval per ticket; the person who asked, or a founder, can **cancel** it. Every step is a note in the ticket and a line of its journal. A **confidential** ticket is approved only by a founder, never by e-mail. Approval by e-mail uses the [e-mail of the instance](./instance#e-mail-of-the-instance), up to 10 sends (requests and reminders) per hour per person, 30 per space.

## Contacts

**Contacts** (Support menu): one card per person, whatever the channel. Each card gathers their **identities**: their Discord account, their address for [tickets by e-mail](./integrations#tickets-by-e-mail), later the web portal. Cards are created on their own from the tickets, nothing to type in.

- **The card**: every ticket of its identities, the average rating they give, the time spent, the custom fields, the blacklist, the labels (*VIP*, *to watch*…) and the staff's discussion about them. A name, an address and free notes (company, phone, context) are edited on the card.
- **Merging**: when `@username` on Discord and `marie@example.com` are the same person, look for the other contact from the card then merge. The identities, the discussion and the labels join the card that is kept; the tickets do not move.
- **Detaching** an identity, to undo a merge by mistake: it gets a card of its own again. The primary identity (the one the card was created for) stays.
- **Confidentiality**: a card shows each person only the tickets they may see, figures included; a ticket restricted to a grade or confidential does not show for the others.
- **Rights**: reading needs `view_tickets`; editing, merging and detaching need `reply_ticket`. Every merge and every detach is written to the log.
- **Erasing a member's data** (GDPR) also removes their identity from their card, and the card if it has no other one.

## Retention, archives and personal data

**Settings → Tickets → Retention and archives** (founders):

- **Tickets closed for more than N months** (1 to 240): **kept** (default), **anonymised** or **deleted**, every night. Anonymising removes the requester, the subject, the content of the messages, the transcripts, the attachments, the copies, the custom fields, the rating comment and the survey answers (its links are closed); the dates, status, type, team, assignees, times and costs stay, so the statistics keep their meaning. Deleting erases the ticket and everything attached to it. The setting shows how many tickets are concerned today; **Apply now** handles them right away, by batches (after a confirmation). Every night, retention handles what is due, up to 5,000 tickets; each run is written to the log.
- **Archive the tickets closed for more than M months** (0: never): they leave the default ticket list, but a **search** always finds them, and the **Archives** filter (« With the archives », « Archives only ») shows them.

**Member data** (founders) takes a **Discord ID** or an **e-mail address**: the address finds the requester's identities (e-mail, web, and Discord through their contact card). The JSON **export** covers every identity of the contact card; **erasure** is done identity by identity; for a requester by e-mail or on the web, it also removes their address from the address book, the copies on other people's tickets and the quarantine.

## Tasks

On the ticket view, **Tasks** splits a ticket's work into steps: a title, a description, a **person** (told in the dashboard) or a team, a **planned duration**, a **planned date**, a state (**to do**, **done**, **not needed**), and **visible to the requester** or not (**Reply** permission to change them). The progress (« 2/3 ») does not count the tasks not needed.

The **time spent** goes to a task: the stopwatch of a task, or time added by hand choosing it; it also counts for the ticket. Deleting a task leaves its time on the ticket.

**Task templates** (**Settings → Catalogue → Task templates**; « new employee » = 6 tasks) are applied from the ticket view or by an [automatic rule](./automations#automatic-rules) (**Task template** action); each task can have a « D+n » due date. In the [member space](./member-space), the requester sees the visible tasks and their state, never who handles them. Each addition, state and deletion is in the ticket's journal.

### Planning

**Planning** menu: the week of a person or a team: the **planned tasks**, the **resolution deadline** of assigned tickets (in red), the **absences**. You see your own planning and your teams' (a founder sees everyone), always through what you are allowed to see. **Dragging a task** onto another day reschedules it, at the same time.

**In my calendar (iCal)** gives a secret link to add to Google Calendar, Outlook or Calendar: your planned tasks, your tickets' deadlines and your absences (30 days back, 90 ahead). The link is kept hashed; creating a new one, or removing it, cuts the old one.

### Writing, going fast

The reply and note area has a **formatting bar** (bold, italic, code, link, lists, quote; **Ctrl+B**, **Ctrl+I**, **Ctrl+K**, **Ctrl+E**): the text stays Markdown, which Discord, e-mails and the member space show safely. **?** opens the list of **shortcuts**: on the ticket view, **r** reply, **n** note, **a** assign it to me, **s** change the status, **.** and **,** next or previous open ticket; in the list, **j**/**k** and **Enter**.

In the list, **Columns** chooses what shows (type, team, organisation, last message…), kept for each person. A **saved view** can be **shared with a team** you belong to: its members see it (read only), each with their own rights on the tickets.

### Costs

**Costs** menu (founders and a grade's **See and manage costs** permission): what support costs, to invoice a client or a department.

| | |
|---|---|
| **Time** | The time spent on a ticket (stopwatch and time added by hand), at the hourly rate of the **person**, else of the ticket's **team**, else of the **space** (rates set by the founders) |
| **Fixed amount** | A fixed amount per ticket opened |
| **Costs** | Costs added to a ticket from its view (travel, a part…), in the ticket's journal |

The ticket view shows its cost; the report groups by **organisation**, **ticket**, **person** or **team** over a free period (time counts on its date, costs on theirs, the fixed amount on the opening day), and exports to **CSV**. It only counts the tickets the person can see.

## Problems

**Problems** menu (off by default; a founder turns it on): a **problem** is the common cause of several tickets, ITIL-style but lighter. It has a title, a description, **symptoms**, a **cause**, a **workaround**, a status (**open**, **known error**, **resolved**, **closed**), a person handling it and tasks.

Tickets are linked to it from the problem or from their view (**Reply** permission), only those you can see. On the view of a linked ticket, the workaround is **offered**: **Insert into the reply** puts it into the reply area. **Resolve the problem** records its solution and can **propose it on all its open tickets** at once (like a ticket's [resolution](#resolution-and-closing), the requester confirms). Each creation, link and resolution is in the journal.

## Changes

**Changes** menu (off by default; a founder turns it on): a planned modification (an update, a migration). It has a description, a **deployment plan**, a **rollback plan**, **risks** and a risk level, the impact, a **window** (it shows in the [planning](#planning) of whoever leads it), tasks, and the tickets and problems it deals with.

It follows a flow: **draft** → **waiting for approval** → **approved** (all approvals) or **refused** (at the first refusal, with its reason) → **in progress** → **done** or **failed**; **cancelled** at any time. **Approvals** are given by the chosen staff members, each for themself, in the dashboard; it only starts once approved, and its plans and risks are frozen once it is (going back to draft resets the approvals). Everything is in the journal.

## Satisfaction survey

When a ticket is closed, the requester gets the **satisfaction survey** (**Settings → Tickets → Satisfaction survey**):

| | |
|---|---|
| **When** | At the closing (as before), or 1 h, 4 h, 1 day, 3 days, 1 week after |
| **Which one** | Datick's own: a single-use link to a page (`/enquete`) with the rating out of 5, a comment and up to **5 questions** (rating out of 5, yes / no, text), which works for a Discord, e-mail or web requester; on Discord, the rating buttons stay. Or **a link to your tool** (the ticket number is added to the link) |

The link works once and expires after 30 days; the page only shows the ticket's subject and the questions. **Analytics → Reports** gives the **response rate** and the answers to the questions over 30 days.

## Organisations

**Organisations** menu: the client companies, departments or sites of your contacts (writing: founders and the **Settings** permission; the staff sees the names).

| | |
|---|---|
| **Attachment** | By the organisation's e-mail address **domains** (`acme.com`: every `@acme.com` contact joins it); **by hand** from the contact's card (the domain no longer moves them; « By the domain » goes back to automatic); or by **import** (`name;domains`, one line per organisation). Public mailboxes (gmail.com, outlook.com…) are refused as domains |
| **Sub-organisations** | One level (« Acme » → « Acme Lyon »): what targets an organisation covers its sub-organisations |
| **Hours** | A calendar of its own (its contract), which comes before the team's and the space's for business-hour deadlines |
| **SLA** | An objective with the **organisation** criterion (Settings → Hours → SLA objectives) |
| **Team, manager** | Its tickets go to its team (if neither the subject nor a tag names one); its account manager can be notified (« the organisation's manager » recipient of notifications) |
| **Fields and notes** | Contract, phone… (20 free fields) and internal notes |
| **Portal** | Who sees the organisation's tickets in the [member space](./member-space#the-tickets-of-one-s-organisation): nobody, its managers or all its members |

A ticket keeps its requester's organisation at the opening: it shows on the ticket view, filters the list (**All organisations**), is a condition of [automatic rules](./automations#automatic-rules). Moving a contact moves their open tickets.

## The ticket list

- **Views**: Open, My tickets, Unassigned, Followed, Waiting, In progress, Urgent, Overdue, Closed, All — and your own saved views.
- **Search** in subjects with combinable operators: `tag:VIP`, `from:name`, `before:2026-10-01`, `after:2026-10-01`, `stage:waiting`, `priority:urgent`, `status:closed`, `assignee:me`, `subject:"password"` (the French forms work too). Switch to **Messages** to search the whole text of the conversations.
- **Bulk actions**: priority, stage, tags, assignment, template, closing — each according to your permissions.
- **Split view** (Profile → Display): the list on the left, the ticket on the right, on a screen at least 1,280 px wide.
- **My queue**: your tickets from most to least urgent, with the reason; **Kanban**: tickets in columns by stage.

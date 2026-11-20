# Automations

Every scheduled job goes through **BullMQ** (Redis): each one runs only once, and the schedule survives restarts.

| Automation | What it does |
|---|---|
| **Member inactivity** | Warning, then closing if the member stops answering |
| **Staff inactivity** | Warning, then closing if the staff does not answer |
| **Staff reminder** | DM to the person in charge of a ticket without an answer for N hours (at most once a day) |
| **Escalation** | Alert in a channel, then closing, for urgent tickets without an answer for too long |
| **Per-stage deadlines (SLA)** | Time left shown, ticket « Overdue » beyond it |
| **Scheduled messages** | Sent at a precise date and time |
| **Unanswered questions** | Opens without a subject the ticket of a member who did not answer the subject question |
| **Planned absences** | Holiday mode at the start of the absence, removed at the end |
| **Personal reminders** | Notification, push and DM when due |
| **Weekly report** | Every Monday at 9 am, statistics and ranking in a channel |
| **Monthly report** | On the 1st of the month at 9 am, a PDF of the past month in a channel |
| **Server health** | Every 15 minutes: bot permissions, configured channels and roles; a new problem is reported by DM to the founders |
| **Discord watch** | Alerts the owner if the bot stays disconnected from Discord, then on reconnection |
| **Error alert** | Warns the owner beyond an error threshold |
| **Retention** | Every night, purges old logs and, if `TRANSCRIPT_RETENTION_DAYS` is set, transcripts |
| **Backup** | Every night at 3 am, an encrypted backup of every database ([details](./backups)) |
| **Public statistics** | Every hour, updates the support statistics message in the chosen channel ([details](#public-statistics)) |
| **Backup monitoring** | Every hour: a backup, check or off-site copy that failed or is late → DM to the owner |
| **New versions** | Every day: DM to the owner when a new version is published ([details](./updates)) |

## Automatic rules

**Settings → Rules** (founders, or a grade's **Manage automatic rules** permission): *when* something happens to a ticket, *if* its conditions are met, *then* the rule acts.

| | |
|---|---|
| **When** | A ticket is opened · the requester writes · the staff replies · the status changes · the priority changes (one or more) · **time passes** (see below) |
| **If** (all, or at least one) | Channel (Discord, e-mail, web) · receiving address · type · subject (a category covers its sub-categories) · words in the message · requester (address, domain `@client.com`, name) · priority · status · tag · hours (support open or closed) · requester's language · requester's organisation (an organisation covers its sub-organisations) · **custom field** (its value among the given ones, letter case ignored); each condition can be reversed (« is not ») |
| **Then** | Priority · urgency and impact · type · subject · team · assign to someone · add or remove a tag · status · restrict to a grade · watchers · notify staff members · automatic reply to the requester · internal note · task template · **SLA objective** (kept by the ticket instead of the automatic choice) · webhook · close |

Rules run **in the order** of the list (arrows); **« stop after this rule »** prevents the next ones. Each rule applied is noted in the **ticket's journal** (« rule *VIP customers* applied: priority urgent, tag VIP »). **Test** shows, on an existing ticket, which conditions are met and what the rule would do, without changing anything.

### When time passes

A rule can act **some time after** a moment of the ticket: its opening, its last status change, the requester's last message, the staff's last reply, the last activity; or **before / after an SLA deadline** (first response, resolution). The delay counts in **business hours** of the ticket's calendar (its team's, else the space's) or in full hours.

Examples: « 48 business hours after the staff's last reply, if the status is *Waiting*: automatic reply *Could you try it?* »; « 1 h before the resolution deadline: notify the lead ». The check runs every 5 minutes. A rule plays **only once** per ticket and per moment: a new reply or a new status starts the count again. A paused SLA deadline (waiting for the requester) or one already met triggers nothing.

Since v6, **inactivity** and the **escalation** of urgent tickets are rules too, created at the update with the space's delays and text (in the staff language), with the same effect:

| Rule | When | If | Then |
|---|---|---|---|
| **Inactivity: warning** | 48 h after the **last message** (a ticket without any message is never concerned) | not resolved | automatic reply « inactive for 48 h, closed in 14 h » |
| **Inactivity: closing** | 62 h after the last message | not resolved | close |
| **Escalation: alert** | 24 h after the last activity | urgent priority, **assigned**, not resolved | **message in a Discord channel** (the escalation alert channel, else the log channel) |
| **Escalation: closing** | 72 h after the last activity | urgent priority, assigned, not resolved | automatic reply, then close |

Change their delays, texts, conditions, or turn them off like any rule; a ticket already warned or alerted before the update is not warned again. The channel message accepts `{id}`, `{subject}`, `{requester}` and `{assignee}` (a confidential ticket shows neither requester nor subject there). The **Assigned** and **Resolved** conditions (yes / no) and the **last message** starting point also serve your own rules.

Guards: a change made by a rule does not start the rules again (no loop); 50 actions at most per event; restricting to a grade also needs the **Manage grades** permission; a rule never lifts a confidential ticket, never changes its team and only notifies staff who can see it.

The former **rules by subject and by keywords** (**Settings → Tickets**) are now rules of this engine, with the same effect; their simple form stays, and they run before these at the opening. Rules are part of the [configuration export](./integrations#backing-up-the-configuration) (tags, teams, grades and statuses by name; the people chosen are not exported).

## Recurring tickets

**Settings → Catalogue → Recurring tickets** (founders and the **Settings** permission): tickets opened on their own on a schedule, such as « backup check, every Monday at 9:00 ».

| | |
|---|---|
| **When** | Every day, working days (Monday to Friday), every week (one day), every month (the 1st to the 28th); at a time, in a time zone (daylight saving included) |
| **What** | The ticket's first message, a subject; a **catalogue service** (its template: type, priority, team) or its own type, priority and team |
| **Wait for the previous one** | By default, nothing new opens while the previous ticket of the same recurrence is still open |

The check runs every minute; each due time opens one ticket only. These tickets come from « Recurring ticket · *name* »: nobody is messaged, they follow the rules, the SLA and the notifications like the others, and each opening is in the journal. **Open now** creates one to try it, without moving the next due time.

## Notifications

**Settings → Notifications** (founders): who is told of what, and how. Each notification ties an **event**, **recipients** and **channels**:

| | |
|---|---|
| **Events** | New ticket · requester's message · staff reply · internal note · assignment · status change · closing · SLA objective breached |
| **Recipients** | The assigned person (for an assignment) · the assigned people · the watchers · the ticket's team · the founders · fixed e-mail addresses (an on-call address, a list) |
| **Channels** | Dashboard and browser (live notification and push) · Discord DM · e-mail (the account's verified address, through the instance e-mail) |

By default it is what was sent before: watchers are told of messages, notes and closings in the dashboard; the assigned person in the dashboard and by Discord DM. Nobody is told of a ticket they cannot see, nor of their own action; a confidential ticket gives only its number outside the space. « SLA objective breached » goes out once per ticket and objective.

Everyone sets in **Profile → What notifies me** what reaches them, channel by channel, except the notifications **imposed** by the space.

### Messages sent to the requester

Further down, **Messages sent to the requester**: the automatic messages (ticket created, waiting, in progress, solution proposed, outside the hours, ticket closed…) can be rewritten **in each of the 6 languages**; the requester gets the one in their language, on Discord, by e-mail or on the portal. The variables of the standard text (`{id}`, `{days}`, `{when}`…) stay available, an unknown variable is refused; **Preview** shows the text with sample values. An emptied text goes back to the standard one.

## Public statistics

**Settings → Channels → Public statistics**: pick a channel, and the bot posts there a message updated every hour, with the figures of the last 30 days:

- tickets resolved;
- first response (median), and the share of tickets that got it within the time you set (2 h by default);
- resolution time (median);
- average satisfaction and number of ratings.

The message only holds figures, never a name or a ticket subject, and follows the bot's language on the server. The same message is edited each time; **Publish now** updates it at once. A line without data (no rating yet, for example) is not shown.

## Public status page

**Incidents → Public status page** (founders and the **Settings** permission) publishes a page at `/statut/<space ID>`, readable without an account and without JavaScript:

- the **components** (« Website », « E-mail »…) and their state — operational, degraded, partial outage, major outage, maintenance —, changed by hand;
- their **availability over 90 days**, day by day (a partial or major outage counts as unavailable);
- the **published incidents**: ticking **Publish on the status page** on an incident only shows its title, its message and, once resolved, the resolution message; the other incidents stay internal;
- an **e-mail subscription**: the person confirms through a link (valid 7 days), then gets an e-mail when a published incident starts and when it is resolved, with a link to unsubscribe. The [instance e-mail](./instance) is needed.

The same data exists in JSON: `/api/public/status/<space ID>`. No ticket, requester or note appears there.

## Announcing a known problem

**Incidents** (`manage_settings`): for a known outage, an incident has a title, a message and possibly subjects. While it is open, each new ticket concerned gets this message by DM right after the welcome, and a banner reminds the staff. When it is resolved, the members affected can be told.

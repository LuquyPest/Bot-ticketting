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

## Public statistics

**Settings → Channels → Public statistics**: pick a channel, and the bot posts there a message updated every hour, with the figures of the last 30 days:

- tickets resolved;
- first response (median), and the share of tickets that got it within the time you set (2 h by default);
- resolution time (median);
- average satisfaction and number of ratings.

The message only holds figures, never a name or a ticket subject, and follows the bot's language on the server. The same message is edited each time; **Publish now** updates it at once. A line without data (no rating yet, for example) is not shown.

## Announcing a known problem

**Incidents** (`manage_settings`): for a known outage, an incident has a title, a message and possibly subjects. While it is open, each new ticket concerned gets this message by DM right after the welcome, and a banner reminds the staff. When it is resolved, the members affected can be told.

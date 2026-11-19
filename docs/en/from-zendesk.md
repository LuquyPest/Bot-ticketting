# Coming from Zendesk or Freshdesk

This guide brings the tickets, contacts, organisations and articles of a Zendesk or a Freshdesk into a Datick space. The original tool is not changed.

## What is carried over

| Zendesk / Freshdesk | Datick |
|---|---|
| Ticket and its conversation | Ticket: public messages in the history, private notes as internal notes |
| Requester | Contact, recognised by e-mail address |
| Organisation / company | Organisation, with its domains |
| Solved / closed status | Closed ticket; the others stay open |
| Priority | Low, normal or urgent |
| Help centre article | Knowledge base article, **as a draft** |
| Agents, groups | To recreate: [invitations](./team#accounts) and [teams](./team) |
| Triggers, automations, SLA | To recreate: [rules](./automations) and [SLA objectives](./setting-up-sla) |

## 1. Export

- **Zendesk**: the account JSON export (one object per line) keeps each ticket's conversation (`comments`); a CSV export of the views keeps the tickets without their conversation. Users and organisations export the same way.
- **Freshdesk**: export from the **tickets**, **contacts** and **companies** lists (CSV). The `Contact ID` and `Company ID` columns serve as identifiers; statuses 4 (resolved) and 5 (closed) give closed tickets.
- **Articles**: a JSON or CSV export of the help centre articles (title, content, category). HTML is removed.

Split files over 10 MB or 5,000 rows.

## 2. Import

**Settings → Backup → Import from another tool**, tool **Zendesk** or **Freshdesk**:

1. **Organisations**, then **Contacts**, then **Tickets**, then **Articles**.
2. **Dry run** for each file: the number of rows and the first row as understood. Then **Import**.
3. Review and publish the articles.

A more recent export imports again without duplicates; tick **Update what is already imported** to take changes of status, priority, names or texts.

## 3. Switch over

1. Redirect the support address to [Datick's mailbox](./integrations#tickets-by-e-mail) (Gmail or Microsoft 365 without password, IMAP, or reception by webhook).
2. Replace the old tool's widget with [Datick's widget](./member-space).
3. Requesters find their old tickets in the [member space](./member-space), signed in by their e-mail address.

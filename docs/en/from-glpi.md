# Coming from GLPI

This guide brings the service desk of a GLPI (tickets, users, entities, knowledge base) into a Datick space, without touching GLPI. Count an hour for a first try. The inventory (computers, licences, contracts) is not carried over: Datick sticks to tickets.

## What GLPI notions become

| GLPI | Datick |
|---|---|
| Entity | [Organisation](./tickets), or one space per entity if their teams are separate ([space template](./instance#spaces)) |
| Requester user | Contact, recognised by e-mail address |
| Technician | Staff member ([invitation](./team#accounts), or [directory sign-in](./active-directory)) |
| Technician group | [Team](./team), with its queue and automatic assignment |
| ITIL category | Subject (nested categories keep their tree: « Hardware › Printer ») |
| Incident / request type | Ticket type |
| Urgency × impact → priority | [Priority matrix](./tickets) |
| SLA / OLA | [SLA objectives and escalation](./setting-up-sla) |
| Business rules | [Rules](./automations) |
| Problem, change | Problems and changes (Settings → Features) |
| Catalogue forms | [Service catalogue](./member-space) |

## 1. Prepare the space

1. **Instance → Spaces → Create a space** (or your existing Discord space).
2. **Settings → Tickets**: recreate your **ITIL categories** as subjects, with the same tree.
3. **Settings → Hours**: your calendar (business hours, public holidays), then your [SLA objectives](./setting-up-sla).
4. **Team → Teams**: one technician group = one team.

## 2. Export from GLPI

In each GLPI list, show the useful columns then export as **CSV** (export icon of the search):

| GLPI list | Useful columns | Import kind |
|---|---|---|
| Administration → Entities | Name | Organisations |
| Administration → Users | Login, Name, Email, Entity | Contacts |
| Assistance → Tickets | ID, Title, Status, Priority, Requester (email), Opening date, Resolution date, Entity, Description | Tickets |
| Tools → Knowledge base | ID, Subject, Content, Category | Articles |

GLPI headers are recognised as they are, in English or French, and so is the `;` separator. Statuses 5 (solved) and 6 (closed) give closed tickets.

## 3. Import, in this order

**Settings → Backup → Import from another tool**, tool **GLPI**:

1. **Organisations**, then **Contacts** (attached to their organisation), then **Tickets**, then **Articles**.
2. For each file: **Dry run** first. It counts the rows and shows how it understood the first one; fix the header if a column is missing, then **Import**.
3. Articles arrive **as drafts**: review them in **Knowledge base**, then publish them.

You can import a more recent export again: nothing is duplicated, and **Update what is already imported** takes the changes (see [Coming from another helpdesk tool](./integrations#coming-from-another-helpdesk-tool)).

## 4. Switch over

1. Connect the [support mailbox](./integrations#tickets-by-e-mail) to Datick: requesters' answers reach their tickets.
2. Give requesters the address of the [member space](./member-space): they find their tickets taken from GLPI there, by their e-mail address.
3. Keep GLPI read-only while you check, then turn its service desk off.

# Setting up an SLA

An SLA, here, means **deadlines met or not** on each ticket: first response and resolution. This guide sets them up step by step; the detail of each setting is in [Tickets → SLA objectives](./tickets#sla-objectives).

## 1. Business hours

**Settings → Hours**: opening days and hours, time zone, public holidays. Deadlines count in these hours: 8 business hours opened on Friday at 5 pm fall on Monday afternoon. A team working other hours has its own (**Team → Teams**).

## 2. The objectives

**Settings → Hours → SLA objectives**. A common example:

| Objective | Criteria | First response | Resolution |
|---|---|---|---|
| Urgent | Urgent priority | 1 h | 8 h |
| Incident | Incident type | 4 h | 3 days |
| Standard | none (all the others) | 1 day | 5 days |

A ticket takes the **most precise** objective that fits it (most criteria met, then the order of the list). Resolution stops while the ticket waits for the requester. For a special customer, a [rule](./automations) can choose the objective: « if the organisation is *Gold Customer*, then SLA objective *Gold contract* ».

## 3. Escalation

In each objective, add **escalation levels**: at 75 % of the deadline, notify the team; at 100 %, raise the priority and add a manager as a watcher; at 150 %, hand the ticket to another team. An **OLA** does the same for a team's internal deadline.

## 4. Follow up

- The ticket view shows both deadlines and their state; the list filters **SLA breached**.
- **Boards**: an « SLA objectives met » widget per team or organisation.
- **Statistics → Reports**: rate met per subject, team, organisation, over the period of your choice, in XLSX or PDF, and scheduled every week by e-mail.
- The [public report](./member-space) can show the share of tickets handled on time.

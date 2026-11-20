// First contact resolution (v7, conception/v7.md §3.8): the share of the closed tickets that were
// solved with a single answer of the staff (a reply or a scheduled message, never an internal note)
// and never reopened. Counted over the tickets closed after at least one answer; merged tickets
// left out. Read by the reports (utils/breakdownReport.js) and the dashboards (utils/dashboards.js).

// Per ticket: its number of staff answers and whether it was reopened
async function perTicket(db, ids) {
  if (!ids.length) return new Map();
  const replies = await db("SELECT ticket_id, COUNT(*) AS n FROM ticket_notes WHERE ticket_id IN (?) AND source IN ('reply', 'scheduled') GROUP BY ticket_id", [ids]).catch(() => []);
  const reopened = await db("SELECT DISTINCT ticket_id FROM audit_log WHERE ticket_id IN (?) AND action = 'ticket_reopen'", [ids]).catch(() => []);
  const r = new Set(reopened.map(x => x.ticket_id));
  const out = new Map(ids.map(id => [id, { replies: 0, reopened: r.has(id) }]));
  for (const x of replies) out.get(x.ticket_id).replies = Number(x.n);
  return out;
}
// { pct, first, answered } over closed tickets (rows with id, status)
async function rate(db, tickets) {
  const closed = tickets.filter(t => t.status === 'closed').map(t => t.id);
  const per = await perTicket(db, closed);
  const answered = [...per.values()].filter(x => x.replies >= 1);
  const first = answered.filter(x => x.replies === 1 && !x.reopened).length;
  return { pct: answered.length ? Math.round((100 * first) / answered.length) : null, first, answered: answered.length };
}

module.exports = { perTicket, rate };

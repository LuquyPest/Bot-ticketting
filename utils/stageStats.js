// Time spent in each stage, rebuilt from the journal (ticket_stage events): a ticket starts in
// "open" at creation, then follows its stage changes until closing (or now when still open).
// Used by the « Qualité » analytics and the monthly report.
const median = arr => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const avg = arr => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

// tickets: [{ id, created_at, closed_at }]; slaMin: { open, waiting, in_progress } in minutes (0 = none)
async function stageCompliance(db, tickets, slaMin, now = Date.now()) {
  const stageStats = { open: [], waiting: [], in_progress: [] };
  const breached = { open: 0, waiting: 0, in_progress: 0 };
  const ongoing = { open: 0, waiting: 0, in_progress: 0 };
  if (tickets.length) {
    const events = await db(
      "SELECT ticket_id, details, created_at FROM audit_log WHERE action = 'ticket_stage' AND ticket_id IN (?) ORDER BY created_at ASC, id ASC",
      [tickets.map(t => t.id)]);
    const byTicket = new Map();
    for (const e of events) {
      if (!byTicket.has(e.ticket_id)) byTicket.set(e.ticket_id, []);
      const d = typeof e.details === 'string' ? JSON.parse(e.details || '{}') : (e.details || {});
      byTicket.get(e.ticket_id).push({ to: d.to, at: new Date(e.created_at).getTime() });
    }
    for (const t of tickets) {
      let stage = 'open', since = new Date(t.created_at).getTime();
      const end = t.closed_at ? new Date(t.closed_at).getTime() : now;
      const close = (until, finished) => {
        if (!stageStats[stage]) return;
        const minutes = Math.max(0, Math.round((until - since) / 60000));
        // Unfinished passages count only once they are over the SLA
        if (finished || (slaMin[stage] && minutes > slaMin[stage])) stageStats[stage].push(minutes);
        else ongoing[stage]++;
        if (slaMin[stage] && minutes > slaMin[stage]) breached[stage]++;
      };
      for (const ev of byTicket.get(t.id) || []) {
        if (ev.at > end || !stageStats[ev.to]) continue;
        close(ev.at, true);
        stage = ev.to; since = ev.at;
      }
      close(end, !!t.closed_at);
    }
  }
  return Object.keys(stageStats).map(key => {
    const list = stageStats[key];
    return {
      stage: key, slaHours: slaMin[key] / 60, measured: list.length, ongoing: ongoing[key],
      avgMinutes: avg(list), medianMinutes: median(list), breached: breached[key],
      compliance: slaMin[key] && list.length ? Math.round(((list.length - breached[key]) / list.length) * 100) : null,
    };
  });
}

module.exports = { stageCompliance, median, avg };

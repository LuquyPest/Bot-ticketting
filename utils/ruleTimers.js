// Rules « when time passes » (v5.2, conception/v5.md §3.8): so long after a moment of the ticket
// (its opening, its last status change, the requester's or the staff's last message, the last
// activity) or before / after one of its SLA deadlines, in business hours of its calendar or in
// full hours. Checked every 5 minutes; each rule fires once per ticket and per moment
// (rule_timer_fired): a new reply or a new status starts the clock again.
const cal = require('./calendars');
const engine = require('./ruleEngine');

const BASIS_SQL = `SELECT t.*,
  (SELECT MAX(n.created_at) FROM ticket_notes n WHERE n.ticket_id = t.id AND n.source = 'user') AS last_member_at,
  (SELECT MAX(n.created_at) FROM ticket_notes n WHERE n.ticket_id = t.id AND n.source IN ('reply', 'web')) AS last_staff_at
  FROM tickets t WHERE t.status = 'open' ORDER BY t.id DESC LIMIT 5000`;

function basisOf(t, basis) {
  const v = { created: t.created_at, stage: t.stage_changed_at || t.created_at, last_member: t.last_member_at, last_staff: t.last_staff_at,
    last_activity: t.last_message_at || t.created_at, last_message: t.last_message_at, tto_due: t.first_response_at ? null : t.tto_due_at, ttr_due: t.resolved_at || t.sla_paused_at ? null : t.ttr_due_at }[basis];
  return v ? new Date(v) : null;
}

// Is the moment reached? after: basis + minutes; before (a deadline): at most `minutes` left
async function due(db, t, timer, now, calCache) {
  const basis = basisOf(t, timer.basis);
  if (!basis) return null;
  let k = null;
  if (timer.businessHours) {
    const key = `${t.team_id || 0}`;
    if (!calCache.has(key)) { const c = await cal.calendarForTicket(db, t); calCache.set(key, c ? cal.asCal(c) : null); }
    k = calCache.get(key);
  }
  if (timer.direction === 'before') {
    if (now > basis.getTime()) return null; // past the deadline: an « after » rule handles it
    const left = k ? cal.businessMinutes(k, now, basis.getTime()) : (basis.getTime() - now) / 60000;
    return left <= timer.minutes ? basis : null;
  }
  const at = k ? cal.addBusinessMinutes(k, basis.getTime(), timer.minutes) : basis.getTime() + timer.minutes * 60000;
  return now >= at ? basis : null;
}

async function runForGuild({ db, client, guildId }, now = Date.now()) {
  const rules = (await engine.listRules(db)).filter(r => r.active && r.triggers.includes('time') && r.timer);
  if (!rules.length) return 0;
  const tickets = await db(BASIS_SQL);
  const calCache = new Map();
  let n = 0;
  for (const t of tickets) {
    for (const rule of rules) {
      const basis = await due(db, t, rule.timer, now, calCache);
      if (!basis) continue;
      // Once per moment, even if two checks run at the same time
      const r = await db('INSERT IGNORE INTO rule_timer_fired (ticket_id, rule_id, basis_at) VALUES (?, ?, ?)', [t.id, rule.id, basis]);
      if (!r.affectedRows) continue;
      const applied = await engine.runRules({ db, client, guildId, ticketId: t.id, trigger: 'time', only: [rule] });
      if (applied.length) n++;
    }
  }
  // Moments long gone: forgotten after 90 days
  await db('DELETE FROM rule_timer_fired WHERE fired_at < NOW() - INTERVAL 90 DAY').catch(() => null);
  return n;
}

async function runRuleTimers(client) {
  const { getActiveGuilds } = require('./guildScan');
  const { getTenantDb } = require('./tenantDb');
  for (const { guild_id } of await getActiveGuilds().catch(() => [])) {
    await runForGuild({ db: getTenantDb(guild_id), client, guildId: guild_id }).catch(err => console.error(`règles temporelles [${guild_id}]`, err.message));
  }
}

module.exports = { basisOf, due, runForGuild, runRuleTimers };

// Planned absences (holidays…): from the start date the staff member is put in vacation mode
// (shown when assigning, left out of the staff newsletter…), and taken out of it at the end
// date — only if the absence is what put them in it. Applied every 5 min (job 'staff-absences')
// and right after an absence is created or removed.
const { broadcast } = require('./sse');
const { recordEvent, SYSTEM } = require('./audit');
const logger = require('./logger');

async function applyAbsences(db, guildId = null) {
  const changes = [];
  // Ended (or ended before it could start, e.g. the bot was offline): vacation mode lifted
  const ended = await db("SELECT * FROM staff_absences WHERE state IN ('planned', 'active') AND ends_at <= NOW()");
  for (const a of ended) {
    await db("UPDATE staff_absences SET state = 'done' WHERE id = ?", [a.id]);
    if (a.state !== 'active') continue;
    const [other] = await db("SELECT 1 FROM staff_absences WHERE user_id = ? AND state = 'active' AND id <> ? LIMIT 1", [a.user_id, a.id]);
    if (a.set_vacation && !other) {
      await db('UPDATE dashboard_users SET vacation_mode = 0 WHERE user_id = ?', [a.user_id]);
      broadcast('availability', { userId: a.user_id, vacationMode: false }, guildId);
    }
    await recordEvent(db, { actor: SYSTEM, action: 'absence_end', targetType: 'user', targetId: a.user_id, details: { from: a.starts_at, to: a.ends_at } });
    changes.push({ id: a.id, userId: a.user_id, state: 'done' });
  }
  const starting = await db("SELECT * FROM staff_absences WHERE state = 'planned' AND starts_at <= NOW() AND ends_at > NOW()");
  for (const a of starting) {
    const [u] = await db('SELECT vacation_mode FROM dashboard_users WHERE user_id = ?', [a.user_id]);
    const setVacation = u && !u.vacation_mode ? 1 : 0;
    if (setVacation) {
      await db('UPDATE dashboard_users SET vacation_mode = 1 WHERE user_id = ?', [a.user_id]);
      broadcast('availability', { userId: a.user_id, vacationMode: true }, guildId);
    }
    await db("UPDATE staff_absences SET state = 'active', set_vacation = ? WHERE id = ?", [setVacation, a.id]);
    await recordEvent(db, { actor: SYSTEM, action: 'absence_start', targetType: 'user', targetId: a.user_id, details: { from: a.starts_at, to: a.ends_at, reason: a.reason || null } });
    changes.push({ id: a.id, userId: a.user_id, state: 'active' });
  }
  return changes;
}

async function runAbsenceCheck() {
  const { getActiveGuilds } = require('./guildScan');
  const { getTenantDb } = require('./tenantDb');
  for (const { guild_id } of await getActiveGuilds()) {
    await applyAbsences(getTenantDb(guild_id), guild_id).catch(err => logger.error('Absences planifiées', { guildId: guild_id, err: err.message }));
  }
}

module.exports = { applyAbsences, runAbsenceCheck };

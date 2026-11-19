// Recurring tickets (v5.3, conception/v5.md §3.12): a ticket opened on its own on a schedule —
// « backup check, every Monday at 9:00 ». Each one has its subject, its first message, an optional
// service of the catalogue (its template: type, priority, team) or its own type, priority and team,
// and can wait until the previous one is closed. Checked every minute (job « recurring-tickets »).
// The requester of these tickets is an identity of their own (« web:<hash> » with no address):
// nothing is ever sent to anyone; the staff sees « Ticket récurrent · <name> ».
const crypto = require('crypto');
const { zoned, validTz } = require('./calendars');

const FREQUENCIES = ['daily', 'weekdays', 'weekly', 'monthly'];
const MAX = 100;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const ownerOf = (guildId, id) => `web:${crypto.createHash('sha256').update(`recurring:${guildId}:${id}`).digest('hex').slice(0, 24)}`;

// Local calendar date and weekday (0 = Sunday) of an instant in a time zone
function localParts(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
// The first run strictly after `after`, in the time zone of the schedule
function nextRun(r, after = Date.now()) {
  const [h, mi] = r.time.split(':').map(Number);
  const start = localParts(after, r.timezone);
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate(), wd = day.getUTCDay();
    const ok = r.frequency === 'daily' || (r.frequency === 'weekdays' && wd >= 1 && wd <= 5)
      || (r.frequency === 'weekly' && wd === r.weekday) || (r.frequency === 'monthly' && d === r.monthday);
    if (!ok) continue;
    const at = zoned(y, m, d, h, mi, r.timezone);
    if (at > after) return new Date(at);
  }
  return null;
}

const shape = x => ({
  id: x.id, name: x.name, subject: x.subject || null, content: x.content, frequency: x.frequency, time: x.run_time, weekday: x.weekday, monthday: x.monthday,
  timezone: x.timezone, serviceId: x.service_id || null, type: x.ticket_type || null, priority: x.priority || null, teamId: x.team_id || null,
  skipIfOpen: !!Number(x.skip_if_open), active: !!Number(x.active), nextRunAt: x.next_run_at, lastRunAt: x.last_run_at, lastTicketId: x.last_ticket_id || null,
});
async function list(db) {
  return (await db('SELECT * FROM recurring_tickets ORDER BY name').catch(() => [])).map(shape);
}

async function clean(db, input = {}) {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  if (!name) return { error: 'Nom requis (80 caractères au plus)' };
  const content = typeof input.content === 'string' ? input.content.trim().slice(0, 2000) : '';
  if (!content) return { error: 'Le premier message du ticket est requis' };
  if (!FREQUENCIES.includes(input.frequency)) return { error: 'Périodicité invalide' };
  if (!TIME_RE.test(input.time || '')) return { error: 'Heure invalide (HH:MM)' };
  const weekday = Number(input.weekday ?? 1), monthday = Number(input.monthday ?? 1);
  if (input.frequency === 'weekly' && !(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) return { error: 'Jour de la semaine invalide' };
  if (input.frequency === 'monthly' && !(Number.isInteger(monthday) && monthday >= 1 && monthday <= 28)) return { error: 'Jour du mois : de 1 à 28' };
  const timezone = typeof input.timezone === 'string' && validTz(input.timezone) ? input.timezone : 'Europe/Paris';
  let subject = null;
  if (input.subject) {
    const [cfg] = await db('SELECT ticket_subjects FROM guild_config WHERE id = 1');
    const known = require('./jsonField').parseJsonField(cfg?.ticket_subjects, []).map(x => (typeof x === 'string' ? x : x?.label || x?.name)).filter(Boolean);
    if (!known.includes(input.subject)) return { error: 'Sujet inconnu (Paramètres → Tickets → Sujets)' };
    subject = input.subject;
  }
  const serviceId = input.serviceId ? Number(input.serviceId) : null;
  if (serviceId && !(await db('SELECT 1 FROM catalog_services WHERE id = ?', [serviceId])).length) return { error: 'Service introuvable' };
  const teamId = input.teamId ? Number(input.teamId) : null;
  if (teamId && !(await db('SELECT 1 FROM teams WHERE id = ?', [teamId])).length) return { error: 'Équipe introuvable' };
  return { value: { name, content, frequency: input.frequency, time: input.time, weekday, monthday, timezone, subject, serviceId, teamId,
    type: ['incident', 'request'].includes(input.type) ? input.type : null, priority: ['low', 'normal', 'urgent'].includes(input.priority) ? input.priority : null,
    skipIfOpen: input.skipIfOpen !== false, active: input.active !== false } };
}

async function save(db, id, input) {
  const r = await clean(db, input);
  if (r.error) return r;
  const v = r.value;
  const next = v.active ? nextRun(v) : null;
  const vals = [v.name, v.subject, v.content, v.frequency, v.time, v.weekday, v.monthday, v.timezone, v.serviceId, v.type, v.priority, v.teamId, v.skipIfOpen ? 1 : 0, v.active ? 1 : 0, next];
  if (id) {
    const res = await db(`UPDATE recurring_tickets SET name = ?, subject = ?, content = ?, frequency = ?, run_time = ?, weekday = ?, monthday = ?, timezone = ?, service_id = ?,
      ticket_type = ?, priority = ?, team_id = ?, skip_if_open = ?, active = ?, next_run_at = ? WHERE id = ?`, [...vals, id]);
    return res.affectedRows ? { ok: true, id } : { error: 'Récurrence introuvable', status: 404 };
  }
  const [n] = await db('SELECT COUNT(*) AS n FROM recurring_tickets');
  if (Number(n.n) >= MAX) return { error: `${MAX} récurrences au plus` };
  const ins = await db(`INSERT INTO recurring_tickets (name, subject, content, frequency, run_time, weekday, monthday, timezone, service_id, ticket_type, priority, team_id, skip_if_open, active, next_run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, vals);
  return { ok: true, id: ins.insertId };
}
async function remove(db, id) {
  const r = await db('DELETE FROM recurring_tickets WHERE id = ?', [id]);
  return r.affectedRows ? { ok: true } : { error: 'Récurrence introuvable', status: 404 };
}

// Opens the ticket of a schedule now: { ticketId } or { skipped }
async function openNow({ db, client, guildId, rec }) {
  if (rec.skipIfOpen && rec.lastTicketId) {
    const [prev] = await db('SELECT status FROM tickets WHERE id = ?', [rec.lastTicketId]);
    if (prev?.status === 'open') return { skipped: 'le précédent est encore ouvert' };
  }
  const tag = `Ticket récurrent · ${rec.name}`.slice(0, 100);
  const user = { id: ownerOf(guildId, rec.id), tag, username: tag, send: async () => null };
  const catalog = require('./catalog');
  const service = rec.serviceId ? await catalog.serviceOf(db, rec.serviceId) : null;
  const subject = (rec.subject || service?.template.subject || rec.name).slice(0, 100);
  const tm = require('./ticketManager').createManager(db, client, guildId);
  const res = await tm.createTicket(user, rec.content, [], subject, { forceNew: true });
  if (!res?.ticket) return { skipped: 'ticket impossible' };
  const ticketId = res.ticket.id;
  if (service) await catalog.applyTemplate({ db, client, guildId, ticketId, service });
  const actor = { id: 'system', tag, username: tag, source: 'system' };
  if (rec.type) { await db('UPDATE tickets SET ticket_type = ? WHERE id = ?', [rec.type, ticketId]); await require('./slaPolicies').refreshQuietly(db, ticketId); }
  if (rec.priority) await tm.setPriority(ticketId, rec.priority, actor);
  if (rec.teamId) {
    const [row] = await db('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    if (row) await require('./teams').routeTicket({ db, tm, ticket: row, teamId: rec.teamId, actor });
  }
  await require('./audit').recordEvent(db, { actor, action: 'ticket_recurring', ticketId, details: { recurrence: rec.name } });
  return { ticketId };
}

async function runForGuild({ db, client, guildId }, now = Date.now()) {
  const due = (await db('SELECT * FROM recurring_tickets WHERE active = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?', [new Date(now)]).catch(() => [])).map(shape);
  let opened = 0;
  for (const rec of due) {
    // The next run first: a failure never opens the same ticket again and again
    const claim = await db('UPDATE recurring_tickets SET next_run_at = ?, last_run_at = ? WHERE id = ? AND next_run_at = ?', [nextRun(rec, now), new Date(now), rec.id, rec.nextRunAt]);
    if (!claim.affectedRows) continue;
    try {
      const r = await openNow({ db, client, guildId, rec });
      if (r.ticketId) { await db('UPDATE recurring_tickets SET last_ticket_id = ? WHERE id = ?', [r.ticketId, rec.id]); opened++; }
    } catch (err) { console.error('ticket récurrent', guildId, rec.id, err.message); }
  }
  return opened;
}
async function runRecurring(client) {
  const { getActiveGuilds } = require('./guildScan');
  const { getTenantDb } = require('./tenantDb');
  for (const { guild_id } of await getActiveGuilds().catch(() => [])) {
    await runForGuild({ db: getTenantDb(guild_id), client, guildId: guild_id }).catch(err => console.error(`tickets récurrents [${guild_id}]`, err.message));
  }
}

module.exports = { FREQUENCIES, ownerOf, nextRun, list, save, remove, openNow, runForGuild, runRecurring };

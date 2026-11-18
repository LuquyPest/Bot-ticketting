// Calendars (v5.1, conception/v5.md §3.4): opening hours per day of the week (several ranges a
// day), a time zone, and closed days (public holidays, closing periods). One for the space, one per
// team if needed. They tell whether the support is open, when it opens next, and count business
// time — what the deadlines (SLA) and the reminders use. No library: the time zone is handled with
// Intl, daylight saving included.
const { parseJsonField } = require('./jsonField');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;
const DEFAULT_HOURS = { mon: [['09:00', '18:00']], tue: [['09:00', '18:00']], wed: [['09:00', '18:00']], thu: [['09:00', '18:00']], fri: [['09:00', '18:00']], sat: [], sun: [] };
const MAX_CALENDARS = 20;
const MAX_CLOSED = 400;

const validTz = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return typeof tz === 'string' && tz.length <= 64; } catch { return false; } };

// ── Time zone arithmetic ──
const fmtCache = new Map();
function parts(ms, tz) {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }); fmtCache.set(tz, f); }
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) };
}
const offsetAt = (ms, tz) => { const p = parts(ms, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; };
// The instant of a local wall time in tz (a time skipped by daylight saving moves to after the jump)
function zoned(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetAt(guess, tz);
  const t2 = guess - offsetAt(t, tz);
  if (t2 !== t) t = Math.max(t, t2);
  return t;
}
const dateKey = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// ── Calendar object: { tz, hours, closed: [{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', label }] } ──
function isClosedDay(cal, key) {
  return (cal.closed || []).some(c => key >= c.from && key <= (c.to || c.from));
}
// The open ranges [startMs, endMs] of the local day containing ms
function rangesOfDay(cal, y, m, d) {
  const key = dateKey(y, m, d);
  if (isClosedDay(cal, key)) return [];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (cal.hours?.[DAYS[wd]] || []).map(([a, b]) => {
    const [ah, am] = a.split(':').map(Number), [bh, bm] = b.split(':').map(Number);
    return [zoned(y, m, d, ah, am, cal.tz), bh === 24 ? zoned(y, m, d + 1, 0, 0, cal.tz) : zoned(y, m, d, bh, bm, cal.tz)];
  }).filter(([s, e]) => e > s).sort((x, z) => x[0] - z[0]);
}
// Walks the open ranges from ms onwards (at most `days` days)
function* openRanges(cal, fromMs, days = 400) {
  const p = parts(fromMs, cal.tz);
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + i));
    for (const [s, e] of rangesOfDay(cal, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate())) {
      if (e <= fromMs) continue;
      yield [Math.max(s, fromMs), e];
    }
  }
}
const hasHours = cal => DAYS.some(d => (cal.hours?.[d] || []).length);

function isOpen(cal, ms = Date.now()) {
  const p = parts(ms, cal.tz);
  return rangesOfDay(cal, p.y, p.m, p.d).some(([s, e]) => ms >= s && ms < e)
    // a range ending at midnight belongs to the day before
    || rangesOfDay(cal, ...(() => { const y = new Date(Date.UTC(p.y, p.m - 1, p.d - 1)); return [y.getUTCFullYear(), y.getUTCMonth() + 1, y.getUTCDate()]; })()).some(([s, e]) => ms >= s && ms < e);
}
// The next opening at or after ms (ms itself when open), or null (no hours at all)
function nextOpening(cal, ms = Date.now()) {
  if (!hasHours(cal)) return null;
  if (isOpen(cal, ms)) return ms;
  for (const [s] of openRanges(cal, ms)) return s;
  return null;
}
// Business minutes between two instants
function businessMinutes(cal, fromMs, toMs) {
  if (!(toMs > fromMs) || !hasHours(cal)) return 0;
  let total = 0;
  for (const [s, e] of openRanges(cal, fromMs, Math.ceil((toMs - fromMs) / 864e5) + 2)) {
    if (s >= toMs) break;
    total += Math.min(e, toMs) - s;
  }
  return Math.round(total / 60000);
}
// The instant when `minutes` business minutes have passed since fromMs
function addBusinessMinutes(cal, fromMs, minutes) {
  if (!hasHours(cal)) return fromMs + minutes * 60000;
  let left = minutes * 60000;
  for (const [s, e] of openRanges(cal, fromMs, 3650)) {
    if (e - s >= left) return s + left;
    left -= e - s;
  }
  return null;
}

// ── Public holidays (computed, added to a calendar as closed days) ──
function easter(y) { // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}
const fromUtc = ms => { const d = new Date(ms); return dateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
const plusDays = (ms, n) => ms + n * 864e5;
const nthWeekday = (y, m, wd, n) => { // n-th weekday (0 = Sunday) of month m, n = -1: the last
  if (n > 0) { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return Date.UTC(y, m - 1, 1 + ((wd - first + 7) % 7) + (n - 1) * 7); }
  const last = new Date(Date.UTC(y, m, 0)); return Date.UTC(y, m - 1, last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7));
};
const fixed = (y, m, d) => Date.UTC(y, m - 1, d);
const HOLIDAYS = {
  FR: y => { const e = easter(y); return [[fixed(y, 1, 1), 'Jour de l\'an'], [plusDays(e, 1), 'Lundi de Pâques'], [fixed(y, 5, 1), 'Fête du Travail'], [fixed(y, 5, 8), 'Victoire 1945'], [plusDays(e, 39), 'Ascension'], [plusDays(e, 50), 'Lundi de Pentecôte'], [fixed(y, 7, 14), 'Fête nationale'], [fixed(y, 8, 15), 'Assomption'], [fixed(y, 11, 1), 'Toussaint'], [fixed(y, 11, 11), 'Armistice'], [fixed(y, 12, 25), 'Noël']]; },
  BE: y => { const e = easter(y); return [[fixed(y, 1, 1), 'Nouvel an'], [plusDays(e, 1), 'Lundi de Pâques'], [fixed(y, 5, 1), 'Fête du Travail'], [plusDays(e, 39), 'Ascension'], [plusDays(e, 50), 'Lundi de Pentecôte'], [fixed(y, 7, 21), 'Fête nationale'], [fixed(y, 8, 15), 'Assomption'], [fixed(y, 11, 1), 'Toussaint'], [fixed(y, 11, 11), 'Armistice'], [fixed(y, 12, 25), 'Noël']]; },
  CH: y => { const e = easter(y); return [[fixed(y, 1, 1), 'Nouvel an'], [plusDays(e, -2), 'Vendredi saint'], [plusDays(e, 1), 'Lundi de Pâques'], [plusDays(e, 39), 'Ascension'], [plusDays(e, 50), 'Lundi de Pentecôte'], [fixed(y, 8, 1), 'Fête nationale'], [fixed(y, 12, 25), 'Noël'], [fixed(y, 12, 26), 'Saint-Étienne']]; },
  LU: y => { const e = easter(y); return [[fixed(y, 1, 1), 'Nouvel an'], [plusDays(e, 1), 'Lundi de Pâques'], [fixed(y, 5, 1), 'Fête du Travail'], [fixed(y, 5, 9), 'Journée de l\'Europe'], [plusDays(e, 39), 'Ascension'], [plusDays(e, 50), 'Lundi de Pentecôte'], [fixed(y, 6, 23), 'Fête nationale'], [fixed(y, 8, 15), 'Assomption'], [fixed(y, 11, 1), 'Toussaint'], [fixed(y, 12, 25), 'Noël'], [fixed(y, 12, 26), 'Saint-Étienne']]; },
  CA: y => { const e = easter(y); return [[fixed(y, 1, 1), 'Jour de l\'an'], [plusDays(e, -2), 'Vendredi saint'], [fixed(y, 7, 1), 'Fête du Canada'], [nthWeekday(y, 9, 1, 1), 'Fête du Travail'], [nthWeekday(y, 10, 1, 2), 'Action de grâce'], [fixed(y, 12, 25), 'Noël']]; },
  US: y => [[fixed(y, 1, 1), 'New Year\'s Day'], [nthWeekday(y, 1, 1, 3), 'Martin Luther King Jr. Day'], [nthWeekday(y, 2, 1, 3), 'Presidents\' Day'], [nthWeekday(y, 5, 1, -1), 'Memorial Day'], [fixed(y, 6, 19), 'Juneteenth'], [fixed(y, 7, 4), 'Independence Day'], [nthWeekday(y, 9, 1, 1), 'Labor Day'], [nthWeekday(y, 11, 4, 4), 'Thanksgiving'], [fixed(y, 12, 25), 'Christmas Day']],
  GB: y => { const e = easter(y); return [[fixed(y, 1, 1), 'New Year\'s Day'], [plusDays(e, -2), 'Good Friday'], [plusDays(e, 1), 'Easter Monday'], [nthWeekday(y, 5, 1, 1), 'Early May bank holiday'], [nthWeekday(y, 5, 1, -1), 'Spring bank holiday'], [nthWeekday(y, 8, 1, -1), 'Summer bank holiday'], [fixed(y, 12, 25), 'Christmas Day'], [fixed(y, 12, 26), 'Boxing Day']]; },
  DE: y => { const e = easter(y); return [[fixed(y, 1, 1), 'Neujahr'], [plusDays(e, -2), 'Karfreitag'], [plusDays(e, 1), 'Ostermontag'], [fixed(y, 5, 1), 'Tag der Arbeit'], [plusDays(e, 39), 'Christi Himmelfahrt'], [plusDays(e, 50), 'Pfingstmontag'], [fixed(y, 10, 3), 'Tag der Deutschen Einheit'], [fixed(y, 12, 25), '1. Weihnachtstag'], [fixed(y, 12, 26), '2. Weihnachtstag']]; },
};
const holidaysFor = (country, year) => (HOLIDAYS[country] ? HOLIDAYS[country](year).map(([ms, label]) => ({ from: fromUtc(ms), to: fromUtc(ms), label })) : null);

// ── Storage (tables calendars, calendar_closed) ──
function clean(input = {}) {
  const name = typeof input.name === 'string' ? input.name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60) : '';
  if (!name) return { error: 'Nom du calendrier requis (60 caractères au plus)' };
  const tz = String(input.timezone || 'Europe/Paris');
  if (!validTz(tz)) return { error: 'Fuseau horaire inconnu (ex. Europe/Paris)' };
  const hours = {};
  for (const d of DAYS) {
    const list = Array.isArray(input.hours?.[d]) ? input.hours[d] : [];
    if (list.length > 4) return { error: 'Quatre plages par jour au plus' };
    const ranges = [];
    for (const r of list) {
      if (!Array.isArray(r) || r.length !== 2 || !TIME_RE.test(r[0]) || !TIME_RE.test(r[1]) || r[0] === '24:00' || r[1] <= r[0]) return { error: 'Plage horaire invalide (HH:MM, la fin après le début)' };
      ranges.push([r[0], r[1]]);
    }
    ranges.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) return { error: 'Deux plages d\'un même jour se chevauchent' };
    hours[d] = ranges;
  }
  const closed = [];
  for (const c of Array.isArray(input.closed) ? input.closed : []) {
    const from = String(c?.from || ''), to = String(c?.to || c?.from || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return { error: 'Jour fermé invalide (AAAA-MM-JJ)' };
    closed.push({ from, to, label: typeof c.label === 'string' ? c.label.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60) : '' });
  }
  if (closed.length > MAX_CLOSED) return { error: `${MAX_CLOSED} jours fermés au plus` };
  const outsideReply = input.outsideReply === true;
  const outsideText = typeof input.outsideText === 'string' ? input.outsideText.trim().slice(0, 1000) : '';
  return { value: { name, timezone: tz, hours, closed, outsideReply, outsideText } };
}

const shape = row => ({
  id: row.id, name: row.name, timezone: row.timezone, hours: { ...DEFAULT_HOURS, ...(parseJsonField(row.hours, {}) || {}) }, closed: parseJsonField(row.closed_days, []) || [],
  outsideReply: !!Number(row.outside_reply), outsideText: row.outside_text || '',
});
const asCal = c => ({ tz: c.timezone, hours: c.hours, closed: c.closed });

async function listCalendars(db) {
  return (await db('SELECT * FROM calendars ORDER BY name').catch(() => [])).map(shape);
}
async function calendarOf(db, id) {
  if (!id) return null;
  const [row] = await db('SELECT * FROM calendars WHERE id = ?', [Number(id)]).catch(() => []);
  return row ? shape(row) : null;
}
async function saveCalendar(db, id, input) {
  const r = clean(input);
  if (r.error) return r;
  const v = r.value;
  const vals = [v.name, v.timezone, JSON.stringify(v.hours), JSON.stringify(v.closed), v.outsideReply ? 1 : 0, v.outsideText || null];
  if (id) {
    const res = await db('UPDATE calendars SET name = ?, timezone = ?, hours = ?, closed_days = ?, outside_reply = ?, outside_text = ? WHERE id = ?', [...vals, id]);
    if (!res.affectedRows) return { error: 'Calendrier introuvable', status: 404 };
    return { ok: true, id };
  }
  const [n] = await db('SELECT COUNT(*) AS n FROM calendars');
  if (Number(n.n) >= MAX_CALENDARS) return { error: `${MAX_CALENDARS} calendriers au plus` };
  const { insertId } = await db('INSERT INTO calendars (name, timezone, hours, closed_days, outside_reply, outside_text) VALUES (?, ?, ?, ?, ?, ?)', vals);
  return { ok: true, id: insertId };
}
async function deleteCalendar(db, id) {
  await db('UPDATE guild_config SET calendar_id = NULL WHERE calendar_id = ?', [id]);
  await db('UPDATE teams SET calendar_id = NULL WHERE calendar_id = ?', [id]).catch(() => null);
  const r = await db('DELETE FROM calendars WHERE id = ?', [id]);
  return r.affectedRows ? { ok: true } : { error: 'Calendrier introuvable', status: 404 };
}

// The calendar that applies to a ticket: its team's, else the space's; null = always open
async function calendarForTicket(db, ticket) {
  if (ticket?.team_id) {
    const [t] = await db('SELECT calendar_id FROM teams WHERE id = ?', [ticket.team_id]).catch(() => []);
    const c = await calendarOf(db, t?.calendar_id);
    if (c) return c;
  }
  const [cfg] = await db('SELECT calendar_id FROM guild_config WHERE id = 1').catch(() => []);
  return calendarOf(db, cfg?.calendar_id);
}

// At the opening of a ticket outside the hours: « we are closed, back on … » (if the calendar says so)
async function outsideHoursReply({ db, client, guildId, ticket }) {
  const cal = await calendarForTicket(db, ticket);
  if (!cal?.outsideReply || isOpen(asCal(cal))) return false;
  const next = nextOpening(asCal(cal));
  const { t, sendToMember } = require('./i18n');
  const { ticketNoticeDmEmbed } = require('./dmEmbeds');
  const LOCALES = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-BR' };
  await sendToMember(client, ticket.owner_id, guildId, () => {
    // Inside the message: in the requester's language, at the calendar's time
    const when = next ? new Intl.DateTimeFormat(LOCALES[require('./i18n').lang()] || 'fr-FR', { timeZone: cal.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(next)) : null;
    return { embeds: [ticketNoticeDmEmbed(client, guildId, ticket, { title: t('hours.closedTitle'), description: cal.outsideText || (when ? t('hours.closedBody', { when }) : t('hours.closedNoDate')), color: 'neutral' })] };
  }, { ticketId: ticket.id }).catch(() => null);
  return true;
}

module.exports = { DAYS, DEFAULT_HOURS, HOLIDAYS, validTz, isOpen, nextOpening, businessMinutes, addBusinessMinutes, holidaysFor, easter, clean, shape, asCal,
  listCalendars, calendarOf, saveCalendar, deleteCalendar, calendarForTicket, outsideHoursReply, zoned };

// Calendars of the space (utils/calendars.js). Read: the staff (open now, next opening);
// write: founders. GET / ; POST / ; PUT /:id ; DELETE /:id ; GET /holidays?country=&year= (preset)
const express = require('express');
const router = express.Router();
const cal = require('../../utils/calendars');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const founders = (req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' }));
const withState = c => {
  const k = cal.asCal(c);
  return { ...c, openNow: cal.isOpen(k), nextOpening: cal.nextOpening(k) ? new Date(cal.nextOpening(k)).toISOString() : null };
};

router.get('/', async (req, res, next) => {
  try {
    const [cfg] = await req.guildDb('SELECT calendar_id FROM guild_config WHERE id = 1');
    res.json({ calendars: (await cal.listCalendars(req.guildDb)).map(withState), spaceCalendarId: cfg?.calendar_id || null, countries: Object.keys(cal.HOLIDAYS) });
  } catch (err) { next(err); }
});

// Public holidays of a country for a year, to add to a calendar (they can be edited after)
router.get('/holidays', founders, (req, res) => {
  const year = parseInt(req.query.year);
  const list = Number.isInteger(year) && year >= 2000 && year <= 2100 ? cal.holidaysFor(String(req.query.country || ''), year) : null;
  if (!list) return res.status(400).json({ error: 'Pays ou année inconnus' });
  res.json(list);
});

router.post('/', founders, async (req, res, next) => {
  try {
    const r = await cal.saveCalendar(req.guildDb, null, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'calendar_save', targetType: 'calendar', targetId: r.id, details: { name: req.body?.name } });
    res.json(withState(await cal.calendarOf(req.guildDb, r.id)));
  } catch (err) { next(err); }
});

router.put('/:id', founders, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await cal.saveCalendar(req.guildDb, id, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'calendar_save', targetType: 'calendar', targetId: id, details: { name: req.body?.name } });
    res.json(withState(await cal.calendarOf(req.guildDb, id)));
  } catch (err) { next(err); }
});

router.delete('/:id', founders, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await cal.deleteCalendar(req.guildDb, id);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'calendar_delete', targetType: 'calendar', targetId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

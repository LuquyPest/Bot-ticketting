// Dashboards (utils/dashboards.js): each staff member's boards and those shared with them; the
// data of a widget, computed through the viewer's visibility.
const express = require('express');
const router = express.Router();
const D = require('../../utils/dashboards');
const { visibilityFilter } = require('../../utils/gradePermissions');

const me = req => String(req.session.user.id);
router.get('/', async (req, res, next) => { try { res.json({ boards: await D.listBoards(req.guildDb, me(req)) }); } catch (err) { next(err); } });
router.post('/', async (req, res, next) => {
  try {
    const r = await D.saveBoard(req.guildDb, null, req.body || {}, me(req), { isFounder: req.userIsFondateur });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json({ id: r.id, boards: await D.listBoards(req.guildDb, me(req)) });
  } catch (err) { next(err); }
});
router.put('/:id', async (req, res, next) => {
  try {
    const r = await D.saveBoard(req.guildDb, parseInt(req.params.id) || 0, req.body || {}, me(req), { isFounder: req.userIsFondateur });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json({ boards: await D.listBoards(req.guildDb, me(req)) });
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    const r = await D.deleteBoard(req.guildDb, parseInt(req.params.id) || 0, me(req));
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json({ boards: await D.listBoards(req.guildDb, me(req)) });
  } catch (err) { next(err); }
});
// POST /api/dashboards/data { widgets: [...] } — the figures of several widgets at once (20 at most)
router.post('/data', async (req, res, next) => {
  try {
    const widgets = Array.isArray(req.body?.widgets) ? req.body.widgets.slice(0, 24) : [];
    const vis = await visibilityFilter(req, 't.visibility_grade_id');
    const out = [];
    for (const w of widgets) {
      const r = await D.widgetData(req.guildDb, w, { userId: me(req), vis });
      out.push(r.error ? { error: r.error } : r.value);
    }
    res.json({ data: out });
  } catch (err) { next(err); }
});

module.exports = router;

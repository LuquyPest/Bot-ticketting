// Taking over the open tickets of another bot (utils/botImport.js) — founders only.
const express = require('express');
const router = express.Router();
const { scanCategory, adoptChannels } = require('../../utils/botImport');

// GET /api/bot-import/scan?categoryId= — channels of the category and the member found for each
router.get('/scan', async (req, res) => {
  const client = req.app.locals.client;
  if (!client) return res.status(503).json({ error: 'Bot Discord non disponible' });
  try {
    const r = await scanCategory(client, req.guildId, req.guildDb, String(req.query.categoryId || ''));
    if (r.error) return res.status(400).json(r);
    res.json(r);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lecture de la catégorie impossible' });
  }
});

// POST /api/bot-import/adopt — { categoryId, items: [{ channelId, ownerId }], history, notify, move }
router.post('/adopt', async (req, res) => {
  const client = req.app.locals.client;
  if (!client) return res.status(503).json({ error: 'Bot Discord non disponible' });
  const b = req.body || {};
  try {
    const r = await adoptChannels(client, req.guildId, req.guildDb, req.session.user, {
      categoryId: String(b.categoryId || ''), items: b.items, history: b.history !== false, notify: b.notify !== false, move: b.move === true,
    });
    if (r.error) return res.status(400).json(r);
    res.json(r);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Import impossible' });
  }
});

module.exports = router;

// Public knowledge base (utils/knowledgeBase.js), read without signing in:
//   GET /api/kb/:guildId                → the space and its public articles
//   GET /api/kb/:guildId/articles/:id   → one article (counted as read)
// A space whose public page is off, unknown or suspended answers the same 404.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const kb = require('../../utils/knowledgeBase');
const { allowBurst } = require('../../utils/rateLimit');

const NOT_FOUND = { error: 'Page introuvable' };

router.get('/:guildId', async (req, res, next) => {
  try {
    const space = await kb.publicSpace(req.params.guildId);
    if (!space) return res.status(404).json(NOT_FOUND);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      space: { id: space.id, name: space.name, logo: space.logo, color: space.color },
      articles: await kb.publicArticles(space.db, { lang: /^[a-z]{2}$/.test(req.query.lang || '') ? req.query.lang : null }),
    });
  } catch (err) { next(err); }
});

router.get('/:guildId/articles/:id', async (req, res, next) => {
  try {
    const space = await kb.publicSpace(req.params.guildId);
    const id = parseInt(req.params.id, 10);
    if (!space || !(id > 0)) return res.status(404).json(NOT_FOUND);
    // One read per visitor and hour, so that reloading does not inflate the figure
    const ip = crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 24);
    const count = await allowBurst(`kbview:${space.id}:${id}:${ip}`, 1, 3600 * 1000);
    const article = await kb.publicArticle(space.db, id, { count, lang: /^[a-z]{2}$/.test(req.query.lang || '') ? req.query.lang : null });
    if (!article) return res.status(404).json({ error: 'Article introuvable' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ space: { id: space.id, name: space.name, logo: space.logo, color: space.color }, article });
  } catch (err) { next(err); }
});

// POST /api/kb/:guildId/articles/:id/feedback { helpful, comment } — once per visitor and article a day
router.post('/:guildId/articles/:id/feedback', express.json({ limit: '4kb' }), async (req, res, next) => {
  try {
    const space = await kb.publicSpace(req.params.guildId);
    const id = parseInt(req.params.id, 10);
    if (!space || !(id > 0)) return res.status(404).json(NOT_FOUND);
    const ip = crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 24);
    if (!(await allowBurst(`kbfb:${space.id}:${id}:${ip}`, 1, 24 * 3600 * 1000))) return res.status(429).json({ error: 'Merci, ton avis est déjà noté' });
    if (!(await allowBurst(`kbfbip:${ip}`, 30, 3600 * 1000))) return res.status(429).json({ error: 'Trop de requêtes' });
    const r = await kb.feedback(space.db, id, req.body?.helpful === true, req.body?.comment);
    if (!r) return res.status(404).json({ error: 'Article introuvable' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
// POST /api/kb/:guildId/searches { q } — a search that found nothing (what is missing)
router.post('/:guildId/searches', express.json({ limit: '2kb' }), async (req, res, next) => {
  try {
    const space = await kb.publicSpace(req.params.guildId);
    if (!space) return res.status(404).json(NOT_FOUND);
    const ip = crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 24);
    if (await allowBurst(`kbsearch:${space.id}:${ip}`, 20, 3600 * 1000)) await kb.searchMiss(space.db, req.body?.q);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

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
      articles: await kb.publicArticles(space.db),
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
    const article = await kb.publicArticle(space.db, id, { count });
    if (!article) return res.status(404).json({ error: 'Article introuvable' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ space: { id: space.id, name: space.name, logo: space.logo, color: space.color }, article });
  } catch (err) { next(err); }
});

module.exports = router;

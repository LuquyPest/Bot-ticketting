// Public knowledge base rendered by the server (v5.6, conception/v5.md §3.15): /aide/<space> and
// /aide/<space>/<article> are sent as full HTML — title, description, canonical link, languages,
// structured data and the content itself inside #root — so search engines index them and they read
// without JavaScript; the dashboard's script then takes over the page as before.
//   GET /aide/:guildId/sitemap.xml  — the plan of the base
// Only what the public API shows (utils/knowledgeBase.js: published, valid, public); a space whose
// page is off gets the usual page, which says « not found », with a 404.
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const kb = require('../../utils/knowledgeBase');
const { escapeHtml, markdownToHtml, markdownToText } = require('../../utils/emailFormat');

const INDEX = path.join(__dirname, '../../dashboard/dist/index.html');
let shell = null, shellAt = 0;
function indexHtml() {
  // Re-read after a new build (checked at most every 10 s)
  if (!shell || Date.now() - shellAt > 10000) {
    // Without a built dashboard (tests, a fresh clone): a bare page, readable all the same
    try { shell = fs.readFileSync(INDEX, 'utf8'); } catch { shell = '<!DOCTYPE html>\n<html lang="fr">\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Datick</title></head>\n<body><div id="root"></div></body>\n</html>\n'; }
    shellAt = Date.now();
  }
  return shell;
}
const LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt'];
const base = () => String(require('../../utils/config').config.webServerBaseUrl || '').replace(/\/$/, '');
const attr = s => escapeHtml(String(s ?? '')).replace(/\n/g, ' ');
// JSON inside <script>: no closing tag can sneak in
const ldJson = o => JSON.stringify(o).replace(/</g, '\\u003c');

function page({ title, description, canonical, lang = 'fr', body, alternates = [], ld = null, status = 200 }) {
  const html = indexHtml();
  if (!html) return null;
  const head = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${attr(description.slice(0, 300))}">`,
    canonical ? `<link rel="canonical" href="${attr(canonical)}">` : '',
    ...alternates.map(a => `<link rel="alternate" hreflang="${attr(a.lang)}" href="${attr(a.href)}">`),
    `<meta property="og:title" content="${attr(title)}">`, `<meta property="og:description" content="${attr(description.slice(0, 300))}">`, `<meta property="og:type" content="article">`,
    canonical ? `<meta property="og:url" content="${attr(canonical)}">` : '',
    ld ? `<script type="application/ld+json">${ldJson(ld)}</script>` : '',
  ].filter(Boolean).join('\n    ');
  return { status, html: html.replace(/<html lang="[^"]*">/, `<html lang="${LANGS.includes(lang) ? lang : 'fr'}">`).replace(/<title>[^<]*<\/title>/, head)
    .replace('<div id="root"></div>', `<div id="root"><main style="max-width:760px;margin:0 auto;padding:24px 16px;font-family:system-ui,sans-serif;line-height:1.55">${body}</main></div>`) };
}
const send = (res, p, next) => (p ? res.status(p.status).set('Cache-Control', 'public, max-age=300').type('html').send(p.html) : next());

router.get('/aide/:guildId/sitemap.xml', async (req, res, next) => {
  try {
    const space = await kb.publicSpace(req.params.guildId);
    if (!space) return res.status(404).type('text/plain').send('Not found');
    const rows = await space.db(`SELECT id, updated_at, created_at FROM faq_entries WHERE ${kb.LIVE} AND visibility = 'public' ORDER BY id LIMIT 5000`);
    const loc = id => `${base()}/aide/${encodeURIComponent(space.id)}${id ? `/${id}` : ''}`;
    const day = d => new Date(d).toISOString().slice(0, 10);
    const urls = [`<url><loc>${escapeHtml(loc())}</loc></url>`, ...rows.map(r => `<url><loc>${escapeHtml(loc(r.id))}</loc><lastmod>${day(r.updated_at || r.created_at)}</lastmod></url>`)];
    res.set('Cache-Control', 'public, max-age=3600').type('application/xml')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  } catch (err) { next(err); }
});

router.get('/aide/:guildId', async (req, res, next) => {
  try {
    const space = await kb.publicSpace(req.params.guildId);
    if (!space) return send(res, page({ title: 'Page introuvable', description: '', body: '<h1>Page introuvable</h1>', status: 404 }), next);
    const lang = LANGS.includes(req.query.lang) ? req.query.lang : null;
    const articles = await kb.publicArticles(space.db, { lang });
    const url = `${base()}/aide/${encodeURIComponent(space.id)}`;
    const groups = new Map();
    for (const a of articles) { const k = a.category || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
    const body = `<h1>${escapeHtml(space.name)} · Aide</h1>${[...groups.entries()].map(([c, list]) => `${c ? `<h2>${escapeHtml(c)}</h2>` : ''}<ul>${list.map(a => `<li><a href="/aide/${encodeURIComponent(space.id)}/${a.id}">${escapeHtml(a.question)}</a></li>`).join('')}</ul>`).join('')}`;
    send(res, page({ title: `${space.name} · Aide`, description: `Les réponses aux questions fréquentes de ${space.name} : ${articles.slice(0, 5).map(a => a.question).join(' · ')}`, canonical: url, lang: lang || 'fr', body,
      ld: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: articles.slice(0, 50).map(a => ({ '@type': 'Question', name: a.question, acceptedAnswer: { '@type': 'Answer', text: markdownToText(a.answer).slice(0, 1000) } })) } }), next);
  } catch (err) { next(err); }
});

router.get('/aide/:guildId/:articleId', async (req, res, next) => {
  try {
    const id = parseInt(req.params.articleId, 10);
    if (!(id > 0) || String(id) !== req.params.articleId) return next();
    const space = await kb.publicSpace(req.params.guildId);
    const lang = LANGS.includes(req.query.lang) ? req.query.lang : null;
    const a = space ? await kb.publicArticle(space.db, id, { lang }) : null;
    if (!a) return send(res, page({ title: 'Article introuvable', description: '', body: '<h1>Article introuvable</h1>', status: 404 }), next);
    const url = `${base()}/aide/${encodeURIComponent(space.id)}/${a.id}`;
    const body = `<p><a href="/aide/${encodeURIComponent(space.id)}">${escapeHtml(space.name)} · Aide</a></p>${a.category ? `<p>${escapeHtml(a.category)}</p>` : ''}<h1>${escapeHtml(a.question)}</h1>${markdownToHtml(a.answer)}`;
    send(res, page({ title: `${a.question} · ${space.name}`, description: markdownToText(a.answer).replace(/\s+/g, ' '), canonical: url, lang: a.lang || 'fr', body,
      alternates: (a.translations || []).filter(t => t.lang).map(t => ({ lang: t.lang, href: `${base()}/aide/${encodeURIComponent(space.id)}/${t.id}` })),
      ld: { '@context': 'https://schema.org', '@type': 'Article', headline: a.question.slice(0, 110), dateModified: new Date(a.updated_at || a.created_at).toISOString(), datePublished: new Date(a.created_at).toISOString(), inLanguage: a.lang || 'fr', mainEntityOfPage: url } }), next);
  } catch (err) { next(err); }
});

module.exports = router;

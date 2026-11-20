// Public knowledge base (v4.2): the FAQ entries marked « public » of a space, readable without
// signing in at /aide/<space>, once a founder turns the page on (guild_config.kb_public).
// Entries « members » stay where the FAQ always was: the member space and the DM suggestions.
const { globalQuery } = require('./globalDb');
const { getTenantDb } = require('./tenantDb');
const { config } = require('./config');

const MAX_ARTICLES = 200;
const base = () => (config.webServerBaseUrl || '').replace(/\/$/, '');
const kbUrl = (guildId, articleId) => `${base()}/aide/${encodeURIComponent(guildId)}${articleId ? `/${articleId}` : ''}`;

// The space, if its public page is on — null otherwise (an unknown space looks the same)
async function publicSpace(guildId) {
  if (!/^[\w-]{1,32}$/.test(String(guildId || ''))) return null;
  if (String(guildId) === require('./demo').DEMO_GUILD_ID) return null; // what visitors write there is never public
  const [g] = await globalQuery('SELECT guild_id, guild_name FROM guilds WHERE guild_id = ? AND status = "active" AND maintenance_mode = 0', [guildId]).catch(() => []);
  if (!g) return null;
  const db = getTenantDb(g.guild_id);
  const [cfg] = await db('SELECT kb_public, portal_logo, portal_color FROM guild_config WHERE id = 1').catch(() => []);
  if (!Number(cfg?.kb_public)) return null;
  return { id: g.guild_id, name: g.guild_name || 'Support', logo: cfg.portal_logo || null, color: cfg.portal_color || null, db };
}

async function kbEnabled(db) {
  const [cfg] = await db('SELECT kb_public FROM guild_config WHERE id = 1').catch(() => []);
  return !!Number(cfg?.kb_public);
}

// Published and still valid (v5.6): drafts and expired articles are shown to nobody but the staff
const LIVE = "active = 1 AND status = 'published' AND (expires_at IS NULL OR expires_at > CURDATE())";
const PUBLIC = `${LIVE} AND visibility = 'public'`;

// The originals (a translation shows instead of its original when the reader asks for its language)
async function publicArticles(db, { lang = null } = {}) {
  const rows = await db(`SELECT id, question, answer, category, updated_at, created_at, lang, translation_of FROM faq_entries WHERE ${PUBLIC}
    ORDER BY ${require('./kbTree').ORDER}, solved_count DESC, id ASC LIMIT ${MAX_ARTICLES}`);
  const originals = rows.filter(r => !r.translation_of);
  if (!lang) return originals.map(({ translation_of, ...a }) => a);
  return originals.map(o => rows.find(r => r.translation_of === o.id && r.lang === lang) || o).map(({ translation_of, ...a }) => a);
}

// One article; counted as read (once per visitor and hour is enough, see the route)
async function publicArticle(db, id, { count = false, lang = null } = {}) {
  let [a] = await db(`SELECT id, question, answer, category, updated_at, created_at, lang, translation_of FROM faq_entries WHERE id = ? AND ${PUBLIC}`, [id]);
  if (!a) return null;
  const root = a.translation_of || a.id;
  const family = await db(`SELECT id, lang, translation_of FROM faq_entries WHERE (id = ? OR translation_of = ?) AND ${PUBLIC}`, [root, root]);
  if (lang && a.lang !== lang) {
    const t = family.find(x => x.lang === lang && x.id !== a.id);
    if (t) [a] = await db(`SELECT id, question, answer, category, updated_at, created_at, lang, translation_of FROM faq_entries WHERE id = ?`, [t.id]);
  }
  if (count) await db('UPDATE faq_entries SET view_count = view_count + 1 WHERE id = ?', [a.id]).catch(() => null);
  const { translation_of, ...out } = a;
  return { ...out, translations: family.filter(x => x.id !== a.id).map(x => ({ id: x.id, lang: x.lang || null })) };
}

// Readers' feedback (« did it help? ») and what they looked for in vain
async function feedback(db, id, helpful, comment) {
  const [a] = await db(`SELECT id FROM faq_entries WHERE id = ? AND ${PUBLIC}`, [id]);
  if (!a) return null;
  await db(`UPDATE faq_entries SET ${helpful ? 'helpful_yes = helpful_yes + 1' : 'helpful_no = helpful_no + 1'} WHERE id = ?`, [id]);
  const text = typeof comment === 'string' ? comment.replace(/\s+/g, ' ').trim().slice(0, 1000) : '';
  await db('INSERT INTO faq_feedback (faq_id, helpful, comment) VALUES (?, ?, ?)', [id, helpful ? 1 : 0, text || null]);
  return { ok: true };
}
async function searchMiss(db, q) {
  const query = String(q || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (query.length < 3) return;
  await db('INSERT INTO kb_searches (query, misses, last_at) VALUES (?, 1, NOW()) ON DUPLICATE KEY UPDATE misses = misses + 1, last_at = NOW()', [query]);
}

module.exports = { LIVE, feedback, searchMiss, publicSpace, kbEnabled, publicArticles, publicArticle, kbUrl, MAX_ARTICLES };

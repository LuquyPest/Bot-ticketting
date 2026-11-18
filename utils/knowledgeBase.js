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

const PUBLIC = "active = 1 AND visibility = 'public'";

async function publicArticles(db) {
  return db(`SELECT id, question, answer, category, updated_at, created_at FROM faq_entries WHERE ${PUBLIC}
    ORDER BY category = '', category, solved_count DESC, id ASC LIMIT ${MAX_ARTICLES}`);
}

// One article; counted as read (once per visitor and hour is enough, see the route)
async function publicArticle(db, id, { count = false } = {}) {
  const [a] = await db(`SELECT id, question, answer, category, updated_at, created_at FROM faq_entries WHERE id = ? AND ${PUBLIC}`, [id]);
  if (a && count) await db('UPDATE faq_entries SET view_count = view_count + 1 WHERE id = ?', [a.id]).catch(() => null);
  return a || null;
}

module.exports = { publicSpace, kbEnabled, publicArticles, publicArticle, kbUrl, MAX_ARTICLES };

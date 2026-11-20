// Categories of the knowledge base as a tree (v8, conception/v8.md §3.4): three levels, the order of
// categories and of articles set by drag and drop. An article keeps the full path of its category
// in `faq_entries.category` (« Parent › Child »), what the public page, the member space, the DM
// suggestions and the API read; `kb_categories.sort_key` gives them the order of the tree.
const MAX_DEPTH = 3, MAX_CATEGORIES = 300;
const SEP = ' › ';
const clean = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').replace(/›/g, '>').trim().slice(0, 80) : '');

async function all(db) { return db('SELECT * FROM kb_categories ORDER BY sort_key, id').catch(() => []); }
function build(rows) {
  const byId = new Map(rows.map(r => [r.id, { id: r.id, name: r.name, parentId: r.parent_id, position: r.position, children: [] }]));
  const roots = [];
  for (const n of byId.values()) (n.parentId && byId.get(n.parentId) ? byId.get(n.parentId).children : roots).push(n);
  const sort = list => { list.sort((a, b) => a.position - b.position || a.id - b.id); list.forEach(n => sort(n.children)); return list; };
  return { roots: sort(roots), byId };
}
const depthOf = (byId, id) => { let d = 0; for (let n = byId.get(id); n; n = byId.get(n.parentId)) d++; return d; };
const heightOf = n => 1 + Math.max(0, ...n.children.map(heightOf));
const pathOf = (byId, id) => { const parts = []; for (let n = byId.get(id); n; n = byId.get(n.parentId)) parts.unshift(n.name); return parts.join(SEP).slice(0, 255); };

// Sort keys, positions and the articles' paths, after any change
async function refresh(db) {
  const { roots, byId } = build(await all(db));
  const walk = async (list, prefix) => {
    for (const [i, n] of list.entries()) {
      const key = `${prefix}${String(i).padStart(4, '0')}`;
      await db('UPDATE kb_categories SET position = ?, sort_key = ? WHERE id = ?', [i, key, n.id]);
      await db('UPDATE faq_entries SET category = ? WHERE category_id = ?', [pathOf(byId, n.id), n.id]);
      await walk(n.children, `${key}.`);
    }
  };
  await walk(roots, '');
}

async function tree(db, articleFilter = { sql: '1=1', params: [] }) {
  const { roots } = build(await all(db));
  const articles = (await db(`SELECT id, question, category_id, position, status, visibility, active FROM faq_entries WHERE translation_of IS NULL AND ${articleFilter.sql} ORDER BY position, id`, articleFilter.params).catch(() => []))
    .map(a => ({ id: a.id, question: a.question, categoryId: a.category_id || null, position: a.position, status: a.status, visibility: a.visibility, active: !!Number(a.active) }));
  return { categories: roots, articles };
}

async function createCategory(db, { name, parentId = null }) {
  const n = clean(name);
  if (!n) return { error: 'Nom de la catégorie requis' };
  const { byId } = build(await all(db));
  if (byId.size >= MAX_CATEGORIES) return { error: `${MAX_CATEGORIES} catégories au plus` };
  const parent = parentId ? Number(parentId) : null;
  if (parent && !byId.has(parent)) return { error: 'Catégorie parente introuvable', status: 404 };
  if (parent && depthOf(byId, parent) >= MAX_DEPTH) return { error: `${MAX_DEPTH} niveaux au plus` };
  if ([...byId.values()].some(c => (c.parentId || null) === parent && c.name.toLowerCase() === n.toLowerCase())) return { error: 'Cette catégorie existe déjà ici' };
  const siblings = [...byId.values()].filter(c => (c.parentId || null) === parent).length;
  const id = (await db('INSERT INTO kb_categories (name, parent_id, position) VALUES (?, ?, ?)', [n, parent, siblings])).insertId;
  await refresh(db);
  return { ok: true, id };
}
async function renameCategory(db, id, name) {
  const n = clean(name);
  if (!n) return { error: 'Nom de la catégorie requis' };
  const r = await db('UPDATE kb_categories SET name = ? WHERE id = ?', [n, id]);
  if (!r.affectedRows) return { error: 'Catégorie introuvable', status: 404 };
  await refresh(db);
  return { ok: true };
}
// Its articles and sub-categories go up to its parent
async function deleteCategory(db, id) {
  const [c] = await db('SELECT * FROM kb_categories WHERE id = ?', [id]);
  if (!c) return { error: 'Catégorie introuvable', status: 404 };
  const parent = c.parent_id || null;
  await db('UPDATE kb_categories SET parent_id = ?, position = position + 10000 WHERE parent_id = ?', [parent, id]);
  await db("UPDATE faq_entries SET category_id = ?, category = '' WHERE category_id = ?", [parent, id]);
  await db('DELETE FROM kb_categories WHERE id = ?', [id]);
  await refresh(db);
  return { ok: true };
}

// Drag and drop: a category under another one (or at the root), an article into a category (or
// none), at a place among its new siblings
async function move(db, { kind, id, parentId = null, index = null }) {
  id = Number(id);
  const target = parentId ? Number(parentId) : null;
  const { byId } = build(await all(db));
  if (target && !byId.has(target)) return { error: 'Catégorie introuvable', status: 404 };
  if (kind === 'category') {
    const node = byId.get(id);
    if (!node) return { error: 'Catégorie introuvable', status: 404 };
    for (let n = byId.get(target); n; n = byId.get(n.parentId)) if (n.id === id) return { error: 'Une catégorie ne va pas dans l\'une des siennes' };
    if ((target ? depthOf(byId, target) : 0) + heightOf(node) > MAX_DEPTH) return { error: `${MAX_DEPTH} niveaux au plus` };
    const siblings = [...byId.values()].filter(c => (c.parentId || null) === target && c.id !== id).sort((a, b) => a.position - b.position || a.id - b.id).map(c => c.id);
    siblings.splice(index === null ? siblings.length : Math.max(0, Math.min(siblings.length, Number(index))), 0, id);
    await db('UPDATE kb_categories SET parent_id = ? WHERE id = ?', [target, id]);
    for (const [i, cid] of siblings.entries()) await db('UPDATE kb_categories SET position = ? WHERE id = ?', [i, cid]);
    await refresh(db);
    return { ok: true };
  }
  if (kind === 'article') {
    const [a] = await db('SELECT id FROM faq_entries WHERE id = ?', [id]);
    if (!a) return { error: 'Article introuvable', status: 404 };
    const siblings = (await db(`SELECT id FROM faq_entries WHERE ${target ? 'category_id = ?' : 'category_id IS NULL'} AND id <> ? AND translation_of IS NULL ORDER BY position, id`, target ? [target, id] : [id])).map(r => r.id);
    siblings.splice(index === null ? siblings.length : Math.max(0, Math.min(siblings.length, Number(index))), 0, id);
    await db('UPDATE faq_entries SET category_id = ?, category = ? WHERE id = ?', [target, target ? pathOf(byId, target) : '', id]);
    // Its translations follow it
    await db('UPDATE faq_entries SET category_id = ?, category = ? WHERE translation_of = ?', [target, target ? pathOf(byId, target) : '', id]);
    for (const [i, aid] of siblings.entries()) await db('UPDATE faq_entries SET position = ? WHERE id = ?', [i, aid]);
    return { ok: true };
  }
  return { error: 'kind : category ou article' };
}

// The editor still gives a category as text: an existing path, or a new root category
async function syncArticle(db, id) {
  const [a] = await db('SELECT category FROM faq_entries WHERE id = ?', [id]);
  if (!a) return;
  const { byId } = build(await all(db));
  const want = String(a.category || '').trim();
  if (!want) { await db('UPDATE faq_entries SET category_id = NULL WHERE id = ?', [id]); return; }
  let found = [...byId.keys()].find(cid => pathOf(byId, cid).toLowerCase() === want.toLowerCase());
  if (!found) found = (await createCategory(db, { name: want.split(SEP).pop() })).id;
  if (found) { await db('UPDATE faq_entries SET category_id = ? WHERE id = ?', [found, id]); await refresh(db); }
}

// ORDER BY for the readers: the tree's order, then the article's place (faq_entries unaliased)
const ORDER = "(SELECT k.sort_key FROM kb_categories k WHERE k.id = faq_entries.category_id) IS NULL, (SELECT k.sort_key FROM kb_categories k WHERE k.id = faq_entries.category_id), category = '', category, position";

module.exports = { MAX_DEPTH, SEP, tree, createCategory, renameCategory, deleteCategory, move, syncArticle, refresh, ORDER };

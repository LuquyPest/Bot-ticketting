// Discord caps a category at 50 channels. When a ticket category is full, the ticket goes to an
// overflow category (« Tickets 2 », « Tickets 3 »…) created right below it with the same
// permissions. Overflow categories left empty are deleted by the health job (utils/guildHealth.js).
const { ChannelType } = require('discord.js');
const logger = require('./logger');

const CATEGORY_LIMIT = 50;

const childCount = (guild, categoryId) => guild.channels.cache.filter(c => c.parentId === categoryId).size;

// Configured category an overflow category belongs to (itself when it is not an overflow one).
async function baseCategoryOf(db, categoryId) {
  if (!categoryId) return null;
  const [row] = await db('SELECT base_category_id FROM overflow_categories WHERE category_id = ?', [categoryId]).catch(() => []);
  return row?.base_category_id || categoryId;
}

// Whether categoryId is baseId or one of its overflow categories.
async function inCategoryFamily(db, categoryId, baseId) {
  return !!categoryId && (await baseCategoryOf(db, categoryId)) === baseId;
}

// Id of a category with room for `needed` more channels: baseId first, then its overflow
// categories, else a new one. Falls back to baseId (Discord then reports the error as before).
async function categoryWithRoom(db, guild, baseId, needed = 1) {
  if (!baseId || !guild) return baseId || null;
  const base = guild.channels.cache.get(baseId) || await guild.channels.fetch(baseId).catch(() => null);
  if (base?.type !== ChannelType.GuildCategory) return baseId;
  if (childCount(guild, base.id) + needed <= CATEGORY_LIMIT) return base.id;

  const rows = await db('SELECT category_id, position FROM overflow_categories WHERE base_category_id = ? ORDER BY position', [base.id]);
  for (const r of rows) {
    const cat = guild.channels.cache.get(r.category_id);
    if (!cat) { await db('DELETE FROM overflow_categories WHERE category_id = ?', [r.category_id]); continue; }
    if (childCount(guild, cat.id) + needed <= CATEGORY_LIMIT) return cat.id;
  }
  const position = rows.reduce((max, r) => Math.max(max, r.position), 1) + 1;
  try {
    const created = await guild.channels.create({
      name: `${base.name} ${position}`.slice(0, 100),
      type: ChannelType.GuildCategory,
      position: base.position + 1,
      permissionOverwrites: base.permissionOverwrites.cache.map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })),
      reason: `Catégorie « ${base.name} » pleine (${CATEGORY_LIMIT} salons)`,
    });
    await db('INSERT INTO overflow_categories (category_id, base_category_id, position) VALUES (?, ?, ?)', [created.id, base.id, position]);
    logger.info('Catégorie de débordement créée', { guildId: guild.id, base: base.id, category: created.id });
    return created.id;
  } catch (err) {
    logger.warn('Catégorie de débordement impossible à créer', { guildId: guild.id, base: base.id, err: err.message });
    return base.id;
  }
}

// Deletes the overflow categories that no longer hold any channel.
async function pruneEmptyOverflow(db, guild) {
  const rows = await db('SELECT category_id FROM overflow_categories');
  let removed = 0;
  for (const { category_id } of rows) {
    const cat = guild.channels.cache.get(category_id);
    if (cat && childCount(guild, cat.id) > 0) continue;
    if (cat && !(await cat.delete('Catégorie de débordement vide').then(() => true, () => false))) continue;
    await db('DELETE FROM overflow_categories WHERE category_id = ?', [category_id]);
    removed++;
  }
  return removed;
}

module.exports = { CATEGORY_LIMIT, categoryWithRoom, baseCategoryOf, inCategoryFamily, pruneEmptyOverflow };

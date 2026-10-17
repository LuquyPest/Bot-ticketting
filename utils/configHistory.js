// History of the server settings (guild_config): every change keeps the before/after value of
// each modified field, so the dashboard can show who changed what and go back to an earlier state.
// Secret fields are recorded as "modified" only, never in clear, and are not restored.
const { parseJsonField } = require('./jsonField');

const MAX_ENTRIES = 500;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// { field: { before, after } } for the fields that differ between two API snapshots
function diffConfig(before, after, secretFields = new Set()) {
  const changes = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (same(before[k], after[k])) continue;
    changes[k] = secretFields.has(k) ? { secret: true } : { before: before[k] ?? null, after: after[k] ?? null };
  }
  return changes;
}

async function recordHistory(db, actor, changes, { source = 'settings', restoredFrom = null } = {}) {
  if (!Object.keys(changes).length) return null;
  const { insertId } = await db(
    'INSERT INTO config_history (actor_id, actor_tag, source, restored_from, changes) VALUES (?, ?, ?, ?, ?)',
    [String(actor.id), String(actor.username || actor.tag || actor.id).slice(0, 100), source, restoredFrom, JSON.stringify(changes)]
  );
  // Keep the most recent entries only
  await db('DELETE FROM config_history WHERE id <= ?', [insertId - MAX_ENTRIES]);
  return insertId;
}

async function listHistory(db, { page = 1, limit = 30 } = {}) {
  const [rows, [{ total }]] = await Promise.all([
    db('SELECT * FROM config_history ORDER BY id DESC LIMIT ? OFFSET ?', [limit, (page - 1) * limit]),
    db('SELECT COUNT(*) AS total FROM config_history'),
  ]);
  return {
    entries: rows.map(r => ({ ...r, changes: parseJsonField(r.changes, {}) })),
    total: Number(total), page, pages: Math.ceil(total / limit),
  };
}

// Values that bring the settings back to their state just before entry `id`: for every field
// changed by that entry or a later one, the "before" of the oldest such change.
async function restorePlan(db, id) {
  const rows = await db('SELECT id, changes FROM config_history WHERE id >= ? ORDER BY id ASC', [id]);
  if (!rows.length || rows[0].id !== id) return null;
  const updates = {}, skipped = new Set();
  for (const r of rows) {
    for (const [k, c] of Object.entries(parseJsonField(r.changes, {}))) {
      if (c.secret) { skipped.add(k); continue; }
      if (!(k in updates)) updates[k] = c.before;
    }
  }
  return { updates, skipped: [...skipped] };
}

module.exports = { diffConfig, recordHistory, listHistory, restorePlan, MAX_ENTRIES };

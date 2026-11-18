// Stages of a ticket (statuts) — the three built-in ones, Ouvert / En attente / En cours, whose
// Discord category and SLA live in guild_config, plus the custom statuses of the space (v4.2,
// table ticket_stages, key « s_<id> »). Each custom status behaves like one of the built-in ones
// (kind) for what the requester sees (portal, notices) and the metrics; it has its own label,
// colour, Discord category and SLA.
const BUILTIN = ['open', 'waiting', 'in_progress'];
const LABEL = { open: 'Ouvert', waiting: 'En attente', in_progress: 'En cours' };
const COLOR = { open: 'sky', waiting: 'amber', in_progress: 'emerald' };
const CATEGORY_COLUMN = { open: 'ticket_category_id', waiting: 'waiting_category_id', in_progress: 'in_progress_category_id' };
const SLA_COLUMN = { open: 'sla_open_hours', waiting: 'sla_waiting_hours', in_progress: 'sla_in_progress_hours' };
const COLORS = ['sky', 'amber', 'emerald', 'violet', 'rose', 'orange', 'teal', 'indigo', 'slate'];
const CUSTOM_RE = /^s_(\d{1,9})$/;
const MAX_CUSTOM = 20;

const CFG_COLUMNS = [...Object.values(CATEGORY_COLUMN), ...Object.values(SLA_COLUMN)].join(', ');

// Every stage of the space, built-in first: [{ key, label, color, kind, categoryId, slaHours, builtin }]
async function listStages(db, cfg = null) {
  if (!cfg || !(SLA_COLUMN.open in cfg)) [cfg] = await db(`SELECT ${CFG_COLUMNS} FROM guild_config WHERE id = 1`).catch(() => [{}]);
  cfg = cfg || {};
  const custom = await db('SELECT id, label, color, kind, category_id, sla_hours, position FROM ticket_stages ORDER BY position, id').catch(() => []);
  return [
    ...BUILTIN.map(key => ({ key, label: LABEL[key], color: COLOR[key], kind: key, categoryId: cfg[CATEGORY_COLUMN[key]] || null, slaHours: Number(cfg[SLA_COLUMN[key]]) || 0, builtin: true })),
    ...custom.map(c => ({ key: `s_${c.id}`, id: c.id, label: c.label, color: c.color, kind: c.kind, categoryId: c.category_id || null, slaHours: Number(c.sla_hours) || 0, builtin: false, position: c.position })),
  ];
}

async function stageOf(db, key) {
  if (BUILTIN.includes(key)) return (await listStages(db)).find(s => s.key === key);
  const m = CUSTOM_RE.exec(String(key || ''));
  if (!m) return null;
  return (await listStages(db)).find(s => s.key === key) || null;
}

// { stage key: SLA hours } — for utils/sla.js (cfg.stageSla)
async function slaMap(db, cfg = null) {
  return Object.fromEntries((await listStages(db, cfg)).map(s => [s.key, s.slaHours]));
}
// The config of a space with the SLA of every stage attached (slaStatus / breachedSql)
async function withStageSla(db, cfg) {
  return { ...(cfg || {}), stageSla: await slaMap(db, cfg) };
}

// The built-in stage a stage behaves like (unknown or deleted: open)
const kindIn = (stages, key) => stages.find(s => s.key === key)?.kind || (BUILTIN.includes(key) ? key : 'open');
async function kindOf(db, key) {
  if (BUILTIN.includes(key)) return key;
  return kindIn(await listStages(db), key);
}

// ── Custom statuses (Paramètres → Tickets → Statuts) ──
function clean(input = {}) {
  const label = typeof input.label === 'string' ? input.label.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40) : '';
  if (!label) return { error: 'Nom du statut requis (40 caractères au plus)' };
  if (Object.values(LABEL).some(l => l.toLowerCase() === label.toLowerCase())) return { error: 'Ce nom est celui d\'un statut de base' };
  const color = COLORS.includes(input.color) ? input.color : 'violet';
  const kind = BUILTIN.includes(input.kind) ? input.kind : 'in_progress';
  const categoryId = input.categoryId ? String(input.categoryId) : null;
  if (categoryId && !/^\d{17,20}$/.test(categoryId)) return { error: 'Catégorie Discord invalide' };
  const slaHours = input.slaHours === undefined || input.slaHours === '' || input.slaHours === null ? 0 : Number(input.slaHours);
  if (!Number.isInteger(slaHours) || slaHours < 0 || slaHours > 720) return { error: 'Délai : un nombre d\'heures entre 0 et 720' };
  return { value: { label, color, kind, categoryId, slaHours } };
}

async function createStage(db, input) {
  const [n] = await db('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS pos FROM ticket_stages');
  if (Number(n.n) >= MAX_CUSTOM) return { error: `${MAX_CUSTOM} statuts personnalisés au plus` };
  const r = clean(input);
  if (r.error) return r;
  const [dup] = await db('SELECT id FROM ticket_stages WHERE LOWER(label) = LOWER(?)', [r.value.label]);
  if (dup) return { error: 'Un statut porte déjà ce nom' };
  const v = r.value;
  const { insertId } = await db('INSERT INTO ticket_stages (label, color, kind, category_id, sla_hours, position) VALUES (?, ?, ?, ?, ?, ?)', [v.label, v.color, v.kind, v.categoryId, v.slaHours, Number(n.pos) + 1]);
  return { ok: true, key: `s_${insertId}` };
}

async function updateStage(db, id, input) {
  const [row] = await db('SELECT id FROM ticket_stages WHERE id = ?', [id]);
  if (!row) return { error: 'Statut introuvable', status: 404 };
  const r = clean(input);
  if (r.error) return r;
  const [dup] = await db('SELECT id FROM ticket_stages WHERE LOWER(label) = LOWER(?) AND id <> ?', [r.value.label, id]);
  if (dup) return { error: 'Un statut porte déjà ce nom' };
  const v = r.value;
  await db('UPDATE ticket_stages SET label = ?, color = ?, kind = ?, category_id = ?, sla_hours = ? WHERE id = ?', [v.label, v.color, v.kind, v.categoryId, v.slaHours, id]);
  return { ok: true };
}

// Its tickets go back to the built-in stage it behaved like (without moving their channel)
async function deleteStage(db, id) {
  const [row] = await db('SELECT id, kind FROM ticket_stages WHERE id = ?', [id]);
  if (!row) return { error: 'Statut introuvable', status: 404 };
  const moved = await db('UPDATE tickets SET stage = ?, stage_changed_at = NOW() WHERE stage = ?', [row.kind, `s_${id}`]);
  await db('DELETE FROM ticket_stages WHERE id = ?', [id]);
  return { ok: true, moved: moved.affectedRows || 0, to: row.kind };
}

// New order of the custom statuses: [id, id, …]
async function reorderStages(db, ids) {
  if (!Array.isArray(ids)) return { error: 'Ordre invalide' };
  let pos = 1;
  for (const id of ids.map(Number).filter(Number.isInteger).slice(0, MAX_CUSTOM)) await db('UPDATE ticket_stages SET position = ? WHERE id = ?', [pos++, id]);
  return { ok: true };
}

module.exports = {
  BUILTIN, LABEL, COLOR, COLORS, CATEGORY_COLUMN, SLA_COLUMN, CUSTOM_RE, MAX_CUSTOM,
  listStages, stageOf, slaMap, withStageSla, kindIn, kindOf, createStage, updateStage, deleteStage, reorderStages,
};

// Inventory / CMDB of a space (v7, conception/v7.md §3.4). Off until a space turns it on.
// - Types defined by the space (computer, server, software, licence, service…), each with its fields.
// - Elements: a type, a name, a status, an owner (a contact and/or an organisation), a location,
//   a serial number, the values of their type's fields and notes; every change is in their history.
// - Relations between elements: « depends on », « installed on », « part of » (no element related
//   to itself; « part of » and « installed on » without loops). Seen from both sides.
// Links to tickets, problems and changes, the requester's choice and impact: utils/assetLinks.js.
const { parseJsonField } = require('./jsonField');

const STATUSES = ['in_use', 'in_stock', 'maintenance', 'retired'];
const FIELD_TYPES = ['text', 'number', 'date', 'choice'];
const RELATIONS = ['depends_on', 'installed_on', 'part_of'];
const MAX_TYPES = 50, MAX_FIELDS = 30, MAX_ASSETS = 100000, MAX_RELATIONS = 200;

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const keyOf = label => label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

async function enabled(db) {
  const [c] = await db('SELECT assets_enabled FROM guild_config WHERE id = 1').catch(() => []);
  return Number(c?.assets_enabled) === 1;
}

// ── Types ──
const shapeType = t => ({ id: t.id, name: t.name, icon: t.icon || '', fields: parseJsonField(t.fields, []) || [], count: Number(t.count || 0) });
async function listTypes(db) {
  return (await db('SELECT t.*, (SELECT COUNT(*) FROM assets a WHERE a.type_id = t.id) AS count FROM asset_types t ORDER BY t.position, t.name').catch(() => [])).map(shapeType);
}
function cleanFields(raw) {
  const fields = [];
  for (const f of (Array.isArray(raw) ? raw : []).slice(0, MAX_FIELDS)) {
    const label = str(f?.label, 60);
    if (!label) return { error: 'Chaque champ a un nom' };
    const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
    const key = keyOf(f.key || label) || `champ_${fields.length + 1}`;
    if (fields.some(x => x.key === key)) return { error: `Deux champs portent le nom « ${label} »` };
    const options = type === 'choice' ? [...new Set((Array.isArray(f.options) ? f.options : String(f.options || '').split(',')).map(o => str(String(o), 60)).filter(Boolean))].slice(0, 50) : undefined;
    if (type === 'choice' && !options.length) return { error: `Le champ « ${label} » a besoin de choix` };
    fields.push({ key, label, type, ...(options ? { options } : {}) });
  }
  return { value: fields };
}
async function saveType(db, id, input = {}) {
  const name = str(input.name, 60);
  if (!name) return { error: 'Nom du type requis' };
  const f = cleanFields(input.fields);
  if (f.error) return f;
  const icon = str(input.icon, 8);
  if ((await db('SELECT 1 FROM asset_types WHERE name = ? AND id <> ?', [name, id || 0])).length) return { error: 'Ce type existe déjà' };
  if (id) {
    const r = await db('UPDATE asset_types SET name = ?, icon = ?, fields = ? WHERE id = ?', [name, icon || null, JSON.stringify(f.value), id]);
    return r.affectedRows ? { ok: true, id } : { error: 'Type introuvable', status: 404 };
  }
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM asset_types');
  if (Number(n) >= MAX_TYPES) return { error: `${MAX_TYPES} types au plus` };
  return { ok: true, id: (await db('INSERT INTO asset_types (name, icon, fields, position) VALUES (?, ?, ?, ?)', [name, icon || null, JSON.stringify(f.value), Number(n)])).insertId };
}
async function deleteType(db, id) {
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM assets WHERE type_id = ?', [id]);
  if (Number(n)) return { error: `Ce type a encore ${n} élément(s)`, status: 409 };
  const r = await db('DELETE FROM asset_types WHERE id = ?', [id]);
  return r.affectedRows ? { ok: true } : { error: 'Type introuvable', status: 404 };
}

// ── Elements ──
const shape = a => ({
  id: a.id, typeId: a.type_id, typeName: a.type_name || null, typeIcon: a.type_icon || '', name: a.name, status: a.status, serial: a.serial || '', location: a.location || '',
  ownerContactId: a.owner_contact_id || null, ownerContactName: a.owner_contact_name || null, ownerOrgId: a.owner_org_id || null, ownerOrgName: a.owner_org_name || null,
  fields: parseJsonField(a.fields, {}) || {}, notes: a.notes || '', createdAt: a.created_at, updatedAt: a.updated_at,
  // v8: warranty, vendor support, licence (seats, expiry, cost; the seats used come with the element)
  warrantyEndsOn: ymdOf(a.warranty_ends_on), supportEndsOn: ymdOf(a.support_ends_on), licenceExpiresOn: ymdOf(a.licence_expires_on),
  seats: a.seats == null ? null : Number(a.seats), cost: a.cost == null ? null : Number(a.cost), seatsUsed: a.seats_used == null ? null : Number(a.seats_used),
});
function ymdOf(d) { return d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d ? String(d).slice(0, 10) : null; }
const SELECT = `SELECT a.*, t.name AS type_name, t.icon AS type_icon, c.display_name AS owner_contact_name, o.name AS owner_org_name,
    (SELECT COUNT(*) FROM asset_assignments x WHERE x.licence_id = a.id) AS seats_used
  FROM assets a JOIN asset_types t ON t.id = a.type_id LEFT JOIN contacts c ON c.id = a.owner_contact_id LEFT JOIN organizations o ON o.id = a.owner_org_id`;

async function listAssets(db, { typeId = null, status = null, orgId = null, contactId = null, q = '', limit = 200, offset = 0, expiring = false } = {}) {
  const where = [], params = [];
  // v8: « expire bientôt » — warranty, support or licence ending within 30 days (or over)
  if (expiring) { const until = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10); where.push("a.status <> 'retired' AND (a.warranty_ends_on <= ? OR a.support_ends_on <= ? OR a.licence_expires_on <= ? OR a.seats < (SELECT COUNT(*) FROM asset_assignments x WHERE x.licence_id = a.id))"); params.push(until, until, until); }
  if (typeId) { where.push('a.type_id = ?'); params.push(Number(typeId)); }
  if (STATUSES.includes(status)) { where.push('a.status = ?'); params.push(status); }
  if (orgId) { where.push('(a.owner_org_id = ? OR a.owner_org_id IN (SELECT id FROM organizations WHERE parent_id = ?))'); params.push(Number(orgId), Number(orgId)); }
  if (contactId) { where.push('a.owner_contact_id = ?'); params.push(Number(contactId)); }
  const term = str(q, 100);
  if (term) { where.push('(a.name LIKE ? OR a.serial LIKE ? OR a.location LIKE ?)'); params.push(...Array(3).fill(`%${term.replace(/[\\%_]/g, m => `\\${m}`)}%`)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await db(`SELECT COUNT(*) AS total FROM assets a ${w}`, params);
  const rows = await db(`${SELECT} ${w} ORDER BY a.name, a.id LIMIT ? OFFSET ?`, [...params, Math.min(500, Math.max(1, Number(limit) || 200)), Math.max(0, Number(offset) || 0)]);
  return { total: Number(total), assets: rows.map(shape) };
}
async function getAsset(db, id) {
  const [a] = await db(`${SELECT} WHERE a.id = ?`, [id]);
  if (!a) return null;
  const out = await db(`SELECT r.kind, r.to_id AS id, b.name, t.name AS type_name, b.status FROM asset_relations r JOIN assets b ON b.id = r.to_id JOIN asset_types t ON t.id = b.type_id WHERE r.from_id = ? ORDER BY b.name`, [id]);
  const inc = await db(`SELECT r.kind, r.from_id AS id, b.name, t.name AS type_name, b.status FROM asset_relations r JOIN assets b ON b.id = r.from_id JOIN asset_types t ON t.id = b.type_id WHERE r.to_id = ? ORDER BY b.name`, [id]);
  const history = await db('SELECT actor_tag, changes, created_at FROM asset_history WHERE asset_id = ? ORDER BY id DESC LIMIT 100', [id]);
  return {
    ...shape(a),
    relations: [...out.map(r => ({ ...r, direction: 'out' })), ...inc.map(r => ({ ...r, direction: 'in' }))].map(r => ({ id: r.id, name: r.name, typeName: r.type_name, status: r.status, kind: r.kind, direction: r.direction })),
    history: history.map(h => ({ by: h.actor_tag, changes: parseJsonField(h.changes, {}), at: h.created_at })),
    assignments: a.seats == null ? [] : await require('./assetLifecycle').assignmentsOf(db, id), // v8: licence seats
  };
}

async function clean(db, input, cur = null) {
  const v = {};
  const typeId = input.typeId !== undefined ? Number(input.typeId) : cur?.type_id;
  const [type] = typeId ? await db('SELECT * FROM asset_types WHERE id = ?', [typeId]) : [];
  if (!type) return { error: 'Type d\'élément introuvable' };
  v.type_id = type.id;
  if (!cur || input.name !== undefined) { v.name = str(input.name, 150); if (!v.name) return { error: 'Nom de l\'élément requis' }; }
  if (input.status !== undefined) { if (!STATUSES.includes(input.status)) return { error: 'Statut invalide' }; v.status = input.status; }
  if (input.serial !== undefined) v.serial = str(input.serial, 100) || null;
  if (input.location !== undefined) v.location = str(input.location, 200) || null;
  if (input.notes !== undefined) v.notes = typeof input.notes === 'string' ? input.notes.slice(0, 5000) : null;
  if (input.ownerContactId !== undefined) {
    v.owner_contact_id = input.ownerContactId ? Number(input.ownerContactId) : null;
    if (v.owner_contact_id && !(await db('SELECT 1 FROM contacts WHERE id = ?', [v.owner_contact_id])).length) return { error: 'Contact introuvable' };
  }
  if (input.ownerOrgId !== undefined) {
    v.owner_org_id = input.ownerOrgId ? Number(input.ownerOrgId) : null;
    if (v.owner_org_id && !(await db('SELECT 1 FROM organizations WHERE id = ?', [v.owner_org_id])).length) return { error: 'Organisation introuvable' };
  }
  // v8: warranty, support, licence
  const lc = require('./assetLifecycle').clean(input);
  if (lc.error) return lc;
  Object.assign(v, lc.value);
  if (input.fields !== undefined || (cur && v.type_id !== cur.type_id)) {
    const defs = parseJsonField(type.fields, []) || [];
    const given = input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields) ? input.fields : (parseJsonField(cur?.fields, {}) || {});
    const out = {};
    for (const f of defs) {
      const raw = given[f.key];
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;
      const s = String(raw).trim().slice(0, 500);
      if (f.type === 'number' && !Number.isFinite(Number(s))) return { error: `« ${f.label} » : un nombre` };
      if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: `« ${f.label} » : une date AAAA-MM-JJ` };
      if (f.type === 'choice' && !f.options.includes(s)) return { error: `« ${f.label} » : un des choix proposés` };
      out[f.key] = f.type === 'number' ? Number(s) : s;
    }
    v.fields = JSON.stringify(out);
  }
  return { value: v };
}
const LABELS = { type_id: 'type', name: 'nom', status: 'statut', serial: 'n° de série', location: 'lieu', notes: 'notes', owner_contact_id: 'contact', owner_org_id: 'organisation', fields: 'champs',
  warranty_ends_on: 'fin de garantie', support_ends_on: 'fin du support', seats: 'sièges', licence_expires_on: 'échéance de licence', cost: 'coût' };
async function history(db, assetId, actor, changes) {
  await db('INSERT INTO asset_history (asset_id, actor_tag, changes) VALUES (?, ?, ?)', [assetId, String(actor?.username || actor?.tag || 'Système').slice(0, 100), JSON.stringify(changes)]);
}

async function createAsset(db, input = {}, actor) {
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM assets');
  if (Number(n) >= MAX_ASSETS) return { error: `${MAX_ASSETS} éléments au plus` };
  const r = await clean(db, input);
  if (r.error) return r;
  const v = { status: 'in_use', fields: '{}', ...r.value };
  const cols = Object.keys(v);
  const id = (await db(`INSERT INTO assets (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(c => v[c]))).insertId;
  await history(db, id, actor, { created: v.name });
  return { ok: true, id };
}
async function updateAsset(db, id, input = {}, actor) {
  const [cur] = await db('SELECT * FROM assets WHERE id = ?', [id]);
  if (!cur) return { error: 'Élément introuvable', status: 404 };
  const r = await clean(db, input, cur);
  if (r.error) return r;
  const changed = Object.entries(r.value).filter(([k, val]) => String(val ?? '') !== String((k === 'fields' ? JSON.stringify(parseJsonField(cur.fields, {}) || {}) : cur[k]) ?? ''));
  if (!changed.length) return { ok: true };
  await db(`UPDATE assets SET ${changed.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, [...changed.map(([, val]) => val), id]);
  await history(db, id, actor, Object.fromEntries(changed.map(([k, val]) => [LABELS[k] || k, k === 'fields' ? 'modifiés' : k === 'notes' ? 'modifiées' : (val ?? '—')])));
  return { ok: true };
}
async function deleteAsset(db, id) {
  const r = await db('DELETE FROM assets WHERE id = ?', [id]);
  return r.affectedRows ? { ok: true } : { error: 'Élément introuvable', status: 404 };
}

// ── Relations ──
// Would from → to (kind) close a loop of « part of » / « installed on »?
async function loops(db, from, to, kind) {
  if (kind === 'depends_on') return false;
  let frontier = [to];
  const seen = new Set();
  for (let depth = 0; frontier.length && depth < 50; depth++) {
    if (frontier.includes(from)) return true;
    frontier.forEach(x => seen.add(x));
    const rows = await db('SELECT to_id FROM asset_relations WHERE kind = ? AND from_id IN (?)', [kind, frontier]);
    frontier = rows.map(r => r.to_id).filter(x => !seen.has(x));
  }
  return frontier.includes(from);
}
async function relate(db, from, to, kind, actor) {
  from = Number(from); to = Number(to);
  if (!RELATIONS.includes(kind)) return { error: `Relation : ${RELATIONS.join(', ')}` };
  if (!from || !to || from === to) return { error: 'Un élément ne se relie pas à lui-même' };
  const found = await db('SELECT id, name FROM assets WHERE id IN (?)', [[from, to]]);
  if (found.length !== 2) return { error: 'Élément introuvable', status: 404 };
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM asset_relations WHERE from_id = ?', [from]);
  if (Number(n) >= MAX_RELATIONS) return { error: `${MAX_RELATIONS} relations au plus par élément` };
  if (await loops(db, from, to, kind)) return { error: 'Cette relation ferait une boucle' };
  const r = await db('INSERT IGNORE INTO asset_relations (from_id, to_id, kind) VALUES (?, ?, ?)', [from, to, kind]);
  if (r.affectedRows) {
    const name = id => found.find(x => x.id === id)?.name;
    await history(db, from, actor, { relation: `${kind} ${name(to)}` });
    await history(db, to, actor, { relation: `${name(from)} ${kind}` });
  }
  return { ok: true };
}
async function unrelate(db, from, to, kind, actor) {
  const r = await db('DELETE FROM asset_relations WHERE from_id = ? AND to_id = ? AND kind = ?', [Number(from), Number(to), kind]);
  if (r.affectedRows) await history(db, Number(from), actor, { relationRemoved: `${kind} #${to}` });
  return { ok: true };
}

module.exports = { STATUSES, FIELD_TYPES, RELATIONS, enabled, listTypes, saveType, deleteType, listAssets, getAsset, createAsset, updateAsset, deleteAsset, relate, unrelate, loops };

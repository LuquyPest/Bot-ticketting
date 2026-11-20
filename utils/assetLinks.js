// Inventory and the rest of the service desk (v7, conception/v7.md §3.4):
// - elements linked to tickets, problems and changes (seen from both sides);
// - the requester picks one of their own elements when opening a ticket (member space);
// - impact of a change: the elements that depend on those it touches (« depends on », « installed
//   on », « part of », followed backwards), and the open tickets about them;
// - CSV import (update by serial number, else by type and name) and export.
const { parseJsonField } = require('./jsonField');
const A = require('./assets');

const TARGETS = ['ticket', 'problem', 'change'];
const MAX_PER_TARGET = 50;

async function targetExists(db, type, id) {
  const table = { ticket: 'tickets', problem: 'problems', change: 'changes' }[type];
  return !!(await db(`SELECT 1 FROM ${table} WHERE id = ?`, [id]).catch(() => [])).length;
}
async function link(db, assetId, type, targetId) {
  if (!TARGETS.includes(type)) return { error: 'Lien : ticket, problem ou change' };
  if (!(await db('SELECT 1 FROM assets WHERE id = ?', [assetId])).length) return { error: 'Élément introuvable', status: 404 };
  if (!(await targetExists(db, type, targetId))) return { error: 'Introuvable', status: 404 };
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM asset_links WHERE target_type = ? AND target_id = ?', [type, targetId]);
  if (Number(n) >= MAX_PER_TARGET) return { error: `${MAX_PER_TARGET} éléments au plus` };
  const r = await db('INSERT IGNORE INTO asset_links (asset_id, target_type, target_id) VALUES (?, ?, ?)', [assetId, type, targetId]);
  return { ok: true, changed: !!r.affectedRows };
}
async function unlink(db, assetId, type, targetId) {
  const r = await db('DELETE FROM asset_links WHERE asset_id = ? AND target_type = ? AND target_id = ?', [assetId, type, targetId]);
  return { ok: true, changed: !!r.affectedRows };
}
// The elements of a ticket, a problem or a change
async function ofTarget(db, type, targetId) {
  return (await db(`SELECT a.id, a.name, a.status, a.serial, t.name AS type_name, t.icon AS type_icon FROM asset_links l JOIN assets a ON a.id = l.asset_id JOIN asset_types t ON t.id = a.type_id
    WHERE l.target_type = ? AND l.target_id = ? ORDER BY a.name`, [type, targetId]).catch(() => [])).map(a => ({ id: a.id, name: a.name, status: a.status, serial: a.serial || '', typeName: a.type_name, typeIcon: a.type_icon || '' }));
}
// What an element is linked to (tickets through the reader's visibility)
async function ofAsset(db, assetId, vis) {
  const tickets = await db(`SELECT t.id, t.subject, t.status FROM asset_links l JOIN tickets t ON t.id = l.target_id WHERE l.asset_id = ? AND l.target_type = 'ticket' AND ${vis.sql} ORDER BY t.id DESC LIMIT 100`, [assetId, ...vis.params]).catch(() => []);
  const problems = await db("SELECT p.id, p.title, p.status FROM asset_links l JOIN problems p ON p.id = l.target_id WHERE l.asset_id = ? AND l.target_type = 'problem' ORDER BY p.id DESC", [assetId]).catch(() => []);
  const changes = await db("SELECT c.id, c.title, c.status FROM asset_links l JOIN changes c ON c.id = l.target_id WHERE l.asset_id = ? AND l.target_type = 'change' ORDER BY c.id DESC", [assetId]).catch(() => []);
  return { tickets, problems, changes };
}

// Impact of a change: its elements, and every element that depends on them (up to 6 steps)
async function impact(db, changeId, vis) {
  const direct = await ofTarget(db, 'change', changeId);
  const level = new Map(direct.map(a => [a.id, 0]));
  let frontier = direct.map(a => a.id);
  for (let depth = 1; frontier.length && depth <= 6; depth++) {
    const rows = await db('SELECT DISTINCT from_id FROM asset_relations WHERE to_id IN (?)', [frontier]);
    frontier = rows.map(r => r.from_id).filter(id => !level.has(id));
    for (const id of frontier) level.set(id, depth);
    if (level.size > 2000) break;
  }
  const ids = [...level.keys()];
  if (!ids.length) return { assets: [], tickets: [] };
  const assets = (await db('SELECT a.id, a.name, a.status, t.name AS type_name, o.name AS org_name FROM assets a JOIN asset_types t ON t.id = a.type_id LEFT JOIN organizations o ON o.id = a.owner_org_id WHERE a.id IN (?) ORDER BY a.name', [ids]))
    .map(a => ({ id: a.id, name: a.name, status: a.status, typeName: a.type_name, orgName: a.org_name || null, depth: level.get(a.id) })).sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
  const tickets = await db(`SELECT DISTINCT t.id, t.subject, l.asset_id FROM asset_links l JOIN tickets t ON t.id = l.target_id WHERE l.target_type = 'ticket' AND l.asset_id IN (?) AND t.status = 'open' AND ${vis.sql} ORDER BY t.id DESC LIMIT 200`, [ids, ...vis.params]).catch(() => []);
  return { assets, tickets: tickets.map(t => ({ id: t.id, subject: t.subject, assetId: t.asset_id })) };
}

// ── Member space: the requester's own elements ──
async function ofRequester(db, ownerIds) {
  if (!(await A.enabled(db))) return [];
  return (await db(`SELECT DISTINCT a.id, a.name, t.name AS type_name, t.icon AS type_icon FROM contact_identities ci JOIN assets a ON a.owner_contact_id = ci.contact_id JOIN asset_types t ON t.id = a.type_id
    WHERE ci.value IN (?) AND a.status <> 'retired' ORDER BY a.name LIMIT 100`, [ownerIds]).catch(() => [])).map(a => ({ id: a.id, name: a.name, typeName: a.type_name, typeIcon: a.type_icon || '' }));
}

// ── CSV ──
const SEP = ';';
const cell = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const STATUS_LABELS = { in_use: 'en service', in_stock: 'en stock', maintenance: 'en maintenance', retired: 'retiré' };
const statusOf = v => { const s = String(v || '').trim().toLowerCase(); return Object.entries(STATUS_LABELS).find(([k, l]) => s === k || s === l)?.[0] || null; };

async function exportCsv(db) {
  const types = await A.listTypes(db);
  const keys = [...new Map(types.flatMap(t => t.fields.map(f => [f.label, f]))).values()];
  const rows = await db('SELECT a.*, t.name AS type_name, o.name AS org_name, c.email AS contact_email FROM assets a JOIN asset_types t ON t.id = a.type_id LEFT JOIN organizations o ON o.id = a.owner_org_id LEFT JOIN contacts c ON c.id = a.owner_contact_id ORDER BY t.name, a.name');
  const head = ['id', 'type', 'nom', 'statut', 'numero_de_serie', 'lieu', 'organisation', 'contact', ...keys.map(f => f.label), 'notes'];
  const lines = [head.map(cell).join(SEP)];
  for (const a of rows) {
    const t = types.find(x => x.id === a.type_id);
    const f = parseJsonField(a.fields, {}) || {};
    lines.push([a.id, a.type_name, a.name, STATUS_LABELS[a.status] || a.status, a.serial, a.location, a.org_name, a.contact_email,
      ...keys.map(k => { const def = t?.fields.find(x => x.label === k.label); return def ? f[def.key] ?? '' : ''; }), a.notes].map(cell).join(SEP));
  }
  return lines.join('\n');
}

// Import: one element per line, by column names (type, nom, statut, numero_de_serie, lieu,
// organisation, contact (e-mail), the fields of the type by their label, notes). An element with
// the same serial number, else the same type and name, is updated. → { created, updated, errors }
async function importCsv(db, text, actor) {
  const { parse } = require('./helpdeskImport');
  let rows;
  try { rows = parse('csv', String(text || '')); } catch (err) { return { error: err.message }; }
  if (!Array.isArray(rows) || !rows.length) return { error: 'Aucune ligne' };
  if (rows.length > 5000) return { error: '5 000 lignes au plus' };
  const norm = k => String(k).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const get = (row, ...names) => { for (const [k, v] of Object.entries(row)) if (names.includes(norm(k))) return String(v ?? '').trim(); return ''; };
  const types = await A.listTypes(db);
  const out = { created: 0, updated: 0, errors: [] };
  for (const [i, row] of rows.entries()) {
    const line = i + 2;
    const typeName = get(row, 'type', 'typedelement');
    const type = types.find(t => t.name.toLowerCase() === typeName.toLowerCase());
    if (!type) { out.errors.push(`Ligne ${line} : type « ${typeName || '?'} » inconnu`); continue; }
    const name = get(row, 'nom', 'name');
    if (!name) { out.errors.push(`Ligne ${line} : nom manquant`); continue; }
    const input = { typeId: type.id, name, serial: get(row, 'numerodeserie', 'serie', 'serial', 'serialnumber'), location: get(row, 'lieu', 'location'), notes: get(row, 'notes') || undefined };
    const st = get(row, 'statut', 'status');
    if (st) { const s = statusOf(st); if (!s) { out.errors.push(`Ligne ${line} : statut « ${st} » inconnu`); continue; } input.status = s; }
    const orgName = get(row, 'organisation', 'organization');
    if (orgName) {
      const [o] = await db('SELECT id FROM organizations WHERE name = ?', [orgName]);
      if (!o) { out.errors.push(`Ligne ${line} : organisation « ${orgName} » inconnue`); continue; }
      input.ownerOrgId = o.id;
    }
    const email = get(row, 'contact', 'email', 'proprietaire');
    if (email) {
      const [c] = await db('SELECT id FROM contacts WHERE email = ? LIMIT 1', [email.toLowerCase()]);
      if (!c) { out.errors.push(`Ligne ${line} : contact « ${email} » inconnu`); continue; }
      input.ownerContactId = c.id;
    }
    input.fields = Object.fromEntries(type.fields.map(f => [f.key, get(row, norm(f.label), f.key.replace(/_/g, ''))]).filter(([, v]) => v !== ''));
    const [existing] = input.serial ? await db('SELECT id FROM assets WHERE serial = ? LIMIT 1', [input.serial]) : await db('SELECT id FROM assets WHERE type_id = ? AND name = ? LIMIT 1', [type.id, name]);
    const r = existing ? await A.updateAsset(db, existing.id, input, actor) : await A.createAsset(db, input, actor);
    if (r.error) out.errors.push(`Ligne ${line} : ${r.error}`);
    else if (existing) out.updated++;
    else out.created++;
  }
  return out;
}

module.exports = { TARGETS, link, unlink, ofTarget, ofAsset, impact, ofRequester, exportCsv, importCsv };

// Skills and languages of the staff (v7, conception/v7.md §3.2). A space keeps a list of skills
// (« Réseau », « Comptabilité »…); each staff member has some, and the languages they answer in.
// A ticket asks for skills: those of its subject (a category covers its sub-categories), those a
// rule or the staff added. Automatic assignment by a team (utils/teams.js) only picks among the
// members who have them all, and prefers those who speak the requester's language; when nobody
// fits, it falls back on the whole team as before.
const LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt'];
const MAX_SKILLS = 100, MAX_PER_TICKET = 10;

const cleanName = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 40) : '');
const ids = v => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
const langsOf = v => String(v || '').split(',').filter(l => LANGS.includes(l));

async function listSkills(db) {
  return (await db(`SELECT s.id, s.name, (SELECT COUNT(*) FROM staff_skills ss WHERE ss.skill_id = s.id) AS staff FROM skills s ORDER BY s.name`).catch(() => []))
    .map(s => ({ id: s.id, name: s.name, staff: Number(s.staff) }));
}
async function createSkill(db, name) {
  const n = cleanName(name);
  if (!n) return { error: 'Nom de la compétence requis (40 caractères au plus)' };
  const [{ c }] = await db('SELECT COUNT(*) AS c FROM skills');
  if (Number(c) >= MAX_SKILLS) return { error: `${MAX_SKILLS} compétences au plus` };
  if ((await db('SELECT 1 FROM skills WHERE name = ?', [n])).length) return { error: 'Cette compétence existe déjà' };
  return { ok: true, id: (await db('INSERT INTO skills (name) VALUES (?)', [n])).insertId };
}
async function renameSkill(db, id, name) {
  const n = cleanName(name);
  if (!n) return { error: 'Nom de la compétence requis (40 caractères au plus)' };
  if ((await db('SELECT 1 FROM skills WHERE name = ? AND id <> ?', [n, id])).length) return { error: 'Cette compétence existe déjà' };
  const r = await db('UPDATE skills SET name = ? WHERE id = ?', [n, id]);
  return r.affectedRows ? { ok: true } : { error: 'Compétence introuvable', status: 404 };
}
async function deleteSkill(db, id) {
  const r = await db('DELETE FROM skills WHERE id = ?', [id]);
  return r.affectedRows ? { ok: true } : { error: 'Compétence introuvable', status: 404 };
}
const known = async (db, list) => (list.length ? (await db('SELECT id FROM skills WHERE id IN (?)', [list])).length === list.length : true);

// ── Staff ──
async function staffList(db) {
  const users = await db("SELECT user_id, username, languages FROM dashboard_users WHERE role IN ('support', 'fondateur') ORDER BY username").catch(() => []);
  const rows = await db('SELECT user_id, skill_id FROM staff_skills').catch(() => []);
  return users.map(u => ({ userId: u.user_id, username: u.username || u.user_id, languages: langsOf(u.languages), skills: rows.filter(r => r.user_id === u.user_id).map(r => r.skill_id) }));
}
// { skills?, languages? } of one staff member
async function saveStaff(db, userId, input = {}) {
  if (!(await db("SELECT 1 FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [String(userId)])).length) return { error: 'Membre du staff introuvable', status: 404 };
  if (input.languages !== undefined) {
    const langs = [...new Set((Array.isArray(input.languages) ? input.languages : []).filter(l => LANGS.includes(l)))];
    await db('UPDATE dashboard_users SET languages = ? WHERE user_id = ?', [langs.join(',') || null, String(userId)]);
  }
  if (input.skills !== undefined) {
    const list = ids(input.skills).slice(0, MAX_SKILLS);
    if (!(await known(db, list))) return { error: 'Compétence introuvable' };
    await db('DELETE FROM staff_skills WHERE user_id = ?', [String(userId)]);
    for (const id of list) await db('INSERT IGNORE INTO staff_skills (user_id, skill_id) VALUES (?, ?)', [String(userId), id]);
  }
  return { ok: true };
}

// ── Subjects ──
async function subjectMap(db) {
  const out = {};
  for (const r of await db('SELECT subject, skill_id FROM subject_skills ORDER BY subject').catch(() => [])) (out[r.subject] ||= []).push(r.skill_id);
  return out;
}
async function saveSubjectMap(db, map = {}) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return { error: 'Format : { sujet: [compétences] }' };
  const [cfg] = await db('SELECT ticket_subjects FROM guild_config WHERE id = 1');
  const subjects = require('./jsonField').parseJsonField(cfg?.ticket_subjects, []).map(x => (typeof x === 'string' ? x : x?.label || x?.name)).filter(Boolean);
  const entries = Object.entries(map).map(([s, v]) => [String(s), ids(v).slice(0, MAX_PER_TICKET)]).filter(([, v]) => v.length);
  if (entries.some(([s]) => !subjects.includes(s))) return { error: 'Sujet inconnu (Paramètres → Tickets → Sujets)' };
  if (!(await known(db, [...new Set(entries.flatMap(([, v]) => v))]))) return { error: 'Compétence introuvable' };
  await db('DELETE FROM subject_skills');
  for (const [s, v] of entries) for (const id of v) await db('INSERT IGNORE INTO subject_skills (subject, skill_id) VALUES (?, ?)', [s, id]);
  return { ok: true };
}

// ── Tickets ──
// What a ticket asks for: [{ id, name, from: 'subject' | 'ticket' }]
async function ofTicket(db, ticket) {
  const lineage = require('./subjectTree').lineage(ticket.subject || '');
  const bySubject = lineage.length ? await db('SELECT DISTINCT s.id, s.name FROM subject_skills x JOIN skills s ON s.id = x.skill_id WHERE x.subject IN (?)', [lineage]).catch(() => []) : [];
  const own = await db('SELECT s.id, s.name FROM ticket_skills x JOIN skills s ON s.id = x.skill_id WHERE x.ticket_id = ?', [ticket.id]).catch(() => []);
  const out = new Map();
  for (const s of bySubject) out.set(s.id, { id: s.id, name: s.name, from: 'subject' });
  for (const s of own) if (!out.has(s.id)) out.set(s.id, { id: s.id, name: s.name, from: 'ticket' });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
// The skills the staff (or a rule) set on the ticket itself
async function setTicketSkills(db, ticketId, list) {
  const v = ids(list).slice(0, MAX_PER_TICKET);
  if (!(await known(db, v))) return { error: 'Compétence introuvable' };
  await db('DELETE FROM ticket_skills WHERE ticket_id = ?', [ticketId]);
  for (const id of v) await db('INSERT IGNORE INTO ticket_skills (ticket_id, skill_id) VALUES (?, ?)', [ticketId, id]);
  return { ok: true };
}
async function addTicketSkill(db, ticketId, skillId) {
  const r = await db('INSERT IGNORE INTO ticket_skills (ticket_id, skill_id) SELECT ?, id FROM skills WHERE id = ?', [ticketId, skillId]);
  return !!r.affectedRows;
}

// Narrows the eligible members of a team for a ticket (utils/teams.js pickAssignee):
// those with every skill asked, if any; then those who speak the requester's language, if any
async function narrow(db, ticket, eligible) {
  if (eligible.length < 2) return { list: eligible, by: [] };
  const by = [];
  let list = eligible;
  const asked = (await ofTicket(db, ticket)).map(s => s.id);
  if (asked.length) {
    const rows = await db('SELECT user_id, skill_id FROM staff_skills WHERE user_id IN (?) AND skill_id IN (?)', [list.map(e => String(e.user_id)), asked]).catch(() => []);
    const fit = list.filter(e => asked.every(id => rows.some(r => r.user_id === String(e.user_id) && r.skill_id === id)));
    if (fit.length) { list = fit; by.push('skills'); }
  }
  if (list.length > 1 && db.guildId) {
    const users = await db('SELECT user_id, languages FROM dashboard_users WHERE user_id IN (?)', [list.map(e => String(e.user_id))]).catch(() => []);
    const spoken = new Map(users.map(u => [u.user_id, langsOf(u.languages)]));
    if ([...spoken.values()].some(l => l.length)) {
      const lang = await require('./i18n').memberLang(ticket.owner_id, db.guildId).catch(() => null);
      const fit = lang ? list.filter(e => (spoken.get(String(e.user_id)) || []).includes(lang)) : [];
      if (fit.length) { list = fit; by.push('language'); }
    }
  }
  return { list, by };
}

module.exports = { LANGS, MAX_SKILLS, listSkills, createSkill, renameSkill, deleteSkill, staffList, saveStaff, subjectMap, saveSubjectMap, ofTicket, setTicketSkills, addTicketSkill, narrow };

// Shared plannings and coverage (v8, conception/v8.md §3.3).
// - A shared planning (« Astreinte », « Permanence N1 »…) has members — people and teams — and
//   slots: a title, a time, the person on it, the skill it asks for, repeated every week or not.
//   Founders create them and choose their members; members fill the slots. A person's slots show
//   in their own planning and their iCal feed.
// - Coverage: for a skill, a language, a team or a shared planning, how many of its people are
//   there each day (not absent). Zero is shown in red.
const MAX_PLANNINGS = 50, MAX_SLOTS = 500, MAX_MEMBERS = 200;
const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// ── Plannings ──
async function membersOf(db, id) {
  const rows = await db('SELECT kind, ref FROM shared_planning_members WHERE planning_id = ?', [id]).catch(() => []);
  return { userIds: rows.filter(r => r.kind === 'user').map(r => r.ref), teamIds: rows.filter(r => r.kind === 'team').map(r => Number(r.ref)) };
}
// Everyone in it: its people and the members of its teams
async function peopleOf(db, id) {
  const { userIds, teamIds } = await membersOf(db, id);
  const viaTeams = teamIds.length ? (await db('SELECT user_id FROM team_members WHERE team_id IN (?)', [teamIds])).map(r => String(r.user_id)) : [];
  return [...new Set([...userIds, ...viaTeams])];
}
async function isMember(db, id, userId) { return (await peopleOf(db, id)).includes(String(userId)); }
async function list(db, { userId, all = false }) {
  const rows = await db('SELECT * FROM shared_plannings ORDER BY name').catch(() => []);
  const out = [];
  for (const p of rows) {
    const m = await membersOf(db, p.id);
    if (!all && !(await isMember(db, p.id, userId))) continue;
    out.push({ id: p.id, name: p.name, description: p.description || '', userIds: m.userIds, teamIds: m.teamIds });
  }
  return out;
}
async function save(db, id, input = {}) {
  const name = str(input.name, 80);
  if (!name) return { error: 'Nom du planning requis' };
  const description = str(input.description, 300) || null;
  const userIds = [...new Set((Array.isArray(input.userIds) ? input.userIds : []).map(String).filter(u => /^[\w:-]{1,32}$/.test(u)))];
  const teamIds = [...new Set((Array.isArray(input.teamIds) ? input.teamIds : []).map(Number).filter(n => n > 0))];
  if (userIds.length + teamIds.length > MAX_MEMBERS) return { error: `${MAX_MEMBERS} membres au plus` };
  if (userIds.length && (await db("SELECT COUNT(*) AS n FROM dashboard_users WHERE user_id IN (?) AND role IN ('support', 'fondateur')", [userIds]))[0].n < userIds.length) return { error: 'Seul le staff peut être membre' };
  if (teamIds.length && (await db('SELECT COUNT(*) AS n FROM teams WHERE id IN (?)', [teamIds]))[0].n < teamIds.length) return { error: 'Équipe introuvable' };
  if (id) {
    const r = await db('UPDATE shared_plannings SET name = ?, description = ? WHERE id = ?', [name, description, id]);
    if (!r.affectedRows) return { error: 'Planning introuvable', status: 404 };
  } else {
    if (Number((await db('SELECT COUNT(*) AS n FROM shared_plannings'))[0].n) >= MAX_PLANNINGS) return { error: `${MAX_PLANNINGS} plannings communs au plus` };
    id = (await db('INSERT INTO shared_plannings (name, description) VALUES (?, ?)', [name, description])).insertId;
  }
  await db('DELETE FROM shared_planning_members WHERE planning_id = ?', [id]);
  for (const u of userIds) await db("INSERT INTO shared_planning_members (planning_id, kind, ref) VALUES (?, 'user', ?)", [id, u]);
  for (const t of teamIds) await db("INSERT INTO shared_planning_members (planning_id, kind, ref) VALUES (?, 'team', ?)", [id, String(t)]);
  return { ok: true, id };
}
async function remove(db, id) {
  const r = await db('DELETE FROM shared_plannings WHERE id = ?', [id]);
  return r.affectedRows ? { ok: true } : { error: 'Planning introuvable', status: 404 };
}

// ── Slots ──
async function cleanSlot(db, planningId, input) {
  const title = str(input.title, 120);
  if (!title) return { error: 'Intitulé du créneau requis' };
  const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return { error: 'Début et fin du créneau requis, la fin après le début' };
  if (endsAt - startsAt > 7 * 864e5) return { error: 'Un créneau dure une semaine au plus' };
  const userId = input.userId ? String(input.userId) : null;
  if (userId && !(await peopleOf(db, planningId)).includes(userId)) return { error: 'Cette personne ne fait pas partie du planning' };
  const skillId = input.skillId ? Number(input.skillId) : null;
  if (skillId && !(await db('SELECT 1 FROM skills WHERE id = ?', [skillId])).length) return { error: 'Compétence introuvable' };
  const until = input.weekly && input.until ? String(input.until).slice(0, 10) : null;
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return { error: 'Date de fin de répétition invalide' };
  return { value: { title, user_id: userId, skill_id: skillId, starts_at: startsAt, ends_at: endsAt, weekly: input.weekly ? 1 : 0, until } };
}
async function saveSlot(db, planningId, slotId, input = {}, actor) {
  if (!(await db('SELECT 1 FROM shared_plannings WHERE id = ?', [planningId])).length) return { error: 'Planning introuvable', status: 404 };
  const c = await cleanSlot(db, planningId, input);
  if (c.error) return c;
  const v = c.value;
  if (slotId) {
    const r = await db('UPDATE planning_slots SET title = ?, user_id = ?, skill_id = ?, starts_at = ?, ends_at = ?, weekly = ?, until = ? WHERE id = ? AND planning_id = ?',
      [v.title, v.user_id, v.skill_id, v.starts_at, v.ends_at, v.weekly, v.until, slotId, planningId]);
    return r.affectedRows ? { ok: true, id: slotId } : { error: 'Créneau introuvable', status: 404 };
  }
  if (Number((await db('SELECT COUNT(*) AS n FROM planning_slots WHERE planning_id = ?', [planningId]))[0].n) >= MAX_SLOTS) return { error: `${MAX_SLOTS} créneaux au plus` };
  const id = (await db('INSERT INTO planning_slots (planning_id, title, user_id, skill_id, starts_at, ends_at, weekly, until, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [planningId, v.title, v.user_id, v.skill_id, v.starts_at, v.ends_at, v.weekly, v.until, actor?.id || null])).insertId;
  return { ok: true, id };
}
async function deleteSlot(db, planningId, slotId) {
  const r = await db('DELETE FROM planning_slots WHERE id = ? AND planning_id = ?', [slotId, planningId]);
  return r.affectedRows ? { ok: true } : { error: 'Créneau introuvable', status: 404 };
}

// Occurrences between from and to: of a planning, or of some people (in any planning)
async function slots(db, { planningId = null, userIds = null, from, to }) {
  const where = planningId ? 's.planning_id = ?' : 's.user_id IN (?)';
  if (!planningId && !userIds?.length) return [];
  const rows = await db(`SELECT s.*, p.name AS planning, u.username, k.name AS skill FROM planning_slots s JOIN shared_plannings p ON p.id = s.planning_id
    LEFT JOIN dashboard_users u ON u.user_id = s.user_id LEFT JOIN skills k ON k.id = s.skill_id
    WHERE ${where} AND s.starts_at < ? AND (s.weekly = 1 OR s.ends_at > ?) ORDER BY s.starts_at LIMIT 2000`, [planningId || userIds, to, from]).catch(() => []);
  const out = [];
  const week = 7 * 864e5;
  for (const s of rows) {
    const start = new Date(s.starts_at).getTime(), len = new Date(s.ends_at).getTime() - start;
    // DATE column: a Date at local midnight (mysql2), or a string; the slot repeats through that whole day
    const untilDay = s.until instanceof Date ? `${s.until.getFullYear()}-${String(s.until.getMonth() + 1).padStart(2, '0')}-${String(s.until.getDate()).padStart(2, '0')}` : s.until ? String(s.until).slice(0, 10) : null;
    const until = untilDay ? new Date(`${untilDay}T23:59:59`).getTime() : Infinity;
    let k = s.weekly ? Math.max(0, Math.floor((from.getTime() - len - start) / week)) : 0;
    for (; ; k++) {
      const a = start + k * week;
      if (a >= to.getTime() || a > until || (!s.weekly && k > 0)) break;
      if (a + len > from.getTime()) out.push({ id: s.id, key: `${s.id}:${k}`, planningId: s.planning_id, planning: s.planning, title: s.title, userId: s.user_id, username: s.username || null, skillId: s.skill_id, skill: s.skill || null, startsAt: new Date(a), endsAt: new Date(a + len), weekly: !!Number(s.weekly), until: untilDay });
      if (out.length > 3000) return out;
    }
  }
  return out.sort((x, y) => x.startsAt - y.startsAt);
}

// ── Coverage ──
async function holders(db, { skillId, lang }) {
  if (skillId) return (await db("SELECT ss.user_id FROM staff_skills ss JOIN dashboard_users u ON u.user_id = ss.user_id WHERE ss.skill_id = ? AND u.role IN ('support', 'fondateur')", [skillId])).map(r => String(r.user_id));
  if (lang) return (await db("SELECT user_id FROM dashboard_users WHERE role IN ('support', 'fondateur') AND FIND_IN_SET(?, languages)", [lang])).map(r => String(r.user_id));
  return [];
}
// [{ day: 'YYYY-MM-DD', present, total, absent: [names] }] for each day of the period
async function coverage(db, userIds, from, to) {
  const ids = userIds.length ? userIds : ['-'];
  const abs = await db('SELECT a.user_id, u.username, a.starts_at, a.ends_at FROM staff_absences a LEFT JOIN dashboard_users u ON u.user_id = a.user_id WHERE a.user_id IN (?) AND a.starts_at < ? AND a.ends_at > ?', [ids, to, from]).catch(() => []);
  const out = [];
  for (let d = new Date(from); d < to; d = new Date(d.getTime() + 864e5)) {
    const end = new Date(d.getTime() + 864e5);
    const away = abs.filter(a => new Date(a.starts_at) < end && new Date(a.ends_at) > d);
    const awayIds = new Set(away.map(a => String(a.user_id)));
    out.push({ day: d.toISOString(), total: userIds.length, present: userIds.filter(u => !awayIds.has(u)).length, absent: [...new Set(away.map(a => a.username || a.user_id))] });
  }
  return out;
}

module.exports = { list, save, remove, membersOf, peopleOf, isMember, saveSlot, deleteSlot, slots, holders, coverage };

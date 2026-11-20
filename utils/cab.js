// Change advisory board (v7, conception/v7.md §3.5): staff members of the board, planned meetings
// whose agenda lists the changes to examine, each member's opinion (for, against, reserve, with a
// comment), and the decision on each change — approved (the change becomes « approved »), refused
// (« refused ») or postponed (it stays as it is). Decisions are on the change's view and in the log.
const { recordEvent } = require('./audit');

const VOTES = ['for', 'against', 'reserve'];
const DECISIONS = ['approved', 'refused', 'postponed'];
const MEETING_STATUSES = ['planned', 'held', 'cancelled'];
const MAX_AGENDA = 50;

async function members(db) {
  return (await db('SELECT m.user_id, u.username FROM cab_members m LEFT JOIN dashboard_users u ON u.user_id = m.user_id ORDER BY u.username').catch(() => []))
    .map(m => ({ userId: m.user_id, username: m.username || m.user_id }));
}
const isMember = async (db, userId) => !!(await db('SELECT 1 FROM cab_members WHERE user_id = ?', [String(userId)])).length;
async function setMembers(db, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 50);
  if (list.length && (await db("SELECT user_id FROM dashboard_users WHERE user_id IN (?) AND role IN ('support', 'fondateur')", [list])).length !== list.length) return { error: 'Seul le staff de l\'espace peut faire partie du comité' };
  await db('DELETE FROM cab_members');
  for (const id of list) await db('INSERT INTO cab_members (user_id) VALUES (?)', [id]);
  return { ok: true };
}

const shapeMeeting = m => ({ id: m.id, title: m.title, startsAt: m.starts_at, status: m.status, notes: m.notes || '', items: Number(m.items || 0), createdAt: m.created_at });
async function listMeetings(db) {
  return (await db(`SELECT m.*, (SELECT COUNT(*) FROM cab_agenda a WHERE a.meeting_id = m.id) AS items FROM cab_meetings m
    ORDER BY m.status = 'planned' DESC, m.starts_at DESC LIMIT 200`).catch(() => [])).map(shapeMeeting);
}
async function getMeeting(db, id) {
  const [m] = await db('SELECT m.*, (SELECT COUNT(*) FROM cab_agenda a WHERE a.meeting_id = m.id) AS items FROM cab_meetings m WHERE m.id = ?', [id]);
  if (!m) return null;
  const agenda = await db(`SELECT a.change_id, a.position, a.decision, a.decision_note, a.decided_at, a.decided_by_tag, c.title, c.status, c.risk_level
    FROM cab_agenda a JOIN changes c ON c.id = a.change_id WHERE a.meeting_id = ? ORDER BY a.position, a.change_id`, [id]);
  const votes = await db('SELECT v.change_id, v.user_id, u.username, v.vote, v.comment, v.voted_at FROM cab_votes v LEFT JOIN dashboard_users u ON u.user_id = v.user_id WHERE v.meeting_id = ?', [id]);
  return {
    ...shapeMeeting(m),
    agenda: agenda.map(a => ({
      changeId: a.change_id, title: a.title, changeStatus: a.status, risk: a.risk_level, decision: a.decision || null, decisionNote: a.decision_note || '', decidedAt: a.decided_at || null, decidedBy: a.decided_by_tag || null,
      votes: votes.filter(v => v.change_id === a.change_id).map(v => ({ userId: v.user_id, username: v.username || v.user_id, vote: v.vote, comment: v.comment || '', at: v.voted_at })),
    })),
  };
}
async function saveMeeting(db, id, input = {}, actor) {
  const title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim().slice(0, 150) : '';
  if (!title) return { error: 'Titre de la réunion requis' };
  const startsAt = input.startsAt ? new Date(input.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return { error: 'Date de la réunion requise' };
  const status = input.status === undefined ? 'planned' : input.status;
  if (!MEETING_STATUSES.includes(status)) return { error: 'Statut : planned, held ou cancelled' };
  const notes = typeof input.notes === 'string' ? input.notes.slice(0, 10000) : null;
  if (id) {
    const r = await db('UPDATE cab_meetings SET title = ?, starts_at = ?, status = ?, notes = ? WHERE id = ?', [title, startsAt, status, notes, id]);
    if (!r.affectedRows) return { error: 'Réunion introuvable', status: 404 };
  } else {
    id = (await db('INSERT INTO cab_meetings (title, starts_at, status, notes) VALUES (?, ?, ?, ?)', [title, startsAt, status, notes])).insertId;
  }
  await recordEvent(db, { actor, action: 'cab_meeting', targetType: 'cab_meeting', targetId: id, details: { title, status } });
  return { ok: true, id };
}
async function deleteMeeting(db, id) {
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM cab_agenda WHERE meeting_id = ? AND decision IS NOT NULL', [id]);
  if (Number(n)) return { error: 'Une réunion qui a pris des décisions ne se supprime pas (annule-la)', status: 409 };
  const r = await db('DELETE FROM cab_meetings WHERE id = ?', [id]);
  return r.affectedRows ? { ok: true } : { error: 'Réunion introuvable', status: 404 };
}

async function addToAgenda(db, id, changeId) {
  const [m] = await db('SELECT status FROM cab_meetings WHERE id = ?', [id]);
  if (!m) return { error: 'Réunion introuvable', status: 404 };
  if (m.status !== 'planned') return { error: 'L\'ordre du jour se prépare avant la réunion', status: 409 };
  const [c] = await db('SELECT status FROM changes WHERE id = ?', [changeId]);
  if (!c) return { error: 'Changement introuvable', status: 404 };
  if (['in_progress', 'done', 'cancelled'].includes(c.status)) return { error: 'Ce changement est déjà lancé, terminé ou annulé' };
  const [{ n, pos }] = await db('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS pos FROM cab_agenda WHERE meeting_id = ?', [id]);
  if (Number(n) >= MAX_AGENDA) return { error: `${MAX_AGENDA} changements au plus par réunion` };
  await db('INSERT IGNORE INTO cab_agenda (meeting_id, change_id, position) VALUES (?, ?, ?)', [id, changeId, Number(pos) + 1]);
  return { ok: true };
}
async function removeFromAgenda(db, id, changeId) {
  const [a] = await db('SELECT decision FROM cab_agenda WHERE meeting_id = ? AND change_id = ?', [id, changeId]);
  if (a?.decision) return { error: 'Une décision a été prise sur ce changement', status: 409 };
  await db('DELETE FROM cab_agenda WHERE meeting_id = ? AND change_id = ?', [id, changeId]);
  return { ok: true };
}

// A member's opinion on a change of the agenda (until the decision)
async function vote(db, id, changeId, userId, value, comment) {
  if (!(await isMember(db, userId))) return { error: 'Seuls les membres du comité donnent leur avis', status: 403 };
  if (!VOTES.includes(value)) return { error: 'Avis : for, against ou reserve' };
  const [a] = await db('SELECT a.decision, m.status FROM cab_agenda a JOIN cab_meetings m ON m.id = a.meeting_id WHERE a.meeting_id = ? AND a.change_id = ?', [id, changeId]);
  if (!a) return { error: 'Ce changement n\'est pas à l\'ordre du jour', status: 404 };
  if (a.decision || a.status === 'cancelled') return { error: 'La décision est déjà prise', status: 409 };
  await db(`INSERT INTO cab_votes (meeting_id, change_id, user_id, vote, comment) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE vote = VALUES(vote), comment = VALUES(comment), voted_at = NOW()`, [id, changeId, String(userId), value, typeof comment === 'string' ? comment.slice(0, 1000) : null]);
  return { ok: true };
}

// The board's decision on a change, applied to it
async function decide(db, id, changeId, decision, note, actor) {
  if (!DECISIONS.includes(decision)) return { error: 'Décision : approved, refused ou postponed' };
  const [a] = await db('SELECT a.decision, m.status, m.title FROM cab_agenda a JOIN cab_meetings m ON m.id = a.meeting_id WHERE a.meeting_id = ? AND a.change_id = ?', [id, changeId]);
  if (!a) return { error: 'Ce changement n\'est pas à l\'ordre du jour', status: 404 };
  if (a.status === 'cancelled') return { error: 'Réunion annulée', status: 409 };
  if (a.decision) return { error: 'La décision est déjà prise', status: 409 };
  const [c] = await db('SELECT status FROM changes WHERE id = ?', [changeId]);
  if (!c || ['in_progress', 'done', 'cancelled'].includes(c.status)) return { error: 'Ce changement est déjà lancé, terminé ou annulé', status: 409 };
  const text = typeof note === 'string' ? note.slice(0, 2000) : '';
  await db('UPDATE cab_agenda SET decision = ?, decision_note = ?, decided_at = NOW(), decided_by_tag = ? WHERE meeting_id = ? AND change_id = ?',
    [decision, text || null, String(actor?.username || actor?.tag || '').slice(0, 100), id, changeId]);
  if (decision !== 'postponed') {
    const status = decision === 'approved' ? 'approved' : 'refused';
    await db('UPDATE changes SET status = ? WHERE id = ?', [status, changeId]);
    await recordEvent(db, { actor, action: 'change_status', targetType: 'change', targetId: changeId, details: { status, cab: id } });
  }
  await recordEvent(db, { actor, action: 'cab_decision', targetType: 'change', targetId: changeId, details: { meeting: id, decision, note: text || undefined } });
  return { ok: true };
}

// The board's decisions on a change (change view)
async function ofChange(db, changeId) {
  return (await db(`SELECT a.meeting_id, m.title, m.starts_at, a.decision, a.decision_note, a.decided_at,
      (SELECT COUNT(*) FROM cab_votes v WHERE v.meeting_id = a.meeting_id AND v.change_id = a.change_id AND v.vote = 'for') AS pro,
      (SELECT COUNT(*) FROM cab_votes v WHERE v.meeting_id = a.meeting_id AND v.change_id = a.change_id AND v.vote = 'against') AS con,
      (SELECT COUNT(*) FROM cab_votes v WHERE v.meeting_id = a.meeting_id AND v.change_id = a.change_id AND v.vote = 'reserve') AS res
    FROM cab_agenda a JOIN cab_meetings m ON m.id = a.meeting_id WHERE a.change_id = ? ORDER BY m.starts_at DESC`, [changeId]).catch(() => []))
    .map(r => ({ meetingId: r.meeting_id, title: r.title, startsAt: r.starts_at, decision: r.decision || null, note: r.decision_note || '', decidedAt: r.decided_at || null, votes: { for: Number(r.pro), against: Number(r.con), reserve: Number(r.res) } }));
}

module.exports = { VOTES, DECISIONS, MEETING_STATUSES, members, isMember, setMembers, listMeetings, getMeeting, saveMeeting, deleteMeeting, addToAgenda, removeFromAgenda, vote, decide, ofChange };

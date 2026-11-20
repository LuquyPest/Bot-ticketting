// Dashboards (v5.6, conception/v5.md §3.16): personal or shared boards made of widgets — counters,
// a curve of tickets created and closed, a list of tickets, SLA objectives met, satisfaction — each
// with its filters (team, priority, type, organisation, subject, period). Every figure is computed
// for whoever looks at it, through their visibility of the tickets.
const { parseJsonField } = require('./jsonField');

const KINDS = ['count', 'chart', 'list', 'sla', 'satisfaction', 'fcr'];
const METRICS = ['open', 'unassigned', 'mine', 'created', 'closed', 'breached', 'waiting'];
const SHARING = ['private', 'team', 'space'];
const MAX_WIDGETS = 24, MAX_BOARDS = 20;

function cleanWidget(w) {
  if (!w || !KINDS.includes(w.kind)) return { error: 'Widget inconnu' };
  const f = w.filters && typeof w.filters === 'object' ? w.filters : {};
  const int = v => (v === undefined || v === null || v === '' ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);
  const filters = { team: int(f.team), organization: int(f.organization), priority: ['low', 'normal', 'urgent'].includes(f.priority) ? f.priority : null,
    type: ['incident', 'request'].includes(f.type) ? f.type : null, subject: typeof f.subject === 'string' ? f.subject.slice(0, 100) || null : null,
    days: Math.min(Math.max(int(f.days) || 30, 1), 365) };
  if (Number.isNaN(filters.team) || Number.isNaN(filters.organization)) return { error: 'Filtre invalide' };
  const out = { kind: w.kind, title: typeof w.title === 'string' ? w.title.replace(/\s+/g, ' ').trim().slice(0, 60) : '', filters };
  if (w.kind === 'count') { if (!METRICS.includes(w.metric)) return { error: 'Compteur inconnu' }; out.metric = w.metric; }
  if (w.kind === 'list') out.limit = Math.min(Math.max(int(w.limit) || 10, 1), 25);
  return { value: out };
}
function cleanBoard(input = {}) {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  if (!name) return { error: 'Nom du tableau requis' };
  const raw = Array.isArray(input.widgets) ? input.widgets : [];
  if (raw.length > MAX_WIDGETS) return { error: `${MAX_WIDGETS} widgets au plus` };
  const widgets = [];
  for (const w of raw) { const r = cleanWidget(w); if (r.error) return r; widgets.push(r.value); }
  const sharing = SHARING.includes(input.sharing) ? input.sharing : 'private';
  const teamId = sharing === 'team' ? Number(input.teamId) || null : null;
  if (sharing === 'team' && !teamId) return { error: 'Choisis l\'équipe avec qui partager' };
  return { value: { name, widgets, sharing, teamId } };
}

const shape = (b, me) => ({ id: b.id, name: b.name, widgets: parseJsonField(b.widgets, []) || [], sharing: b.sharing, teamId: b.team_id || null,
  ownerId: b.owner_id, ownerName: b.owner_name || null, mine: String(b.owner_id) === String(me) });
// Mine, and those shared with the space or one of my teams
async function listBoards(db, userId) {
  const teams = (await db('SELECT team_id FROM team_members WHERE user_id = ?', [userId])).map(r => r.team_id);
  const rows = await db(`SELECT b.*, u.username AS owner_name FROM dashboards b LEFT JOIN dashboard_users u ON u.user_id = b.owner_id
    WHERE b.owner_id = ? OR b.sharing = 'space'${teams.length ? " OR (b.sharing = 'team' AND b.team_id IN (?))" : ''} ORDER BY b.owner_id = ? DESC, b.name`,
  [userId, ...(teams.length ? [teams] : []), userId]).catch(() => []);
  return rows.map(b => shape(b, userId));
}
async function saveBoard(db, id, input, userId, { isFounder = false } = {}) {
  const r = cleanBoard(input);
  if (r.error) return r;
  const v = r.value;
  if (v.sharing === 'team' && !isFounder && !(await db('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?', [v.teamId, userId])).length) return { error: 'On ne partage qu\'avec une équipe dont on fait partie' };
  if (v.sharing === 'team' && !(await db('SELECT 1 FROM teams WHERE id = ?', [v.teamId])).length) return { error: 'Équipe introuvable' };
  if (id) {
    const res = await db('UPDATE dashboards SET name = ?, widgets = ?, sharing = ?, team_id = ? WHERE id = ? AND owner_id = ?', [v.name, JSON.stringify(v.widgets), v.sharing, v.teamId, id, userId]);
    return res.affectedRows ? { ok: true, id } : { error: 'Tableau introuvable (seul son auteur le modifie)', status: 404 };
  }
  const [n] = await db('SELECT COUNT(*) AS n FROM dashboards WHERE owner_id = ?', [userId]);
  if (Number(n.n) >= MAX_BOARDS) return { error: `${MAX_BOARDS} tableaux au plus` };
  return { ok: true, id: (await db('INSERT INTO dashboards (owner_id, name, widgets, sharing, team_id) VALUES (?, ?, ?, ?, ?)', [userId, v.name, JSON.stringify(v.widgets), v.sharing, v.teamId])).insertId };
}
async function deleteBoard(db, id, userId) {
  const r = await db('DELETE FROM dashboards WHERE id = ? AND owner_id = ?', [id, userId]);
  return r.affectedRows ? { ok: true } : { error: 'Tableau introuvable (seul son auteur le supprime)', status: 404 };
}

// ── Data of one widget, for the viewer (vis: their visibility filter on tickets `t`) ──
function where(f, vis) {
  const parts = [vis.sql], params = [...vis.params];
  if (f.team) { parts.push('t.team_id = ?'); params.push(f.team); }
  if (f.organization) { parts.push('(t.organization_id = ? OR t.organization_id IN (SELECT id FROM organizations WHERE parent_id = ?))'); params.push(f.organization, f.organization); }
  if (f.priority) { parts.push('t.priority = ?'); params.push(f.priority); }
  if (f.type) { parts.push("COALESCE(t.ticket_type, 'request') = ?"); params.push(f.type); }
  if (f.subject) { parts.push("(t.subject = ? OR t.subject LIKE CONCAT(?, ' › %'))"); params.push(f.subject, f.subject); }
  return { sql: parts.join(' AND '), params };
}
async function widgetData(db, w, { userId, vis }) {
  const c = cleanWidget(w);
  if (c.error) return c;
  const x = c.value, f = x.filters, wh = where(f, vis);
  const since = new Date(Date.now() - f.days * 864e5);
  if (x.kind === 'count') {
    const extra = {
      open: ["t.status = 'open'", []], unassigned: ["t.status = 'open' AND NOT EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id)", []],
      mine: ["t.status = 'open' AND EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = ?)", [userId]],
      created: ['t.created_at >= ?', [since]], closed: ["t.status = 'closed' AND t.closed_at >= ?", [since]],
      breached: [require('./slaPolicies').OBJECTIVE_BREACHED_SQL.replace(/\b(status|first_response_at|tto_due_at|resolved_at|sla_paused_at|ttr_due_at|ola_due_at)\b/g, 't.$1'), []],
      waiting: ["t.status = 'open' AND t.stage = 'waiting'", []],
    }[x.metric];
    const [r] = await db(`SELECT COUNT(*) AS n FROM tickets t WHERE ${wh.sql} AND ${extra[0]}`, [...wh.params, ...extra[1]]);
    return { value: { kind: 'count', metric: x.metric, count: Number(r.n) } };
  }
  if (x.kind === 'chart') {
    const created = await db(`SELECT DATE(t.created_at) AS d, COUNT(*) AS n FROM tickets t WHERE ${wh.sql} AND t.created_at >= ? GROUP BY DATE(t.created_at)`, [...wh.params, since]);
    const closed = await db(`SELECT DATE(t.closed_at) AS d, COUNT(*) AS n FROM tickets t WHERE ${wh.sql} AND t.closed_at >= ? GROUP BY DATE(t.closed_at)`, [...wh.params, since]);
    const key = d => new Date(d).toISOString().slice(0, 10);
    const cm = new Map(created.map(r => [key(r.d), Number(r.n)])), xm = new Map(closed.map(r => [key(r.d), Number(r.n)]));
    const days = [];
    for (let i = f.days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push({ day: d, created: cm.get(d) || 0, closed: xm.get(d) || 0 }); }
    return { value: { kind: 'chart', days } };
  }
  if (x.kind === 'list') {
    const rows = await db(`SELECT t.id, t.subject, t.priority, t.stage, t.created_at, t.owner_tag FROM tickets t WHERE ${wh.sql} AND t.status = 'open' ORDER BY t.priority = 'urgent' DESC, t.created_at ASC LIMIT ?`, [...wh.params, x.limit]);
    return { value: { kind: 'list', tickets: rows } };
  }
  if (x.kind === 'sla') {
    const [r] = await db(`SELECT SUM(t.tto_due_at IS NOT NULL AND t.first_response_at IS NOT NULL) AS tto_n, SUM(t.first_response_at IS NOT NULL AND t.first_response_at <= t.tto_due_at) AS tto_ok,
        SUM(t.ttr_due_at IS NOT NULL AND COALESCE(t.resolved_at, t.closed_at) IS NOT NULL) AS ttr_n, SUM(COALESCE(t.resolved_at, t.closed_at) <= t.ttr_due_at) AS ttr_ok
      FROM tickets t WHERE ${wh.sql} AND t.created_at >= ? AND t.sla_policy_id IS NOT NULL`, [...wh.params, since]);
    const pct = (ok, n) => (Number(n) ? Math.round(Number(ok) / Number(n) * 100) : null);
    return { value: { kind: 'sla', ttoPct: pct(r.tto_ok, r.tto_n), ttrPct: pct(r.ttr_ok, r.ttr_n), tickets: Number(r.tto_n || 0) } };
  }
  if (x.kind === 'fcr') {
    // First contact resolution of the tickets closed over the period (utils/fcr.js, v7)
    const rows = await db(`SELECT t.id, t.status FROM tickets t WHERE ${wh.sql} AND t.status = 'closed' AND t.closed_at >= ? AND t.merged_into IS NULL LIMIT 20000`, [...wh.params, since]);
    const r = await require('./fcr').rate(db, rows);
    return { value: { kind: 'fcr', pct: r.pct, first: r.first, answered: r.answered } };
  }
  const [s] = await db(`SELECT COUNT(*) AS n, AVG(r.rating) AS avg, SUM(r.rating >= 4) AS good FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id WHERE ${wh.sql} AND r.rated_at >= ?`, [...wh.params, since]);
  const dist = await db(`SELECT r.rating, COUNT(*) AS n FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id WHERE ${wh.sql} AND r.rated_at >= ? GROUP BY r.rating`, [...wh.params, since]);
  return { value: { kind: 'satisfaction', count: Number(s.n), average: s.avg === null ? null : Math.round(Number(s.avg) * 10) / 10, goodPct: Number(s.n) ? Math.round(Number(s.good) / Number(s.n) * 100) : null,
    distribution: [1, 2, 3, 4, 5].map(n => Number(dist.find(d => Number(d.rating) === n)?.n || 0)) } };
}

module.exports = { KINDS, METRICS, cleanWidget, cleanBoard, listBoards, saveBoard, deleteBoard, widgetData };

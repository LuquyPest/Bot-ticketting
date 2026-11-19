// Costs (v5.4, conception/v5.md §3.16): what a ticket costs — the time spent (utils/ticketTime.js)
// at an hourly rate (the person's, else the ticket team's, else the space's), a fixed amount per
// ticket, and the costs added to a ticket (travel, a part…). Reports by ticket, organisation,
// person, team and period, to invoice a client or a department. Amounts in cents.
const { parseJsonField } = require('./jsonField');

const MAX_CENTS = 100000000; // 1 000 000.00
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD'];

async function settings(db) {
  const [c] = await db('SELECT cost_currency, cost_default_rate_cents, cost_fixed_cents FROM guild_config WHERE id = 1').catch(() => []);
  const rates = await db('SELECT scope, target_id, hourly_cents FROM cost_rates').catch(() => []);
  return {
    currency: CURRENCIES.includes(c?.cost_currency) ? c.cost_currency : 'EUR',
    defaultRateCents: Number(c?.cost_default_rate_cents) || 0, fixedCents: Number(c?.cost_fixed_cents) || 0,
    userRates: Object.fromEntries(rates.filter(r => r.scope === 'user').map(r => [String(r.target_id), Number(r.hourly_cents)])),
    teamRates: Object.fromEntries(rates.filter(r => r.scope === 'team').map(r => [String(r.target_id), Number(r.hourly_cents)])),
  };
}
const cents = v => { const n = Math.round(Number(v)); return Number.isInteger(n) && n >= 0 && n <= MAX_CENTS ? n : null; };
async function saveSettings(db, input = {}) {
  const currency = CURRENCIES.includes(input.currency) ? input.currency : 'EUR';
  const def = cents(input.defaultRateCents ?? 0), fixed = cents(input.fixedCents ?? 0);
  if (def === null || fixed === null) return { error: 'Montant invalide' };
  const users = Object.entries(input.userRates || {}), teams = Object.entries(input.teamRates || {});
  if (users.length > 500 || teams.length > 100) return { error: 'Trop de taux' };
  for (const [, v] of [...users, ...teams]) if (cents(v) === null) return { error: 'Taux horaire invalide' };
  const staff = users.length ? (await db("SELECT user_id FROM dashboard_users WHERE user_id IN (?) AND role IN ('support', 'fondateur')", [users.map(([k]) => k)])).map(r => String(r.user_id)) : [];
  if (staff.length !== users.length) return { error: 'Un taux par personne ne vaut que pour le staff' };
  const teamIds = teams.length ? (await db('SELECT id FROM teams WHERE id IN (?)', [teams.map(([k]) => Number(k))])).map(r => String(r.id)) : [];
  if (teamIds.length !== teams.length) return { error: 'Équipe introuvable' };
  await db('UPDATE guild_config SET cost_currency = ?, cost_default_rate_cents = ?, cost_fixed_cents = ? WHERE id = 1', [currency, def, fixed]);
  await db('DELETE FROM cost_rates');
  for (const [k, v] of users) await db("INSERT INTO cost_rates (scope, target_id, hourly_cents) VALUES ('user', ?, ?)", [k, cents(v)]);
  for (const [k, v] of teams) await db("INSERT INTO cost_rates (scope, target_id, hourly_cents) VALUES ('team', ?, ?)", [Number(k), cents(v)]);
  return { ok: true };
}
// The hourly rate of a time entry: the person's, else the ticket team's, else the space's
const rateOf = (s, userId, teamId) => s.userRates[String(userId)] ?? (teamId ? s.teamRates[String(teamId)] : undefined) ?? s.defaultRateCents;
const secondsOf = e => Number(e.seconds ?? Math.min(Math.max(0, (Date.now() - new Date(e.started_at).getTime()) / 1000), 8 * 3600));

// ── Costs added to a ticket ──
async function listExtras(db, ticketId) {
  return (await db('SELECT id, label, amount_cents, created_by_tag, created_at FROM ticket_costs WHERE ticket_id = ? ORDER BY id', [ticketId]).catch(() => []))
    .map(x => ({ id: x.id, label: x.label, amountCents: Number(x.amount_cents), by: x.created_by_tag, createdAt: x.created_at }));
}
async function addExtra(db, ticketId, input, actor) {
  const label = typeof input.label === 'string' ? input.label.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const amount = cents(input.amountCents);
  if (!label) return { error: 'Libellé requis' };
  if (!amount) return { error: 'Montant invalide' };
  const [n] = await db('SELECT COUNT(*) AS n FROM ticket_costs WHERE ticket_id = ?', [ticketId]);
  if (Number(n.n) >= 100) return { error: '100 frais au plus par ticket' };
  const ins = await db('INSERT INTO ticket_costs (ticket_id, label, amount_cents, created_by_id, created_by_tag) VALUES (?, ?, ?, ?, ?)', [ticketId, label, amount, actor?.id || null, actor?.username || null]);
  await require('./audit').recordEvent(db, { actor, action: 'ticket_cost_add', ticketId, details: { label, amountCents: amount } });
  return { ok: true, id: ins.insertId };
}
async function removeExtra(db, ticketId, id, actor) {
  const r = await db('DELETE FROM ticket_costs WHERE id = ? AND ticket_id = ?', [id, ticketId]);
  if (!r.affectedRows) return { error: 'Frais introuvable', status: 404 };
  await require('./audit').recordEvent(db, { actor, action: 'ticket_cost_delete', ticketId, details: { id } });
  return { ok: true };
}

// The cost of one ticket: { time: [{ userTag, seconds, rateCents, cents }], fixedCents, extras, totalCents }
async function ticketCost(db, ticketId) {
  const s = await settings(db);
  const [t] = await db('SELECT team_id FROM tickets WHERE id = ?', [ticketId]);
  const entries = await db('SELECT user_id, user_tag, seconds, started_at FROM ticket_time WHERE ticket_id = ?', [ticketId]);
  const byUser = new Map();
  for (const e of entries) {
    const k = String(e.user_id);
    const x = byUser.get(k) || { userId: k, userTag: e.user_tag, seconds: 0, rateCents: rateOf(s, k, t?.team_id) };
    x.seconds += secondsOf(e);
    byUser.set(k, x);
  }
  const time = [...byUser.values()].map(x => ({ ...x, seconds: Math.round(x.seconds), cents: Math.round(x.seconds / 3600 * x.rateCents) }));
  const extras = await listExtras(db, ticketId);
  const totalCents = time.reduce((n, x) => n + x.cents, 0) + s.fixedCents + extras.reduce((n, x) => n + x.amountCents, 0);
  return { currency: s.currency, time, fixedCents: s.fixedCents, extras, totalCents };
}

// Report over a period: time by its date, costs added by their date, the fixed amount per ticket
// opened in the period. by: ticket | organization | user | team. vis: the reader's visibility filter.
async function report(db, { from, to, by = 'organization', vis }) {
  const s = await settings(db);
  const time = await db(`SELECT tt.ticket_id, tt.user_id, tt.user_tag, tt.seconds, tt.started_at, t.team_id, t.organization_id, t.subject
    FROM ticket_time tt JOIN tickets t ON t.id = tt.ticket_id WHERE tt.started_at >= ? AND tt.started_at < ? AND ${vis.sql}`, [from, to, ...vis.params]);
  const extras = await db(`SELECT c.ticket_id, c.amount_cents, c.created_by_id, t.team_id, t.organization_id, t.subject
    FROM ticket_costs c JOIN tickets t ON t.id = c.ticket_id WHERE c.created_at >= ? AND c.created_at < ? AND ${vis.sql}`, [from, to, ...vis.params]);
  const opened = s.fixedCents ? await db(`SELECT t.id AS ticket_id, t.team_id, t.organization_id, t.subject FROM tickets t WHERE t.created_at >= ? AND t.created_at < ? AND ${vis.sql}`, [from, to, ...vis.params]) : [];
  const names = {
    organization: Object.fromEntries((await db('SELECT id, name FROM organizations').catch(() => [])).map(o => [String(o.id), o.name])),
    team: Object.fromEntries((await db('SELECT id, name FROM teams').catch(() => [])).map(o => [String(o.id), o.name])),
    user: Object.fromEntries((await db('SELECT user_id, username FROM dashboard_users')).map(u => [String(u.user_id), u.username])),
  };
  const rows = new Map();
  const keyOf = (r, who) => (by === 'ticket' ? String(r.ticket_id) : by === 'user' ? String(who || '') : by === 'team' ? String(r.team_id || '') : String(r.organization_id || ''));
  const label = (k, r) => (by === 'ticket' ? `#${k}${r.subject ? ` ${r.subject}` : ''}` : k ? (names[by][k] || k) : by === 'user' ? '(personne)' : by === 'team' ? 'Sans équipe' : 'Sans organisation');
  const row = (k, r) => { if (!rows.has(k)) rows.set(k, { key: k, label: label(k, r), seconds: 0, timeCents: 0, fixedCents: 0, extraCents: 0, tickets: new Set() }); return rows.get(k); };
  for (const e of time) {
    const x = row(keyOf(e, e.user_id), e);
    const sec = secondsOf(e);
    x.seconds += sec; x.timeCents += sec / 3600 * rateOf(s, e.user_id, e.team_id); x.tickets.add(e.ticket_id);
  }
  for (const c of extras) { const x = row(keyOf(c, c.created_by_id), c); x.extraCents += Number(c.amount_cents); x.tickets.add(c.ticket_id); }
  if (by !== 'user') for (const o of opened) { const x = row(keyOf(o), o); x.fixedCents += s.fixedCents; x.tickets.add(o.ticket_id); }
  const out = [...rows.values()].map(x => ({ key: x.key, label: x.label, tickets: x.tickets.size, seconds: Math.round(x.seconds), timeCents: Math.round(x.timeCents), fixedCents: x.fixedCents, extraCents: x.extraCents,
    totalCents: Math.round(x.timeCents) + x.fixedCents + x.extraCents })).sort((a, b) => b.totalCents - a.totalCents);
  return { currency: s.currency, by, rows: out, totalCents: out.reduce((n, x) => n + x.totalCents, 0) };
}
function reportCsv(r) {
  const { csvCell } = require('./csv');
  const money = c => (c / 100).toFixed(2);
  const lines = [['Groupe', 'Tickets', 'Heures', `Temps (${r.currency})`, `Forfait (${r.currency})`, `Frais (${r.currency})`, `Total (${r.currency})`],
    ...r.rows.map(x => [x.label, x.tickets, (x.seconds / 3600).toFixed(2), money(x.timeCents), money(x.fixedCents), money(x.extraCents), money(x.totalCents)])];
  return `\uFEFF${lines.map(l => l.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

module.exports = { CURRENCIES, settings, saveSettings, rateOf, listExtras, addExtra, removeExtra, ticketCost, report, reportCsv };

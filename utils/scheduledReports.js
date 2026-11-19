// Reports sent by e-mail on a schedule (v5.6, conception/v5.md §3.16): a breakdown report
// (utils/breakdownReport.js) by team, organisation, person… over the last N days, as XLSX, PDF or
// CSV, every week or every month, to chosen addresses. Computed with what its author sees.
// Founders send them to any address; the view_audit permission only to their own.
const { csvCell } = require('./csv');
const exportLib = require('./reportExport');
const report = require('./breakdownReport');
const recurring = require('./recurring');

const FORMATS = ['xlsx', 'pdf', 'csv'];
const MAX = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BY_NAME = { team: 'équipe', category: 'catégorie', subject: 'sujet', channel: 'canal', type: 'type', organization: 'organisation', assignee: 'personne', priority: 'priorité' };

// { buffer, type } of a report in a format
async function render(r, fmt) {
  const rows = [report.CSV_HEADER, ...report.csvRows(r)];
  if (fmt === 'xlsx') return { buffer: exportLib.xlsx(rows, { sheet: `Par ${BY_NAME[r.by] || r.by}` }), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  if (fmt === 'pdf') {
    const period = r.from ? `du ${r.from.toISOString().slice(0, 10)} au ${new Date(r.to.getTime() - 864e5).toISOString().slice(0, 10)}` : `${r.days} derniers jours`;
    return { buffer: await exportLib.pdf(rows, { title: `Rapport par ${BY_NAME[r.by] || r.by}`, subtitle: `${period} · ${r.total} ticket(s)` }), type: 'application/pdf' };
  }
  return { buffer: Buffer.from(`﻿${rows.map(l => l.map(csvCell).join(',')).join('\r\n')}`), type: 'text/csv; charset=utf-8' };
}

const shape = x => ({ id: x.id, name: x.name, by: x.dimension, days: x.days, format: x.format, frequency: x.frequency, weekday: x.weekday, monthday: x.monthday, time: x.run_time,
  timezone: x.timezone, recipients: JSON.parse(x.recipients || '[]'), active: !!Number(x.active), nextRunAt: x.next_run_at, lastSentAt: x.last_sent_at, ownerId: x.owner_id });
async function list(db, { ownerId = null } = {}) {
  return (await db(`SELECT * FROM scheduled_reports ${ownerId ? 'WHERE owner_id = ?' : ''} ORDER BY name`, ownerId ? [ownerId] : []).catch(() => [])).map(shape);
}

async function ownEmail(userId) {
  const [a] = await require('./globalDb').globalQuery('SELECT email FROM accounts WHERE id = ? AND email_verified = 1', [String(userId)]).catch(() => []);
  return a?.email ? String(a.email).toLowerCase() : null;
}
async function clean(input = {}, { isFounder, userId }) {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  if (!name) return { error: 'Nom du rapport requis' };
  if (!report.DIMENSIONS.includes(input.by)) return { error: 'Regroupement inconnu' };
  if (!FORMATS.includes(input.format)) return { error: 'Format : xlsx, pdf ou csv' };
  if (!['weekly', 'monthly'].includes(input.frequency)) return { error: 'Envoi chaque semaine ou chaque mois' };
  const days = Number(input.days);
  if (!Number.isInteger(days) || days < 1 || days > 365) return { error: 'Période : de 1 à 365 jours' };
  const recipients = [...new Set((Array.isArray(input.recipients) ? input.recipients : String(input.recipients || '').split(/[\s,;]+/)).map(e => String(e).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  if (!recipients.length || recipients.some(e => !EMAIL_RE.test(e) || e.length > 254)) return { error: 'Indique des adresses e-mail valides' };
  if (!isFounder) {
    const mine = await ownEmail(userId);
    if (!mine || recipients.some(e => e !== mine)) return { error: 'Tu ne peux l\'envoyer qu\'à ta propre adresse vérifiée (les fondateurs à n\'importe qui)' };
  }
  const sched = { frequency: input.frequency === 'monthly' ? 'monthly' : 'weekly', weekday: Number.isInteger(Number(input.weekday)) ? Number(input.weekday) % 7 : 1,
    monthday: Math.min(Math.max(Number(input.monthday) || 1, 1), 28), time: /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time || '') ? input.time : '08:00',
    timezone: require('./calendars').validTz(input.timezone) ? input.timezone : 'Europe/Paris' };
  return { value: { name, by: input.by, days, format: input.format, recipients, active: input.active !== false, ...sched } };
}
async function save(db, id, input, actor) {
  const r = await clean(input, actor);
  if (r.error) return r;
  const v = r.value;
  const next = v.active ? recurring.nextRun(v) : null;
  const vals = [v.name, v.by, v.days, v.format, v.frequency, v.weekday, v.monthday, v.time, v.timezone, JSON.stringify(v.recipients), v.active ? 1 : 0, next];
  if (id) {
    const res = await db(`UPDATE scheduled_reports SET name = ?, dimension = ?, days = ?, format = ?, frequency = ?, weekday = ?, monthday = ?, run_time = ?, timezone = ?, recipients = ?, active = ?, next_run_at = ?
      WHERE id = ?${actor.isFounder ? '' : ' AND owner_id = ?'}`, [...vals, id, ...(actor.isFounder ? [] : [actor.userId])]);
    return res.affectedRows ? { ok: true, id } : { error: 'Rapport introuvable', status: 404 };
  }
  const [n] = await db('SELECT COUNT(*) AS n FROM scheduled_reports');
  if (Number(n.n) >= MAX) return { error: `${MAX} rapports programmés au plus` };
  const ins = await db(`INSERT INTO scheduled_reports (name, dimension, days, format, frequency, weekday, monthday, run_time, timezone, recipients, active, next_run_at, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...vals, actor.userId]);
  return { ok: true, id: ins.insertId };
}
async function remove(db, id, actor) {
  const r = await db(`DELETE FROM scheduled_reports WHERE id = ?${actor.isFounder ? '' : ' AND owner_id = ?'}`, [id, ...(actor.isFounder ? [] : [actor.userId])]);
  return r.affectedRows ? { ok: true } : { error: 'Rapport introuvable', status: 404 };
}

// Builds and sends one report now (with its author's visibility): { sent } or throws
async function sendNow(db, guildId, rec) {
  const vis = await require('./planning').visFor(db, rec.ownerId);
  const r = await report.breakdown(db, vis, { by: rec.by, days: rec.days });
  const out = await render(r, rec.format);
  const [space] = await require('./globalDb').globalQuery('SELECT guild_name FROM guilds WHERE guild_id = ?', [guildId]).catch(() => []);
  const fname = `rapport-${rec.by}-${new Date().toISOString().slice(0, 10)}.${rec.format}`;
  for (const to of rec.recipients) {
    await require('./instanceMail').sendInstanceMail({ to, template: 'scheduledReport', vars: { space: space?.guild_name || 'Support', name: rec.name, days: rec.days, total: r.total },
      attachments: [{ filename: fname, content: out.buffer, contentType: out.type }] });
  }
  return { sent: rec.recipients.length };
}
async function runForGuild({ db, guildId }, now = Date.now()) {
  const due = (await db('SELECT * FROM scheduled_reports WHERE active = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?', [new Date(now)]).catch(() => [])).map(shape);
  let n = 0;
  for (const rec of due) {
    const claim = await db('UPDATE scheduled_reports SET next_run_at = ? WHERE id = ? AND next_run_at = ?', [recurring.nextRun(rec, now), rec.id, rec.nextRunAt]);
    if (!claim.affectedRows) continue;
    try { await sendNow(db, guildId, rec); await db('UPDATE scheduled_reports SET last_sent_at = NOW(), last_error = NULL WHERE id = ?', [rec.id]); n++; }
    catch (err) { await db('UPDATE scheduled_reports SET last_error = ? WHERE id = ?', [String(err.message).slice(0, 300), rec.id]).catch(() => null); }
  }
  return n;
}
async function runScheduledReports() {
  const { getActiveGuilds } = require('./guildScan');
  const { getTenantDb } = require('./tenantDb');
  for (const { guild_id } of await getActiveGuilds().catch(() => [])) await runForGuild({ db: getTenantDb(guild_id), guildId: guild_id }).catch(() => null);
}

module.exports = { FORMATS, render, list, save, remove, sendNow, runForGuild, runScheduledReports };

// Escalation and internal objectives (v5.1, conception/v5.md §3.5).
// - Levels: at a share of an objective (50 % of the first response time, 100 % = its deadline,
//   150 % = half as much again), actions: tell the people on the ticket, raise the priority,
//   hand it to another team, add followers, post in the escalation channel. Each level fires once
//   per ticket (sla_escalation_fired).
// - OLA: a team has its own resolution time, counted from when the ticket came to it, in business
//   hours of its calendar, paused like the resolution while waiting for the requester.
// Levels of an SLA objective use tto / ttr, levels of a team use ola.
const { parseJsonField } = require('./jsonField');
const cal = require('./calendars');
const { recordEvent } = require('./audit');
const { CONFIDENTIAL } = require('./gradePermissions');

const OBJECTIVES = ['tto', 'ttr', 'ola'];
const MAX_LEVELS = 6;
const MAX_MINUTES = 365 * 24 * 60;
const ACTOR = { id: 'system', tag: 'Escalade SLA', username: 'Escalade SLA', source: 'system' };
const UP = { low: 'normal', normal: 'urgent' };
const LABEL = { tto: 'prise en charge', ttr: 'résolution', ola: 'objectif interne' };

const shape = r => {
  const a = parseJsonField(r.actions, {}) || {};
  return { id: r.id, objective: r.objective, percent: Number(r.percent), notify: !!a.notify, raisePriority: !!a.raisePriority, alertChannel: !!a.alertChannel, teamId: a.teamId || null, followerIds: a.followerIds || [] };
};
async function levelsOf(db, { policyId = null, teamId = null }) {
  return (await db(`SELECT * FROM sla_escalations WHERE ${policyId ? 'policy_id' : 'team_id'} = ? ORDER BY objective, percent`, [policyId || teamId]).catch(() => [])).map(shape);
}

// [{ objective, percent, notify, raisePriority, alertChannel, teamId, followerIds }] or { error }
async function cleanLevels(db, input, allowed) {
  if (input === undefined) return { value: undefined };
  if (!Array.isArray(input)) return { error: 'Niveaux d\'escalade invalides' };
  if (input.length > MAX_LEVELS) return { error: `${MAX_LEVELS} niveaux d'escalade au plus` };
  const out = [];
  for (const l of input) {
    const objective = String(l?.objective || '');
    if (!allowed.includes(objective)) return { error: 'Objectif d\'escalade invalide' };
    const percent = Number(l.percent);
    if (!Number.isInteger(percent) || percent < 10 || percent > 500) return { error: 'Niveau d\'escalade : entre 10 et 500 % du délai' };
    if (out.some(x => x.objective === objective && x.percent === percent)) return { error: 'Deux niveaux au même pourcentage' };
    const teamId = l.teamId ? Number(l.teamId) : null;
    if (teamId && !(await db('SELECT id FROM teams WHERE id = ?', [teamId])).length) return { error: 'Équipe introuvable' };
    const followerIds = [...new Set((Array.isArray(l.followerIds) ? l.followerIds : []).map(String))].slice(0, 10);
    if (followerIds.length && (await db("SELECT user_id FROM dashboard_users WHERE user_id IN (?) AND role IN ('support', 'fondateur')", [followerIds])).length !== followerIds.length) return { error: 'Seul le staff peut suivre un ticket' };
    const v = { objective, percent, notify: !!l.notify, raisePriority: !!l.raisePriority, alertChannel: !!l.alertChannel, teamId, followerIds };
    if (!v.notify && !v.raisePriority && !v.alertChannel && !teamId && !followerIds.length) return { error: 'Un niveau d\'escalade fait au moins une action' };
    out.push(v);
  }
  return { value: out };
}
async function saveLevels(db, { policyId = null, teamId = null }, levels) {
  if (levels === undefined) return;
  const old = await levelsOf(db, { policyId, teamId });
  const key = l => `${l.objective}:${l.percent}`;
  // A level kept at the same place keeps its id, so it does not fire again
  for (const o of old) if (!levels.some(l => key(l) === key(o))) {
    await db('DELETE FROM sla_escalations WHERE id = ?', [o.id]);
    await db('DELETE FROM sla_escalation_fired WHERE escalation_id = ?', [o.id]);
  }
  for (const l of levels) {
    const actions = JSON.stringify({ notify: l.notify, raisePriority: l.raisePriority, alertChannel: l.alertChannel, teamId: l.teamId, followerIds: l.followerIds });
    const same = old.find(o => key(o) === key(l));
    if (same) await db('UPDATE sla_escalations SET actions = ? WHERE id = ?', [actions, same.id]);
    else await db('INSERT INTO sla_escalations (policy_id, team_id, objective, percent, actions) VALUES (?, ?, ?, ?, ?)', [policyId, teamId, l.objective, l.percent, actions]);
  }
}
async function dropLevels(db, { policyId = null, teamId = null }) {
  for (const o of await levelsOf(db, { policyId, teamId })) {
    await db('DELETE FROM sla_escalation_fired WHERE escalation_id = ?', [o.id]);
    await db('DELETE FROM sla_escalations WHERE id = ?', [o.id]);
  }
}

function cleanOla(input) {
  if (input === undefined || input === null || input === '' || Number(input) === 0) return { value: null };
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1 || n > MAX_MINUTES) return { error: 'Objectif interne : une durée en minutes, d\'une minute à un an' };
  return { value: n };
}

// ── OLA deadline of one ticket ──
const adder = async (db, t) => {
  const c = await cal.calendarForTicket(db, t);
  const k = c ? cal.asCal(c) : null;
  return (from, minutes) => (k ? cal.addBusinessMinutes(k, from, minutes) : from + minutes * 60000);
};
async function refreshOla(db, ticketId) {
  const [t] = await db('SELECT * FROM tickets WHERE id = ?', [ticketId]);
  if (!t) return;
  const [team] = t.team_id ? await db('SELECT ola_minutes FROM teams WHERE id = ?', [t.team_id]) : [];
  const minutes = Number(team?.ola_minutes) || 0;
  if (!minutes || !t.team_since) {
    if (t.ola_due_at) await db('UPDATE tickets SET ola_due_at = NULL WHERE id = ?', [t.id]);
    return;
  }
  const add = await adder(db, t);
  await db('UPDATE tickets SET ola_due_at = ? WHERE id = ?', [new Date(add(new Date(t.team_since).getTime(), minutes + Number(t.ola_paused_minutes || 0))), t.id]);
}
// The ticket came to a team (or left it): its internal clock starts again
async function onTeamChange(db, ticketId) {
  await db('UPDATE tickets SET team_since = IF(team_id IS NULL, NULL, NOW()), ola_paused_minutes = 0 WHERE id = ?', [ticketId]);
  await db("DELETE f FROM sla_escalation_fired f JOIN sla_escalations e ON e.id = f.escalation_id WHERE f.ticket_id = ? AND e.objective = 'ola'", [ticketId]);
  await db('DELETE FROM sla_escalation_fired WHERE ticket_id = ? AND escalation_id = -3', [ticketId]); // its « breached » notice
  await refreshOla(db, ticketId);
}
async function refreshTeamTickets(db, teamId) {
  for (const { id } of await db("SELECT id FROM tickets WHERE status = 'open' AND team_id = ? LIMIT 5000", [teamId])) await refreshOla(db, id).catch(() => null);
}
// Leaving « waiting »: the business time spent waiting while at the team moves the OLA
async function onResume(db, t) {
  if (!t.ola_due_at || !t.team_since || !t.sla_paused_at) return;
  const from = Math.max(new Date(t.sla_paused_at).getTime(), new Date(t.team_since).getTime());
  const c = await cal.calendarForTicket(db, t);
  const paused = c ? cal.businessMinutes(cal.asCal(c), from, Date.now()) : Math.round((Date.now() - from) / 60000);
  if (paused > 0) await db('UPDATE tickets SET ola_paused_minutes = ola_paused_minutes + ? WHERE id = ?', [paused, t.id]);
  await refreshOla(db, t.id);
}

// ── The check (every 5 minutes) ──
// When a level is reached: the moment it is due, from the start of its objective
async function fireAt(db, t, l, policy, team, addFor) {
  if (l.objective === 'tto') {
    if (t.first_response_at || !policy?.tto_minutes) return null;
    return addFor.policy(new Date(t.created_at).getTime(), Math.round(policy.tto_minutes * l.percent / 100));
  }
  if (t.sla_paused_at) return null;
  if (l.objective === 'ttr') {
    if (!policy?.ttr_minutes) return null;
    return addFor.policy(new Date(t.created_at).getTime(), Math.round(policy.ttr_minutes * l.percent / 100) + Number(t.sla_paused_minutes || 0));
  }
  if (!team?.ola_minutes || !t.team_since) return null;
  return addFor.team(new Date(t.team_since).getTime(), Math.round(team.ola_minutes * l.percent / 100) + Number(t.ola_paused_minutes || 0));
}

async function staffToTell(db, t) {
  let ids = (await db('SELECT user_id FROM ticket_assignees WHERE ticket_id = ?', [t.id])).map(r => r.user_id);
  if (!ids.length && t.team_id) ids = (await db('SELECT user_id FROM team_members WHERE team_id = ?', [t.team_id])).map(r => r.user_id);
  if (!ids.length) ids = (await db("SELECT user_id FROM dashboard_users WHERE role = 'fondateur'")).map(r => r.user_id);
  return ids;
}

async function fire(ctx, t, l) {
  const { db, guildId, client } = ctx;
  const { canUserSeeTicket } = require('./gradePermissions');
  const what = `${LABEL[l.objective]} ${l.percent >= 100 ? (l.percent === 100 ? 'dépassée' : `dépassée (${l.percent} %)`) : `à ${l.percent} %`}`;
  const title = `Escalade · #${t.id} : ${what}`;
  const body = t.visibility_grade_id === CONFIDENTIAL ? '' : String(t.subject || '').slice(0, 120);
  const done = [];
  if (l.raisePriority && UP[t.priority]) {
    await require('./ticketManager').createManager(db, client, guildId).setPriority(t.id, UP[t.priority], ACTOR);
    done.push(`priorité ${UP[t.priority]}`);
  }
  if (l.teamId && l.teamId !== t.team_id && t.visibility_grade_id !== CONFIDENTIAL) {
    const r = await require('./teams').routeTicket({ db, tm: require('./ticketManager').createManager(db, client, guildId), ticket: t, teamId: l.teamId, actor: ACTOR });
    if (r.teamId) done.push('équipe changée');
  }
  for (const uid of l.followerIds) {
    if (await canUserSeeTicket(db, uid, t).catch(() => false)) { await require('./followers').setFollowing(db, t.id, uid, true); done.push(`suivi par ${uid}`); }
  }
  if (l.notify) {
    const { sendToUser } = require('./sse');
    for (const uid of [...new Set([...(await staffToTell(db, t)), ...l.followerIds])]) {
      if (!(await canUserSeeTicket(db, uid, t).catch(() => false))) continue;
      sendToUser(guildId, uid, 'followed', { ticketId: t.id, subject: body || null, kind: 'escalation', title, body });
      require('../web/routes/push').sendPushToUser(guildId, uid, { type: 'follow', title, body, ticketId: t.id }).catch(() => null);
    }
    done.push('staff prévenu');
  }
  if (l.alertChannel && client) {
    const [cfg] = await db('SELECT escalation_alert_channel_id, close_log_channel_id FROM guild_config WHERE id = 1');
    const chId = cfg?.escalation_alert_channel_id || cfg?.close_log_channel_id;
    const ch = chId ? await require('./discordGuard').fetchGuildChannel(client, guildId, chId) : null;
    if (ch?.isTextBased?.()) {
      const { EmbedBuilder } = require('discord.js');
      await ch.send({ embeds: [new EmbedBuilder().setColor(0xef4444).setTitle(`🚨 ${title}`).setDescription(body || '(confidentiel)').setTimestamp()] }).catch(() => null);
      done.push('alerte publiée');
    }
  }
  await recordEvent(db, { actor: ACTOR, action: 'ticket_sla_escalation', ticketId: t.id, details: { objective: l.objective, percent: l.percent, actions: done } });
}

// « Objective breached » notification (utils/notifications.js): once per ticket and objective.
// Marked in sla_escalation_fired with the negative ids -1 (tto), -2 (ttr), -3 (ola): not levels.
const BREACH = [['tto', -1, t => !t.first_response_at && t.tto_due_at, 'prise en charge'], ['ttr', -2, t => !t.sla_paused_at && t.ttr_due_at, 'résolution'], ['ola', -3, t => !t.sla_paused_at && t.ola_due_at, 'objectif interne']];
async function breachNotice(ctx, t, now) {
  for (const [, id, dueOf, label] of BREACH) {
    const due = dueOf(t);
    if (!due || now < new Date(due).getTime()) continue;
    const r = await ctx.db('INSERT IGNORE INTO sla_escalation_fired (ticket_id, escalation_id) VALUES (?, ?)', [t.id, id]);
    if (r.affectedRows) await require('./notifications').notify(ctx.db, ctx.guildId, 'sla_breached', t, { objective: label, client: ctx.client });
  }
}

async function runForGuild(ctx, now = Date.now()) {
  const { db } = ctx;
  const levels = (await db('SELECT * FROM sla_escalations').catch(() => [])).map(r => ({ ...shape(r), policyId: r.policy_id, ownerTeamId: r.team_id }));
  const tellBreach = (await require('./notifications').listRules(db)).some(r => r.active && r.event === 'sla_breached');
  if (!levels.length && !tellBreach) return 0;
  const tickets = await db(`SELECT * FROM tickets WHERE status = 'open' AND resolved_at IS NULL AND (sla_policy_id IS NOT NULL OR ola_due_at IS NOT NULL) ORDER BY id DESC LIMIT 5000`);
  const fired = new Set((await db('SELECT ticket_id, escalation_id FROM sla_escalation_fired')).map(r => `${r.ticket_id}:${r.escalation_id}`));
  const policies = Object.fromEntries((await db('SELECT id, tto_minutes, ttr_minutes, business_hours FROM sla_policies WHERE active = 1')).map(p => [p.id, p]));
  const teams = Object.fromEntries((await db('SELECT id, ola_minutes FROM teams')).map(x => [x.id, x]));
  let n = 0;
  for (const t of tickets) {
    if (tellBreach) await breachNotice(ctx, t, now);
    const mine = levels.filter(l => (l.policyId && l.policyId === t.sla_policy_id) || (l.ownerTeamId && l.ownerTeamId === t.team_id));
    const todo = mine.filter(l => !fired.has(`${t.id}:${l.id}`));
    if (!todo.length) continue;
    const policy = policies[t.sla_policy_id];
    const teamAdd = await adder(db, t);
    const addFor = { team: teamAdd, policy: policy && Number(policy.business_hours) ? teamAdd : (from, m) => from + m * 60000 };
    for (const l of todo) {
      const at = await fireAt(db, t, l, policy, teams[t.team_id], addFor);
      if (at == null || now < at) continue;
      const r = await db('INSERT IGNORE INTO sla_escalation_fired (ticket_id, escalation_id) VALUES (?, ?)', [t.id, l.id]);
      if (!r.affectedRows) continue;
      const [fresh] = await db('SELECT * FROM tickets WHERE id = ?', [t.id]);
      await fire(ctx, fresh, l).catch(err => console.error('escalade SLA', t.id, err.message));
      n++;
    }
  }
  return n;
}

async function runSlaEscalation(client) {
  const { getActiveGuilds } = require('./guildScan');
  const { getTenantDb } = require('./tenantDb');
  for (const { guild_id } of await getActiveGuilds().catch(() => [])) {
    await runForGuild({ db: getTenantDb(guild_id), guildId: guild_id, client }).catch(err => console.error(`escalade SLA [${guild_id}]`, err.message));
  }
}

module.exports = { OBJECTIVES, MAX_LEVELS, levelsOf, cleanLevels, saveLevels, dropLevels, cleanOla, refreshOla, onTeamChange, refreshTeamTickets, onResume, runForGuild, runSlaEscalation };

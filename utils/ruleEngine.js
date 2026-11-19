// Business rules (v5.2, conception/v5.md §3.8): one engine for what happens to a ticket on its own.
// WHEN a ticket is created, the requester writes, the staff replies, its status or priority
// changes; IF all (or any) of the conditions hold; THEN actions, rule after rule in order, with
// « stop after this rule ». Each rule applied is written in the ticket's journal.
// Guards: changes made by a rule never start the rules again (RULE_ACTOR), 50 actions at most
// per event, rules written by the founders or the manage_rules permission.
// The old rules by subject and by keywords are rules of this engine (origin « subject »,
// web/routes/subjectRules.js keeps their simple form).
const { parseJsonField } = require('./jsonField');
const { recordEvent } = require('./audit');
const { matchesSubject, norm } = require('./subjectMatch');
const { CONFIDENTIAL } = require('./gradePermissions');
const logger = require('./logger');

const TRIGGERS = ['created', 'member_reply', 'staff_reply', 'stage', 'priority', 'time'];
// « When time passes » (utils/ruleTimers.js): so long after (or before) a moment of the ticket
const TIMER_BASES = ['created', 'stage', 'last_member', 'last_staff', 'last_activity', 'tto_due', 'ttr_due'];
const DUE_BASES = ['tto_due', 'ttr_due'];
const FIELDS = ['channel', 'address', 'type', 'subject', 'text', 'requester', 'priority', 'stage', 'tag', 'hours', 'language', 'organization'];
const ACTIONS = ['subject', 'type', 'urgency', 'impact', 'priority', 'team', 'assign', 'tagAdd', 'tagRemove', 'stage', 'grade', 'follower', 'reply', 'note', 'notify', 'webhook', 'close', 'tasks'];
const PRIORITIES = ['low', 'normal', 'urgent'];
const CHANNELS = ['discord', 'email', 'web'];
const LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt'];
const MAX_RULES = 100, MAX_CONDITIONS = 20, MAX_RULE_ACTIONS = 20, MAX_EVENT_ACTIONS = 50;
const RULE_ACTOR = { id: 'system', tag: 'Règle automatique', username: 'Règle automatique', source: 'rule' };
const channelOf = ownerId => (/^mail:/.test(ownerId) ? 'email' : /^web:/.test(ownerId) ? 'web' : 'discord');

// Keywords: comma-separated words or phrases, from the start of a word, accents and case ignored
const keywordList = s => String(s || '').split(',').map(k => norm(k)).filter(Boolean);
function matchesKeywords(keywords, text) {
  const t = ` ${norm(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return keywordList(keywords).some(k => t.includes(` ${k.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`));
}

const shape = r => ({
  id: r.id, name: r.name, position: r.position, active: !!Number(r.active), origin: r.origin || null,
  triggers: parseJsonField(r.triggers, []), match: r.match_mode === 'any' ? 'any' : 'all',
  conditions: parseJsonField(r.conditions, []), actions: parseJsonField(r.actions, []), stop: !!Number(r.stop_after),
  timer: parseJsonField(r.timer, null),
});
async function listRules(db) {
  return (await db('SELECT * FROM ticket_rules ORDER BY position, id').catch(() => [])).map(shape);
}

// ── Validation ──
const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const staffIds = async (db, ids) => (await db("SELECT user_id FROM dashboard_users WHERE user_id IN (?) AND role IN ('support', 'fondateur')", [ids])).map(r => String(r.user_id));
const subjectsOf = async db => {
  const [cfg] = await db('SELECT ticket_subjects FROM guild_config WHERE id = 1');
  return parseJsonField(cfg?.ticket_subjects, []).map(x => (typeof x === 'string' ? x : x?.label || x?.name)).filter(Boolean);
};

async function cleanCondition(db, c) {
  if (!c || !FIELDS.includes(c.field)) return { error: 'Condition inconnue' };
  const values = [...new Set((Array.isArray(c.values) ? c.values : [c.values]).filter(v => v !== undefined && v !== null && v !== '').map(v => String(v).trim()))].slice(0, 20);
  if (!values.length) return { error: 'Une condition sans valeur' };
  const only = list => (values.every(v => list.includes(v)) ? null : { error: 'Valeur de condition invalide' });
  const bad = {
    channel: () => only(CHANNELS), type: () => only(['incident', 'request']), priority: () => only(PRIORITIES), language: () => only(LANGS),
    hours: () => (values.length === 1 && ['open', 'closed'].includes(values[0]) ? null : { error: 'Horaires : ouvert ou fermé' }),
    stage: () => (values.every(v => /^(open|waiting|in_progress|s_\d{1,9})$/.test(v)) ? null : { error: 'Statut invalide' }),
    subject: () => (values.every(v => v.length <= 100) ? null : { error: 'Sujet trop long' }),
    text: () => (values.every(v => v.length <= 300 && keywordList(v).every(w => w.length >= 3 && w.length <= 60)) ? null : { error: 'Mots-clés : de 3 à 60 caractères, séparés par des virgules' }),
    requester: () => (values.every(v => v.length >= 3 && v.length <= 100) ? null : { error: 'Demandeur : de 3 à 100 caractères (adresse, domaine, nom)' }),
    address: () => (values.every(v => /^[^\s@]+@[^\s@]+$/.test(v) && v.length <= 254) ? null : { error: 'Adresse de réception invalide' }),
    tag: () => null, organization: () => null,
  }[c.field]();
  if (bad) return bad;
  let out = values;
  if (c.field === 'tag') {
    out = values.map(Number).filter(Number.isInteger);
    if (out.length !== values.length || (await db('SELECT id FROM ticket_tags WHERE id IN (?)', [out])).length !== out.length) return { error: 'Tag introuvable' };
  }
  if (c.field === 'address') out = values.map(v => v.toLowerCase());
  if (c.field === 'organization') {
    out = values.map(Number).filter(Number.isInteger);
    if (out.length !== values.length || (await db('SELECT id FROM organizations WHERE id IN (?)', [out])).length !== out.length) return { error: 'Organisation introuvable' };
  }
  return { value: { field: c.field, not: !!c.not, values: out } };
}

async function cleanAction(db, a, { canGrade }) {
  if (!a || !ACTIONS.includes(a.type)) return { error: 'Action inconnue' };
  const v = a.value;
  const id = Number(v);
  const one = async (sql, msg) => ((await db(sql, [id])).length ? { value: { type: a.type, value: id } } : { error: msg });
  switch (a.type) {
    case 'subject': {
      const s = str(v, 100);
      return (await subjectsOf(db)).includes(s) ? { value: { type: a.type, value: s } } : { error: 'Sujet inconnu (Paramètres → Tickets → Sujets)' };
    }
    case 'type': return ['incident', 'request'].includes(v) ? { value: { type: a.type, value: v } } : { error: 'Type invalide' };
    case 'urgency': case 'impact': return Number.isInteger(id) && id >= 1 && id <= 5 ? { value: { type: a.type, value: id } } : { error: 'Urgence et impact : de 1 à 5' };
    case 'priority': return PRIORITIES.includes(v) ? { value: { type: a.type, value: v } } : { error: 'Priorité invalide' };
    case 'team': return one('SELECT id FROM teams WHERE id = ?', 'Équipe introuvable');
    case 'tasks': return one('SELECT id FROM task_templates WHERE id = ?', 'Modèle de tâches introuvable');
    case 'tagAdd': case 'tagRemove': return one('SELECT id FROM ticket_tags WHERE id = ?', 'Tag introuvable');
    case 'grade':
      if (!canGrade) return { error: 'Restreindre à un grade demande la permission manage_grades', status: 403 };
      return one('SELECT id FROM grades WHERE id = ?', 'Grade introuvable');
    case 'stage': return (await require('./stages').stageOf(db, String(v))) ? { value: { type: a.type, value: String(v) } } : { error: 'Statut introuvable' };
    case 'assign': case 'follower': case 'notify': {
      const ids = [...new Set((Array.isArray(v) ? v : [v]).map(String))].slice(0, 10);
      if (!ids.length || (await staffIds(db, ids)).length !== ids.length) return { error: 'Seul le staff de l\'espace peut être choisi' };
      return { value: { type: a.type, value: a.type === 'assign' ? ids[0] : ids } };
    }
    case 'reply': case 'note': {
      const text = typeof v === 'string' ? v.trim().slice(0, 2000) : '';
      return text ? { value: { type: a.type, value: text } } : { error: 'Texte requis (2000 caractères au plus)' };
    }
    case 'webhook': case 'close': return { value: { type: a.type, value: true } };
    default: return { error: 'Action inconnue' };
  }
}

async function cleanRule(db, input = {}, { canGrade = false } = {}) {
  const name = str(input.name, 80);
  if (!name) return { error: 'Nom de la règle requis (80 caractères au plus)' };
  const triggers = [...new Set(Array.isArray(input.triggers) ? input.triggers : [])].filter(t => TRIGGERS.includes(t));
  if (!triggers.length) return { error: 'Choisis quand la règle s\'applique' };
  let timer = null;
  if (triggers.includes('time')) {
    if (triggers.length > 1) return { error: '« Le temps passe » ne se combine pas avec un autre déclencheur' };
    const t = input.timer || {};
    const minutes = Number(t.minutes);
    if (!TIMER_BASES.includes(t.basis)) return { error: 'Point de départ du délai invalide' };
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 365 * 24 * 60) return { error: 'Délai : de 1 minute à un an' };
    const direction = t.direction === 'before' ? 'before' : 'after';
    if (direction === 'before' && !DUE_BASES.includes(t.basis)) return { error: '« Avant » ne vaut que pour une échéance SLA' };
    timer = { basis: t.basis, minutes, direction, businessHours: t.businessHours !== false };
  }
  const conditions = [];
  for (const c of (Array.isArray(input.conditions) ? input.conditions : []).slice(0, MAX_CONDITIONS + 1)) {
    if (conditions.length >= MAX_CONDITIONS) return { error: `${MAX_CONDITIONS} conditions au plus` };
    const r = await cleanCondition(db, c);
    if (r.error) return r;
    conditions.push(r.value);
  }
  const actions = [];
  for (const a of (Array.isArray(input.actions) ? input.actions : []).slice(0, MAX_RULE_ACTIONS + 1)) {
    if (actions.length >= MAX_RULE_ACTIONS) return { error: `${MAX_RULE_ACTIONS} actions au plus` };
    const r = await cleanAction(db, a, { canGrade });
    if (r.error) return r;
    actions.push(r.value);
  }
  if (!actions.length) return { error: 'Choisis au moins une action' };
  return { value: { name, triggers, timer, match: input.match === 'any' ? 'any' : 'all', conditions, actions, stop: !!input.stop, active: input.active !== false } };
}

async function saveRule(db, id, input, opts = {}) {
  const r = await cleanRule(db, input, opts);
  if (r.error) return r;
  const v = r.value;
  const vals = [v.name, JSON.stringify(v.triggers), v.match, JSON.stringify(v.conditions), JSON.stringify(v.actions), v.stop ? 1 : 0, v.active ? 1 : 0, v.timer ? JSON.stringify(v.timer) : null];
  if (id) {
    const res = await db('UPDATE ticket_rules SET name = ?, triggers = ?, match_mode = ?, conditions = ?, actions = ?, stop_after = ?, active = ?, timer = ? WHERE id = ?', [...vals, id]);
    if (!res.affectedRows) return { error: 'Règle introuvable', status: 404 };
    return { ok: true, id, value: v };
  }
  const [n] = await db('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS pos FROM ticket_rules');
  if (Number(n.n) >= MAX_RULES) return { error: `${MAX_RULES} règles au plus` };
  const ins = await db('INSERT INTO ticket_rules (name, triggers, match_mode, conditions, actions, stop_after, active, timer, position, origin, legacy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [...vals, Number(n.pos) + 1, opts.origin || null, opts.legacy ? JSON.stringify(opts.legacy) : null]);
  return { ok: true, id: ins.insertId, value: v };
}
async function deleteRule(db, id) {
  const r = await db('DELETE FROM ticket_rules WHERE id = ?', [id]);
  return r.affectedRows ? { ok: true } : { error: 'Règle introuvable', status: 404 };
}
async function reorderRules(db, ids) {
  let pos = 1;
  for (const id of (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger).slice(0, MAX_RULES)) await db('UPDATE ticket_rules SET position = ? WHERE id = ?', [pos++, id]);
}

// ── Evaluation ──
async function contextOf(db, guildId, ticketId, extra = {}) {
  const [t] = await db('SELECT * FROM tickets WHERE id = ?', [ticketId]);
  if (!t) return null;
  const tags = new Set((await db('SELECT tag_id FROM ticket_tag_assignments WHERE ticket_id = ?', [t.id])).map(r => Number(r.tag_id)));
  let address = extra.address ? String(extra.address).toLowerCase() : null;
  if (!address) {
    const [row] = await db('SELECT a.address FROM email_threads th JOIN email_addresses a ON a.id = th.via_address_id WHERE th.ticket_id = ?', [t.id]).catch(() => []);
    address = row?.address ? String(row.address).toLowerCase() : null;
    // Came to the main mailbox
    if (!address && channelOf(t.owner_id) === 'email') {
      const [m] = await db('SELECT address, oauth_account FROM email_settings LIMIT 1').catch(() => []);
      address = (m?.oauth_account || m?.address) ? String(m.oauth_account || m.address).toLowerCase() : null;
    }
  }
  return { t, tags, address, message: extra.message || '', guildId, language: null };
}

async function holds(db, c, ctx) {
  const { t } = ctx;
  let ok;
  switch (c.field) {
    case 'channel': ok = c.values.includes(channelOf(t.owner_id)); break;
    case 'address': ok = !!ctx.address && c.values.includes(ctx.address); break;
    case 'type': ok = c.values.includes(t.ticket_type || 'request'); break;
    case 'subject': ok = !!t.subject && c.values.some(v => matchesSubject(v, t.subject)); break;
    case 'text': ok = !!ctx.message && c.values.some(v => matchesKeywords(v, ctx.message)); break;
    case 'requester': ok = c.values.some(v => `${t.owner_tag || ''} ${t.owner_id || ''}`.toLowerCase().includes(v.toLowerCase())); break;
    case 'priority': ok = c.values.includes(t.priority || 'normal'); break;
    case 'stage': ok = c.values.includes(t.stage || 'open'); break;
    case 'tag': ok = c.values.some(id => ctx.tags.has(Number(id))); break;
    case 'organization': {
      // An organisation covers its sub-organisations
      const [o] = t.organization_id ? await db('SELECT parent_id FROM organizations WHERE id = ?', [t.organization_id]) : [];
      ok = c.values.some(id => Number(id) === Number(t.organization_id) || (o?.parent_id && Number(id) === Number(o.parent_id)));
      break;
    }
    case 'hours': {
      const cal = require('./calendars');
      const k = await cal.calendarForTicket(db, t);
      const open = !k || cal.isOpen(cal.asCal(k));
      ok = c.values[0] === 'open' ? open : !open;
      break;
    }
    case 'language': {
      if (ctx.language === null) ctx.language = await require('./i18n').memberLang(t.owner_id, ctx.guildId).catch(() => 'fr');
      ok = c.values.includes(ctx.language);
      break;
    }
    default: ok = false;
  }
  return c.not ? !ok : ok;
}
async function evaluate(db, rule, ctx) {
  const results = [];
  for (const c of rule.conditions) results.push({ field: c.field, ok: await holds(db, c, ctx) });
  const matched = !results.length || (rule.match === 'any' ? results.some(r => r.ok) : results.every(r => r.ok));
  return { matched, results };
}

// ── Actions ──
const PRIORITY_LABEL = { low: 'basse', normal: 'normale', urgent: 'urgente' };
async function apply(env, a, rule) {
  const { db, client, guildId } = env;
  const [t] = await db('SELECT * FROM tickets WHERE id = ?', [env.ticketId]);
  if (!t || t.status !== 'open') return null;
  const tm = env.tm || (env.tm = require('./ticketManager').createManager(db, client, guildId));
  const confidential = t.visibility_grade_id === CONFIDENTIAL;
  const { canUserSeeTicket } = require('./gradePermissions');
  const tagSync = id => require('./channelVisibility').syncAfterTagChange(db, client, guildId, t.id, id).catch(() => null);
  switch (a.type) {
    case 'subject':
      if (t.subject === a.value) return null;
      await tm.setSubject(t.id, a.value, RULE_ACTOR);
      await require('./slaPolicies').refreshQuietly(db, t.id);
      return `sujet ${a.value}`;
    case 'type':
      if ((t.ticket_type || 'request') === a.value) return null;
      await db('UPDATE tickets SET ticket_type = ? WHERE id = ?', [a.value, t.id]);
      await recordEvent(db, { actor: RULE_ACTOR, action: 'ticket_type', ticketId: t.id, details: { from: t.ticket_type, to: a.value, rule: rule.name } });
      await require('./slaPolicies').refreshQuietly(db, t.id);
      return `type ${a.value}`;
    case 'urgency': case 'impact': {
      const pm = require('./priorityMatrix');
      if (!(await pm.matrixSettings(db)).enabled) return null;
      const r = await pm.setMatrixPriority({ db, client, guildId, ticket: t, [a.type]: a.value, actor: RULE_ACTOR });
      return r?.error ? null : `${a.type === 'urgency' ? 'urgence' : 'impact'} ${a.value}`;
    }
    case 'priority':
      if (t.priority === a.value) return null;
      await tm.setPriority(t.id, a.value, RULE_ACTOR);
      return `priorité ${PRIORITY_LABEL[a.value]}`;
    case 'team': {
      if (t.team_id === a.value || confidential) return null;
      const r = await require('./teams').routeTicket({ db, tm, ticket: t, teamId: a.value, actor: RULE_ACTOR });
      return r.teamId ? 'équipe' : null;
    }
    case 'assign': {
      if (!(await canUserSeeTicket(db, a.value, t).catch(() => false))) return null;
      const [u] = await db('SELECT user_id, username FROM dashboard_users WHERE user_id = ?', [a.value]);
      if (!u) return null;
      return (await tm.addAssignee(t.id, { id: u.user_id, username: u.username, tag: u.username }, RULE_ACTOR)) ? `attribué à ${u.username}` : null;
    }
    case 'tagAdd':
      if (!(await db('INSERT IGNORE INTO ticket_tag_assignments (ticket_id, tag_id) SELECT ?, id FROM ticket_tags WHERE id = ?', [t.id, a.value])).affectedRows) return null;
      await recordEvent(db, { actor: RULE_ACTOR, action: 'ticket_tag_add', ticketId: t.id, targetType: 'tag', targetId: a.value, details: { rule: rule.name } });
      await tagSync(a.value);
      return 'tag ajouté';
    case 'tagRemove':
      if (!(await db('DELETE FROM ticket_tag_assignments WHERE ticket_id = ? AND tag_id = ?', [t.id, a.value])).affectedRows) return null;
      await recordEvent(db, { actor: RULE_ACTOR, action: 'ticket_tag_remove', ticketId: t.id, targetType: 'tag', targetId: a.value, details: { rule: rule.name } });
      await tagSync(a.value);
      return 'tag retiré';
    case 'stage': {
      if ((t.stage || 'open') === a.value) return null;
      const r = await tm.moveToStage(t.id, a.value, RULE_ACTOR);
      return r?.ok ? `statut ${r.label}` : null;
    }
    case 'grade':
      // A confidential ticket stays confidential (no rule widens or narrows it)
      if (confidential || t.visibility_grade_id === a.value) return null;
      await db('UPDATE tickets SET visibility_grade_id = ? WHERE id = ?', [a.value, t.id]);
      await recordEvent(db, { actor: RULE_ACTOR, action: 'ticket_visibility_change', ticketId: t.id, details: { visibility_grade_id: a.value, rule: rule.name } });
      await require('./channelVisibility').syncTicketChannel(db, client, guildId, { ...t, visibility_grade_id: a.value });
      return 'grade';
    case 'follower': {
      let n = 0;
      for (const uid of a.value) if (await canUserSeeTicket(db, uid, t).catch(() => false)) { await require('./followers').setFollowing(db, t.id, uid, true); n++; }
      return n ? `${n} observateur(s)` : null;
    }
    case 'notify': {
      const { sendToUser } = require('./sse');
      const title = `Règle « ${rule.name} » · #${t.id}`;
      const body = confidential ? '' : String(t.subject || '').slice(0, 120);
      let n = 0;
      for (const uid of a.value) {
        if (!(await canUserSeeTicket(db, uid, t).catch(() => false))) continue;
        sendToUser(guildId, uid, 'followed', { ticketId: t.id, subject: body || null, kind: 'rule', title, body });
        require('../web/routes/push').sendPushToUser(guildId, uid, { type: 'follow', title, body, ticketId: t.id }).catch(() => null);
        n++;
      }
      return n ? `${n} personne(s) prévenue(s)` : null;
    }
    case 'reply': {
      const { sendToMember } = require('./i18n');
      const { ticketNoticeDmEmbed } = require('./dmEmbeds');
      const sent = await sendToMember(client, t.owner_id, guildId, () => ({ embeds: [ticketNoticeDmEmbed(client, guildId, t, { title: `#${t.id}${t.subject ? ` · ${t.subject}` : ''}`, description: a.value, color: 'primary' })] }), { ticketId: t.id }).catch(() => null);
      await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, 'system', ?, ?, 'system')", [t.id, `Règle « ${rule.name} »`, `🤖 Réponse automatique envoyée au demandeur :\n${a.value}`]);
      return sent === null ? null : 'réponse automatique';
    }
    case 'note':
      await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, 'system', ?, ?, 'system')", [t.id, `Règle « ${rule.name} »`, a.value]);
      return 'note interne';
    case 'tasks': {
      const r = await require('./tasks').applyTemplate(db, t.id, a.value, RULE_ACTOR, { guildId });
      return r.added ? `${r.added} tâche(s)` : null;
    }
    case 'webhook':
      await require('./webhookEmitter').fireTicketWebhook(db, 'rule_applied', { ticketId: t.id, rule: rule.name, subject: t.subject || null });
      return 'webhook';
    case 'close': {
      const channel = await tm.channelOf(t);
      const closer = { ...RULE_ACTOR, reason: `règle « ${rule.name} »` };
      if (channel) await tm.closeTicketWithTranscript(channel, closer);
      else {
        await db("UPDATE tickets SET status = 'closed', closed_at = NOW(), closed_by_tag = ? WHERE id = ?", [RULE_ACTOR.tag, t.id]);
        await recordEvent(db, { actor: RULE_ACTOR, action: 'ticket_close', ticketId: t.id, details: { rule: rule.name } });
      }
      return 'fermé';
    }
    default: return null;
  }
}

// ── Running the rules for one event ──
// trigger: TRIGGERS; actor: who caused the event (a rule → nothing runs); message: the text written
async function runRules({ db, client, guildId, ticketId, trigger, actor = null, message = '', address = null, tm = null, only = null }) {
  if (actor?.source === 'rule' || !TRIGGERS.includes(trigger)) return [];
  const rules = only || (await listRules(db)).filter(r => r.active && r.triggers.includes(trigger));
  if (!rules.length) return [];
  const env = { db, client, guildId, ticketId, tm };
  const applied = [];
  let budget = MAX_EVENT_ACTIONS;
  for (const rule of rules) {
    const ctx = await contextOf(db, guildId, ticketId, { message, address });
    if (!ctx || ctx.t.status !== 'open') break;
    if (!(await evaluate(db, rule, ctx)).matched) continue;
    const done = [];
    for (const a of rule.actions) {
      if (budget-- <= 0) break;
      try {
        const r = await apply(env, a, rule);
        if (r) done.push(r);
      } catch (err) {
        logger.error('Règle : action', { guildId, ticketId, rule: rule.id, action: a.type, err: err.message });
      }
    }
    if (done.length) await recordEvent(db, { actor: RULE_ACTOR, action: 'ticket_rule', ticketId, details: { rule: rule.name, trigger, actions: done } });
    applied.push({ rule: rule.name, actions: done });
    if (rule.stop || budget <= 0) break;
  }
  return applied;
}
// For the event hooks (reply, status, priority): never blocks nor fails the change itself
function emit(args) {
  if (args.actor?.source === 'rule') return;
  runRules(args).catch(err => logger.error('Règles', { guildId: args.guildId, ticketId: args.ticketId, err: err.message }));
}

// What a rule would do on an existing ticket, without doing it
const DESCRIBE = {
  subject: v => `Sujet → ${v}`, type: v => `Type → ${v === 'incident' ? 'incident' : 'demande'}`, urgency: v => `Urgence → ${v}`, impact: v => `Impact → ${v}`,
  priority: v => `Priorité → ${PRIORITY_LABEL[v]}`, team: v => `Équipe #${v}`, assign: v => `Attribuer à ${v}`, tagAdd: v => `Ajouter le tag #${v}`, tagRemove: v => `Retirer le tag #${v}`,
  stage: v => `Statut → ${v}`, grade: v => `Restreindre au grade #${v}`, follower: v => `Observateurs : ${v.join(', ')}`, reply: v => `Répondre : « ${v.slice(0, 80)} »`,
  note: v => `Note interne : « ${v.slice(0, 80)} »`, tasks: v => `Modèle de tâches #${v}`, notify: v => `Prévenir : ${v.join(', ')}`, webhook: () => 'Webhook', close: () => 'Fermer le ticket',
};
async function testRule(db, guildId, input, ticketId, { message = '' } = {}) {
  const r = await cleanRule(db, input, { canGrade: true });
  if (r.error) return r;
  const ctx = await contextOf(db, guildId, ticketId, { message });
  if (!ctx) return { error: 'Ticket introuvable', status: 404 };
  const { matched, results } = await evaluate(db, r.value, ctx);
  return { ok: true, matched, conditions: results, actions: matched ? r.value.actions.map(a => DESCRIBE[a.type](a.value)) : [] };
}

module.exports = { TIMER_BASES, DUE_BASES, TRIGGERS, FIELDS, ACTIONS, RULE_ACTOR, MAX_RULES, MAX_EVENT_ACTIONS, matchesKeywords, listRules, cleanRule, saveRule, deleteRule, reorderRules, runRules, emit, testRule, evaluate, contextOf };

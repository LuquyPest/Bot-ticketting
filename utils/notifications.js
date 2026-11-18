// Notifications (v5.2, conception/v5.md §3.9).
// Staff side: rules « event × recipients × channels » set by the founders (Paramètres →
// Notifications); each staff member can turn off what reaches them (Profil → Notifications)
// unless the rule is imposed. The rules created by migration 61 are what was sent before:
// followers told of messages, notes and closing in the dashboard; the assigned person in the
// dashboard and by Discord DM.
// Requester side: the texts of the messages the requester receives can be rewritten per language
// (overrides of utils/i18n.js, see templateKeys), with their {variables} and a preview.
const { parseJsonField } = require('./jsonField');
const logger = require('./logger');
const { CONFIDENTIAL } = require('./gradePermissions');

const EVENTS = ['ticket_created', 'member_reply', 'staff_reply', 'note', 'assigned', 'stage', 'closed', 'sla_breached'];
const RECIPIENTS = ['assignee', 'assignees', 'followers', 'team', 'founders', 'emails'];
const CHANNELS = ['dashboard', 'discord', 'email', 'slack', 'teams'];
const TEAM_CHANNELS = ['slack', 'teams']; // a channel of the space: one post per event, whoever the recipients
const MAX_RULES = 40;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The Discord client, for DMs from places that do not hold it (web/server.js sets it)
let sharedClient = null;
const setClient = c => { sharedClient = c; };
const client = () => sharedClient;

const TITLES = {
  ticket_created: (t, by) => `Nouveau ticket #${t.id}${by ? ` de ${by}` : ''}`,
  member_reply: (t, by) => `Message de ${by} · #${t.id}`,
  staff_reply: (t, by) => `${by} a répondu · #${t.id}`,
  note: (t, by) => `Note de ${by} · #${t.id}`,
  assigned: (t, by) => `Ticket #${t.id} attribué${by ? ` par ${by}` : ''}`,
  stage: (t, by, x) => `Ticket #${t.id} : ${x.stage || 'statut changé'}${by ? ` (${by})` : ''}`,
  closed: (t, by) => `Ticket #${t.id} fermé${by ? ` par ${by}` : ''}`,
  sla_breached: (t, by, x) => `Ticket #${t.id} : ${x.objective || 'objectif'} dépassé`,
};

// ── Rules ──
const shape = r => ({ id: r.id, event: r.event, recipients: parseJsonField(r.recipients, []), channels: parseJsonField(r.channels, []), emails: parseJsonField(r.emails, []), imposed: !!Number(r.imposed), active: !!Number(r.active) });
async function listRules(db) {
  return (await db('SELECT * FROM notification_rules ORDER BY id').catch(() => [])).map(shape);
}
function cleanRules(input) {
  if (!Array.isArray(input) || input.length > MAX_RULES) return { error: `${MAX_RULES} notifications au plus` };
  const out = [];
  for (const r of input) {
    if (!EVENTS.includes(r?.event)) return { error: 'Événement inconnu' };
    const recipients = [...new Set(Array.isArray(r.recipients) ? r.recipients : [])].filter(x => RECIPIENTS.includes(x));
    const channels = [...new Set(Array.isArray(r.channels) ? r.channels : [])].filter(x => CHANNELS.includes(x));
    const emails = [...new Set((Array.isArray(r.emails) ? r.emails : []).map(e => String(e).trim().toLowerCase()).filter(Boolean))].slice(0, 10);
    if (emails.some(e => !EMAIL_RE.test(e) || e.length > 254)) return { error: 'Adresse e-mail invalide' };
    if (recipients.includes('assignee') && r.event !== 'assigned') return { error: '« La personne attribuée » ne vaut que pour une attribution' };
    if (recipients.includes('emails') && !emails.length) return { error: 'Indique au moins une adresse' };
    if (!channels.length || (!recipients.length && !channels.every(c => TEAM_CHANNELS.includes(c)))) return { error: 'Chaque notification a des destinataires et des canaux' };
    out.push({ event: r.event, recipients, channels, emails: recipients.includes('emails') ? emails : [], imposed: !!r.imposed, active: r.active !== false });
  }
  return { value: out };
}
async function saveRules(db, input) {
  const r = cleanRules(input);
  if (r.error) return r;
  await db('DELETE FROM notification_rules');
  for (const x of r.value) {
    await db('INSERT INTO notification_rules (event, recipients, channels, emails, imposed, active) VALUES (?, ?, ?, ?, ?, ?)',
      [x.event, JSON.stringify(x.recipients), JSON.stringify(x.channels), JSON.stringify(x.emails), x.imposed ? 1 : 0, x.active ? 1 : 0]);
  }
  return { ok: true };
}

// ── Personal preferences: { event: { channel: false } } — only what is turned off is stored ──
async function prefsOf(db, userId) {
  const rows = await db('SELECT event, channel, enabled FROM user_notification_prefs WHERE user_id = ?', [String(userId)]).catch(() => []);
  const out = {};
  for (const r of rows) (out[r.event] = out[r.event] || {})[r.channel] = !!Number(r.enabled);
  return out;
}
async function savePrefs(db, userId, prefs) {
  if (!prefs || typeof prefs !== 'object') return { error: 'Préférences invalides' };
  for (const [event, channels] of Object.entries(prefs)) {
    if (!EVENTS.includes(event) || !channels || typeof channels !== 'object') continue;
    for (const [channel, on] of Object.entries(channels)) {
      if (!CHANNELS.includes(channel)) continue;
      await db('INSERT INTO user_notification_prefs (user_id, event, channel, enabled) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)', [String(userId), event, channel, on ? 1 : 0]);
      // The older profile switch follows (utils/assignNotify.js used to read it)
      if (event === 'assigned' && channel === 'discord') await db('UPDATE dashboard_users SET notify_assign_dm = ? WHERE user_id = ?', [on ? 1 : 0, String(userId)]);
    }
  }
  return { ok: true };
}
// What reaches this person, for the profile: the active rules naming them by role
async function reachingRules(db) {
  return (await listRules(db)).filter(r => r.active && r.recipients.some(x => x !== 'emails'))
    .map(r => ({ ...r, channels: r.channels.filter(c => !TEAM_CHANNELS.includes(c)) })).filter(r => r.channels.length);
}

// ── Sending ──
async function recipientsOf(db, rule, ticket, extra) {
  const ids = new Set();
  const add = rows => rows.forEach(r => ids.add(String(r.user_id)));
  for (const who of rule.recipients) {
    if (who === 'assignee' && extra.assigneeId) ids.add(String(extra.assigneeId));
    if (who === 'assignees') add(await db('SELECT user_id FROM ticket_assignees WHERE ticket_id = ?', [ticket.id]));
    if (who === 'followers') add(await db('SELECT user_id FROM ticket_followers WHERE ticket_id = ?', [ticket.id]));
    if (who === 'team' && ticket.team_id) add(await db('SELECT user_id FROM team_members WHERE team_id = ?', [ticket.team_id]));
    if (who === 'founders') add(await db("SELECT user_id FROM dashboard_users WHERE role = 'fondateur'"));
  }
  return [...ids];
}

async function sendEmail(guildId, to, title, body, ticket) {
  const { config } = require('./config');
  const base = String(config.webServerBaseUrl || '').replace(/\/$/, '');
  const [row] = await require('./globalDb').globalQuery('SELECT guild_name FROM guilds WHERE guild_id = ?', [guildId]).catch(() => []);
  const space = row?.guild_name || 'Support';
  await require('./instanceMail').sendInstanceMail({ to, template: 'staffNotification', vars: { space, title, body: body || title, link: base ? `${base}/tickets/${ticket.id}` : '' } });
}

// event: EVENTS; ticket: the row (id, subject, team_id, visibility…); opts: { by, byId, excerpt,
// assigneeId, stage, objective, client }. Never throws. Returns the staff ids told on any channel.
async function notify(db, guildId, event, ticket, opts = {}) {
  try {
    if (!ticket?.id || !EVENTS.includes(event)) return [];
    const rules = (await listRules(db)).filter(r => r.active && r.event === event);
    if (!rules.length) return [];
    const confidential = ticket.visibility_grade_id === CONFIDENTIAL;
    const title = TITLES[event](ticket, opts.by || '', opts);
    const body = confidential ? '' : String(opts.excerpt || ticket.subject || '').slice(0, 160);
    const { canUserSeeTicket } = require('./gradePermissions');
    const { sendToUser } = require('./sse');
    const told = new Set();
    const done = new Set(); // user:channel already sent for this event
    const prefs = new Map();
    for (const rule of rules) {
      for (const kind of rule.channels.filter(c => TEAM_CHANNELS.includes(c))) {
        if (done.has(`space:${kind}`)) continue;
        done.add(`space:${kind}`);
        await require('./chatIntegrations').post(db, guildId, kind, ticket, { title, body }).catch(() => null);
      }
      for (const uid of await recipientsOf(db, rule, ticket, opts)) {
        if (opts.byId && uid === String(opts.byId)) continue;
        if (!(await canUserSeeTicket(db, uid, ticket).catch(() => false))) continue;
        if (!prefs.has(uid)) prefs.set(uid, await prefsOf(db, uid));
        for (const channel of rule.channels.filter(c => !TEAM_CHANNELS.includes(c))) {
          if (done.has(`${uid}:${channel}`)) continue;
          if (!rule.imposed && prefs.get(uid)[event]?.[channel] === false) continue;
          done.add(`${uid}:${channel}`);
          if (channel === 'dashboard') {
            if (event === 'assigned') sendToUser(guildId, uid, 'assigned', { ticketId: ticket.id, subject: confidential ? null : ticket.subject, ownerTag: confidential ? null : ticket.owner_tag, by: opts.by });
            else sendToUser(guildId, uid, 'followed', { ticketId: ticket.id, subject: confidential ? null : ticket.subject || null, kind: event, title, body });
            require('../web/routes/push').sendPushToUser(guildId, uid, { type: event === 'assigned' ? 'assigned' : 'follow', title, body, ticketId: ticket.id }).catch(() => null);
            told.add(uid);
          } else if (channel === 'discord') {
            const ok = await sendDiscord(opts.client || sharedClient, guildId, uid, event, ticket, { title, body, by: opts.by, confidential }).catch(() => false);
            if (ok) told.add(uid);
          } else if (channel === 'email') {
            const [acc] = await require('./globalDb').globalQuery('SELECT email FROM accounts WHERE id = ? AND email_verified = 1', [uid]).catch(() => []);
            if (acc?.email) { await sendEmail(guildId, acc.email, title, body, ticket).catch(() => null); told.add(uid); }
          }
        }
      }
      // Fixed addresses: e-mail only
      if (rule.recipients.includes('emails') && rule.channels.includes('email')) {
        for (const to of rule.emails) {
          if (done.has(`${to}:email`)) continue;
          done.add(`${to}:email`);
          // A confidential ticket says only its number outside the space
          await sendEmail(guildId, to, confidential ? `Ticket #${ticket.id}` : title, body, ticket).catch(() => null);
        }
      }
    }
    return [...told];
  } catch (err) {
    logger.error('Notifications', { guildId, ticketId: ticket?.id, event, err: err.message });
    return [];
  }
}

async function sendDiscord(client, guildId, uid, event, ticket, { title, body, by, confidential }) {
  const user = await client?.users?.fetch(uid).catch(() => null);
  if (!user) return false;
  const { EmbedBuilder } = require('discord.js');
  const { config } = require('./config');
  const base = config.webServerBaseUrl;
  const guildName = client.guilds?.cache?.get(guildId)?.name;
  const embed = new EmbedBuilder().setColor(0x6366f1).setAuthor({ name: `${guildName || 'Support'} · ${title}`.slice(0, 256) });
  if (event === 'assigned') {
    embed.setDescription(`${by || 'Quelqu\'un'} t'a attribué ce ticket.`)
      .addFields({ name: 'Sujet', value: confidential ? '(confidentiel)' : (ticket.subject || 'Sans sujet').slice(0, 1024), inline: true },
        { name: 'Membre', value: confidential ? '—' : String(ticket.owner_tag || '—').slice(0, 1024), inline: true });
    if (ticket.channel_id && !require('./virtualChannel').isVirtualChannelId(ticket.channel_id)) embed.addFields({ name: 'Salon', value: `<#${ticket.channel_id}>`, inline: true });
  } else if (body) embed.setDescription(body.slice(0, 4000));
  if (base) embed.setURL(`${base.replace(/\/$/, '')}/tickets/${ticket.id}`).setTitle('Ouvrir dans le dashboard');
  embed.setFooter({ text: 'Réglable depuis ton profil sur le dashboard' });
  return !!(await user.send({ embeds: [embed] }).catch(() => null));
}
// For the hooks: never waits for nor fails the change itself
function emit(db, guildId, event, ticket, opts) { notify(db, guildId, event, ticket, opts).catch(() => null); }

// ── Requester messages, per language (overrides of utils/i18n.js) ──
const TEMPLATE_KEYS = ['welcome.default', 'staffOpen.title', 'staffOpen.body', 'stage.open.title', 'stage.open.body', 'stage.waiting.title', 'stage.waiting.body',
  'stage.in_progress.title', 'stage.in_progress.body', 'resolution.title', 'resolution.body', 'hours.closedTitle', 'hours.closedBody', 'hours.closedNoDate', 'closed.title', 'closed.body'];
const SAMPLE = { id: 42, days: 7, when: 'lundi 9:00', max: 3, tag: 'Paul' };
const varsOf = s => [...new Set(String(s).match(/\{(\w+)\}/g) || [])].map(v => v.slice(1, -1));
async function listTemplates(db) {
  const { DICTIONARIES, LANGS } = require('./i18n');
  const rows = await db('SELECT tkey, lang, text FROM notification_templates').catch(() => []);
  return TEMPLATE_KEYS.map(key => ({
    key, variables: varsOf(DICTIONARIES.fr[key]),
    texts: Object.fromEntries(LANGS.map(l => [l, { default: DICTIONARIES[l]?.[key] ?? DICTIONARIES.en[key] ?? DICTIONARIES.fr[key], custom: rows.find(r => r.tkey === key && r.lang === l)?.text || null }])),
  }));
}
// texts: [{ key, lang, text }] — text empty = back to the standard text
async function saveTemplates(db, guildId, texts) {
  const { DICTIONARIES, LANGS } = require('./i18n');
  if (!Array.isArray(texts) || texts.length > TEMPLATE_KEYS.length * LANGS.length) return { error: 'Textes invalides' };
  for (const x of texts) {
    if (!TEMPLATE_KEYS.includes(x?.key) || !LANGS.includes(x.lang)) return { error: 'Texte inconnu' };
    const text = typeof x.text === 'string' ? x.text.trim().slice(0, 1500) : '';
    // Only the variables of the standard text: anything else would show as is
    const unknown = varsOf(text).filter(v => !varsOf(DICTIONARIES.fr[x.key]).includes(v));
    if (unknown.length) return { error: `Variable inconnue pour ce texte : {${unknown[0]}}` };
    if (!text) await db('DELETE FROM notification_templates WHERE tkey = ? AND lang = ?', [x.key, x.lang]);
    else await db('INSERT INTO notification_templates (tkey, lang, text) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE text = VALUES(text)', [x.key, x.lang, text]);
  }
  require('./i18n').clearTemplateCache(guildId);
  return { ok: true };
}
const preview = text => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (SAMPLE[k] !== undefined ? String(SAMPLE[k]) : m));

module.exports = { setClient, client, TEAM_CHANNELS, EVENTS, RECIPIENTS, CHANNELS, TEMPLATE_KEYS, listRules, cleanRules, saveRules, prefsOf, savePrefs, reachingRules, notify, emit, listTemplates, saveTemplates, preview };

// Member web space: a member signed in with Discord sees their own tickets (as owner or
// participant) on every active server that keeps the option on (guild_config.member_portal_enabled,
// on by default), with the conversation they had with the staff. Never shown: internal notes,
// staff messages typed in the Discord ticket channel, the identity behind anonymous replies.
const { getActiveGuilds } = require('./guildScan');
const { getTenantDb } = require('./tenantDb');
const { escapeHtml } = require('./transcript');

const MEMBER_SOURCES = ['user', 'reply', 'scheduled', 'system'];
const SNOWFLAKE_RE = /^\d{17,20}$/;

// Server colours in the member space (logo, accent colour, welcome text)
async function guildBranding(db) {
  const [cfg] = await db('SELECT portal_logo, portal_color, portal_welcome FROM guild_config WHERE id = 1').catch(() => []);
  return { logo: cfg?.portal_logo || null, color: cfg?.portal_color || null, welcome: cfg?.portal_welcome || null };
}

async function portalEnabled(db) {
  const [cfg] = await db('SELECT member_portal_enabled FROM guild_config WHERE id = 1');
  return !cfg || cfg.member_portal_enabled === null || Number(cfg.member_portal_enabled) === 1;
}

const ownTicketsSql = `(t.owner_id = ? OR t.id IN (SELECT ticket_id FROM ticket_participants WHERE user_id = ?))`;

// [{ guild: { id, name, icon }, tickets: [...] }], most recent activity first
async function listMemberTickets(userId, client) {
  const out = [];
  for (const { guild_id, guild_name } of await getActiveGuilds()) {
    try {
      const db = getTenantDb(guild_id);
      if (!(await portalEnabled(db))) continue;
      const tickets = await db(
        `SELECT t.id, t.subject, t.status, t.stage, t.created_at, t.closed_at, t.last_message_at, t.merged_into, t.owner_id,
                EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id) AS assigned,
                (SELECT rating FROM ticket_ratings r WHERE r.ticket_id = t.id LIMIT 1) AS rating
         FROM tickets t WHERE ${ownTicketsSql}
         ORDER BY COALESCE(t.last_message_at, t.created_at) DESC LIMIT 200`,
        [userId, userId]
      );
      if (!tickets.length) continue;
      const g = client?.guilds?.cache?.get(guild_id);
      out.push({
        guild: { id: guild_id, name: g?.name || guild_name || guild_id, icon: g?.iconURL?.({ size: 64 }) || null, ...(await guildBranding(db)) },
        tickets: tickets.map(({ owner_id, ...t }) => ({ ...t, assigned: !!Number(t.assigned), participant: owner_id !== userId })),
      });
    } catch { /* tenant DB unavailable */ }
  }
  const last = g => Math.max(...g.tickets.map(t => new Date(t.last_message_at || t.created_at).getTime()));
  return out.sort((a, b) => last(b) - last(a));
}

// Name shown for a message, as the member saw it in their DMs
function authorLabel(note, userId) {
  if (note.source === 'user') return note.author_id === userId ? null : note.author_tag;
  if (note.source === 'system') return null;
  if (note.source === 'scheduled' || /\(anonyme\)$/.test(note.author_tag)) return 'Support';
  return note.author_tag;
}

// { guild, ticket, messages } or null when the member may not see it
async function memberTicket(userId, guildId, ticketId, client) {
  if (!SNOWFLAKE_RE.test(String(guildId)) || !(ticketId > 0)) return null;
  const guilds = await getActiveGuilds();
  const guild = guilds.find(g => g.guild_id === guildId);
  if (!guild) return null;
  const db = getTenantDb(guildId);
  if (!(await portalEnabled(db))) return null;
  const [ticket] = await db(
    `SELECT t.id, t.subject, t.status, t.stage, t.created_at, t.closed_at, t.last_message_at, t.merged_into, t.owner_id,
            t.visibility_grade_id = -1 AS confidential,
            EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id) AS assigned,
            (SELECT rating FROM ticket_ratings r WHERE r.ticket_id = t.id LIMIT 1) AS rating
     FROM tickets t WHERE t.id = ? AND ${ownTicketsSql}`,
    [ticketId, userId, userId]
  );
  if (!ticket) return null;
  const notes = await db(
    'SELECT id, author_id, author_tag, content, source, created_at, edited_at, deleted_at FROM ticket_notes WHERE ticket_id = ? AND source IN (?) ORDER BY created_at ASC, id ASC',
    [ticketId, MEMBER_SOURCES]
  );
  const g = client?.guilds?.cache?.get(guildId);
  const { owner_id, ...t } = ticket;
  return {
    guild: { id: guildId, name: g?.name || guild.guild_name || guildId, icon: g?.iconURL?.({ size: 64 }) || null, ...(await guildBranding(db)) },
    ticket: { ...t, assigned: !!Number(t.assigned), confidential: !!Number(t.confidential), participant: owner_id !== userId },
    messages: notes.map(n => ({
      id: n.id,
      kind: n.source === 'user' ? (n.author_id === userId ? 'me' : 'member') : n.source === 'system' ? 'event' : 'staff',
      author: authorLabel(n, userId),
      content: n.deleted_at ? '' : n.content,
      deleted: !!n.deleted_at,
      edited: !!n.edited_at,
      created_at: n.created_at,
    })),
  };
}

const fmt = d => new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

// Standalone HTML transcript of the member's conversation
function memberTranscriptHtml({ guild, ticket, messages }, username) {
  const rows = messages.filter(m => !m.deleted).map(m => m.kind === 'event'
    ? `<p class="ev">${escapeHtml(m.content)} · ${fmt(m.created_at)}</p>`
    : `<div class="m ${m.kind === 'staff' ? 's' : 'u'}"><b>${escapeHtml(m.kind === 'me' ? username : m.author || 'Membre')}</b> <span>${fmt(m.created_at)}</span><p>${escapeHtml(m.content)}</p></div>`).join('\n');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ticket #${ticket.id} — ${escapeHtml(guild.name)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#1f2330;background:#fff}
h1{font-size:20px;margin:0}.meta{color:#5b6075;font-size:13px;margin:4px 0 24px}.m{margin:12px 0;padding:10px 14px;border-radius:12px;background:#f2f3f7}
.m.s{background:#ecebff}.m b{font-size:13px}.m span{color:#6b7085;font-size:12px}.m p{margin:6px 0 0;white-space:pre-wrap;word-break:break-word}
.ev{text-align:center;color:#6b7085;font-size:12px;margin:14px 0}</style></head><body>
<h1>Ticket #${ticket.id}${ticket.subject ? ` — ${escapeHtml(ticket.subject)}` : ''}</h1>
<p class="meta">${escapeHtml(guild.name)} · ouvert le ${fmt(ticket.created_at)}${ticket.closed_at ? ` · fermé le ${fmt(ticket.closed_at)}` : ''}</p>
${rows || '<p class="ev">Aucun message</p>'}
</body></html>`;
}

// Link to a ticket in the member space, or null when the server turned the space off (cached 1 min)
const portalCache = new Map();
async function ticketWebUrl(guildId, ticketId) {
  const base = portalUrl();
  if (!base) return null;
  let entry = portalCache.get(guildId);
  if (!entry || Date.now() - entry.at > 60000) {
    entry = { at: Date.now(), on: await portalEnabled(getTenantDb(guildId)) };
    portalCache.set(guildId, entry);
  }
  return entry.on ? `${base}/${guildId}/${ticketId}` : null;
}

// Public address of the member space (from the dashboard's public OAuth callback URL)
function portalUrl() {
  const { config } = require('./config');
  try { return new URL('/espace', config.dashboard?.discordCallbackUrl || config.webServerBaseUrl).toString(); } catch { return null; }
}

// Servers where the member is on Discord and the member space is on (cached 5 min)
async function memberGuilds(userId, client) {
  const redis = require('./redis').getRedis();
  const key = `memberguilds:${userId}`;
  const cached = await redis.get(key).catch(() => null);
  if (cached) return JSON.parse(cached);
  const out = [];
  for (const { guild_id, guild_name } of await getActiveGuilds()) {
    try {
      const g = client?.guilds?.cache?.get(guild_id);
      if (!g || !(await g.members.fetch(userId).catch(() => null))) continue;
      if (!(await portalEnabled(getTenantDb(guild_id)))) continue;
      out.push({ id: guild_id, name: g.name || guild_name || guild_id, icon: g.iconURL?.({ size: 64 }) || null, ...(await guildBranding(getTenantDb(guild_id))) });
    } catch { /* tenant DB unavailable */ }
  }
  await redis.set(key, JSON.stringify(out), 'EX', 300).catch(() => null);
  return out;
}

async function isMemberGuild(userId, guildId, client) {
  return (await memberGuilds(userId, client)).find(g => g.id === guildId) || null;
}

// Public help: active FAQ entries of a server
async function guildFaq(guildId) {
  return getTenantDb(guildId)('SELECT id, question, answer FROM faq_entries WHERE active = 1 ORDER BY solved_count DESC, id ASC LIMIT 200');
}

// What the web form asks before opening a ticket: subjects, then (for a subject) custom fields
// and the opening form questions
async function openingForm(guildId, subject) {
  const db = getTenantDb(guildId);
  const [cfg] = await db('SELECT ticket_subjects, intake_form_enabled FROM guild_config WHERE id = 1');
  const subjects = require('./jsonField').parseJsonField(cfg?.ticket_subjects, []);
  if (subject === undefined) return { subjects };
  const fields = await require('./ticketFields').applicableFields(db, subject);
  let questions = [];
  if (cfg?.intake_form_enabled) {
    const [form] = await db('SELECT id FROM intake_forms WHERE active = 1 AND (subject = ? OR subject IS NULL) ORDER BY subject IS NULL ASC LIMIT 1', [subject || null]).catch(() => []);
    if (form) questions = (await db('SELECT label FROM intake_form_fields WHERE form_id = ? ORDER BY position ASC', [form.id])).map(q => q.label);
  }
  return { subjects, fields: fields.map(f => ({ id: f.id, label: f.label, type: f.type, required: !!f.required })), questions };
}

module.exports = { ticketWebUrl, listMemberTickets, memberTicket, memberTranscriptHtml, portalUrl, memberGuilds, isMemberGuild, guildFaq, openingForm };

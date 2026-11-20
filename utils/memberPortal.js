// Member web space: a member signed in with Discord, or with a link sent by e-mail (v4, identity
// « web:<hash> »), sees their own tickets (as owner or participant) on every active space that
// keeps the option on (guild_config.member_portal_enabled, on by default), with the conversation
// they had with the staff. Never shown: internal notes, staff messages typed in the Discord ticket
// channel, the identity behind anonymous replies.
// A member signed in by e-mail also sees the tickets they opened by e-mail to the same address
// (« mail:<hash> »): the link proved they read that mailbox.
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

// The requester sees the built-in stage a custom status behaves like, never its internal name
const STAGE_KIND = "COALESCE((SELECT ts.kind FROM ticket_stages ts WHERE CONCAT('s_', ts.id) = t.stage), t.stage)";

const ownTicketsSql = `(t.owner_id IN (?) OR t.id IN (SELECT ticket_id FROM ticket_participants WHERE user_id IN (?)))`;

// Organisation portal (v5.3, utils/organizations.js): the organisations whose tickets this member
// may read — set per organisation: nobody, its managers (contacts marked as such), or all its
// members; a parent organisation includes its sub-organisations. Read only. Never a confidential
// ticket, nor one the staff restricted to a grade.
async function orgScope(db, ids) {
  const rows = await db(`SELECT o.id, o.portal_visibility, c.org_portal_manager FROM contact_identities ci JOIN contacts c ON c.id = ci.contact_id
    JOIN organizations o ON o.id = c.organization_id WHERE ci.value IN (?)`, [ids]).catch(() => []);
  const out = new Set();
  for (const r of rows) {
    if (!(r.portal_visibility === 'all' || (r.portal_visibility === 'manager' && Number(r.org_portal_manager) === 1))) continue;
    out.add(Number(r.id));
    for (const c of await db('SELECT id FROM organizations WHERE parent_id = ?', [r.id]).catch(() => [])) out.add(Number(c.id));
  }
  return [...out];
}
const ORG_TICKET_SQL = 't.organization_id IN (?) AND t.visibility_grade_id IS NULL';

// Identities of a signed-in member: { id, email? } → the owner IDs their tickets may carry
function memberIds(member) {
  if (!member?.email) return [String(member.id)];
  return [String(member.id), require('./emailTickets').ownerIdFor(member.email)];
}

// Spaces where anyone may sign in by e-mail and open a ticket (Settings → member space)
async function emailOpen(db) {
  const [cfg] = await db('SELECT portal_email_open FROM guild_config WHERE id = 1').catch(() => []);
  return Number(cfg?.portal_email_open) === 1;
}

// [{ guild: { id, name, icon }, tickets: [...] }], most recent activity first
async function listMemberTickets(member, client) {
  const ids = memberIds(member);
  const out = [];
  for (const { guild_id, guild_name } of await getActiveGuilds()) {
    try {
      const db = getTenantDb(guild_id);
      if (!(await portalEnabled(db))) continue;
      const tickets = await db(
        `SELECT t.id, t.subject, t.status, ${STAGE_KIND} AS stage, t.created_at, t.closed_at, t.last_message_at, t.merged_into, t.owner_id, t.resolved_at,
                EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id) AS assigned,
                (SELECT rating FROM ticket_ratings r WHERE r.ticket_id = t.id LIMIT 1) AS rating
         FROM tickets t WHERE ${ownTicketsSql}
         ORDER BY COALESCE(t.last_message_at, t.created_at) DESC LIMIT 200`,
        [ids, ids]
      );
      const scope = await orgScope(db, ids);
      const orgTickets = scope.length ? await db(
        `SELECT t.id, t.subject, t.status, ${STAGE_KIND} AS stage, t.created_at, t.closed_at, t.last_message_at, t.resolved_at, t.owner_tag,
                EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id) AS assigned
         FROM tickets t WHERE ${ORG_TICKET_SQL} AND NOT ${ownTicketsSql}
         ORDER BY COALESCE(t.last_message_at, t.created_at) DESC LIMIT 200`, [scope, ids, ids]) : [];
      if (!tickets.length && !orgTickets.length) continue;
      const g = client?.guilds?.cache?.get(guild_id);
      out.push({
        guild: { id: guild_id, name: g?.name || guild_name || guild_id, icon: g?.iconURL?.({ size: 64 }) || null, ...(await guildBranding(db)) },
        tickets: tickets.map(({ owner_id, ...t }) => ({ ...t, assigned: !!Number(t.assigned), participant: !ids.includes(owner_id) })),
        orgTickets: orgTickets.map(({ owner_tag, ...t }) => ({ ...t, assigned: !!Number(t.assigned), requester: owner_tag })),
      });
    } catch { /* tenant DB unavailable */ }
  }
  const last = g => Math.max(...[...g.tickets, ...(g.orgTickets || [])].map(t => new Date(t.last_message_at || t.created_at).getTime()));
  return out.sort((a, b) => last(b) - last(a));
}

// Name shown for a message, as the member saw it in their DMs
function authorLabel(note, ids) {
  if (note.source === 'user') return ids.includes(note.author_id) ? null : note.author_tag;
  if (note.source === 'system') return null;
  if (note.source === 'scheduled' || /\(anonyme\)$/.test(note.author_tag)) return 'Support';
  return note.author_tag;
}

// { guild, ticket, messages, access } or null when the member may not see it. allowOrg: a ticket of
// their organisation (read only: never for replying, confirming or downloading)
async function memberTicket(member, guildId, ticketId, client, { allowOrg = false } = {}) {
  const ids = memberIds(member);
  if (!SNOWFLAKE_RE.test(String(guildId)) || !(ticketId > 0)) return null;
  const guilds = await getActiveGuilds();
  const guild = guilds.find(g => g.guild_id === guildId);
  if (!guild) return null;
  const db = getTenantDb(guildId);
  if (!(await portalEnabled(db))) return null;
  let [ticket] = await db(
    `SELECT t.id, t.subject, t.status, ${STAGE_KIND} AS stage, t.created_at, t.closed_at, t.last_message_at, t.merged_into, t.owner_id,
            t.visibility_grade_id = -1 AS confidential, t.resolved_at, t.resolution,
            EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id) AS assigned,
            (SELECT rating FROM ticket_ratings r WHERE r.ticket_id = t.id LIMIT 1) AS rating
     FROM tickets t WHERE t.id = ? AND ${ownTicketsSql}`,
    [ticketId, ids, ids]
  );
  let access = 'own';
  if (!ticket && allowOrg) {
    const scope = await orgScope(db, ids);
    if (scope.length) {
      const [o] = await db(
        `SELECT t.id, t.subject, t.status, ${STAGE_KIND} AS stage, t.created_at, t.closed_at, t.last_message_at, t.merged_into, t.owner_id, t.owner_tag,
                0 AS confidential, t.resolved_at, t.resolution, EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id) AS assigned, NULL AS rating
         FROM tickets t WHERE t.id = ? AND ${ORG_TICKET_SQL}`, [ticketId, scope]);
      if (o) { ticket = o; access = 'org'; }
    }
  }
  if (!ticket) return null;
  const notes = await db(
    'SELECT id, author_id, author_tag, content, source, created_at, edited_at, deleted_at FROM ticket_notes WHERE ticket_id = ? AND source IN (?) ORDER BY created_at ASC, id ASC',
    [ticketId, MEMBER_SOURCES]
  );
  const g = client?.guilds?.cache?.get(guildId);
  const { owner_id, owner_tag, ...t } = ticket;
  return {
    access,
    guild: { id: guildId, name: g?.name || guild.guild_name || guildId, icon: g?.iconURL?.({ size: 64 }) || null, ...(await guildBranding(db)) },
    ticket: { ...t, assigned: !!Number(t.assigned), confidential: !!Number(t.confidential), participant: access === 'own' && !ids.includes(owner_id), ...(access === 'org' ? { requester: owner_tag } : {}) },
    messages: notes.map(n => ({
      id: n.id,
      kind: n.source === 'user' ? (ids.includes(n.author_id) ? 'me' : 'member') : n.source === 'system' ? 'event' : 'staff',
      author: authorLabel(n, ids),
      content: n.deleted_at ? '' : n.content,
      deleted: !!n.deleted_at,
      edited: !!n.edited_at,
      created_at: n.created_at,
    })),
  };
}

const LOCALES = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-BR' };

// Standalone HTML transcript of the member's conversation, in the language of the member space
function memberTranscriptHtml({ guild, ticket, messages }, username, lang = 'fr') {
  const { t, withLang } = require('./i18n');
  return withLang(lang, () => {
    const fmt = d => new Date(d).toLocaleString(LOCALES[lang] || 'fr-FR', { timeZone: 'Europe/Paris' });
    const rows = messages.filter(m => !m.deleted).map(m => m.kind === 'event'
      ? `<p class="ev">${escapeHtml(m.content)} · ${fmt(m.created_at)}</p>`
      : `<div class="m ${m.kind === 'staff' ? 's' : 'u'}"><b>${escapeHtml(m.kind === 'me' ? username : m.author || t('portal.member'))}</b> <span>${fmt(m.created_at)}</span><p>${escapeHtml(m.content)}</p></div>`).join('\n');
    return `<!DOCTYPE html><html lang="${LOCALES[lang] ? lang : 'fr'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ticket #${ticket.id} — ${escapeHtml(guild.name)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#1f2330;background:#fff}
h1{font-size:20px;margin:0}.meta{color:#5b6075;font-size:13px;margin:4px 0 24px}.m{margin:12px 0;padding:10px 14px;border-radius:12px;background:#f2f3f7}
.m.s{background:#ecebff}.m b{font-size:13px}.m span{color:#6b7085;font-size:12px}.m p{margin:6px 0 0;white-space:pre-wrap;word-break:break-word}
.ev{text-align:center;color:#6b7085;font-size:12px;margin:14px 0}</style></head><body>
<h1>Ticket #${ticket.id}${ticket.subject ? ` — ${escapeHtml(ticket.subject)}` : ''}</h1>
<p class="meta">${escapeHtml(guild.name)} · ${escapeHtml(t('portal.openedOn', { date: fmt(ticket.created_at) }))}${ticket.closed_at ? ` · ${escapeHtml(t('portal.closedOn', { date: fmt(ticket.closed_at) }))}` : ''}</p>
${rows || `<p class="ev">${escapeHtml(t('portal.noMessages'))}</p>`}
</body></html>`;
  });
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

// Spaces where the member may open a ticket, with the member space on (cached 5 min): for a
// Discord member, the servers they are on; signed in by e-mail, the spaces open to everyone
async function memberGuilds(member, client) {
  const redis = require('./redis').getRedis();
  const key = `memberguilds:${member.id}`;
  const cached = await redis.get(key).catch(() => null);
  if (cached) return JSON.parse(cached);
  const out = [];
  for (const { guild_id, guild_name } of await getActiveGuilds()) {
    try {
      const g = client?.guilds?.cache?.get(guild_id);
      const db = getTenantDb(guild_id);
      if (member.email) { if (!(await emailOpen(db))) continue; }
      else if (!g || !(await g.members.fetch(member.id).catch(() => null))) continue;
      if (!(await portalEnabled(db))) continue;
      out.push({ id: guild_id, name: g?.name || guild_name || guild_id, icon: g?.iconURL?.({ size: 64 }) || null, ...(await guildBranding(db)), kb: await require('./knowledgeBase').kbEnabled(db) });
    } catch { /* tenant DB unavailable */ }
  }
  await redis.set(key, JSON.stringify(out), 'EX', 300).catch(() => null);
  return out;
}

async function isMemberGuild(member, guildId, client) {
  return (await memberGuilds(member, client)).find(g => g.id === guildId) || null;
}

// Help of a server for its members: every published entry, public, kept for members, or for
// their organisation (v5.6); never the staff's or a team's articles
async function guildFaq(guildId, member = null) {
  const db = getTenantDb(guildId);
  const { LIVE } = require('./knowledgeBase');
  let orgs = [];
  if (member) {
    const rows = await db('SELECT c.organization_id, o.parent_id FROM contact_identities ci JOIN contacts c ON c.id = ci.contact_id LEFT JOIN organizations o ON o.id = c.organization_id WHERE ci.value IN (?) AND c.organization_id IS NOT NULL', [memberIds(member)]).catch(() => []);
    orgs = [...new Set(rows.flatMap(r => [r.organization_id, r.parent_id]).filter(Boolean))];
  }
  return db(`SELECT id, question, answer, category, visibility FROM faq_entries WHERE ${LIVE} AND translation_of IS NULL
    AND (visibility IN ('public', 'members')${orgs.length ? " OR (visibility = 'organization' AND organization_id IN (?))" : ''})
    ORDER BY category = '', category, solved_count DESC, id ASC LIMIT 200`, orgs.length ? [orgs] : []);
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
    const line = require('./subjectTree').lineage(subject);
    const [form] = await db('SELECT id FROM intake_forms WHERE active = 1 AND (subject IN (?) OR subject IS NULL) ORDER BY subject IS NULL ASC, subject = ? DESC LIMIT 1', [line.length ? line : [''], subject || '']).catch(() => []);
    if (form) questions = (await db('SELECT label FROM intake_form_fields WHERE form_id = ? ORDER BY position ASC', [form.id])).map(q => q.label);
  }
  return { subjects, fields: fields.map(f => ({ id: f.id, label: f.label, type: f.type, required: !!f.required })), questions };
}

module.exports = { orgScope, memberIds, emailOpen, ticketWebUrl, listMemberTickets, memberTicket, memberTranscriptHtml, portalUrl, memberGuilds, isMemberGuild, guildFaq, openingForm };

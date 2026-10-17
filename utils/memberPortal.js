// Member web space: a member signed in with Discord sees their own tickets (as owner or
// participant) on every active server that keeps the option on (guild_config.member_portal_enabled,
// on by default), with the conversation they had with the staff. Never shown: internal notes,
// staff messages typed in the Discord ticket channel, the identity behind anonymous replies.
const { getActiveGuilds } = require('./guildScan');
const { getTenantDb } = require('./tenantDb');
const { escapeHtml } = require('./transcript');

const MEMBER_SOURCES = ['user', 'reply', 'scheduled', 'system'];
const SNOWFLAKE_RE = /^\d{17,20}$/;

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
        guild: { id: guild_id, name: g?.name || guild_name || guild_id, icon: g?.iconURL?.({ size: 64 }) || null },
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
            EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id) AS assigned,
            (SELECT rating FROM ticket_ratings r WHERE r.ticket_id = t.id LIMIT 1) AS rating
     FROM tickets t WHERE t.id = ? AND ${ownTicketsSql}`,
    [ticketId, userId, userId]
  );
  if (!ticket) return null;
  const notes = await db(
    'SELECT id, author_id, author_tag, content, source, created_at FROM ticket_notes WHERE ticket_id = ? AND source IN (?) ORDER BY created_at ASC, id ASC',
    [ticketId, MEMBER_SOURCES]
  );
  const g = client?.guilds?.cache?.get(guildId);
  const { owner_id, ...t } = ticket;
  return {
    guild: { id: guildId, name: g?.name || guild.guild_name || guildId, icon: g?.iconURL?.({ size: 64 }) || null },
    ticket: { ...t, assigned: !!Number(t.assigned), participant: owner_id !== userId },
    messages: notes.map(n => ({
      id: n.id,
      kind: n.source === 'user' ? (n.author_id === userId ? 'me' : 'member') : n.source === 'system' ? 'event' : 'staff',
      author: authorLabel(n, userId),
      content: n.content,
      created_at: n.created_at,
    })),
  };
}

const fmt = d => new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

// Standalone HTML transcript of the member's conversation
function memberTranscriptHtml({ guild, ticket, messages }, username) {
  const rows = messages.map(m => m.kind === 'event'
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

// Public address of the member space (from the dashboard's public OAuth callback URL)
function portalUrl() {
  const { config } = require('./config');
  try { return new URL('/espace', config.dashboard?.discordCallbackUrl || config.webServerBaseUrl).toString(); } catch { return null; }
}

module.exports = { listMemberTickets, memberTicket, memberTranscriptHtml, portalEnabled, portalUrl, MEMBER_SOURCES };

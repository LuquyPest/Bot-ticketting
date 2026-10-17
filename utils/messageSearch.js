// Full-text search over ticket conversations (member messages, staff replies, internal notes)
// and subjects / member names. Words of 3+ characters use the FULLTEXT index on ticket_notes.content (prefix
// match); a query made only of shorter words falls back to LIKE.
const { norm } = require('./subjectMatch');

const SOURCES = {
  member: ['user'],
  staff: ['reply', 'scheduled', 'discord'],
  notes: ['web'],
};

// Words of the query, without the boolean-mode operators
function terms(q) {
  return [...new Set(String(q).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))].slice(0, 8);
}

const likeEscape = s => s.replace(/[%_\\]/g, '\\$&');

// SQL condition on ticket_notes (alias n) matching the query
function matchSql(q) {
  const words = terms(q);
  if (words.length && words.every(w => w.length >= 3)) {
    return { sql: 'MATCH(n.content) AGAINST (? IN BOOLEAN MODE)', params: [words.map(w => `+${w}*`).join(' ')] };
  }
  return { sql: 'n.content LIKE ?', params: [`%${likeEscape(String(q).trim())}%`] };
}

// ~160 characters around the first matched word
function snippet(content, words) {
  const text = String(content).replace(/\s+/g, ' ').trim();
  const lower = norm(text);
  let at = -1;
  for (const w of words) { const i = lower.indexOf(norm(w)); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0 || text.length <= 160) return text.slice(0, 160) + (text.length > 160 ? '…' : '');
  const start = Math.max(0, at - 60);
  return (start > 0 ? '…' : '') + text.slice(start, start + 160) + (start + 160 < text.length ? '…' : '');
}

// { results: [{ ticket, hits, match: { id, author_tag, source, created_at, snippet } | null }], total, page, pages, terms }
async function searchMessages(db, { q, source = '', status = '', vis, page = 1, limit = 20 }) {
  const words = terms(q);
  const m = matchSql(q);
  const srcList = SOURCES[source];
  const noteWhere = [m.sql, ...(srcList ? ['n.source IN (?)'] : [])].join(' AND ');
  const noteParams = [...m.params, ...(srcList ? [srcList] : [])];
  // A subject or member-name match counts only when every source is searched
  const like = `%${likeEscape(String(q).trim())}%`;
  const subjectSql = srcList ? '0' : '(t.subject LIKE ? OR t.owner_tag LIKE ?)';
  const subjectParams = srcList ? [] : [like, like];
  const where = [`(h.ticket_id IS NOT NULL OR ${subjectSql})`, vis.sql, ...(status ? ['t.status = ?'] : [])];
  const whereParams = [...subjectParams, ...vis.params, ...(status ? [status] : [])];
  const from = `FROM tickets t
    LEFT JOIN (SELECT n.ticket_id, COUNT(*) AS hits, MAX(n.created_at) AS last_at FROM ticket_notes n
               WHERE ${noteWhere} GROUP BY n.ticket_id) h ON h.ticket_id = t.id
    WHERE ${where.join(' AND ')}`;

  const offset = (page - 1) * limit;
  const [rows, [{ total }]] = await Promise.all([
    db(`SELECT t.id, t.owner_tag, t.subject, t.status, t.stage, t.priority, t.created_at, t.closed_at,
               COALESCE(h.hits, 0) AS hits, h.last_at
        ${from} ORDER BY COALESCE(h.last_at, t.created_at) DESC LIMIT ? OFFSET ?`,
      [...noteParams, ...whereParams, limit, offset]),
    db(`SELECT COUNT(*) AS total ${from}`, [...noteParams, ...whereParams]),
  ]);

  // Latest matching message of each ticket on this page
  const byTicket = new Map();
  const ids = rows.filter(r => r.hits > 0).map(r => r.id);
  if (ids.length) {
    const notes = await db(
      `SELECT n.id, n.ticket_id, n.author_tag, n.source, n.content, n.created_at FROM ticket_notes n
       WHERE n.ticket_id IN (?) AND ${noteWhere} ORDER BY n.created_at DESC LIMIT 500`,
      [ids, ...noteParams]
    );
    for (const n of notes) if (!byTicket.has(n.ticket_id)) byTicket.set(n.ticket_id, n);
  }

  const results = rows.map(({ hits, last_at, ...ticket }) => {
    const n = byTicket.get(ticket.id);
    return {
      ticket, hits: Number(hits),
      match: n ? { id: n.id, author_tag: n.author_tag, source: n.source, created_at: n.created_at, snippet: snippet(n.content, words) } : null,
    };
  });
  return { results, total: Number(total), page, pages: Math.ceil(total / limit), terms: words };
}

module.exports = { searchMessages, terms, snippet, SOURCES };

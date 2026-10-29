// Member profiles for the staff: what the server knows about a member across tickets (stats,
// labels such as « VIP », latest custom field values) and a discussion thread between staff
// members about them (posts, one level of replies, pinned posts shown in every ticket view).
const { parseJsonField } = require('./jsonField');

const MAX_LABELS = 10;

function cleanLabels(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_LABELS) return null;
  const labels = [...new Set(raw.map(l => String(l || '').trim().slice(0, 30)).filter(Boolean))];
  return labels;
}

async function labelsOf(db, memberId) {
  const [row] = await db('SELECT labels FROM member_profiles WHERE member_id = ?', [memberId]);
  return parseJsonField(row?.labels, []) || [];
}

// Directory: members who opened tickets or have notes, most recent activity first
async function directory(db, { q = '', page = 1, limit = 30, vis }) {
  const like = `%${String(q).replace(/[%_\\]/g, '\\$&')}%`;
  const search = q ? 'AND (t.owner_tag LIKE ? OR t.owner_id = ?)' : '';
  const params = q ? [like, q] : [];
  const rows = await db(
    `SELECT t.owner_id AS member_id, MAX(t.owner_tag) AS tag, COUNT(*) AS tickets, SUM(t.status = 'open') AS open,
            MAX(COALESCE(t.last_message_at, t.created_at)) AS last_at,
            (SELECT COUNT(*) FROM member_notes n WHERE n.member_id = t.owner_id) AS notes,
            (SELECT labels FROM member_profiles p WHERE p.member_id = t.owner_id) AS labels
     FROM tickets t WHERE ${vis.sql} ${search}
     GROUP BY t.owner_id ORDER BY last_at DESC LIMIT ? OFFSET ?`,
    [...vis.params, ...params, limit, (page - 1) * limit]
  );
  const [{ total }] = await db(`SELECT COUNT(DISTINCT t.owner_id) AS total FROM tickets t WHERE ${vis.sql} ${search}`, [...vis.params, ...params]);
  return {
    members: rows.map(r => ({ ...r, tickets: Number(r.tickets), open: Number(r.open), notes: Number(r.notes), labels: parseJsonField(r.labels, []) || [] })),
    total: Number(total), page, pages: Math.ceil(Number(total) / limit),
  };
}

async function profile(db, memberId, vis) {
  // Every figure comes from the tickets this staff member may see (restricted and confidential
  // tickets stay out, custom field values included)
  const [tickets, [rating], [bl], [time], fieldRows, labels, [{ n: notes }]] = await Promise.all([
    db(`SELECT id, subject, status, stage, priority, created_at, closed_at, owner_tag FROM tickets t WHERE t.owner_id = ? AND ${vis.sql} ORDER BY id DESC LIMIT 100`, [memberId, ...vis.params]),
    db(`SELECT AVG(r.rating) AS avg, COUNT(*) AS n FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id WHERE r.owner_id = ? AND ${vis.sql}`, [memberId, ...vis.params]),
    db('SELECT reason, expires_at, added_at FROM blacklist WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW())', [memberId]),
    db(`SELECT COALESCE(SUM(COALESCE(tt.seconds, LEAST(TIMESTAMPDIFF(SECOND, tt.started_at, NOW()), 28800))), 0) AS s
        FROM ticket_time tt JOIN tickets t ON t.id = tt.ticket_id WHERE t.owner_id = ? AND ${vis.sql}`, [memberId, ...vis.params]).catch(() => [{ s: 0 }]),
    // Latest value of each custom field across the member's tickets (order number, in-game name…)
    db(`SELECT f.label, v.value FROM ticket_field_values v JOIN ticket_fields f ON f.id = v.field_id JOIN tickets t ON t.id = v.ticket_id
        WHERE t.owner_id = ? AND ${vis.sql} ORDER BY t.id DESC`, [memberId, ...vis.params]),
    labelsOf(db, memberId),
    db('SELECT COUNT(*) AS n FROM member_notes WHERE member_id = ?', [memberId]),
  ]);
  const fields = [];
  for (const f of fieldRows) if (!fields.some(x => x.label === f.label)) fields.push(f);
  return {
    member_id: memberId, tag: tickets[0]?.owner_tag || null, labels, fields,
    stats: {
      tickets: tickets.length, open: tickets.filter(t => t.status === 'open').length,
      first: tickets.at(-1)?.created_at || null, last: tickets[0]?.created_at || null,
      ratingAvg: rating?.avg != null ? Math.round(Number(rating.avg) * 10) / 10 : null, ratings: Number(rating?.n || 0),
      timeSeconds: Number(time?.s || 0), notes: Number(notes),
    },
    blacklist: bl || null,
    tickets: tickets.map(({ owner_tag, ...t }) => t),
  };
}

// Thread: top-level posts (pinned first, then newest) with their replies (oldest first)
async function posts(db, memberId) {
  const rows = await db('SELECT * FROM member_notes WHERE member_id = ? ORDER BY created_at ASC, id ASC', [memberId]);
  const top = rows.filter(r => !r.parent_id).map(r => ({ ...r, pinned: !!r.pinned, replies: rows.filter(x => x.parent_id === r.id) }));
  return top.sort((a, b) => (b.pinned - a.pinned) || (new Date(b.created_at) - new Date(a.created_at)));
}

// For the ticket view: labels, pinned posts and the latest ones
async function summary(db, memberId) {
  const [labels, all] = await Promise.all([labelsOf(db, memberId), posts(db, memberId)]);
  return { labels, pinned: all.filter(p => p.pinned).slice(0, 5), latest: all.filter(p => !p.pinned).slice(0, 2), count: all.length };
}

module.exports = { cleanLabels, directory, profile, posts, summary, MAX_LABELS };

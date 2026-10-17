// "This problem looks like #123, solved": closed tickets whose member messages and subject are
// closest to the current ticket (FULLTEXT relevance on ticket_notes), with the last staff reply
// of each, i.e. the answer that closed it.
const STOPWORDS = new Set(`alors aussi autre avant avec avoir bonjour bonsoir cela cette ceci chez comme comment dans depuis donc elle elles encore entre est été être faire fait faut hello leur leurs mais merci même mes moi mon nous notre pour pourquoi quand quel quelle quelque sans sont suis tout toute tous très vous votre vos voici voila voilà veux peux peut avez avais était cest jai salut please thanks thank with have this that from your what when where which would could should there their about`.split(/\s+/));

// Distinctive words of a text (4+ letters, no common words), most frequent first
function keywords(text, max = 12) {
  const counts = new Map();
  for (const w of String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 4 || STOPWORDS.has(w) || /^\d+$/.test(w) || /^https?$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}

async function findSimilarTickets(db, ticket, vis, { limit = 3 } = {}) {
  const firstMessages = await db(
    "SELECT content FROM ticket_notes WHERE ticket_id = ? AND source = 'user' ORDER BY created_at ASC LIMIT 5",
    [ticket.id]
  );
  const words = keywords([ticket.subject, ...firstMessages.map(m => m.content.replace(/https?:\/\/\S+/g, ''))].join(' '));
  if (!words.length) return { keywords: [], tickets: [] };
  const q = words.join(' ');
  const rows = await db(
    `SELECT n.ticket_id, SUM(MATCH(n.content) AGAINST (? IN NATURAL LANGUAGE MODE)) AS score
     FROM ticket_notes n JOIN tickets t ON t.id = n.ticket_id
     WHERE n.source = 'user' AND MATCH(n.content) AGAINST (? IN NATURAL LANGUAGE MODE)
       AND t.id <> ? AND t.status = 'closed' AND t.merged_into IS NULL AND ${vis.sql}
     GROUP BY n.ticket_id ORDER BY score DESC LIMIT 10`,
    [q, q, ticket.id, ...vis.params]
  );
  if (!rows.length) return { keywords: words, tickets: [] };
  const ids = rows.map(r => r.ticket_id);
  const [tickets, replies, ratings] = await Promise.all([
    db('SELECT id, subject, owner_tag, closed_at, closed_by_tag FROM tickets WHERE id IN (?)', [ids]),
    db(`SELECT n.ticket_id, n.author_tag, n.content, n.created_at FROM ticket_notes n
        WHERE n.ticket_id IN (?) AND n.source IN ('reply', 'scheduled') ORDER BY n.created_at DESC`, [ids]),
    db('SELECT ticket_id, rating FROM ticket_ratings WHERE ticket_id IN (?)', [ids]),
  ]);
  const byId = new Map(tickets.map(t => [t.id, t]));
  const lastReply = new Map();
  for (const r of replies) if (!lastReply.has(r.ticket_id)) lastReply.set(r.ticket_id, r);
  const rating = new Map(ratings.map(r => [r.ticket_id, r.rating]));
  const sameSubject = s => !!ticket.subject && !!s && s.toLowerCase() === ticket.subject.toLowerCase();

  const scored = rows.map(r => {
    const t = byId.get(r.ticket_id);
    // Bonus: same subject, a well rated outcome, an actual answer to reuse
    const score = Number(r.score) * (sameSubject(t?.subject) ? 1.5 : 1) * (rating.get(r.ticket_id) >= 4 ? 1.2 : 1) * (lastReply.has(r.ticket_id) ? 1 : 0.5);
    return { t, score, r };
  }).filter(x => x.t).sort((a, b) => b.score - a.score).slice(0, limit);

  return {
    keywords: words,
    tickets: scored.map(({ t, score }) => {
      const reply = lastReply.get(t.id);
      return {
        id: t.id, subject: t.subject, owner_tag: t.owner_tag, closed_at: t.closed_at, closed_by_tag: t.closed_by_tag,
        rating: rating.get(t.id) ?? null, score: Math.round(score * 100) / 100,
        reply: reply ? { author_tag: reply.author_tag.replace(/ \(anonyme\)$/, ''), content: reply.content, created_at: reply.created_at } : null,
      };
    }),
  };
}

module.exports = { findSimilarTickets, keywords };

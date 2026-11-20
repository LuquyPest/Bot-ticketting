// Open duplicates (v7, conception/v7.md §3.1): when a ticket opens, the other OPEN tickets of the
// same requester (every identity of their contact card) about the same thing are pointed out —
// to the staff on the ticket view (merge or mark as duplicate in one click, or « not a duplicate »),
// and to the requester on the member space before they open another one.
// « About the same thing »: the same subject, or at least 2 distinctive words in common making up
// 40 % of the shorter list (subject + first messages; utils/similarTickets.js keywords()).
const { keywords } = require('./similarTickets');

const MAX_AGE_DAYS = 60;

// Every identity (owner_id) of the requester: their contact card, or this identity alone
async function ownersOf(db, ownerId) {
  const rows = await db(`SELECT ci2.value FROM contact_identities ci JOIN contact_identities ci2 ON ci2.contact_id = ci.contact_id WHERE ci.value = ?`, [String(ownerId)]).catch(() => []);
  return [...new Set([String(ownerId), ...rows.map(r => String(r.value))])].slice(0, 20);
}

function compare(a, b) {
  const same = !!a.subject && !!b.subject && a.subject.trim().toLowerCase() === b.subject.trim().toLowerCase();
  const ka = new Set(keywords(`${a.subject || ''} ${a.text || ''}`, 15));
  const kb = new Set(keywords(`${b.subject || ''} ${b.text || ''}`, 15));
  const common = [...ka].filter(w => kb.has(w));
  const ratio = common.length / Math.max(1, Math.min(ka.size, kb.size));
  if (same) return { reason: 'subject', common };
  if (common.length >= 2 && ratio >= 0.4) return { reason: 'words', common };
  return null;
}

const textOf = async (db, ids) => {
  const rows = ids.length ? await db("SELECT ticket_id, content FROM ticket_notes WHERE ticket_id IN (?) AND source = 'user' ORDER BY created_at ASC", [ids]).catch(() => []) : [];
  const out = new Map();
  for (const r of rows) {
    const cur = out.get(r.ticket_id) || [];
    if (cur.length < 3) cur.push(String(r.content || '').replace(/https?:\/\/\S+/g, '').slice(0, 2000));
    out.set(r.ticket_id, cur);
  }
  return id => (out.get(id) || []).join(' ');
};

// The open tickets of `owners` (vis: who reads) that look like { subject, text }
async function findOpen(db, owners, probe, vis, { exclude = null, limit = 5 } = {}) {
  const rows = await db(
    `SELECT t.id, t.subject, t.created_at, t.owner_id FROM tickets t
     WHERE t.owner_id IN (?) AND t.status = 'open' AND t.merged_into IS NULL AND t.created_at >= NOW() - INTERVAL ${MAX_AGE_DAYS} DAY
       ${exclude ? 'AND t.id <> ?' : ''} AND ${vis.sql} ORDER BY t.id DESC LIMIT 30`,
    [owners, ...(exclude ? [exclude] : []), ...vis.params]
  ).catch(() => []);
  if (!rows.length) return [];
  const text = await textOf(db, rows.map(r => r.id));
  return rows.map(r => ({ r, m: compare(probe, { subject: r.subject, text: text(r.id) }) }))
    .filter(x => x.m).slice(0, limit)
    .map(({ r, m }) => ({ id: r.id, subject: r.subject, createdAt: r.created_at, sameIdentity: r.owner_id, reason: m.reason, common: m.common.slice(0, 6) }));
}

// Staff: the possible duplicates of a ticket (pairs already linked or dismissed are left out)
async function forTicket(db, ticket, vis) {
  if (ticket.status !== 'open' || ticket.duplicate_dismissed_at) return [];
  const owners = await ownersOf(db, ticket.owner_id);
  const text = await textOf(db, [ticket.id]);
  const found = await findOpen(db, owners, { subject: ticket.subject, text: text(ticket.id) }, vis, { exclude: ticket.id });
  if (!found.length) return [];
  const linked = new Set((await db('SELECT IF(ticket_a = ?, ticket_b, ticket_a) AS other FROM ticket_links WHERE ticket_a = ? OR ticket_b = ?', [ticket.id, ticket.id, ticket.id]).catch(() => [])).map(r => r.other));
  return found.filter(f => !linked.has(f.id)).map(f => ({ ...f, canMerge: f.sameIdentity === String(ticket.owner_id) })).map(({ sameIdentity, ...f }) => f);
}

async function dismiss(db, ticketId) {
  await db('UPDATE tickets SET duplicate_dismissed_at = NOW() WHERE id = ?', [ticketId]);
}

// Member space: their own open tickets like what they are about to send — only the identities they
// are signed in with (a contact card is put together by the staff, it may be wrong)
async function forRequester(db, ownerIds, { subject = '', content = '' } = {}) {
  const found = await findOpen(db, ownerIds.map(String), { subject: String(subject).slice(0, 100), text: String(content).slice(0, 2000) }, { sql: '1 = 1', params: [] }, { limit: 3 });
  return found.map(f => ({ id: f.id, subject: f.subject, createdAt: f.createdAt }));
}

module.exports = { MAX_AGE_DAYS, ownersOf, compare, forTicket, dismiss, forRequester };

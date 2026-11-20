// Links between tickets of a space (v7, conception/v7.md §3.1). One link per pair (ticket_links,
// migration 7), with a kind (migration 83):
//   related   — « lié à », both ways
//   duplicate — from_id is a duplicate of the other one
//   blocks    — from_id blocks the other one
//   parent    — from_id is the parent of the other one (a ticket has one parent at most, no cycle)
// Seen from one ticket, a link is a « relation »: related, duplicate_of, has_duplicate, blocks,
// blocked_by, child (the other is my child), parent (the other is my parent).
const { recordEvent, SYSTEM } = require('./audit');

const KINDS = ['related', 'duplicate', 'blocks', 'parent'];
// relation seen from `me` → [kind, from is me?]
const RELATIONS = {
  related: ['related', true], duplicate_of: ['duplicate', true], has_duplicate: ['duplicate', false],
  blocks: ['blocks', true], blocked_by: ['blocks', false], child: ['parent', true], parent: ['parent', false],
};
const relationOf = (kind, fromId, me) => {
  const mine = Number(fromId) === Number(me);
  switch (kind) {
    case 'duplicate': return mine ? 'duplicate_of' : 'has_duplicate';
    case 'blocks': return mine ? 'blocks' : 'blocked_by';
    case 'parent': return mine ? 'child' : 'parent';
    default: return 'related';
  }
};

// The links of a ticket that the reader sees (vis: visibilityFilter or NOT_CONFIDENTIAL)
async function listLinks(db, ticketId, vis) {
  const rows = await db(
    `SELECT t.id, t.subject, t.status, t.owner_tag, t.resolved_at, l.kind, l.from_id FROM ticket_links l
     JOIN tickets t ON t.id = IF(l.ticket_a = ?, l.ticket_b, l.ticket_a)
     WHERE (l.ticket_a = ? OR l.ticket_b = ?) AND ${vis.sql} ORDER BY t.id DESC`,
    [ticketId, ticketId, ticketId, ...vis.params]
  ).catch(() => []);
  return rows.map(r => ({ id: r.id, subject: r.subject, status: r.status, owner_tag: r.owner_tag, resolved: !!r.resolved_at, relation: relationOf(r.kind || 'related', r.from_id, ticketId) }));
}
// Children of a parent: { total, closed } (every child, the count reveals nothing else)
async function progress(db, ticketId) {
  const [r] = await db(
    `SELECT COUNT(*) AS total, COALESCE(SUM(t.status = 'closed'), 0) AS closed FROM ticket_links l
     JOIN tickets t ON t.id = IF(l.ticket_a = ?, l.ticket_b, l.ticket_a)
     WHERE (l.ticket_a = ? OR l.ticket_b = ?) AND l.kind = 'parent' AND l.from_id = ?`, [ticketId, ticketId, ticketId, ticketId]
  ).catch(() => [{ total: 0, closed: 0 }]);
  return { total: Number(r?.total || 0), closed: Number(r?.closed || 0) };
}

const parentOf = async (db, id) => {
  const [r] = await db("SELECT from_id FROM ticket_links WHERE kind = 'parent' AND (ticket_a = ? OR ticket_b = ?) AND from_id <> ?", [id, id, id]).catch(() => []);
  return r ? Number(r.from_id) : null;
};

// Links `me` to `other` with a relation seen from `me` → { ok } or { error }
async function setLink(db, me, other, relation = 'related', actor = SYSTEM) {
  me = Number(me); other = Number(other);
  if (!Number.isInteger(other) || other <= 0 || other === me) return { error: 'Numéro de ticket invalide' };
  const rel = RELATIONS[relation];
  if (!rel) return { error: `Relation inconnue : ${Object.keys(RELATIONS).join(', ')}` };
  const [kind, fromMe] = rel;
  const from = kind === 'related' ? null : (fromMe ? me : other);
  if (kind === 'parent') {
    const parent = from, child = from === me ? other : me;
    const existing = await parentOf(db, child);
    if (existing && existing !== parent) return { error: `Le ticket #${child} a déjà un parent (#${existing})` };
    // No cycle: the parent must not descend from the child
    let up = parent;
    for (let depth = 0; up && depth < 50; depth++) {
      up = await parentOf(db, up);
      if (up === child) return { error: 'Ce lien ferait une boucle de parents' };
    }
  }
  const [a, b] = [Math.min(me, other), Math.max(me, other)];
  const [before] = await db('SELECT kind, from_id FROM ticket_links WHERE ticket_a = ? AND ticket_b = ?', [a, b]);
  if (before && before.kind === kind && Number(before.from_id || 0) === Number(from || 0)) return { ok: true, changed: false };
  await db(`INSERT INTO ticket_links (ticket_a, ticket_b, created_by_tag, kind, from_id) VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE kind = VALUES(kind), from_id = VALUES(from_id)`,
  [a, b, String(actor.tag || actor.username || 'Système').slice(0, 100), kind, from]);
  for (const id of [me, other]) {
    await recordEvent(db, { actor, action: 'ticket_link', ticketId: id, details: { with: id === me ? other : me, relation: id === me ? relation : relationOf(kind, from, other) } });
  }
  return { ok: true, changed: true };
}

async function removeLink(db, me, other, actor = SYSTEM) {
  const [a, b] = [Math.min(me, other), Math.max(me, other)];
  const r = await db('DELETE FROM ticket_links WHERE ticket_a = ? AND ticket_b = ?', [a, b]);
  if (r.affectedRows) for (const id of [me, other]) await recordEvent(db, { actor, action: 'ticket_unlink', ticketId: id, details: { with: id === me ? other : me } });
  return { ok: true, changed: !!r.affectedRows };
}

// A ticket was closed (audit ticket_close, whatever the path): when the space asks for it, its open
// children are closed too (each of them closes its own children the same way).
async function afterClose(db, ticketId) {
  if (!db.guildId) return 0;
  const [c] = await db('SELECT close_children_with_parent FROM guild_config WHERE id = 1').catch(() => []);
  if (Number(c?.close_children_with_parent) !== 1) return 0;
  const children = await db(
    `SELECT t.* FROM ticket_links l JOIN tickets t ON t.id = IF(l.ticket_a = ?, l.ticket_b, l.ticket_a)
     WHERE (l.ticket_a = ? OR l.ticket_b = ?) AND l.kind = 'parent' AND l.from_id = ? AND t.status = 'open'`, [ticketId, ticketId, ticketId, ticketId]
  ).catch(() => []);
  const by = { ...SYSTEM, tag: `Fermé avec le ticket #${ticketId}`, reason: `Ticket parent #${ticketId} fermé` };
  let n = 0;
  for (const child of children) {
    try {
      await require('./resolution').closeResolved({ db, client: require('./notifications').client(), guildId: db.guildId, ticket: child, by });
      n++;
    } catch (err) { console.error('close child:', err.message); }
  }
  return n;
}

module.exports = { KINDS, RELATIONS, relationOf, listLinks, progress, setLink, removeLink, afterClose, parentOf };

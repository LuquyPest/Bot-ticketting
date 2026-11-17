// Contacts of a space (v4 PR 9, conception/v4.md §3.4): one card per person, gathering their
// identities — the values stored in tickets.owner_id: a Discord ID, « mail:<hash> » for e-mail
// tickets, « web:<hash> » for the web portal. Tickets never move: a card shows the tickets of all
// its identities, through the visibility filter of the staff member who reads it.
// Contacts are created on the fly from the tickets (utils/contactsSync.js). The staff discussion
// and the labels (member_notes, member_profiles) are kept under the contact's primary identity
// (its seed, the identity it was created for): merging moves them to the card that is kept.
const { SYNC_STATEMENTS } = require('./contactsSync');
const { parseJsonField } = require('./jsonField');

const VALUE_RE = /^(\d{17,20}|mail:[0-9a-f]{24}|web:[0-9a-f]{24})$/;
const kindOf = v => (v.startsWith('mail:') ? 'email' : v.startsWith('web:') ? 'web' : 'discord');
const SYNC_EVERY_MS = 30 * 1000;
const lastSync = new Map(); // space ID → time of the last sync

// Creates the missing contacts (at most every 30 s for a space, or now with force)
async function sync(db, { key = null, force = false } = {}) {
  const at = key ? lastSync.get(key) || 0 : 0;
  if (!force && key && Date.now() - at < SYNC_EVERY_MS) return;
  if (key) lastSync.set(key, Date.now());
  for (const sql of SYNC_STATEMENTS) await db(sql);
}

// The card of an identity: { contact, identities, primary }. An identity without tickets nor
// contact yet (a Discord member never seen) gives a card of its own, not saved.
async function resolve(db, value) {
  let [ident] = await db('SELECT contact_id FROM contact_identities WHERE value = ?', [value]);
  if (!ident) { await sync(db); [ident] = await db('SELECT contact_id FROM contact_identities WHERE value = ?', [value]); }
  if (!ident) return { contact: null, identities: [{ value, kind: kindOf(value), label: null }], primary: value };
  const [contact] = await db('SELECT id, display_name, email, notes, seed, created_at FROM contacts WHERE id = ?', [ident.contact_id]);
  const identities = await db('SELECT value, kind, label, created_at FROM contact_identities WHERE contact_id = ? ORDER BY created_at, value', [contact.id]);
  const primary = identities.some(i => i.value === contact.seed) ? contact.seed : identities[0].value;
  return { contact, identities: identities.map(i => ({ ...i, primary: i.value === primary })), primary };
}

// Directory: contacts with tickets visible to this staff member, most recent activity first
async function directory(db, { q = '', page = 1, limit = 30, vis, key = null }) {
  await sync(db, { key });
  const like = `%${String(q).replace(/[%_\\]/g, '\\$&')}%`;
  const search = q ? `AND (c.display_name LIKE ? OR c.email LIKE ? OR c.id IN (SELECT contact_id FROM contact_identities WHERE label LIKE ? OR value = ?))` : '';
  const params = q ? [like, like, like, q] : [];
  const from = `FROM contacts c JOIN contact_identities ci ON ci.contact_id = c.id JOIN tickets t ON t.owner_id = ci.value WHERE ${vis.sql} ${search}`;
  const rows = await db(
    `SELECT c.id AS contact_id, c.display_name AS tag, c.email,
            COALESCE(MAX(CASE WHEN ci.value = c.seed THEN ci.value END), MIN(ci.value)) AS member_id,
            GROUP_CONCAT(DISTINCT ci.kind ORDER BY ci.kind) AS kinds,
            COUNT(DISTINCT t.id) AS tickets, COUNT(DISTINCT CASE WHEN t.status = 'open' THEN t.id END) AS open,
            MAX(COALESCE(t.last_message_at, t.created_at)) AS last_at
     ${from} GROUP BY c.id ORDER BY last_at DESC LIMIT ? OFFSET ?`,
    [...vis.params, ...params, limit, (page - 1) * limit]
  );
  const [{ total }] = await db(`SELECT COUNT(DISTINCT c.id) AS total ${from}`, [...vis.params, ...params]);
  const ids = rows.map(r => r.member_id);
  const [notes, labels] = ids.length ? await Promise.all([
    db('SELECT member_id, COUNT(*) AS n FROM member_notes WHERE member_id IN (?) GROUP BY member_id', [ids]),
    db('SELECT member_id, labels FROM member_profiles WHERE member_id IN (?)', [ids]),
  ]) : [[], []];
  return {
    members: rows.map(r => ({
      ...r, kinds: String(r.kinds || '').split(',').filter(Boolean), tickets: Number(r.tickets), open: Number(r.open),
      notes: Number(notes.find(n => n.member_id === r.member_id)?.n || 0),
      labels: parseJsonField(labels.find(l => l.member_id === r.member_id)?.labels, []) || [],
    })),
    total: Number(total), page, pages: Math.ceil(Number(total) / limit),
  };
}

// Name, address and notes of the card. Returns the contact, or { error }.
async function update(db, card, { displayName, email, notes }) {
  if (!card.contact) return { status: 404, error: 'Ce contact n\'a encore aucun ticket' };
  const set = {};
  if (displayName !== undefined) {
    const n = String(displayName || '').trim().slice(0, 100);
    if (!n) return { status: 400, error: 'Nom requis' };
    set.display_name = n;
  }
  if (email !== undefined) {
    const e = String(email || '').trim().toLowerCase();
    if (e && (!require('./emailTickets').EMAIL_RE.test(e) || e.length > 254)) return { status: 400, error: 'Adresse e-mail invalide' };
    set.email = e || null;
  }
  if (notes !== undefined) {
    const t = String(notes || '').trim();
    if (t.length > 5000) return { status: 400, error: 'Notes trop longues (5000 caractères max)' };
    set.notes = t || null;
  }
  const keys = Object.keys(set);
  if (keys.length) await db(`UPDATE contacts SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => set[k]), card.contact.id]);
  const [contact] = await db('SELECT id, display_name, email, notes, seed, created_at FROM contacts WHERE id = ?', [card.contact.id]);
  return { contact };
}

// Merges the card of `other` into `card`: identities, staff discussion and labels join the card
// that is kept; the other card disappears. Tickets do not move.
async function merge(db, card, other) {
  if (!card.contact || !other.contact) return { status: 404, error: 'Contact introuvable' };
  if (card.contact.id === other.contact.id) return { status: 400, error: 'C\'est déjà le même contact' };
  const moved = other.identities.map(i => i.value);
  await db('UPDATE contact_identities SET contact_id = ? WHERE contact_id = ?', [card.contact.id, other.contact.id]);
  await db('UPDATE member_notes SET member_id = ? WHERE member_id IN (?)', [card.primary, moved]);
  const rows = await db('SELECT member_id, labels FROM member_profiles WHERE member_id IN (?)', [[card.primary, ...moved]]);
  const all = [...new Set(rows.flatMap(r => parseJsonField(r.labels, []) || []))].slice(0, 10);
  if (all.length) {
    await db('INSERT INTO member_profiles (member_id, labels) VALUES (?, ?) ON DUPLICATE KEY UPDATE labels = VALUES(labels)', [card.primary, JSON.stringify(all)]);
  }
  await db('DELETE FROM member_profiles WHERE member_id IN (?)', [moved]);
  // The kept card gets what it lacked
  await db(`UPDATE contacts SET email = COALESCE(email, ?), notes = CASE WHEN ? IS NULL THEN notes WHEN notes IS NULL THEN ? ELSE CONCAT(notes, '\n\n', ?) END WHERE id = ?`,
    [other.contact.email, other.contact.notes, other.contact.notes, other.contact.notes, card.contact.id]);
  await db('DELETE FROM contacts WHERE id = ?', [other.contact.id]);
  return { ok: true, moved };
}

// Takes an identity out of the card (a merge by mistake): it gets a card of its own again. The
// primary identity stays (the discussion and labels are kept under it).
async function detach(db, card, value) {
  const ident = card.identities.find(i => i.value === value);
  if (!card.contact || !ident) return { status: 404, error: 'Identité introuvable sur ce contact' };
  if (value === card.primary) return { status: 400, error: 'L\'identité principale reste sur la fiche' };
  await db('UPDATE contacts SET seed = NULL WHERE seed = ?', [value]);
  const { insertId } = await db('INSERT INTO contacts (display_name, email, seed) VALUES (?, ?, ?)',
    [String(ident.label || value).slice(0, 100), ident.kind === 'email' ? ident.label : null, value]);
  await db('UPDATE contact_identities SET contact_id = ? WHERE value = ?', [insertId, value]);
  return { ok: true, contactId: insertId };
}

module.exports = { VALUE_RE, kindOf, sync, resolve, directory, update, merge, detach };

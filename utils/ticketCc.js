// Copies of a ticket by e-mail (v5.0, conception/v5.md §3.6): the people in copy (Cc) of the
// e-mail that opened it, or added by the staff, stay in copy of everything sent to the requester.
// Someone in copy can answer in the thread: their message goes into the ticket.
// Never on a confidential ticket (CONFIDENTIAL = visibility_grade_id -1).
const MAX = 10;
const CONFIDENTIAL = -1;
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const norm = a => String(a || '').trim().toLowerCase();

async function listCc(db, ticketId) {
  return db('SELECT id, address, name, added_by, created_at FROM ticket_cc WHERE ticket_id = ? ORDER BY id', [ticketId]).catch(() => []);
}

// The addresses of the support (main, additional, connected account): never in copy of itself
async function ourAddresses(db) {
  const [s] = await db('SELECT address, oauth_account FROM email_settings WHERE id = 1').catch(() => []);
  const extra = await db('SELECT address FROM email_addresses').catch(() => []);
  return new Set([s?.address, s?.oauth_account, ...extra.map(x => x.address)].filter(Boolean).map(norm));
}

// { ok, cc } | { error } — by: who added it ('email' when it came with an e-mail)
// dryRun: only the checks (the API checks every change before writing any)
async function addCc(db, ticket, { address, name = null }, by = 'email', { dryRun = false } = {}) {
  const a = norm(address);
  if (!EMAIL_RE.test(a) || a.length > 254) return { error: 'Adresse e-mail invalide' };
  if (ticket.visibility_grade_id === CONFIDENTIAL) return { error: 'Un ticket confidentiel n\'a jamais de copie' };
  if (!String(ticket.owner_id).startsWith('mail:')) return { error: 'Les copies concernent les tickets ouverts par e-mail' };
  const [owner] = await db('SELECT address FROM email_contacts WHERE owner_id = ?', [ticket.owner_id]).catch(() => []);
  if (norm(owner?.address) === a) return { error: 'C\'est l\'adresse du demandeur' };
  if ((await ourAddresses(db)).has(a)) return { error: 'C\'est une adresse du support' };
  const [n] = await db('SELECT COUNT(*) AS n FROM ticket_cc WHERE ticket_id = ?', [ticket.id]);
  if (Number(n.n) >= MAX) return { error: `${MAX} copies au plus par ticket` };
  if (dryRun) return { ok: true, address: a };
  const cleanName = name ? String(name).replace(/[\r\n\t"<>]+/g, ' ').trim().slice(0, 100) || null : null;
  const r = await db('INSERT IGNORE INTO ticket_cc (ticket_id, address, name, added_by) VALUES (?, ?, ?, ?)', [ticket.id, a, cleanName, String(by).slice(0, 100)]);
  return { ok: true, added: r.affectedRows === 1, address: a };
}

async function removeCc(db, ticketId, id) {
  const [row] = await db('SELECT id, address FROM ticket_cc WHERE id = ? AND ticket_id = ?', [id, ticketId]);
  if (!row) return { error: 'Copie introuvable', status: 404 };
  await db('DELETE FROM ticket_cc WHERE id = ?', [row.id]);
  return { ok: true, address: row.address };
}

// The people in copy of an incoming e-mail: its To and Cc, without the support's own addresses
// nor the sender; the added ones (silently capped at MAX per ticket)
async function addFromMail(db, ticket, mail, sender) {
  if (ticket.visibility_grade_id === CONFIDENTIAL) return [];
  const ours = await ourAddresses(db);
  const added = [];
  for (const field of [mail.to, mail.cc]) {
    for (const group of Array.isArray(field) ? field : [field]) {
      for (const v of group?.value || []) {
        const a = norm(v?.address);
        if (!a || a === norm(sender) || ours.has(a)) continue;
        const r = await addCc(db, ticket, { address: a, name: v.name || null }, 'email');
        if (r.added) added.push(a);
      }
    }
  }
  return added;
}

// The Cc of an e-mail to the requester of this ticket (nodemailer address objects)
async function ccHeader(db, ticket) {
  if (!ticket || ticket.visibility_grade_id === CONFIDENTIAL) return [];
  return (await listCc(db, ticket.id)).map(c => (c.name ? { name: c.name, address: c.address } : c.address));
}

async function isCc(db, ticketId, address) {
  const [row] = await db('SELECT id FROM ticket_cc WHERE ticket_id = ? AND address = ?', [ticketId, norm(address)]).catch(() => []);
  return !!row;
}

module.exports = { MAX, listCc, addCc, removeCc, addFromMail, ccHeader, isCc };

// Guest side of the temporary access: the link's token opens a read-only session limited to the
// shared tickets. No dashboard right; expiry and revocation are checked on every request, and
// every ticket opened is written to the server's journal.
const express = require('express');
const router = express.Router();
const { recordEvent } = require('../../utils/audit');
const { resolveToken, sessionInvite, guestSources } = require('../../utils/guestInvites');

const actorOf = invite => ({ id: `guest:${invite.id}`, tag: `Invité · ${invite.label}`.slice(0, 100), source: 'guest' });

// POST /api/guest/session { token }
router.post('/session', async (req, res, next) => {
  try {
    const found = await resolveToken(req.body?.token);
    if (!found) return res.status(401).json({ error: 'Lien invalide, expiré ou révoqué' });
    const { guildId, db, invite } = found;
    await db('UPDATE guest_invites SET last_used_at = NOW(), uses = uses + 1 WHERE id = ?', [invite.id]);
    await recordEvent(db, { actor: actorOf(invite), action: 'guest_session', targetType: 'guest', targetId: invite.id, details: { ip: req.ip } });
    // New session id; an open dashboard or member session in the same browser is kept
    const keep = Object.fromEntries(Object.entries(req.session).filter(([k]) => k !== 'cookie'));
    req.session.regenerate(err => {
      if (err) return next(err);
      Object.assign(req.session, keep, { guest: { guildId, inviteId: invite.id } });
      res.json({ ok: true });
    });
  } catch (err) { next(err); }
});

async function requireGuest(req, res, next) {
  try {
    const found = await sessionInvite(req.session?.guest);
    if (!found) { if (req.session) delete req.session.guest; return res.status(401).json({ error: 'Accès expiré ou révoqué' }); }
    req.guestDb = found.db;
    req.invite = found.invite;
    next();
  } catch (err) { next(err); }
}

router.get('/me', requireGuest, async (req, res) => {
  const guildName = req.app.locals.client?.guilds?.cache?.get(req.session.guest.guildId)?.name || null;
  res.json({ label: req.invite.label, expiresAt: req.invite.expires_at, includeNotes: req.invite.include_notes, guildName });
});

router.get('/tickets', requireGuest, async (req, res, next) => {
  try {
    const rows = await req.guestDb('SELECT id, subject, status, owner_tag, created_at, closed_at FROM tickets WHERE id IN (?) ORDER BY id DESC', [req.invite.ticket_ids]);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/tickets/:id', requireGuest, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!req.invite.ticket_ids.includes(id)) return res.status(404).json({ error: 'Ticket introuvable' });
    const [ticket] = await req.guestDb('SELECT id, subject, status, owner_tag, created_at, closed_at FROM tickets WHERE id = ?', [id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
    const messages = await req.guestDb(
      'SELECT id, author_tag, content, source, created_at, deleted_at FROM ticket_notes WHERE ticket_id = ? AND source IN (?) ORDER BY created_at ASC, id ASC',
      [id, guestSources(req.invite)]);
    await recordEvent(req.guestDb, { actor: actorOf(req.invite), action: 'guest_view', ticketId: id, targetType: 'guest', targetId: req.invite.id });
    res.json({ ticket, messages });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  if (req.session) delete req.session.guest;
  res.json({ ok: true });
});

module.exports = router;

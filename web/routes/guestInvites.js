// Temporary guest access, founder side: create (link shown once), list, revoke.
const express = require('express');
const router = express.Router();
const { recordEvent, dashboardActor } = require('../../utils/audit');
const { DURATIONS, newToken, parse, isLive } = require('../../utils/guestInvites');

router.use((req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' })));

function publicUrl(token) {
  const { config } = require('../../utils/config');
  let base = '';
  try { base = new URL('/', config.dashboard?.discordCallbackUrl || config.webServerBaseUrl).origin; } catch { /* relative link */ }
  return `${base}/invite#${token}`; // in the fragment: never sent to the server, logs or Referer
}

router.get('/', async (req, res, next) => {
  try {
    const rows = await req.guildDb('SELECT id, label, ticket_ids, include_notes, expires_at, revoked_at, created_by_tag, created_at, last_used_at, uses FROM guest_invites ORDER BY id DESC LIMIT 100');
    res.json(rows.map(r => ({ ...parse(r), live: isLive(r) })));
  } catch (err) { next(err); }
});

// POST /api/guest-invites { label, ticketIds, includeNotes, duration: 1h|24h|7d|30d }
router.post('/', async (req, res, next) => {
  try {
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    if (!label || label.length > 100) return res.status(400).json({ error: 'Nom de l\'invité requis (100 caractères max)' });
    const ids = [...new Set((Array.isArray(req.body?.ticketIds) ? req.body.ticketIds : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
    if (!ids.length || ids.length > 50) return res.status(400).json({ error: 'Choisis de 1 à 50 tickets' });
    const found = await req.guildDb('SELECT id FROM tickets WHERE id IN (?)', [ids]);
    if (found.length !== ids.length) return res.status(400).json({ error: `Ticket(s) introuvable(s) : ${ids.filter(i => !found.some(f => f.id === i)).join(', ')}` });
    const seconds = DURATIONS[req.body?.duration];
    if (!seconds) return res.status(400).json({ error: 'Durée invalide (1h, 24h, 7d ou 30d)' });
    const { token, tokenHash } = newToken(req.guildId);
    const { insertId } = await req.guildDb(
      `INSERT INTO guest_invites (token_hash, label, ticket_ids, include_notes, expires_at, created_by_id, created_by_tag)
       VALUES (?, ?, ?, ?, NOW() + INTERVAL ? SECOND, ?, ?)`,
      [tokenHash, label, JSON.stringify(ids), req.body?.includeNotes ? 1 : 0, seconds, req.session.user.id, req.session.user.username]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'guest_invite_create', targetType: 'guest', targetId: insertId, details: { label, tickets: ids, includeNotes: !!req.body?.includeNotes, duration: req.body.duration } });
    res.json({ id: insertId, link: publicUrl(token) });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const [inv] = await req.guildDb('SELECT id, label FROM guest_invites WHERE id = ?', [parseInt(req.params.id) || 0]);
    if (!inv) return res.status(404).json({ error: 'Invitation introuvable' });
    await req.guildDb('UPDATE guest_invites SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = ?', [inv.id]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'guest_invite_revoke', targetType: 'guest', targetId: inv.id, details: { label: inv.label } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

// « C'est résolu » by e-mail link (utils/resolution.js), public: the link /solution#<space>.<token>
// keeps the token in the fragment; the page sends it in the body.
//   POST /api/resolution/link   { token } → the ticket and its solution
//   POST /api/resolution/accept { token } → closes the ticket (once)
const express = require('express');
const router = express.Router();
const res_ = require('../../utils/resolution');

const GONE = 'Ce lien a expiré ou a déjà servi';

router.post('/link', async (req, res) => {
  try {
    const found = await res_.findByToken(req.body?.token);
    if (!found) return res.status(410).json({ error: GONE });
    const t = found.ticket;
    // Only what the confirmation needs: the subject and the solution, never the conversation
    res.json({ space: found.space || 'Support', ticketId: t.id, subject: t.subject || null, solution: t.resolution, by: t.resolved_by_tag, resolvedAt: t.resolved_at });
  } catch (err) { console.error('resolution link:', err.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/accept', async (req, res) => {
  try {
    const found = await res_.findByToken(req.body?.token);
    if (!found) return res.status(410).json({ error: GONE });
    const owner = found.ticket.owner_id;
    await res_.acceptResolution({ db: found.db, client: req.app.locals.client, guildId: found.guildId, ticket: found.ticket, by: { id: owner, tag: found.ticket.owner_tag, username: found.ticket.owner_tag, source: 'member' } });
    res.json({ ok: true, ticketId: found.ticket.id });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('resolution accept:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

// Approval by e-mail link (utils/approvals.js), public: the token comes from the fragment of
// /validation#<token> and is sent in the body, never in a URL.
//   POST /api/approvals/link   { token }                       → what is asked
//   POST /api/approvals/decide { token, decision, comment }    → the answer (once)
const express = require('express');
const router = express.Router();
const approvals = require('../../utils/approvals');

const GONE = 'Ce lien a expiré ou a déjà servi';

router.post('/link', async (req, res) => {
  try {
    const found = await approvals.findByToken(req.body?.token);
    if (!found) return res.status(410).json({ error: GONE });
    const { db, guildId, approval: a } = found;
    const [t] = await db('SELECT id, subject, owner_tag, status FROM tickets WHERE id = ?', [a.ticket_id]);
    const { globalQuery } = require('../../utils/globalDb');
    const [g] = await globalQuery('SELECT guild_name FROM guilds WHERE guild_id = ?', [guildId]);
    // Only what the decision needs: no conversation, no internal notes
    res.json({ space: g?.guild_name || 'Support', ticketId: t?.id, subject: t?.subject || null, requester: t?.owner_tag || null, open: t?.status === 'open',
      reason: a.reason, by: a.requested_by_tag, approver: a.approver_name });
  } catch (err) { console.error('approval link:', err.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/decide', async (req, res) => {
  try {
    const found = await approvals.findByToken(req.body?.token);
    if (!found) return res.status(410).json({ error: GONE });
    const { db, guildId, approval: a } = found;
    const client = req.app.locals.client;
    const tm = require('../../utils/ticketManager').createManager(db, client, guildId);
    const r = await approvals.decide({ db, client, guildId, approval: a, decision: req.body?.decision, comment: req.body?.comment, decider: { tag: a.approver_name }, tm });
    res.json({ ok: true, decision: req.body.decision, moved: r.moved });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('approval decide:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

// Member web space (/espace): sign in with Discord, then read-only access to one's own tickets.
// The member identity lives in req.session.member and never grants dashboard access; a staff
// member already signed in to the dashboard is recognised too.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { listMemberTickets, memberTicket, memberTranscriptHtml } = require('../../utils/memberPortal');

const memberOf = req => req.session.member
  || (req.session.user && { id: req.session.user.id, username: req.session.user.username, avatar: req.session.user.avatar || null, viaDashboard: true });

function requireMember(req, res, next) {
  const m = memberOf(req);
  if (!m) return res.status(401).json({ error: 'Non connecté' });
  req.member = m;
  next();
}

// GET /api/member/auth/discord — Discord sign-in (identity only), back through the dashboard callback
router.get('/auth/discord', (req, res) => {
  const { config } = require('../../utils/config');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  req.session.oauthPurpose = 'member';
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.dashboard.discordCallbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

router.get('/me', requireMember, (req, res) => res.json(req.member));

// POST /api/member/logout — ends the member session (a dashboard session stays open)
router.post('/logout', (req, res) => {
  delete req.session.member;
  res.json({ ok: true });
});

router.get('/tickets', requireMember, async (req, res) => {
  try {
    res.json(await listMemberTickets(req.member.id, req.app.locals.client));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

async function loadOwn(req, res) {
  const data = await memberTicket(req.member.id, req.params.guildId, parseInt(req.params.ticketId), req.app.locals.client);
  if (!data) res.status(404).json({ error: 'Ticket introuvable' });
  return data;
}

router.get('/tickets/:guildId/:ticketId', requireMember, async (req, res) => {
  try {
    const data = await loadOwn(req, res);
    if (data) res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/member/tickets/:guildId/:ticketId/transcript — the conversation as an HTML file
router.get('/tickets/:guildId/:ticketId/transcript', requireMember, async (req, res) => {
  try {
    const data = await loadOwn(req, res);
    if (!data) return;
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('Content-Disposition', `attachment; filename="ticket-${data.ticket.id}.html"`);
    res.type('html').send(memberTranscriptHtml(data, req.member.username));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
module.exports.memberOf = memberOf;

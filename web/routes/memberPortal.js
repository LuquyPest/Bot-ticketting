// Member web space (/espace): sign in with Discord, then read-only access to one's own tickets.
// The member identity lives in req.session.member and never grants dashboard access; a staff
// member already signed in to the dashboard is recognised too.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { listMemberTickets, memberTicket, memberTranscriptHtml, memberGuilds, isMemberGuild, guildFaq, openingForm } = require('../../utils/memberPortal');
const { getTenantDb } = require('../../utils/tenantDb');
const { createManager } = require('../../utils/ticketManager');
const { isBlacklistedIn } = require('../../utils/guildScan');
const { allowBurst } = require('../../utils/rateLimit');
const { t, withLang, LANGS } = require('../../utils/i18n');

// Language of the member space: the one picked on the page (X-Member-Lang), else the browser's
// (English for another language), French without any header
const portalLang = req => {
  const picked = String(req.get('X-Member-Lang') || req.query?.lang || '').toLowerCase();
  if (LANGS.includes(picked)) return picked;
  return req.get('Accept-Language') ? (req.acceptsLanguages(...LANGS) || 'en') : 'fr';
};
const tr = (req, key, vars) => withLang(portalLang(req), () => t(key, vars));

const memberOf = req => req.session.member
  || (req.session.user && { id: req.session.user.id, username: req.session.user.username, avatar: req.session.user.avatar || null, viaDashboard: true });

function requireMember(req, res, next) {
  const m = memberOf(req);
  if (!m) return res.status(401).json({ error: tr(req, 'portal.notSignedIn') });
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
    res.status(500).json({ error: tr(req, 'portal.serverError') });
  }
});

async function loadOwn(req, res) {
  const data = await memberTicket(req.member.id, req.params.guildId, parseInt(req.params.ticketId), req.app.locals.client);
  if (!data) res.status(404).json({ error: tr(req, 'portal.ticketNotFound') });
  return data;
}

router.get('/tickets/:guildId/:ticketId', requireMember, async (req, res) => {
  try {
    const data = await loadOwn(req, res);
    if (data) res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: tr(req, 'portal.serverError') });
  }
});

// GET /api/member/tickets/:guildId/:ticketId/transcript — the conversation as an HTML file
router.get('/tickets/:guildId/:ticketId/transcript', requireMember, async (req, res) => {
  try {
    const data = await loadOwn(req, res);
    if (!data) return;
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('Content-Disposition', `attachment; filename="ticket-${data.ticket.id}.html"`);
    res.type('html').send(memberTranscriptHtml(data, req.member.username, portalLang(req)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: tr(req, 'portal.serverError') });
  }
});

// ── Servers, public help, opening a ticket, answering ──

router.get('/guilds', requireMember, async (req, res) => {
  try { res.json(await memberGuilds(req.member.id, req.app.locals.client)); } catch (err) { console.error(err); res.status(500).json({ error: tr(req, 'portal.serverError') }); }
});

async function guildOf(req, res) {
  const g = await isMemberGuild(req.member.id, req.params.guildId, req.app.locals.client);
  if (!g) res.status(404).json({ error: tr(req, 'portal.guildNotFound') });
  return g;
}

router.get('/guilds/:guildId/faq', requireMember, async (req, res) => {
  try {
    if (!(await guildOf(req, res))) return;
    res.json(await guildFaq(req.params.guildId));
  } catch (err) { console.error(err); res.status(500).json({ error: tr(req, 'portal.serverError') }); }
});

router.get('/guilds/:guildId/form', requireMember, async (req, res) => {
  try {
    if (!(await guildOf(req, res))) return;
    const subject = typeof req.query.subject === 'string' ? req.query.subject.slice(0, 100) : undefined;
    res.json(await openingForm(req.params.guildId, subject));
  } catch (err) { console.error(err); res.status(500).json({ error: tr(req, 'portal.serverError') }); }
});

// Refusal reasons shared by opening and answering (same rules as in DMs)
async function memberBlocked(db, userId) {
  return (await isBlacklistedIn(db, userId)) ? 'portal.blocked' : null;
}

// POST /api/member/guilds/:guildId/tickets { subject, fields: { id: value }, answers: [], content }
// Opens the ticket exactly like the DM flow (welcome DM, channel, rules, incidents…)
router.post('/guilds/:guildId/tickets', requireMember, async (req, res) => {
  try {
    const guild = await guildOf(req, res);
    if (!guild) return;
    const guildId = guild.id;
    const client = req.app.locals.client;
    const db = getTenantDb(guildId);
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length > 2000) return res.status(400).json({ error: tr(req, 'portal.describe') });
    const blocked = await memberBlocked(db, req.member.id);
    if (blocked) return res.status(403).json({ error: tr(req, blocked) });
    const form = await openingForm(guildId);
    const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim().slice(0, 100) : '';
    if (form.subjects.length && !form.subjects.includes(subject)) return res.status(400).json({ error: tr(req, 'portal.pickSubject') });
    const { fields, questions } = await openingForm(guildId, subject);
    const { parseFieldAnswer } = require('../../utils/ticketFields');
    const fieldValues = {};
    for (const f of fields) {
      const raw = req.body?.fields?.[f.id];
      const r = parseFieldAnswer(f, raw ?? '', ['']);
      if (r.error && (f.required || String(raw ?? '').trim())) return res.status(400).json({ error: tr(req, r.error === 'number' ? 'portal.fieldNumber' : 'portal.fieldRequired', { label: f.label }) });
      if (r.value) fieldValues[f.id] = r.value;
    }
    const answers = Array.isArray(req.body?.answers) ? req.body.answers.map(a => String(a ?? '').trim().slice(0, 500)) : [];
    if (questions.some((q, i) => !answers[i])) return res.status(400).json({ error: tr(req, 'portal.answerAll') });

    const [cfg] = await db('SELECT max_tickets_per_day FROM guild_config WHERE id = 1');
    const tm = createManager(db, client, guildId);
    const maxPerDay = cfg?.max_tickets_per_day ?? 3;
    if (await tm.getDailyTicketCount(req.member.id) >= maxPerDay) return res.status(429).json({ error: tr(req, 'portal.dailyLimit', { max: maxPerDay }) });

    if (!(await allowBurst(`webopen:${req.member.id}`, 3, 60 * 1000))) return res.status(429).json({ error: tr(req, 'portal.tooManyTickets') });
    const user = await client.users.fetch(req.member.id).catch(() => null);
    if (!user) return res.status(409).json({ error: tr(req, 'portal.noAccount') });
    const summary = questions.map((label, i) => `**${label}** : ${answers[i]}`).join('\n');
    const enriched = questions.length ? `${content}\n\n📋 **Formulaire d'intake :**\n${summary}` : content;
    const startedAt = new Date(Date.now() - 1000);
    await require('../../events/messageCreate').openTicketInGuild(user, enriched, [], guildId, client, subject,
      { skipFaq: true, fieldsDone: true, intakeDone: true, fieldValues: Object.keys(fieldValues).length ? fieldValues : null, confidential: !!req.body?.confidential });
    const [ticket] = await db('SELECT id FROM tickets WHERE owner_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 1', [req.member.id, startedAt]);
    if (!ticket) return res.status(409).json({ error: tr(req, 'portal.openFailed') });
    res.json({ ok: true, guildId, ticketId: ticket.id });
  } catch (err) { console.error(err); res.status(500).json({ error: tr(req, 'portal.serverError') }); }
});

// POST /api/member/tickets/:guildId/:ticketId/messages { content } — reaches the staff like a DM
router.post('/tickets/:guildId/:ticketId/messages', requireMember, async (req, res) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length > 2000) return res.status(400).json({ error: tr(req, 'portal.messageLength') });
    const data = await loadOwn(req, res);
    if (!data) return;
    if (data.ticket.status !== 'open') return res.status(400).json({ error: tr(req, 'portal.closed') });
    const guildId = data.guild.id;
    const db = getTenantDb(guildId);
    const blocked = await memberBlocked(db, req.member.id);
    if (blocked) return res.status(403).json({ error: tr(req, blocked) });
    if (!(await allowBurst(`dm:${req.member.id}`, 8, 30 * 1000))) return res.status(429).json({ error: tr(req, 'portal.tooManyMessages') });
    const client = req.app.locals.client;
    const user = await client.users.fetch(req.member.id).catch(() => null);
    const [ticket] = await db('SELECT * FROM tickets WHERE id = ?', [data.ticket.id]);
    const sent = user && await createManager(db, client, guildId).relayToTicket(ticket, user, content, []);
    if (!sent) return res.status(409).json({ error: tr(req, 'portal.notSent') });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: tr(req, 'portal.serverError') }); }
});

module.exports = router;
module.exports.memberOf = memberOf;

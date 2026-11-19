// Member web space (/espace): sign in with Discord or with a link sent by e-mail (v4), then one's
// own tickets: follow, answer, open. The member identity lives in req.session.member and never
// grants dashboard access; a staff member already signed in to the dashboard is recognised too.
// Signed in by e-mail, the member is « web:<hash of the address> » (utils/webRequesters.js).
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { listMemberTickets, memberTicket, memberTranscriptHtml, memberGuilds, isMemberGuild, guildFaq, openingForm } = require('../../utils/memberPortal');
const { getTenantDb } = require('../../utils/tenantDb');
const { createManager } = require('../../utils/ticketManager');
const { isBlacklistedIn } = require('../../utils/guildScan');
const { allowBurst } = require('../../utils/rateLimit');
const { t, withLang, LANGS, rememberLocale } = require('../../utils/i18n');
const { getRedis } = require('../../utils/redis');
const web = require('../../utils/webRequesters');
const { memberIds } = require('../../utils/memberPortal');

const LINK_MINUTES = 15;
const linkKey = token => `memberlink:${crypto.createHash('sha256').update(token).digest('hex')}`;

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
  if (!config.clientId || !config.dashboard?.discordClientSecret) return res.redirect('/espace?error=discord_off');
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

// GET /api/member/login-options — the ways to sign in on this instance (public)
router.get('/login-options', async (req, res) => {
  const { config } = require('../../utils/config');
  const mail = await require('../../utils/instanceMail').mailSettings().catch(() => ({ enabled: false }));
  res.json({ discord: !!(config.clientId && config.dashboard?.discordClientSecret), email: !!mail.enabled });
});

// POST /api/member/auth/email { email } — sends a sign-in link (15 min, single use). Same answer
// whatever the address; a few links per address and per quarter of an hour at most.
router.post('/auth/email', async (req, res) => {
  try {
    const { EMAIL_RE } = require('../../utils/emailTickets');
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: tr(req, 'portal.badEmail') });
    const mail = require('../../utils/instanceMail');
    if (!(await mail.mailSettings()).enabled) return res.status(409).json({ error: tr(req, 'portal.emailOff') });
    if (!(await allowBurst(`memberlink:${web.webOwnerIdFor(email)}`, 3, LINK_MINUTES * 60 * 1000))) return res.json({ ok: true });
    const { portalUrl } = require('../../utils/memberPortal');
    const base = portalUrl();
    if (!base) return res.status(409).json({ error: tr(req, 'portal.emailOff') });
    const token = crypto.randomBytes(32).toString('base64url');
    const lang = portalLang(req);
    await getRedis().set(linkKey(token), JSON.stringify({ email, lang }), 'EX', LINK_MINUTES * 60);
    // In the fragment: never sent to a server, nor in a Referer
    await mail.sendInstanceMail({ to: email, template: 'loginLink', lang, vars: { link: `${base}/connexion#${token}`, minutes: LINK_MINUTES } });
    res.json({ ok: true });
  } catch (err) {
    console.error('member link:', err.message);
    res.status(502).json({ error: tr(req, 'portal.mailFailed') });
  }
});

// POST /api/member/auth/email/verify { token } — opens the member session; the link is used up
router.post('/auth/email/verify', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(400).json({ error: tr(req, 'portal.linkInvalid') });
  const raw = await getRedis().getdel(linkKey(token)).catch(() => null);
  if (!raw) return res.status(400).json({ error: tr(req, 'portal.linkInvalid') });
  const { email, lang } = JSON.parse(raw);
  const member = { id: web.webOwnerIdFor(email), username: email, avatar: null, email };
  // New session ID; an open dashboard session in the same browser is kept
  const keep = Object.fromEntries(Object.entries(req.session).filter(([k]) => k !== 'cookie'));
  req.session.regenerate(async err => {
    if (err) return res.status(500).json({ error: tr(req, 'portal.serverError') });
    Object.assign(req.session, keep);
    req.session.member = member;
    await rememberLocale(member.id, lang);
    res.json({ ok: true, member });
  });
});

router.get('/me', requireMember, (req, res) => res.json(req.member));

// POST /api/member/logout — ends the member session (a dashboard session stays open)
router.post('/logout', (req, res) => {
  delete req.session.member;
  res.json({ ok: true });
});

router.get('/tickets', requireMember, async (req, res) => {
  try {
    res.json(await listMemberTickets(req.member, req.app.locals.client));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: tr(req, 'portal.serverError') });
  }
});

async function loadOwn(req, res, { allowOrg = false } = {}) {
  const data = await memberTicket(req.member, req.params.guildId, parseInt(req.params.ticketId), req.app.locals.client, { allowOrg });
  if (!data) res.status(404).json({ error: tr(req, 'portal.ticketNotFound') });
  return data;
}

router.get('/tickets/:guildId/:ticketId', requireMember, async (req, res) => {
  try {
    // A ticket of their organisation (v5.3): read only, without its files
    const data = await loadOwn(req, res, { allowOrg: true });
    if (!data) return;
    if (data.access === 'org') return res.json({ ...data, files: [], upload: { enabled: false } });
    // The files of the conversation, and what may be sent (v5.0)
    const db = getTenantDb(data.guild.id);
    const files = (await require('../../utils/emailAttachments').listForTicket(db, data.ticket.id).catch(() => []))
      .map(f => ({ id: f.id, filename: f.filename, size: f.size, created_at: f.created_at }));
    res.json({ ...data, files, upload: await require('../../utils/requesterFiles').uploadRules(db) });
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
  try { res.json(await memberGuilds(req.member, req.app.locals.client)); } catch (err) { console.error(err); res.status(500).json({ error: tr(req, 'portal.serverError') }); }
});

async function guildOf(req, res) {
  const g = await isMemberGuild(req.member, req.params.guildId, req.app.locals.client);
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
    res.json({ ...(await openingForm(req.params.guildId, subject)), upload: await require('../../utils/requesterFiles').uploadRules(getTenantDb(req.params.guildId)) });
  } catch (err) { console.error(err); res.status(500).json({ error: tr(req, 'portal.serverError') }); }
});

// Refusal reasons shared by opening and answering (same rules as in DMs)
async function memberBlocked(db, member) {
  for (const id of memberIds(member)) if (await isBlacklistedIn(db, id)) return 'portal.blocked';
  return null;
}

// Who writes, for the ticket code: the Discord user, or (signed in by e-mail) a user-like object
// whose « DMs » are e-mails — ownerId: the identity the ticket knows them by
async function requesterFor(req, guildId, ownerId = req.member.id) {
  if (!req.member.email) return req.app.locals.client.users.fetch(ownerId).catch(() => null);
  if (web.isWebOwner(ownerId)) {
    await web.rememberAddress(getTenantDb(guildId), ownerId, req.member.email);
    return web.webUserFor(ownerId, req.member.email, guildId);
  }
  return require('../../utils/emailTickets').userFor(ownerId, req.member.email, null, guildId);
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
    const blocked = await memberBlocked(db, req.member);
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
    // Anyone can get a sign-in link: new tickets from e-mail sign-ins are capped per space as well
    if (req.member.email && !(await allowBurst(`webnew:${guildId}`, 60, 3600 * 1000))) return res.status(429).json({ error: tr(req, 'portal.tooManyTickets') });
    const user = await requesterFor(req, guildId);
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
// POST /api/member/tickets/:guildId/:ticketId/resolution { accept, comment } — the proposed solution:
// « it is solved » closes the ticket, « not yet » makes it go on (with what is still wrong)
router.post('/tickets/:guildId/:ticketId/resolution', requireMember, async (req, res) => {
  try {
    const data = await loadOwn(req, res);
    if (!data) return;
    const db = getTenantDb(data.guild.id);
    const [ticket] = await db("SELECT * FROM tickets WHERE id = ? AND status = 'open' AND resolved_at IS NOT NULL", [data.ticket.id]);
    if (!ticket) return res.status(410).json({ error: tr(req, 'resolution.expired') });
    const by = { id: req.member.id, tag: req.member.username || req.member.email || 'membre', username: req.member.username || req.member.email, source: 'member' };
    const r = require('../../utils/resolution');
    if (req.body?.accept === true) {
      await r.acceptResolution({ db, client: req.app.locals.client, guildId: data.guild.id, ticket, by });
      return res.json({ ok: true, closed: true });
    }
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 1000) : '';
    await r.reopenResolution({ db, guildId: data.guild.id, ticket, by, comment });
    if (comment) {
      const user = await requesterFor(req, data.guild.id, memberIds(req.member).includes(ticket.owner_id) ? ticket.owner_id : req.member.id);
      if (user) await createManager(db, req.app.locals.client, data.guild.id).relayToTicket({ ...ticket, resolved_at: null }, user, comment, []).catch(() => null);
    }
    res.json({ ok: true, closed: false });
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); console.error(err); res.status(500).json({ error: tr(req, 'portal.serverError') }); }
});

// GET /api/member/tickets/:guildId/:ticketId/files/:fileId — a file of my ticket, always downloaded
router.get('/tickets/:guildId/:ticketId/files/:fileId', requireMember, async (req, res) => {
  try {
    const data = await loadOwn(req, res);
    if (!data) return;
    const found = await require('../../utils/emailAttachments').fileFor(getTenantDb(data.guild.id), data.guild.id, data.ticket.id, parseInt(req.params.fileId) || 0);
    if (!found) return res.status(404).json({ error: tr(req, 'portal.ticketNotFound') });
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(found.row.filename)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    res.sendFile(found.file);
  } catch (err) { console.error(err); res.status(500).json({ error: tr(req, 'portal.serverError') }); }
});

// A message, files (multipart « files », 5 at most) or both
const memberUpload = (req, res, next) => (req.is('multipart/form-data')
  ? require('../../utils/requesterFiles').upload()(req, res, err => (err ? res.status(413).json({ error: tr(req, 'portal.fileTooBig') }) : next()))
  : next());
router.post('/tickets/:guildId/:ticketId/messages', requireMember, memberUpload, async (req, res) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const files = Array.isArray(req.files) ? req.files : [];
    if ((!content && !files.length) || content.length > 2000) return res.status(400).json({ error: tr(req, 'portal.messageLength') });
    const data = await loadOwn(req, res);
    if (!data) return;
    if (data.ticket.status !== 'open') return res.status(400).json({ error: tr(req, 'portal.closed') });
    const guildId = data.guild.id;
    const db = getTenantDb(guildId);
    const blocked = await memberBlocked(db, req.member);
    if (blocked) return res.status(403).json({ error: tr(req, blocked) });
    if (!(await allowBurst(`dm:${req.member.id}`, 8, 30 * 1000))) return res.status(429).json({ error: tr(req, 'portal.tooManyMessages') });
    // Files: 30 per hour and per person, whatever the tickets
    for (let i = 0; i < files.length; i++) if (!(await allowBurst(`webfiles:${req.member.id}`, 30, 3600 * 1000))) return res.status(429).json({ error: tr(req, 'portal.tooManyMessages') });
    const client = req.app.locals.client;
    const [ticket] = await db('SELECT * FROM tickets WHERE id = ?', [data.ticket.id]);
    const ids = memberIds(req.member);
    const user = await requesterFor(req, guildId, ids.includes(ticket.owner_id) ? ticket.owner_id : req.member.id);
    const tm = createManager(db, client, guildId);
    if (files.length) {
      const r = user ? await require('../../utils/requesterFiles').addFiles({ db, guildId, tm, ticket, user, files, text: content }) : { sent: false };
      if (!r.sent) return res.status(409).json({ error: tr(req, 'portal.notSent') });
      return res.json({ ok: true, files: r.files });
    }
    const sent = user && await tm.relayToTicket(ticket, user, content, []);
    if (!sent) return res.status(409).json({ error: tr(req, 'portal.notSent') });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: tr(req, 'portal.serverError') }); }
});

module.exports = router;
module.exports.memberOf = memberOf;

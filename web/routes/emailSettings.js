// Tickets by e-mail, settings of the server (founders): GET / PUT / POST /test, and the stored
// attachments (POST /attachments/purge). Passwords are
// never sent back (only whether they are set); changes go to the server's journal.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const email = require('../../utils/emailTickets');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const attach = require('../../utils/emailAttachments');
const mailOAuth = require('../../utils/mailOAuth');
const view = async (s, db) => ({
  inbound: require('../../utils/inboundEmail').view(await email.emailSettings(db, { withSecrets: true })),
  signature: s.signature || '', branded: s.branded === undefined ? true : !!Number(s.branded),
  authMode: s.auth_mode || 'password', oauthAccount: s.oauth_account || null, oauthConnected: !!s.oauth_refresh_set,
  oauthAvailable: await mailOAuth.available(), oauthCallbacks: Object.fromEntries(mailOAuth.KEYS.map(k => [k, mailOAuth.callbackUrl(k)])),
  attachments: { ...attach.attachSettings(s), usage: await attach.usage(db) },
  enabled: !!s.enabled, address: s.address || '', displayName: s.display_name || '',
  imapHost: s.imap_host || '', imapPort: s.imap_port || 993, imapUser: s.imap_user || '', imapPasswordSet: !!s.imap_password_set,
  smtpHost: s.smtp_host || '', smtpPort: s.smtp_port || 587, smtpUser: s.smtp_user || '', smtpPasswordSet: !!s.smtp_password_set,
  lastFetchAt: s.last_fetch_at || null, lastError: s.last_error || null,
});

router.get('/', async (req, res, next) => {
  try { res.json(await view(await email.emailSettings(req.guildDb), req.guildDb)); } catch (err) { next(err); }
});

router.put('/', async (req, res, next) => {
  try {
    const { value, error } = await email.saveEmailSettings(req.guildDb, req.body || {});
    if (error) return res.status(400).json({ error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'email_settings', details: { enabled: value.enabled, address: value.address || null } });
    res.json(await view(value, req.guildDb));
  } catch (err) { next(err); }
});

// ── Mailbox connected by OAuth2 (utils/mailOAuth.js) ──
// POST /oauth/:provider/start → { url } (the browser goes there) ; GET /oauth/:provider/callback
// (back from the provider, same session and space) ; POST /oauth/disconnect
router.post('/oauth/:provider/start', async (req, res, next) => {
  try {
    if (!mailOAuth.isOAuth(req.params.provider)) return res.status(404).json({ error: 'Fournisseur inconnu' });
    const start = await mailOAuth.authorizeUrl(req.params.provider);
    if (!start) return res.status(409).json({ error: 'Le propriétaire de l\'instance doit d\'abord déclarer l\'application (Instance → Connexion → Boîtes e-mail)' });
    req.session.mailOAuth = { ...start.pending, guildId: req.guildId, userId: req.session.user.id };
    req.session.save(() => res.json({ url: start.url }));
  } catch (err) { next(err); }
});

router.get('/oauth/:provider/callback', async (req, res) => {
  const pending = req.session.mailOAuth;
  delete req.session.mailOAuth;
  const back = reason => res.redirect(`/settings?tab=integrations&email=${reason}`);
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  // Started from this space, by this person, in this browser
  if (!pending || pending.guildId !== req.guildId || pending.userId !== req.session.user.id || !same(String(req.query.state || ''), pending.state || '')) return back('invalid_state');
  if (req.query.error || !req.query.code) return back('oauth_failed');
  try {
    const conn = await mailOAuth.finish(req.params.provider, pending, String(req.query.code).slice(0, 4000));
    await mailOAuth.saveConnection(req.guildDb, req.params.provider, conn);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'email_settings', details: { oauth: req.params.provider, account: conn.account } });
    back('connected');
  } catch (err) {
    console.error('email oauth:', err.reason || err.message);
    back(['no_refresh', 'no_address', 'invalid_state', 'provider_off'].includes(err.reason) ? err.reason : 'oauth_failed');
  }
});

router.post('/oauth/disconnect', async (req, res, next) => {
  try {
    await mailOAuth.disconnect(req.guildDb);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'email_settings', details: { oauth: null, enabled: false } });
    res.json(await view(await email.emailSettings(req.guildDb), req.guildDb));
  } catch (err) { next(err); }
});

// ── Reception by webhook (utils/inboundEmail.js) ──
// PUT /inbound { mode: 'imap' | 'webhook', provider, signingKey, topicArn } ; POST /inbound/token (new URL)
router.put('/inbound', async (req, res, next) => {
  try {
    const r = await require('../../utils/inboundEmail').saveInbound(req.guildDb, req.guildId, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'email_settings', details: { inbound: req.body?.mode === 'webhook' ? req.body.provider : 'imap' } });
    res.json(await view(await email.emailSettings(req.guildDb), req.guildDb));
  } catch (err) { next(err); }
});
router.post('/inbound/token', async (req, res, next) => {
  try {
    await require('../../utils/inboundEmail').regenerateToken(req.guildDb, req.guildId);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'email_settings', details: { inboundToken: 'new' } });
    res.json(await view(await email.emailSettings(req.guildDb), req.guildDb));
  } catch (err) { next(err); }
});

router.post('/test', async (req, res, next) => {
  try { res.json(await email.testEmailSettings(req.guildDb)); } catch (err) { next(err); }
});

// POST /api/email/attachments/purge { all } — applies the retention now (all: every closed ticket)
router.post('/attachments/purge', async (req, res, next) => {
  try {
    const s = attach.attachSettings(await email.emailSettings(req.guildDb));
    const result = await attach.purge(req.guildDb, req.guildId, { days: req.body?.all === true ? 0 : s.retentionDays || 36500 });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'email_attachments_purge', details: { files: result.files, bytes: result.bytes, all: req.body?.all === true } });
    res.json({ ...result, usage: await attach.usage(req.guildDb) });
  } catch (err) { next(err); }
});

// ── Additional addresses (v4.1): GET /addresses, POST /addresses, PUT /addresses/:id, DELETE /addresses/:id ──
const MAX_ADDRESSES = 20;
const { parseJsonField } = require('../../utils/jsonField');
async function addressesView(db) {
  const [cfg] = await db('SELECT ticket_subjects FROM guild_config WHERE id = 1');
  const subjects = parseJsonField(cfg?.ticket_subjects, []).map(x => (typeof x === 'string' ? x : x?.label || x?.name)).filter(Boolean);
  const tags = await db('SELECT id, name FROM ticket_tags ORDER BY name');
  return { addresses: await email.listAddresses(db), subjects, tags };
}
// { address, displayName, subject, tagId, replyFrom } → { value } or { error }
async function cleanAddress(db, body, exceptId = 0) {
  const address = String(body?.address || '').trim().toLowerCase();
  if (!email.EMAIL_RE.test(address) || address.length > 254) return { error: 'Adresse e-mail invalide' };
  const main = await email.emailSettings(db);
  if (String(main.address || '').toLowerCase() === address) return { error: 'C\'est déjà l\'adresse principale de la boîte' };
  const [dup] = await db('SELECT id FROM email_addresses WHERE address = ? AND id <> ?', [address, exceptId]);
  if (dup) return { error: 'Adresse déjà ajoutée' };
  const { subjects, tags } = await addressesView(db);
  const subject = typeof body?.subject === 'string' && body.subject.trim() ? body.subject.trim().slice(0, 100) : null;
  if (subject && !subjects.includes(subject)) return { error: 'Sujet inconnu (Paramètres → Tickets → Sujets)' };
  const tagId = body?.tagId ? Number(body.tagId) : null;
  if (tagId && !tags.some(t => t.id === tagId)) return { error: 'Tag introuvable' };
  const displayName = typeof body?.displayName === 'string' ? body.displayName.replace(/[\r\n]+/g, ' ').trim().slice(0, 100) || null : null;
  return { value: { address, displayName, subject, tagId, replyFrom: body?.replyFrom === true } };
}

router.get('/addresses', async (req, res, next) => {
  try { res.json(await addressesView(req.guildDb)); } catch (err) { next(err); }
});

router.post('/addresses', async (req, res, next) => {
  try {
    const [n] = await req.guildDb('SELECT COUNT(*) AS n FROM email_addresses');
    if (Number(n.n) >= MAX_ADDRESSES) return res.status(400).json({ error: `${MAX_ADDRESSES} adresses au plus` });
    const { value: v, error } = await cleanAddress(req.guildDb, req.body);
    if (error) return res.status(400).json({ error });
    await req.guildDb('INSERT INTO email_addresses (address, display_name, subject, tag_id, reply_from) VALUES (?, ?, ?, ?, ?)', [v.address, v.displayName, v.subject, v.tagId, v.replyFrom ? 1 : 0]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'email_address_add', details: { address: v.address, subject: v.subject, tagId: v.tagId } });
    res.json(await addressesView(req.guildDb));
  } catch (err) { next(err); }
});

router.put('/addresses/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const [row] = await req.guildDb('SELECT id FROM email_addresses WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Adresse introuvable' });
    const { value: v, error } = await cleanAddress(req.guildDb, req.body, id);
    if (error) return res.status(400).json({ error });
    await req.guildDb('UPDATE email_addresses SET address = ?, display_name = ?, subject = ?, tag_id = ?, reply_from = ? WHERE id = ?', [v.address, v.displayName, v.subject, v.tagId, v.replyFrom ? 1 : 0, id]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'email_address_update', details: { address: v.address, subject: v.subject, tagId: v.tagId } });
    res.json(await addressesView(req.guildDb));
  } catch (err) { next(err); }
});

router.delete('/addresses/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const [row] = await req.guildDb('SELECT address FROM email_addresses WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Adresse introuvable' });
    await req.guildDb('DELETE FROM email_addresses WHERE id = ?', [id]);
    // Tickets that came in on it reply from the main address again
    await req.guildDb('UPDATE email_threads SET via_address_id = NULL WHERE via_address_id = ?', [id]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'email_address_remove', details: { address: row.address } });
    res.json(await addressesView(req.guildDb));
  } catch (err) { next(err); }
});

module.exports = router;

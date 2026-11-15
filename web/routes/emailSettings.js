// Tickets by e-mail, settings of the server (founders): GET / PUT / POST /test. Passwords are
// never sent back (only whether they are set); changes go to the server's journal.
const express = require('express');
const router = express.Router();
const email = require('../../utils/emailTickets');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const view = s => ({
  enabled: !!s.enabled, address: s.address || '', displayName: s.display_name || '',
  imapHost: s.imap_host || '', imapPort: s.imap_port || 993, imapUser: s.imap_user || '', imapPasswordSet: !!s.imap_password_set,
  smtpHost: s.smtp_host || '', smtpPort: s.smtp_port || 587, smtpUser: s.smtp_user || '', smtpPasswordSet: !!s.smtp_password_set,
  lastFetchAt: s.last_fetch_at || null, lastError: s.last_error || null,
});

router.get('/', async (req, res, next) => {
  try { res.json(view(await email.emailSettings(req.guildDb))); } catch (err) { next(err); }
});

router.put('/', async (req, res, next) => {
  try {
    const { value, error } = await email.saveEmailSettings(req.guildDb, req.body || {});
    if (error) return res.status(400).json({ error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'email_settings', details: { enabled: value.enabled, address: value.address || null } });
    res.json(view(value));
  } catch (err) { next(err); }
});

router.post('/test', async (req, res, next) => {
  try { res.json(await email.testEmailSettings(req.guildDb)); } catch (err) { next(err); }
});

module.exports = router;

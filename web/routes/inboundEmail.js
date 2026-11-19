// Incoming e-mails pushed by a provider (utils/inboundEmail.js), public:
//   POST /api/inbound/:provider/:token
// Mounted before the CSRF guard and the body parsers of the app: providers send JSON, forms,
// multipart (with the attachments) or SNS text, up to the size of an e-mail. The answer is 2xx as
// soon as the message is taken (or deliberately skipped); 4xx tells the provider something is
// wrong with the request (it shows it in its logs), never what exists or not.
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const inbound = require('../../utils/inboundEmail');
const { allowBurst } = require('../../utils/rateLimit');

const LIMIT = '15mb';
const upload = multer({ storage: multer.memoryStorage(), defParamCharset: 'utf8', limits: { fileSize: 10 * 1024 * 1024, files: 20, fields: 200, fieldSize: 12 * 1024 * 1024 } }).any();
const parsers = [
  express.json({ limit: LIMIT }),
  express.urlencoded({ extended: false, limit: LIMIT }),
  express.text({ type: ['text/plain'], limit: LIMIT }), // SNS (Amazon SES)
  (req, res, next) => (req.is('multipart/form-data') ? upload(req, res, e => (e ? res.status(413).json({ error: 'Message trop volumineux' }) : next())) : next()),
];

router.post('/:provider/:token', async (req, res, next) => {
  // Before reading anything: guessing URLs or flooding is capped per address
  const ip = crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 24);
  if (!(await allowBurst(`inboundip:${ip}`, 120, 60 * 1000))) return res.status(429).json({ error: 'Trop de requêtes' });
  next();
}, ...parsers, async (req, res) => {
  const { provider, token } = req.params;
  let space = null;
  try {
    space = await inbound.resolve(provider, token);
    if (!space) return res.status(404).json({ error: 'Adresse de réception inconnue' });
    if (!(await allowBurst(`inbound:${space.guildId}`, 600, 3600 * 1000))) return res.status(429).json({ error: 'Trop de messages pour cet espace' });
    const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
    let mail;
    if (provider === 'mailgun') mail = await inbound.mailgun(body, req.files, space.secret);
    else if (provider === 'postmark') mail = await inbound.postmark(body);
    else if (provider === 'sendgrid') mail = await inbound.sendgrid(body);
    else {
      const r = await inbound.ses(typeof req.body === 'string' ? req.body : body, space.s.inbound_topic);
      if (r.confirmed) return res.json({ ok: true, subscribed: true });
      if (r.ignored) return res.json({ ok: true, ignored: r.ignored });
      mail = r.mail;
    }
    const result = await require('../../utils/emailTickets').processEmail(req.app.locals.client, space.guildId, mail, space.s);
    await space.db('UPDATE email_settings SET last_inbound_at = NOW(), last_error = NULL WHERE id = 1').catch(() => null);
    res.json({ ok: true, ...(result?.ticketId ? { ticket: result.ticketId } : {}), ...(result?.skipped ? { skipped: result.skipped } : {}), ...(result?.quarantined ? { quarantined: true } : {}) });
  } catch (err) {
    const status = err.status || 500;
    if (space) await space.db('UPDATE email_settings SET last_error = ? WHERE id = 1', [`Réception (${inbound.LABELS[provider]}) : ${err.message}`.slice(0, 300)]).catch(() => null);
    if (status >= 500) console.error('inbound e-mail:', provider, err.message);
    res.status(status).json({ error: status >= 500 ? 'Erreur serveur' : err.message });
  }
});

module.exports = router;

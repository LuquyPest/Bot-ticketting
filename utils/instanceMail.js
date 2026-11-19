// E-mail of the instance (Instance → Santé → E-mail de l'instance): the SMTP server used by
// Datick itself to write to people — invitations, sign-in links, password resets (v4,
// conception/v4.md §3.5). Distinct from the support mailboxes of each space (utils/emailTickets.js),
// with the same safety: public hosts only (EMAIL_ALLOW_PRIVATE_HOSTS=true for a local server),
// standard ports, password encrypted (secretBox) and never sent back.
const { getSetting, setSetting } = require('./instanceSettings');
const { seal, open } = require('./secretBox');
const { config } = require('./config');
const TEMPLATES = require('./locales/mails');

const KEY = 'instance_email';
const DEFAULTS = { enabled: false, host: null, port: 587, user: null, password: null, from: null, fromName: null };

async function mailSettings({ withSecret = false } = {}) {
  const s = await getSetting(KEY, DEFAULTS);
  const out = { ...DEFAULTS, ...s, passwordSet: !!s.password };
  if (withSecret) { try { out.password = s.password ? open(s.password) : null; } catch { out.password = null; } } else delete out.password;
  return out;
}

// input: { enabled, host, port, user, password, from, fromName } — an empty password keeps the saved one
async function saveMailSettings(input = {}) {
  const { EMAIL_RE, SMTP_PORTS } = require('./emailTickets');
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const host = str(input.host, 255).toLowerCase();
  const port = Number(input.port) || 587;
  const from = str(input.from, 254).toLowerCase();
  if (host && !(/^[a-z0-9.-]+$/.test(host) && host.includes('.'))) return { error: 'Serveur SMTP invalide' };
  if (!SMTP_PORTS.includes(port)) return { error: `Port SMTP accepté : ${SMTP_PORTS.join(', ')}` };
  if (from && !EMAIL_RE.test(from)) return { error: 'Adresse d\'expéditeur invalide' };
  const current = await getSetting(KEY, DEFAULTS);
  const next = {
    enabled: input.enabled === true, host: host || null, port, user: str(input.user, 254) || null,
    password: typeof input.password === 'string' && input.password ? seal(input.password.slice(0, 500)) : current.password || null,
    from: from || null, fromName: str(input.fromName, 100) || null,
  };
  if (next.enabled && (!next.host || !next.from)) return { error: 'Pour activer, renseigne le serveur SMTP et l\'adresse d\'expéditeur' };
  await setSetting(KEY, next);
  return { value: await mailSettings() };
}

const appName = () => 'Datick';
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// { subject, text, html } of a template, in fr or en (English for any other language)
function renderMail(template, lang, vars = {}) {
  const dict = TEMPLATES[lang === 'fr' ? 'fr' : 'en'];
  const t = dict[template];
  if (!t) throw new Error(`Modèle d'e-mail inconnu : ${template}`);
  const all = { app: appName(), url: config.webServerBaseUrl || '', ...vars };
  const text = `${fill(t.text, all)}\n\n— ${fill(dict.footer, all)}`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.55;color:#1f2330;max-width:560px">${
    escapeHtml(text).split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join('')}</div>`;
  return { subject: fill(t.subject, all), text, html };
}

// Sends one of the templates; throws a readable error if the instance e-mail is off or fails
async function sendInstanceMail({ to, template, lang = 'fr', vars = {}, attachments = [] }) {
  const s = await mailSettings({ withSecret: true });
  if (!s.enabled) throw Object.assign(new Error('L\'e-mail de l\'instance n\'est pas configuré (Instance → Santé)'), { status: 409 });
  const { EMAIL_RE, smtpTransport } = require('./emailTickets');
  if (!EMAIL_RE.test(String(to || ''))) throw Object.assign(new Error('Adresse du destinataire invalide'), { status: 400 });
  const mail = renderMail(template, lang, vars);
  const transport = await smtpTransport({ smtp_host: s.host, smtp_port: s.port, smtp_user: s.user, smtp_password: s.password });
  try {
    await transport.sendMail({
      from: s.fromName ? { name: s.fromName, address: s.from } : s.from,
      to, subject: mail.subject, text: mail.text, html: mail.html, ...(attachments.length ? { attachments } : {}),
      headers: { 'Auto-Submitted': 'auto-generated' },
    });
  } finally { transport.close?.(); }
  return { ok: true };
}

module.exports = { mailSettings, saveMailSettings, renderMail, sendInstanceMail, KEY };

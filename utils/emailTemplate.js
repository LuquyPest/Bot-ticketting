// E-mail template of a space (v7, conception/v7.md §3.6): what the e-mails sent to the requesters
// look like (replies of the staff and automatic messages, when « formatted with the space's
// colours » is on) — a logo and a colour of their own (else those of the member space), a header
// above the message and a footer below it (markdown: bold, links). Previewed before saving.
const { parseJsonField } = require('./jsonField');

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const LOGO_RE = /^https:\/\/[^\s"'<>]{1,490}$/;
const MAX_TEXT = 1000;

async function getTemplate(db) {
  const [c] = await db('SELECT email_template FROM guild_config WHERE id = 1').catch(() => []);
  const t = parseJsonField(c?.email_template, {}) || {};
  return { logo: t.logo || '', color: t.color || '', header: t.header || '', footer: t.footer || '' };
}
function clean(input = {}) {
  const v = {};
  const str = k => (typeof input[k] === 'string' ? input[k].trim() : '');
  v.logo = str('logo');
  if (v.logo && !LOGO_RE.test(v.logo)) return { error: 'Logo : une adresse https://' };
  v.color = str('color');
  if (v.color && !COLOR_RE.test(v.color)) return { error: 'Couleur : au format #rrggbb' };
  v.header = str('header').slice(0, MAX_TEXT);
  v.footer = str('footer').slice(0, MAX_TEXT);
  return { value: v };
}
async function saveTemplate(db, input) {
  const r = clean(input);
  if (r.error) return r;
  const empty = !Object.values(r.value).some(Boolean);
  await db('UPDATE guild_config SET email_template = ? WHERE id = 1', [empty ? null : JSON.stringify(r.value)]);
  return { ok: true };
}
// The brand of utils/emailTickets.js, with the template's choices over the defaults
function apply(brand, t) {
  return { ...brand, ...(t.logo ? { logo: t.logo } : {}), ...(t.color ? { color: t.color } : {}), ...(t.header ? { header: t.header } : {}), ...(t.footer ? { footer: t.footer } : {}) };
}
// An example e-mail with this template (draft, or the saved one)
async function preview(db, guildId, draft = null) {
  const t = draft ? clean(draft) : { value: await getTemplate(db) };
  if (t.error) return t;
  const [cfg] = await db('SELECT portal_color, portal_logo FROM guild_config WHERE id = 1').catch(() => []);
  const [g] = await require('./globalDb').globalQuery('SELECT guild_name FROM guilds WHERE guild_id = ?', [guildId]).catch(() => []);
  const base = { name: g?.guild_name || 'Support', logo: cfg?.portal_logo, color: cfg?.portal_color, footer: require('./i18n').t('email.replyFooter') };
  const { renderPayload } = require('./emailTickets');
  const sample = { content: 'Bonjour,\n\nNous avons bien reçu votre demande et nous la traitons. Pouvez-vous nous dire **depuis quand** le problème se produit ?\n\nBonne journée,' };
  return { html: renderPayload(sample, { brand: apply(base, t.value), signatures: ['L\'équipe support'] }).html };
}

module.exports = { getTemplate, saveTemplate, apply, preview, clean };

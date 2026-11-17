// Language of the bot for the staff: replies to commands and buttons, messages posted in ticket
// channels and log channels. Server setting guild_config.staff_language (Paramètres → Général):
// fr, en, es, de, it, pt, or « auto » — the Discord language of the person for a reply only they
// see, the server's language (its Discord « preferred locale ») for a message everyone sees.
// Independent of the language used with members (utils/i18n.js). Texts: utils/locales/staff.js.
const STRINGS = require('./locales/staff');

const LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt'];
const LOCALES = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-BR' };
const fromLocale = locale => { const p = String(locale || '').toLowerCase().slice(0, 2); return LANGS.includes(p) ? p : 'en'; };

const cache = new Map(); // guildId → { at, setting }
const TTL_MS = 60 * 1000;
async function staffSetting(guildId) {
  const c = cache.get(guildId);
  if (c && Date.now() - c.at < TTL_MS) return c.setting;
  let setting = 'fr';
  try {
    const [row] = await require('./tenantDb').getTenantDb(guildId)('SELECT staff_language FROM guild_config WHERE id = 1');
    if ([...LANGS, 'auto'].includes(row?.staff_language)) setting = row.staff_language;
  } catch { /* guild not ready: French */ }
  cache.set(guildId, { at: Date.now(), setting });
  return setting;
}
const clearStaffLangCache = guildId => cache.delete(guildId);

function translate(lang, key, vars = {}) {
  const entry = STRINGS[key];
  const s = entry ? (entry[LANGS.indexOf(lang)] ?? entry[1] ?? entry[0]) : key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

// L(key, vars) for a guild. locale: the Discord language of the reader (a reply only they see);
// without it, « auto » follows the server's preferred locale.
async function staffT(guildId, { locale = null, client = null } = {}) {
  const setting = guildId ? await staffSetting(guildId) : 'fr';
  const preferred = client?.guilds?.cache?.get(guildId)?.preferredLocale;
  const lang = setting !== 'auto' ? setting : locale ? fromLocale(locale) : preferred ? fromLocale(preferred) : 'fr';
  const L = (key, vars) => translate(lang, key, vars);
  L.lang = lang;
  L.locale = LOCALES[lang];
  L.time = (d = new Date()) => d.toLocaleTimeString(LOCALES[lang], { hour: '2-digit', minute: '2-digit' });
  return L;
}

// For an interaction: reply seen by the person (their Discord language in « auto »)
const forInteraction = (interaction, { shared = false } = {}) =>
  staffT(interaction.guildId, { locale: shared ? null : interaction.locale, client: interaction.client });

// Every translation of a key (to recognise a marker whatever the language it was written in)
const allTranslations = key => [...new Set(STRINGS[key] || [])];

module.exports = { staffT, forInteraction, translate, clearStaffLangCache, allTranslations, LANGS, STRINGS };

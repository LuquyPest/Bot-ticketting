// Web widget (utils/webWidget.js):
//   GET  /widget.js                       → script to paste on a site (floating button, or inline)
//   GET  /widget/:token                   → the form, a standalone page shown in an iframe
//   POST /api/widget/:token/tickets       → opens the ticket (public, anti-spam)
//   GET / PUT /api/widget-settings, POST /api/widget-settings/token → Paramètres (founders)
const express = require('express');
const crypto = require('crypto');
const widget = require('../../utils/webWidget');
const { t, withLang, LANGS, rememberLocale } = require('../../utils/i18n');
const { allowBurst } = require('../../utils/rateLimit');
const { config } = require('../../utils/config');

const base = () => (config.webServerBaseUrl || '').replace(/\/$/, '');
const COLOR_RE = /^#[0-9a-f]{3,8}$/i;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const langOf = req => {
  const picked = String(req.query?.lang || req.get('X-Member-Lang') || '').toLowerCase();
  if (LANGS.includes(picked)) return picked;
  return req.get('Accept-Language') ? (req.acceptsLanguages(...LANGS) || 'en') : 'fr';
};
const mailReady = async () => !!(await require('../../utils/instanceMail').mailSettings().catch(() => ({}))).enabled;

// ── Public pages ──
const pages = express.Router();

const SCRIPT = `(function(){var s=document.currentScript;if(!s)return;var t=s.getAttribute('data-datick-widget');if(!t)return;
var base=new URL(s.src).origin,label=s.getAttribute('data-label')||'Support',lang=s.getAttribute('data-lang')||'',color=s.getAttribute('data-color')||'';
if(!/^#[0-9a-f]{3,8}$/i.test(color))color='#5865f2';
var src=base+'/widget/'+encodeURIComponent(t)+(lang?'?lang='+encodeURIComponent(lang):'');
function frame(css){var f=document.createElement('iframe');f.src=src;f.title=label;f.setAttribute('loading','lazy');f.style.cssText=css;return f;}
if(s.getAttribute('data-mode')==='inline'){s.parentNode.insertBefore(frame('width:100%;height:'+(parseInt(s.getAttribute('data-height'),10)||560)+'px;border:0;border-radius:12px'),s.nextSibling);return;}
var b=document.createElement('button'),f=null;b.type='button';b.textContent=label;b.setAttribute('aria-expanded','false');
b.style.cssText='position:fixed;bottom:20px;right:20px;z-index:2147483646;padding:12px 18px;border:0;border-radius:999px;background:'+color+';color:#fff;font:600 14px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer';
b.onclick=function(){if(!f){f=frame('position:fixed;bottom:76px;right:20px;width:min(380px,calc(100vw - 40px));height:min(580px,calc(100vh - 100px));border:0;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.3);z-index:2147483647;background:#fff');document.body.appendChild(f);b.setAttribute('aria-expanded','true');return;}
var hidden=f.style.display==='none';f.style.display=hidden?'block':'none';b.setAttribute('aria-expanded',String(hidden));};
if(document.body)document.body.appendChild(b);else document.addEventListener('DOMContentLoaded',function(){document.body.appendChild(b);});})();`;

pages.get('/widget.js', (req, res) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('application/javascript').send(SCRIPT);
});

function page({ lang, nonce, title, body, color }) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style nonce="${nonce}">
:root{--bg:#fff;--fg:#1f2330;--muted:#5d6478;--line:#d6d9e0;--accent:${color}}
@media (prefers-color-scheme:dark){:root{--bg:#16181f;--fg:#eceef3;--muted:#a3a9b8;--line:#343846}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{padding:18px}h1{font-size:17px;margin:0 0 12px}label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}
input,select,textarea{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--fg);font:inherit}
textarea{min-height:120px;resize:vertical}button{margin-top:14px;width:100%;padding:11px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-weight:600;font-size:14px;cursor:pointer}
button:disabled{opacity:.6}.note{font-size:12px;color:var(--muted);margin-top:10px}.msg{padding:10px 12px;border-radius:10px;margin-top:12px}
.err{background:rgba(220,38,38,.12);color:#dc2626}.ok{background:rgba(22,163,74,.12)}.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
</style></head><body><main>${body}</main></body></html>`;
}

pages.get('/widget/:token', async (req, res, next) => {
  const lang = langOf(req);
  const nonce = crypto.randomBytes(16).toString('base64');
  try {
    const w = await widget.resolveToken(req.params.token);
    const [cfg] = w ? await w.db('SELECT portal_color FROM guild_config WHERE id = 1').catch(() => []) : [];
    const color = COLOR_RE.test(cfg?.portal_color || '') ? cfg.portal_color : '#5865f2';
    const ready = w && await mailReady();
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors ${ready ? widget.frameAncestors(w.settings.origins) : '*'}`);
    res.removeHeader('X-Frame-Options');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    const L = (k, v) => withLang(lang, () => t(k, v));
    if (!ready) return res.status(404).type('html').send(page({ lang, nonce, color, title: L('widget.title'), body: `<p>${esc(L('widget.unavailable'))}</p>` }));
    const [space] = await require('../../utils/globalDb').globalQuery('SELECT guild_name FROM guilds WHERE guild_id = ?', [w.guildId]);
    const { subjects } = await require('../../utils/memberPortal').openingForm(w.guildId);
    const body = `<h1>${esc(L('widget.title'))}${space?.guild_name ? ` · ${esc(space.guild_name)}` : ''}</h1>
<form id="f" novalidate>
<label for="n">${esc(L('widget.name'))}</label><input id="n" name="name" maxlength="100" autocomplete="name">
<label for="e">${esc(L('widget.email'))}</label><input id="e" name="email" type="email" maxlength="254" required autocomplete="email">
${subjects.length ? `<label for="s">${esc(L('widget.subject'))}</label><select id="s" name="subject" required><option value=""></option>${subjects.map(s => `<option>${esc(s)}</option>`).join('')}</select>` : ''}
<label for="m">${esc(L('widget.message'))}</label><textarea id="m" name="message" maxlength="2000" required></textarea>
<div class="hp" aria-hidden="true"><label for="w">Website</label><input id="w" name="website" tabindex="-1" autocomplete="off"></div>
<input type="hidden" name="t" value="${esc(widget.stamp(w.guildId))}">
<button id="b" type="submit">${esc(L('widget.send'))}</button>
<p class="note">${esc(L('widget.privacy'))}</p><div id="r" role="status" aria-live="polite"></div>
</form>
<script nonce="${nonce}">
document.getElementById('f').addEventListener('submit',function(ev){ev.preventDefault();var f=ev.target,b=document.getElementById('b'),r=document.getElementById('r');
var data={};new FormData(f).forEach(function(v,k){data[k]=v;});b.disabled=true;r.className='';r.textContent='';
fetch(${JSON.stringify(`/api/widget/${req.params.token}/tickets`)},{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest','X-Member-Lang':${JSON.stringify(lang)}},body:JSON.stringify(data)})
.then(function(x){return x.json().then(function(j){return{ok:x.ok,j:j};});}).then(function(x){
if(x.ok){f.innerHTML='';var p=document.createElement('p');p.className='msg ok';p.textContent=${JSON.stringify(L('widget.sent'))};f.appendChild(p);return;}
r.className='msg err';r.textContent=(x.j&&x.j.error)||'Erreur';b.disabled=false;})
.catch(function(){r.className='msg err';r.textContent=${JSON.stringify(L('portal.serverError'))};b.disabled=false;});});
</script>`;
    res.type('html').send(page({ lang, nonce, color, title: L('widget.title'), body }));
  } catch (err) { next(err); }
});

// ── Public API ──
const api = express.Router();

api.post('/:token/tickets', async (req, res) => {
  const lang = langOf(req);
  const L = (k, v) => withLang(lang, () => t(k, v));
  try {
    const w = await widget.resolveToken(req.params.token);
    if (!w || !(await mailReady())) return res.status(404).json({ error: L('widget.unavailable') });
    const { guildId, db } = w;
    const b = req.body || {};
    // Hidden field filled in: a robot, answered as if it worked
    if (typeof b.website === 'string' && b.website.trim()) return res.json({ ok: true });
    const stampErr = widget.stampProblem(guildId, b.t);
    if (stampErr) return res.status(400).json({ error: L(stampErr === 'tooFast' ? 'widget.tooFast' : 'widget.expired') });
    const { EMAIL_RE } = require('../../utils/emailTickets');
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: L('portal.badEmail') });
    const message = typeof b.message === 'string' ? b.message.trim() : '';
    if (!message || message.length > 2000) return res.status(400).json({ error: L('portal.describe') });
    const name = typeof b.name === 'string' ? b.name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100) : '';
    const { subjects } = await require('../../utils/memberPortal').openingForm(guildId);
    const subject = typeof b.subject === 'string' ? b.subject.trim().slice(0, 100) : '';
    if (subjects.length && !subjects.includes(subject)) return res.status(400).json({ error: L('portal.pickSubject') });

    const web = require('../../utils/webRequesters');
    const ownerId = web.webOwnerIdFor(email);
    if (await require('../../utils/guildScan').isBlacklistedIn(db, ownerId)) return res.status(403).json({ error: L('portal.blocked') });
    // Per IP, per address, and for the whole space (shared with the member space sign-ins by e-mail)
    const ipKey = crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 24);
    if (!(await allowBurst(`widgetip:${guildId}:${ipKey}`, 5, 3600 * 1000))
      || !(await allowBurst(`widgetaddr:${ownerId}`, 3, 3600 * 1000))
      || !(await allowBurst(`webnew:${guildId}`, 60, 3600 * 1000))) return res.status(429).json({ error: L('widget.tooMany') });
    const [cfg] = await db('SELECT max_tickets_per_day FROM guild_config WHERE id = 1');
    const client = req.app.locals.client;
    const maxPerDay = cfg?.max_tickets_per_day ?? 3;
    const tm = require('../../utils/ticketManager').createManager(db, client, guildId);
    if (await tm.getDailyTicketCount(ownerId) >= maxPerDay) return res.status(429).json({ error: L('portal.dailyLimit', { max: maxPerDay }) });

    await web.rememberAddress(db, ownerId, email);
    await rememberLocale(ownerId, lang);
    const user = web.webUserFor(ownerId, email, guildId, name);
    const startedAt = new Date(Date.now() - 1000);
    await withLang(lang, () => require('../../events/messageCreate').openTicketInGuild(user, message, [], guildId, client, subject, // '' = no subject (null would ask for one)
      { skipFaq: true, fieldsDone: true, intakeDone: true }));
    const [ticket] = await db('SELECT id FROM tickets WHERE owner_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 1', [ownerId, startedAt]);
    if (!ticket) return res.status(409).json({ error: L('portal.openFailed') });
    res.json({ ok: true });
  } catch (err) {
    console.error('widget ticket error:', err.message);
    res.status(500).json({ error: L('portal.serverError') });
  }
});

// ── Settings (founders) ──
const settings = express.Router();
const { recordEvent, dashboardActor } = require('../../utils/audit');

const view = async (req) => {
  const s = await widget.settingsOf(req.guildDb);
  return { enabled: s.enabled, token: s.token, origins: s.origins, snippet: s.token ? widget.snippet(base(), s.token) : null, url: s.token ? `${base()}/widget/${s.token}` : null, mailReady: await mailReady() };
};

settings.get('/', async (req, res, next) => {
  try { res.json(await view(req)); } catch (err) { next(err); }
});

settings.put('/', async (req, res, next) => {
  try {
    const r = await widget.saveSettings(req.guildDb, req.guildId, { enabled: req.body?.enabled === true, origins: req.body?.origins ?? '' });
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'widget_settings', details: { enabled: req.body?.enabled === true, origins: widget.parseOrigins(req.body?.origins ?? '').length } });
    res.json(await view(req));
  } catch (err) { next(err); }
});

// A new public token: the code pasted on the sites stops working until replaced
settings.post('/token', async (req, res, next) => {
  try {
    await widget.regenerateToken(req.guildDb, req.guildId);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'widget_token', details: null });
    res.json(await view(req));
  } catch (err) { next(err); }
});

module.exports = { pages, api, settings };

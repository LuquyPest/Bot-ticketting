// Web widget (utils/webWidget.js):
//   GET  /widget.js                       → script to paste on a site (floating button, or inline)
//   GET  /widget/:token                   → the form, a standalone page shown in an iframe
//   POST /api/widget/:token/tickets       → opens the ticket (public, anti-spam)
//   GET  /api/widget/:token/suggest?q=    → public articles of the knowledge base matching the message
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
.kb{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px}.kb p{margin:0 0 6px;font-size:12px;color:var(--muted)}.kb ul{margin:0;padding-left:18px}.kb a{color:var(--fg)}
.err{background:rgba(220,38,38,.12);color:#dc2626}.ok{background:rgba(22,163,74,.12)}.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.tabs{display:flex;gap:6px;margin:0 0 6px}.tabs button{margin:0;padding:8px;background:transparent;color:var(--fg);border:1px solid var(--line);font-weight:500}.tabs button[aria-pressed=true]{background:var(--accent);color:#fff;border-color:var(--accent)}
.log{display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;padding:4px 0;margin:8px 0}.b{max-width:85%;padding:8px 10px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}
.b.v{align-self:flex-end;background:var(--accent);color:#fff}.b.s{align-self:flex-start;border:1px solid var(--line)}.who{display:block;font-size:11px;opacity:.75;margin-bottom:2px}
.bbtn{display:flex;flex-wrap:wrap;gap:6px}.bbtn button,.bbtn a{margin:0;width:auto;padding:7px 11px;border:1px solid var(--accent);background:transparent;color:var(--fg);border-radius:999px;font-weight:500;font-size:13px;text-decoration:none}
.row{display:flex;gap:6px}.row textarea{min-height:44px;flex:1}.row button{width:auto;margin:0;padding:0 14px}.link{background:none;border:0;color:var(--muted);text-decoration:underline;width:auto;padding:0;margin-top:8px;font-weight:400;font-size:12px}
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
    const rules = await require('../../utils/requesterFiles').uploadRules(w.db);
    const tree = await require('../../utils/widgetBot').publicTree(w.db, w.guildId).catch(() => null);
    const body = `<h1>${esc(L('widget.title'))}${space?.guild_name ? ` · ${esc(space.guild_name)}` : ''}</h1>
${tree ? `<section id="bot" aria-live="polite"><div id="bl" class="log"></div><div id="bb" class="bbtn"></div><button type="button" id="bh" class="link">${esc(L('widget.botTalk'))}</button></section>
<script type="application/json" id="bt">${JSON.stringify(tree).replace(/</g, '\\u003c')}</script>` : ''}
<div id="tabs" class="tabs" hidden><button type="button" id="tc" aria-pressed="false">${esc(L('widget.chatStart'))}</button><button type="button" id="tf" aria-pressed="true">${esc(L('widget.chatForm'))}</button></div>
<p id="ci" class="note" hidden>${esc(L('widget.chatIntro'))}</p>
<section id="cv" hidden aria-label="${esc(L('widget.chatStart'))}"><div id="log" class="log" role="log" aria-live="polite"></div><p id="cw" class="note">${esc(L('widget.chatWaiting'))}</p>
<div class="row"><textarea id="ct" maxlength="2000" aria-label="${esc(L('widget.chatPlaceholder'))}" placeholder="${esc(L('widget.chatPlaceholder'))}"></textarea><button type="button" id="cs">${esc(L('widget.chatSend'))}</button></div>
<button type="button" id="ce" class="link">${esc(L('widget.chatEnd'))}</button><div id="cr" role="status" aria-live="polite"></div></section>
<form id="f" novalidate>
<label for="n">${esc(L('widget.name'))}</label><input id="n" name="name" maxlength="100" autocomplete="name">
<label for="e">${esc(L('widget.email'))}</label><input id="e" name="email" type="email" maxlength="254" required autocomplete="email">
${subjects.length ? `<label for="s">${esc(L('widget.subject'))}</label><select id="s" name="subject" required><option value=""></option>${subjects.map(s => `<option>${esc(s)}</option>`).join('')}</select>` : ''}
<label for="m">${esc(L('widget.message'))}</label><textarea id="m" name="message" maxlength="2000" required></textarea>
${rules.enabled ? `<label for="fi">${esc(L('widget.files', { max: 3, mb: rules.maxMb }))}</label><input id="fi" name="files" type="file" multiple>` : ''}
<div id="k" class="kb" hidden><p>${esc(L('widget.maybe'))}</p><ul id="kl"></ul></div>
<div class="hp" aria-hidden="true"><label for="w">Website</label><input id="w" name="website" tabindex="-1" autocomplete="off"></div>
<input type="hidden" name="t" value="${esc(widget.stamp(w.guildId))}"><input type="hidden" name="path" id="bp">
<button id="b" type="submit">${esc(L('widget.send'))}</button>
<p class="note">${esc(L('widget.privacy'))}</p><div id="r" role="status" aria-live="polite"></div>
</form>
<script nonce="${nonce}">
(function(){var m=document.getElementById('m'),k=document.getElementById('k'),kl=document.getElementById('kl'),tm=null,last='';
m.addEventListener('input',function(){clearTimeout(tm);tm=setTimeout(function(){var q=m.value.trim();if(q.length<8||q===last)return;last=q;
fetch(${JSON.stringify(`/api/widget/${req.params.token}/suggest?q=`)}+encodeURIComponent(q)).then(function(x){return x.json();}).then(function(list){
kl.textContent='';(Array.isArray(list)?list:[]).forEach(function(a){var li=document.createElement('li'),l=document.createElement('a');l.href=a.url;l.target='_blank';l.rel='noopener';l.textContent=a.question;li.appendChild(l);kl.appendChild(li);});
k.hidden=!kl.children.length;}).catch(function(){});},600);});})();
document.getElementById('f').addEventListener('submit',function(ev){ev.preventDefault();var f=ev.target,b=document.getElementById('b'),r=document.getElementById('r');
var fd=new FormData(f),fi=document.getElementById('fi');if(fi&&fi.files.length>3){r.className='msg err';r.textContent=${JSON.stringify(L('widget.tooManyFiles', { max: 3 }))};return;}b.disabled=true;r.className='';r.textContent='';
fetch(${JSON.stringify(`/api/widget/${req.params.token}/tickets`)},{method:'POST',headers:{'X-Requested-With':'XMLHttpRequest','X-Member-Lang':${JSON.stringify(lang)}},body:fd})
.then(function(x){return x.json().then(function(j){return{ok:x.ok,j:j};});}).then(function(x){
if(x.ok){f.innerHTML='';var p=document.createElement('p');p.className='msg ok';p.textContent=${JSON.stringify(L('widget.sent'))};f.appendChild(p);return;}
r.className='msg err';r.textContent=(x.j&&x.j.error)||'Erreur';b.disabled=false;})
.catch(function(){r.className='msg err';r.textContent=${JSON.stringify(L('portal.serverError'))};b.disabled=false;});});
(function(){var bt=document.getElementById('bt');if(!bt)return;var tree;try{tree=JSON.parse(bt.textContent);}catch(e){return;}
var f=document.getElementById('f'),tabs=document.getElementById('tabs'),bot=document.getElementById('bot'),bl=document.getElementById('bl'),bb=document.getElementById('bb'),bp=document.getElementById('bp'),path=[];
window.__bot=true;f.hidden=true;
function bubble(t,c){var d=document.createElement('div');d.className='b '+c;d.textContent=t;bl.appendChild(d);bl.scrollTop=bl.scrollHeight;}
function leave(kind){window.__bot=false;bot.hidden=true;f.hidden=false;bp.value=path.join(' › ');if(window.__chatOk){tabs.hidden=false;window.__setMode&&window.__setMode(kind==='form'?'form':'chat');}var m=document.getElementById('m');if(m)m.focus();}
function show(id){var n=tree.nodes.find(function(x){return x.id===id;});if(!n){leave('human');return;}bubble(n.text,'s');bb.textContent='';
n.buttons.forEach(function(b){var el;if(b.kind==='article'){el=document.createElement('a');el.href=b.url;el.target='_blank';el.rel='noopener';el.textContent=b.label;el.addEventListener('click',function(){path.push(b.label);});}
else{el=document.createElement('button');el.type='button';el.textContent=b.label;el.addEventListener('click',function(){path.push(b.label);bubble(b.label,'v');if(b.kind==='step')show(b.next);else leave(b.kind);});}bb.appendChild(el);});}
document.getElementById('bh').addEventListener('click',function(){leave('human');});show(tree.start);})();
(function(){var API=${JSON.stringify(`/api/widget/${req.params.token}/chat`)},H={'X-Requested-With':'XMLHttpRequest','X-Member-Lang':${JSON.stringify(lang)},'Content-Type':'application/json'};
var f=document.getElementById('f'),tabs=document.getElementById('tabs'),tc=document.getElementById('tc'),tf=document.getElementById('tf'),ci=document.getElementById('ci'),cv=document.getElementById('cv'),log=document.getElementById('log'),ct=document.getElementById('ct'),cr=document.getElementById('cr'),cw=document.getElementById('cw');
var mode='form',sid=null,last=0,timer=null,fi=document.getElementById('fi'),fiL=fi?document.querySelector('label[for=fi]'):null;
function setMode(m){mode=m;tc.setAttribute('aria-pressed',m==='chat');tf.setAttribute('aria-pressed',m!=='chat');ci.hidden=m!=='chat';if(fi){fi.hidden=m==='chat';fiL.hidden=m==='chat';}}
window.__setMode=setMode;fetch(API).then(function(x){return x.json();}).then(function(j){if(j&&j.available){window.__chatOk=true;if(!window.__bot)tabs.hidden=false;setMode('chat');}}).catch(function(){});
tc.addEventListener('click',function(){setMode('chat');});tf.addEventListener('click',function(){setMode('form');});
function add(list){(list||[]).forEach(function(m){if(m.id<=last)return;last=m.id;var d=document.createElement('div');d.className='b '+(m.from==='visitor'?'v':'s');
var w=document.createElement('span');w.className='who';w.textContent=m.from==='visitor'?${JSON.stringify(L('widget.chatYou'))}:(m.author||'Support');d.appendChild(w);d.appendChild(document.createTextNode(m.text));log.appendChild(d);if(m.from!=='visitor')cw.hidden=true;});log.scrollTop=log.scrollHeight;}
function stop(text){clearInterval(timer);timer=null;cv.querySelector('.row').hidden=true;document.getElementById('ce').hidden=true;cr.className='msg ok';cr.textContent=text;}
function poll(){fetch(API+'/'+sid+'?after='+last,{headers:H}).then(function(x){if(x.status===404){stop(${JSON.stringify(L('widget.chatEnded'))});return null;}return x.json();}).then(function(j){if(!j)return;add(j.messages);if(j.open===false)stop(${JSON.stringify(L('widget.chatClosed'))});}).catch(function(){});}
f.addEventListener('submit',function(ev){if(mode!=='chat')return;ev.preventDefault();ev.stopImmediatePropagation();var fd=new FormData(f),body={},r=document.getElementById('r'),b=document.getElementById('b');fd.forEach(function(v,k){if(typeof v==='string')body[k]=v;});b.disabled=true;r.className='';r.textContent='';
fetch(API,{method:'POST',headers:H,body:JSON.stringify(body)}).then(function(x){return x.json().then(function(j){return{ok:x.ok,j:j};});}).then(function(x){
if(!x.ok){r.className='msg err';r.textContent=(x.j&&x.j.error)||'Erreur';b.disabled=false;if(x.j&&x.j.error===${JSON.stringify(L('widget.chatOff'))}){tabs.hidden=true;setMode('form');}return;}
sid=x.j.session;f.hidden=true;tabs.hidden=true;ci.hidden=true;cv.hidden=false;add(x.j.messages);timer=setInterval(poll,3000);ct.focus();}).catch(function(){r.className='msg err';r.textContent=${JSON.stringify(L('portal.serverError'))};b.disabled=false;});},true);
function send(){var t=ct.value.trim();if(!t||!sid)return;ct.value='';fetch(API+'/'+sid,{method:'POST',headers:H,body:JSON.stringify({text:t,after:last})}).then(function(x){return x.json().then(function(j){return{ok:x.ok,j:j};});}).then(function(x){
if(!x.ok){cr.className='msg err';cr.textContent=(x.j&&x.j.error)||'Erreur';ct.value=t;return;}cr.textContent='';cr.className='';add(x.j.messages);}).catch(function(){ct.value=t;});}
document.getElementById('cs').addEventListener('click',send);ct.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
document.getElementById('ce').addEventListener('click',function(){if(!sid)return;fetch(API+'/'+sid+'/end',{method:'POST',headers:H}).catch(function(){});stop(${JSON.stringify(L('widget.chatClosed'))});});
})();
</script>`;
    res.type('html').send(page({ lang, nonce, color, title: L('widget.title'), body }));
  } catch (err) { next(err); }
});

// ── Public API ──
const api = express.Router();

// Before sending, the visitor may find their answer: only public articles, only if the page is on
api.get('/:token/suggest', async (req, res) => {
  try {
    const w = await widget.resolveToken(req.params.token);
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 2000) : '';
    const kb = require('../../utils/knowledgeBase');
    if (!w || !w.settings.enabled || !(await kb.kbEnabled(w.db))) return res.json([]);
    const matches = await require('../../utils/faq').findFaqMatches(w.db, q, 3, { publicOnly: true });
    res.json(matches.map(m => ({ id: m.id, question: m.question, url: kb.kbUrl(w.guildId, m.id) })));
  } catch (err) {
    console.error('widget suggest error:', err.message);
    res.json([]);
  }
});

// The form with files is sent as multipart (3 files at most)
const widgetUpload = (req, res, next) => (req.is('multipart/form-data')
  ? require('../../utils/requesterFiles').upload(3)(req, res, err => (err ? res.status(413).json({ error: withLang(langOf(req), () => t('portal.fileTooBig')) }) : next()))
  : next());
// Opens a ticket from the widget (form or chat): checks, limits, then like a DM → { ticketId, ownerId, user } or { status, error }
async function openFromWidget(req, w, lang, b, files = []) {
  const L = (k, v) => withLang(lang, () => t(k, v));
  const { guildId, db } = w;
  const stampErr = widget.stampProblem(guildId, b.t);
  if (stampErr) return { status: 400, error: L(stampErr === 'tooFast' ? 'widget.tooFast' : 'widget.expired') };
  const { EMAIL_RE } = require('../../utils/emailTickets');
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 254) return { status: 400, error: L('portal.badEmail') };
  const typed = typeof b.message === 'string' ? b.message.trim() : '';
  if (!typed || typed.length > 2000) return { status: 400, error: L('portal.describe') };
  // The steps of the question tree the visitor went through (v7, utils/widgetBot.js)
  const path = require('../../utils/widgetBot').cleanPath(b.path);
  const message = path ? `${typed}\n\n🧭 ${L('widget.botPath')} : ${path}` : typed;
  const name = typeof b.name === 'string' ? b.name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100) : '';
  const { subjects } = await require('../../utils/memberPortal').openingForm(guildId);
  const subject = typeof b.subject === 'string' ? b.subject.trim().slice(0, 100) : '';
  if (subjects.length && !subjects.includes(subject)) return { status: 400, error: L('portal.pickSubject') };

  const web = require('../../utils/webRequesters');
  const ownerId = web.webOwnerIdFor(email);
  if (await require('../../utils/guildScan').isBlacklistedIn(db, ownerId)) return { status: 403, error: L('portal.blocked') };
  // Per IP, per address, and for the whole space (shared with the member space sign-ins by e-mail)
  const ipKey = crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 24);
  if (!(await allowBurst(`widgetip:${guildId}:${ipKey}`, 5, 3600 * 1000))
    || !(await allowBurst(`widgetaddr:${ownerId}`, 3, 3600 * 1000))
    || !(await allowBurst(`webnew:${guildId}`, 60, 3600 * 1000))) return { status: 429, error: L('widget.tooMany') };
  const [cfg] = await db('SELECT max_tickets_per_day FROM guild_config WHERE id = 1');
  const client = req.app.locals.client;
  const maxPerDay = cfg?.max_tickets_per_day ?? 3;
  const tm = require('../../utils/ticketManager').createManager(db, client, guildId);
  if (await tm.getDailyTicketCount(ownerId) >= maxPerDay) return { status: 429, error: L('portal.dailyLimit', { max: maxPerDay }) };

  await web.rememberAddress(db, ownerId, email);
  await rememberLocale(ownerId, lang);
  const user = web.webUserFor(ownerId, email, guildId, name);
  const startedAt = new Date(Date.now() - 1000);
  if (b.chat) await require('../../utils/redis').getRedis().set(`chatopen:${ownerId}`, '1', 'EX', 60).catch(() => null); // no « ticket created » e-mail for a chat
  await withLang(lang, () => require('../../events/messageCreate').openTicketInGuild(user, message, [], guildId, client, subject, // '' = no subject (null would ask for one)
    { skipFaq: true, fieldsDone: true, intakeDone: true }));
  const [ticket] = await db('SELECT id FROM tickets WHERE owner_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 1', [ownerId, startedAt]);
  if (!ticket) return { status: 409, error: L('portal.openFailed') };
  if (files.length) {
    const [full] = await db('SELECT * FROM tickets WHERE id = ?', [ticket.id]);
    await withLang(lang, () => require('../../utils/requesterFiles').addFiles({ db, guildId, tm, ticket: full, user, files })).catch(e => console.error('widget files:', e.message));
  }
  return { ticketId: ticket.id, ownerId, user, tm };
}

api.post('/:token/tickets', widgetUpload, async (req, res) => {
  const lang = langOf(req);
  const L = (k, v) => withLang(lang, () => t(k, v));
  try {
    const w = await widget.resolveToken(req.params.token);
    if (!w || !(await mailReady())) return res.status(404).json({ error: L('widget.unavailable') });
    const b = req.body || {};
    // Hidden field filled in: a robot, answered as if it worked
    if (typeof b.website === 'string' && b.website.trim()) return res.json({ ok: true });
    const r = await openFromWidget(req, w, lang, { ...b, chat: false }, Array.isArray(req.files) ? req.files : []);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true });
  } catch (err) {
    console.error('widget ticket error:', err.message);
    res.status(500).json({ error: L('portal.serverError') });
  }
});

// ── Live chat (utils/liveChat.js, v7) ──
const chat = require('../../utils/liveChat');
api.get('/:token/chat', async (req, res) => {
  try {
    const w = await widget.resolveToken(req.params.token);
    res.json({ available: !!w && w.settings.enabled && await mailReady() && await chat.available(w.db) });
  } catch { res.json({ available: false }); }
});
api.post('/:token/chat', async (req, res) => {
  const lang = langOf(req);
  const L = (k, v) => withLang(lang, () => t(k, v));
  try {
    const w = await widget.resolveToken(req.params.token);
    if (!w || !(await mailReady()) || !(await chat.available(w.db))) return res.status(409).json({ error: L('widget.chatOff') });
    const b = req.body || {};
    if (typeof b.website === 'string' && b.website.trim()) return res.status(409).json({ error: L('widget.chatOff') });
    const r = await openFromWidget(req, w, lang, { ...b, chat: true });
    if (r.error) return res.status(r.status).json({ error: r.error });
    const session = await chat.startSession(w.db, r.ticketId, r.ownerId);
    await require('../../utils/redis').getRedis().del(`chatopen:${r.ownerId}`).catch(() => null); // the session takes over
    res.json({ ok: true, session, messages: await chat.messages(w.db, r.ticketId) });
  } catch (err) {
    console.error('widget chat error:', err.message);
    res.status(500).json({ error: L('portal.serverError') });
  }
});
api.get('/:token/chat/:session', async (req, res) => {
  try {
    const w = await widget.resolveToken(req.params.token);
    const s = w ? await chat.sessionOf(w.db, req.params.session) : null;
    if (!s) return res.status(404).json({ error: 'Conversation terminée' });
    res.json({ open: s.status === 'open', messages: await chat.messages(w.db, s.ticket_id, req.query.after) });
  } catch { res.status(500).json({ error: 'Erreur' }); }
});
api.post('/:token/chat/:session', async (req, res) => {
  const lang = langOf(req);
  const L = (k, v) => withLang(lang, () => t(k, v));
  try {
    const w = await widget.resolveToken(req.params.token);
    const s = w ? await chat.sessionOf(w.db, req.params.session) : null;
    if (!s) return res.status(404).json({ error: L('widget.chatEnded') });
    if (s.status !== 'open') return res.status(409).json({ error: L('portal.closed') });
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 2000) return res.status(400).json({ error: L('portal.messageLength') });
    if (!(await allowBurst(`chatmsg:${s.owner_id}`, 20, 60 * 1000))) return res.status(429).json({ error: L('portal.tooManyMessages') });
    const [ticket] = await w.db('SELECT * FROM tickets WHERE id = ?', [s.ticket_id]);
    const [contact] = await w.db('SELECT address FROM email_contacts WHERE owner_id = ?', [s.owner_id]).catch(() => []);
    const user = require('../../utils/webRequesters').webUserFor(s.owner_id, contact?.address || '', w.guildId);
    const tm = require('../../utils/ticketManager').createManager(w.db, req.app.locals.client, w.guildId);
    const sent = await tm.relayToTicket(ticket, user, text, []);
    if (!sent) return res.status(409).json({ error: L('portal.notSent') });
    res.json({ ok: true, messages: await chat.messages(w.db, s.ticket_id, req.body?.after) });
  } catch (err) { console.error('widget chat message error:', err.message); res.status(500).json({ error: L('portal.serverError') }); }
});
api.post('/:token/chat/:session/end', async (req, res) => {
  try {
    const w = await widget.resolveToken(req.params.token);
    const s = w ? await chat.sessionOf(w.db, req.params.session) : null;
    if (s) await chat.endSession(w.db, s.id);
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

// ── Settings (founders) ──
const settings = express.Router();
const { recordEvent, dashboardActor } = require('../../utils/audit');

const view = async (req) => {
  const s = await widget.settingsOf(req.guildDb);
  return { enabled: s.enabled, token: s.token, origins: s.origins, chat: await chat.enabled(req.guildDb), snippet: s.token ? widget.snippet(base(), s.token) : null, url: s.token ? `${base()}/widget/${s.token}` : null, mailReady: await mailReady() };
};

settings.get('/', async (req, res, next) => {
  try { res.json(await view(req)); } catch (err) { next(err); }
});

settings.put('/', async (req, res, next) => {
  try {
    const r = await widget.saveSettings(req.guildDb, req.guildId, { enabled: req.body?.enabled === true, origins: req.body?.origins ?? '' });
    if (r.error) return res.status(400).json({ error: r.error });
    if (req.body?.chat !== undefined) await req.guildDb('UPDATE guild_config SET widget_chat = ? WHERE id = 1', [req.body.chat ? 1 : 0]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'widget_settings', details: { enabled: req.body?.enabled === true, origins: widget.parseOrigins(req.body?.origins ?? '').length } });
    res.json(await view(req));
  } catch (err) { next(err); }
});

// GET / PUT /api/widget-settings/bot — the question tree (utils/widgetBot.js, v7)
settings.get('/bot', async (req, res, next) => { try { res.json(await require('../../utils/widgetBot').getBot(req.guildDb)); } catch (err) { next(err); } });
settings.put('/bot', async (req, res, next) => {
  try {
    const B = require('../../utils/widgetBot');
    const r = await B.saveBot(req.guildDb, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'widget_bot', details: { enabled: !!req.body?.enabled, steps: (req.body?.nodes || []).length } });
    res.json(await B.getBot(req.guildDb));
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

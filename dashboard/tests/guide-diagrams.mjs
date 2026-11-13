// Annotated diagrams of the installation guide (docs/public/images/guide-*.png): simplified
// drawings of the pages to use (Discord developer portal, DNS), with numbered markers where to
// click. They are drawings, labelled as such — not screenshots of third-party sites.
//   node tests/guide-diagrams.mjs
import { chromium } from 'playwright-core';

const out = process.argv[2] || new URL('../../docs/public/images', import.meta.url).pathname;

const CSS = `
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, 'Segoe UI', system-ui, sans-serif; background: transparent; }
.frame { width: 920px; margin: 24px; border-radius: 10px; overflow: hidden; background: #111318; border: 1px solid #2a2f38; box-shadow: 0 20px 50px -20px rgba(0,0,0,.55); color: #d5d9e0; }
.bar { height: 40px; background: #1a1d23; border-bottom: 1px solid #2a2f38; display: flex; align-items: center; gap: 8px; padding: 0 14px; }
.bar i { width: 11px; height: 11px; border-radius: 50%; display: inline-block; background: #3a3f48; }
.url { margin-left: 12px; flex: 1; height: 24px; border-radius: 6px; background: #111318; border: 1px solid #2a2f38; color: #8a93a1; font-size: 12px; display: flex; align-items: center; padding: 0 10px; }
.tag { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #7aa7ff; border: 1px solid #2f6feb66; border-radius: 4px; padding: 2px 6px; }
.body { display: flex; min-height: 360px; }
.nav { width: 210px; background: #15181d; border-right: 1px solid #2a2f38; padding: 16px 10px; }
.nav .app { font-size: 13px; font-weight: 700; color: #fff; padding: 0 8px 12px; }
.nav div.item { font-size: 13px; padding: 8px 10px; border-radius: 6px; color: #9aa3b1; margin-bottom: 2px; position: relative; }
.nav div.item.on { background: #2f6feb22; color: #fff; }
.main { flex: 1; padding: 22px 26px; position: relative; }
h1 { font-size: 20px; margin: 0 0 4px; color: #fff; }
.sub { font-size: 12.5px; color: #8a93a1; margin-bottom: 18px; }
.lbl { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #8a93a1; margin: 16px 0 6px; }
.field { height: 36px; border-radius: 6px; background: #0c0e12; border: 1px solid #2a2f38; display: flex; align-items: center; padding: 0 12px; font-size: 13px; color: #c7ccd4; font-family: 'DejaVu Sans Mono', ui-monospace, monospace; position: relative; }
.row { display: flex; gap: 10px; align-items: center; }
.btn { height: 34px; padding: 0 14px; border-radius: 6px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; background: #2a2f38; color: #e6e9ee; position: relative; white-space: nowrap; }
.btn.primary { background: #2f6feb; color: #fff; }
.toggle { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border: 1px solid #2a2f38; border-radius: 8px; margin-bottom: 8px; position: relative; }
.toggle b { font-size: 13.5px; color: #fff; display: block; } .toggle span { font-size: 12px; color: #8a93a1; }
.sw { width: 40px; height: 22px; border-radius: 11px; background: #3a3f48; position: relative; flex: none; }
.sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; }
.sw.on { background: #2fb868; } .sw.on::after { left: 21px; }
.hl { box-shadow: 0 0 0 3px #111318, 0 0 0 5px #f5a524; }
.n { position: absolute; width: 24px; height: 24px; border-radius: 50%; background: #f5a524; color: #111; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 3px #111318; z-index: 2; }
.legend { padding: 14px 26px 18px; border-top: 1px solid #2a2f38; background: #15181d; font-size: 13px; color: #c7ccd4; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
.legend div { display: flex; gap: 10px; align-items: flex-start; line-height: 1.45; }
.legend .n { position: static; width: 20px; height: 20px; font-size: 11px; flex: none; box-shadow: none; }
.note { font-size: 11px; color: #6c7582; padding: 0 26px 14px; background: #15181d; }
.muted { opacity: .45; }
`;

const frame = (url, inner, legend) => `
<div class="frame">
  <div class="bar"><i></i><i></i><i></i><div class="url">${url}</div><span class="tag">Schéma</span></div>
  ${inner}
  <div class="legend">${legend.map((t, i) => `<div><span class="n">${i + 1}</span><span>${t}</span></div>`).join('')}</div>
  <div class="note">Dessin simplifié : l'apparence réelle du site peut légèrement différer, les noms des boutons sont les mêmes.</div>
</div>`;

const portalNav = active => `
<div class="nav">
  <div class="app">Mon bot</div>
  ${['General Information', 'Installation', 'OAuth2', 'Bot', 'Emojis'].map(x => `<div class="item ${x === active ? 'on' : ''}">${x}</div>`).join('')}
</div>`;

const card = (n, title, lines, steps) => `
  <div style="flex:1;border:1px solid #2a2f38;border-radius:10px;background:#15181d;padding:16px 18px;position:relative">
    <span class="n" style="position:static;display:inline-flex;margin-bottom:10px">${n}</span>
    <div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:8px">${title}</div>
    ${lines.map(l => `<div style="font-size:12.5px;color:#aab2bf;line-height:1.6">${l}</div>`).join('')}
    <div style="margin-top:12px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7aa7ff">${steps}</div>
  </div>`;
const arrow = label => `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:#8a93a1;font-size:11px;min-width:76px">
  <span>${label}</span><svg width="64" height="14" viewBox="0 0 64 14"><path d="M2 7h56M50 1l8 6-8 6" stroke="#f5a524" stroke-width="2" fill="none"/></svg></div>`;

const DIAGRAMS = {
  // Overview of what the guide sets up
  'guide-overview': `<div class="frame" style="width:960px"><div style="padding:22px 24px 20px">
    <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a93a1;margin-bottom:14px">Ce que tu vas mettre en place</div>
    <div style="display:flex;align-items:stretch">
      ${card('A', 'Ton domaine', ['<code style="color:#e6e9ee">tickets.example.com</code>', 'pointe vers ton serveur'], 'Étape 2')}
      ${arrow('HTTPS')}
      ${card('B', 'Ton serveur', ['Docker fait tourner :', 'le bot et son dashboard,', 'la base, Redis, Caddy,', 'les sauvegardes'], 'Étapes 1, 4, 5')}
      ${arrow('token')}
      ${card('C', 'Ton bot Discord', ['l\'application créée sur le', 'portail développeur, invitée', 'sur ton serveur Discord'], 'Étapes 3, 7')}
    </div>
  </div></div>`,
  // Discord developer portal — new application and its ID
  'guide-discord-app': frame('discord.com/developers/applications',
    `<div class="body">${portalNav('General Information')}
      <div class="main">
        <span class="n" style="top:14px;right:22px">1</span>
        <div class="row" style="justify-content:flex-end;margin-bottom:8px"><span class="btn primary hl">New Application</span></div>
        <h1>General Information</h1>
        <div class="sub">Nom, icône et description de ton application.</div>
        <div class="lbl">Name</div>
        <div class="field">Mon bot</div>
        <div class="lbl">Application ID</div>
        <div class="row"><div class="field" style="flex:1">123456789012345678</div><span class="btn hl" style="position:relative">Copy<span class="n" style="top:-14px;right:-14px">2</span></span></div>
        <div class="lbl">Public Key</div>
        <div class="field muted">••••••••••••••••••••••••••••••••</div>
      </div></div>`,
    ['<b>New Application</b> : donne un nom à ton bot, accepte les conditions, <b>Create</b>.', '<b>Application ID</b> : copie-le, <code>setup.sh</code> te le demandera.']),

  // Bot tab — token, public bot, intents
  'guide-discord-bot': frame('discord.com/developers/applications › Bot',
    `<div class="body">${portalNav('Bot')}
      <div class="main">
        <h1>Bot</h1>
        <div class="sub">Le compte du bot sur Discord.</div>
        <div class="lbl">Token</div>
        <div class="row"><div class="field" style="flex:1">••••••••••••••••••••••••••••••••••••</div><span class="btn primary hl" style="position:relative">Reset Token<span class="n" style="top:-14px;right:-14px">1</span></span></div>
        <div class="lbl">Authorization Flow</div>
        <div class="toggle hl"><div><b>Public Bot</b><span>N'importe qui peut ajouter ce bot à son serveur</span></div><div class="sw"></div><span class="n" style="top:-12px;right:-12px">2</span></div>
        <div class="lbl">Privileged Gateway Intents</div>
        <div class="toggle muted"><div><b>Presence Intent</b></div><div class="sw"></div></div>
        <div class="toggle hl"><div><b>Server Members Intent</b></div><div class="sw on"></div><span class="n" style="top:-12px;right:-12px">3</span></div>
        <div class="toggle hl"><div><b>Message Content Intent</b></div><div class="sw on"></div></div>
        <div class="row" style="justify-content:flex-end;margin-top:10px"><span class="btn primary hl" style="position:relative">Save Changes<span class="n" style="top:-14px;right:-14px">4</span></span></div>
      </div></div>`,
    ['<b>Reset Token</b> → copie le <b>token</b>. Il ne s\'affiche qu\'une fois.', '<b>Public Bot</b> : <b>désactivé</b>. Toi seul pourras inviter le bot.', '<b>Server Members</b> et <b>Message Content Intent</b> : <b>activés</b>. Sans eux, le bot ne lit pas les MP.', '<b>Save Changes</b> en bas de la page.']),

  // OAuth2 tab — client secret and redirect URL
  'guide-discord-oauth': frame('discord.com/developers/applications › OAuth2',
    `<div class="body">${portalNav('OAuth2')}
      <div class="main">
        <h1>OAuth2</h1>
        <div class="sub">Connexion « avec Discord » au dashboard.</div>
        <div class="lbl">Client information</div>
        <div class="row"><div class="field muted" style="flex:1">Client ID : 123456789012345678</div></div>
        <div class="row" style="margin-top:8px"><div class="field" style="flex:1">Client Secret : ••••••••••••••••••••••</div><span class="btn primary hl" style="position:relative">Reset Secret<span class="n" style="top:-14px;right:-14px">1</span></span></div>
        <div class="lbl">Redirects</div>
        <div class="field hl">https://tickets.example.com/api/auth/discord/callback<span class="n" style="top:-12px;right:-12px">2</span></div>
        <div class="row" style="margin-top:8px"><span class="btn">Add Another</span></div>
        <div class="row" style="justify-content:flex-end;margin-top:14px"><span class="btn primary hl" style="position:relative">Save Changes<span class="n" style="top:-14px;right:-14px">3</span></span></div>
      </div></div>`,
    ['<b>Reset Secret</b> → copie le <b>Client Secret</b>.', '<b>Add Redirect</b> : <code>https://</code><i>ton domaine</i><code>/api/auth/discord/callback</code>, exactement.', '<b>Save Changes</b>.']),

  // DNS record at the domain registrar
  'guide-dns': frame('ton fournisseur de domaine › Zone DNS',
    `<div class="body"><div class="main">
        <h1>Ajouter un enregistrement</h1>
        <div class="sub">Zone DNS de <b>example.com</b></div>
        <div class="row" style="gap:14px">
          <div style="width:120px"><div class="lbl">Type</div><div class="field hl" style="position:relative">A<span class="n" style="top:-12px;right:-12px">1</span></div></div>
          <div style="flex:1"><div class="lbl">Nom / sous-domaine</div><div class="field hl" style="position:relative">tickets<span class="n" style="top:-12px;right:-12px">2</span></div></div>
          <div style="flex:1"><div class="lbl">Valeur / cible</div><div class="field hl" style="position:relative">203.0.113.10<span class="n" style="top:-12px;right:-12px">3</span></div></div>
          <div style="width:110px"><div class="lbl">TTL</div><div class="field muted">3600</div></div>
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:26px"><span class="btn primary">Enregistrer</span></div>
      </div></div>`,
    ['Type <b>A</b> (adresse IPv4).', 'Le sous-domaine du dashboard : <b>tickets</b> donne <code>tickets.example.com</code>.', 'L\'<b>adresse IP de ton serveur</b> (celle donnée par ton hébergeur).']),
};

const b = await chromium.launch();
for (const [name, html] of Object.entries(DIAGRAMS)) {
  const page = await b.newPage({ viewport: { width: 980, height: 700 }, deviceScaleFactor: 2 });
  await page.setContent(`<style>${CSS}</style>${html}`);
  await page.locator('.frame').screenshot({ path: `${out}/${name}.png`, omitBackground: true });
  await page.close();
  console.log('✓', name);
}
await b.close();

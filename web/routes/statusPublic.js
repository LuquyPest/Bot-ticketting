// Public status page (utils/statusPage.js, v7), rendered by the server — it reads without JavaScript:
//   GET  /statut/:guildId                   the page (404 when the space has not turned it on)
//   POST /statut/:guildId/abonnement        e-mail subscription (form), confirmed by a link
//   GET  /statut/:guildId/confirmer?t=…     confirms it
//   GET  /statut/:guildId/desabonner?t=…    leaves
//   GET  /api/public/status/:guildId        the same data in JSON
const express = require('express');
const router = express.Router();
const S = require('../../utils/statusPage');
const { escapeHtml } = require('../../utils/emailFormat');
const { allowBurst } = require('../../utils/rateLimit');

const SNOWFLAKE = /^\d{17,20}$/;
async function spaceOf(guildId) {
  if (!SNOWFLAKE.test(String(guildId))) return null;
  const [g] = await require('../../utils/globalDb').globalQuery("SELECT guild_id, guild_name FROM guilds WHERE guild_id = ? AND status = 'active'", [guildId]).catch(() => []);
  return g ? { id: g.guild_id, name: g.guild_name, db: require('../../utils/tenantDb').getTenantDb(g.guild_id) } : null;
}
const LABELS = { operational: 'Opérationnel', degraded: 'Dégradé', partial_outage: 'Panne partielle', major_outage: 'Panne majeure', maintenance: 'Maintenance' };
const COLORS = { operational: '#16a34a', degraded: '#ca8a04', partial_outage: '#ea580c', major_outage: '#dc2626', maintenance: '#2563eb' };
const OVERALL = { operational: 'Tous les services fonctionnent', degraded: 'Certains services sont perturbés', partial_outage: 'Panne partielle en cours', major_outage: 'Panne majeure en cours', maintenance: 'Maintenance en cours' };
const fmt = d => new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' });
const e = escapeHtml;

function page(space, view, notice = '') {
  const title = view.title || space.name;
  const comps = view.components.map(c => `
    <section class="comp">
      <div class="row"><h3>${e(c.name)}</h3><span class="state" style="color:${COLORS[c.status]}">${e(LABELS[c.status])}</span></div>
      ${c.description ? `<p class="muted">${e(c.description)}</p>` : ''}
      <div class="bars" role="img" aria-label="Disponibilité sur 90 jours : ${c.availability.pct} %">${c.availability.days.map(d => `<span title="${e(d.day)} : ${d.pct} %" class="${d.down ? (d.pct < 95 ? 'bad' : 'warn') : 'ok'}"></span>`).join('')}</div>
      <div class="row muted small"><span>il y a 90 jours</span><span>${c.availability.pct} % de disponibilité</span><span>aujourd'hui</span></div>
    </section>`).join('');
  const inc = view.incidents.map(i => `
    <article class="inc">
      <h3>${e(i.title)} <span class="small ${i.resolvedAt ? 'muted' : 'open'}">${i.resolvedAt ? `résolu le ${e(fmt(i.resolvedAt))}` : 'en cours'}</span></h3>
      <p class="small muted">Depuis le ${e(fmt(i.createdAt))}</p>
      <p>${e(i.message).replace(/\n/g, '<br>')}</p>
      ${i.resolvedAt && i.resolvedMessage ? `<p><strong>Résolution :</strong> ${e(i.resolvedMessage).replace(/\n/g, '<br>')}</p>` : ''}
    </article>`).join('');
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)} — État des services</title><meta name="description" content="${e(OVERALL[view.status])}">
<style>
:root{--bg:#f8fafc;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#121a2e;--ink:#e2e8f0;--muted:#94a3b8;--line:#1e293b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px}h1{font-size:24px;margin:0 0 16px}h2{font-size:17px;margin:28px 0 10px}h3{font-size:15px;margin:0}
.banner{padding:16px;border-radius:12px;color:#fff;font-weight:600;background:${COLORS[view.status]}}
.comp,.inc,.sub{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}.muted{color:var(--muted)}.small{font-size:12px;font-weight:400}.open{color:#dc2626}
.bars{display:flex;gap:2px;margin:10px 0 4px}.bars span{flex:1;height:28px;border-radius:2px;background:#16a34a}.bars .warn{background:#ca8a04}.bars .bad{background:#dc2626}
form{display:flex;gap:8px;flex-wrap:wrap}input{flex:1;min-width:200px;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
button{padding:9px 14px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font-weight:600;cursor:pointer}.notice{padding:10px 12px;border-radius:8px;background:#4f46e51a;margin:12px 0}
</style></head>
<body><main>
<h1>${e(title)}</h1>
${notice ? `<p class="notice" role="status">${e(notice)}</p>` : ''}
<div class="banner" role="status">${e(OVERALL[view.status])}</div>
${comps ? `<h2>Services</h2>${comps}` : ''}
<h2>Incidents</h2>
${inc || '<p class="muted">Aucun incident ces 90 derniers jours.</p>'}
<section class="sub"><h2 style="margin-top:0">Être prévenu par e-mail</h2>
<form method="post" action="/statut/${e(space.id)}/abonnement"><label for="email" class="muted small" style="width:100%">Adresse e-mail (un lien de confirmation vous sera envoyé)</label>
<input id="email" name="email" type="email" required maxlength="254" autocomplete="email"><button type="submit">S'abonner</button></form></section>
<p class="muted small">Mis à jour le ${e(fmt(new Date()))}.</p>
</main></body></html>`;
}

async function render(req, res, notice = '') {
  const space = await spaceOf(req.params.guildId);
  const view = space ? await S.publicView(space.db).catch(() => null) : null;
  if (!view) return res.status(404).type('text/plain').send('Page introuvable');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(page(space, view, notice));
}

router.get('/statut/:guildId', (req, res) => render(req, res).catch(() => res.status(500).end()));
router.post('/statut/:guildId/abonnement', express.urlencoded({ extended: false, limit: '4kb' }), express.json({ limit: '4kb' }), async (req, res) => {
  try {
    const space = await spaceOf(req.params.guildId);
    if (!space || !(await S.settings(space.db)).enabled) return res.status(404).type('text/plain').send('Page introuvable');
    if (!(await allowBurst(`statussub:${req.ip}`, 5, 3600 * 1000))) return render(req, res, 'Trop de demandes, réessayez plus tard.');
    const r = await S.subscribe(space.db, space.id, req.body?.email);
    return render(req, res, r.error || 'Si l\'adresse est valide, un e-mail de confirmation vient de partir.');
  } catch { res.status(500).end(); }
});
router.get('/statut/:guildId/confirmer', async (req, res) => {
  try {
    const space = await spaceOf(req.params.guildId);
    if (!space) return res.status(404).type('text/plain').send('Page introuvable');
    const ok = typeof req.query.t === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(req.query.t) && await S.confirm(space.db, req.query.t);
    return render(req, res, ok ? 'Abonnement confirmé : vous serez prévenu des incidents.' : 'Lien invalide ou expiré.');
  } catch { res.status(500).end(); }
});
router.get('/statut/:guildId/desabonner', async (req, res) => {
  try {
    const space = await spaceOf(req.params.guildId);
    if (!space) return res.status(404).type('text/plain').send('Page introuvable');
    const ok = typeof req.query.t === 'string' && await S.unsubscribe(space.db, req.query.t);
    return render(req, res, ok ? 'Vous êtes désabonné.' : 'Lien invalide ou déjà utilisé.');
  } catch { res.status(500).end(); }
});
router.get('/api/public/status/:guildId', async (req, res) => {
  try {
    const space = await spaceOf(req.params.guildId);
    const view = space ? await S.publicView(space.db) : null;
    if (!view) return res.status(404).json({ error: 'Page introuvable' });
    res.json(view);
  } catch { res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

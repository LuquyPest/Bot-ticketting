// Jira, GitHub and GitLab (utils/devIntegrations.js, v7).
//   staff:   GET/PUT /api/dev-integrations (founders), GET/POST/DELETE /api/dev-integrations/tickets/:id
//   tracker: POST /api/dev-hooks/:guildId/:provider/:secret — mounted before the CSRF guard, raw body
const express = require('express');
const D = require('../../utils/devIntegrations');
const { dashboardActor } = require('../../utils/audit');

const staff = express.Router();
const founders = (req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' }));
staff.get('/', founders, async (req, res, next) => { try { res.json(await D.settings(req.guildDb, req.guildId)); } catch (err) { next(err); } });
staff.put('/:provider', founders, async (req, res, next) => {
  try {
    const r = await D.saveSettings(req.guildDb, String(req.params.provider), req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    await require('../../utils/audit').recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'dev_settings', details: { provider: req.params.provider, enabled: !!req.body?.enabled } });
    res.json(await D.settings(req.guildDb, req.guildId));
  } catch (err) { next(err); }
});
// The ticket must be visible to the reader; writing needs the reply_ticket permission
async function ticketOf(req, res, write) {
  const { visibilityFilter, getUserPermissions } = require('../../utils/gradePermissions');
  const vis = await visibilityFilter(req, 't.visibility_grade_id');
  const [t] = await req.guildDb(`SELECT t.* FROM tickets t WHERE t.id = ? AND ${vis.sql}`, [parseInt(req.params.id) || 0, ...vis.params]);
  if (!t) { res.status(404).json({ error: 'Ticket introuvable' }); return null; }
  if (write && !req.userIsFondateur && !(req.userPermissions || await getUserPermissions(req.session.user.id, req.guildDb)).has('reply_ticket')) { res.status(403).json({ error: 'Permission « Répondre » requise' }); return null; }
  return t;
}
const enabledList = async req => Object.entries(await D.settings(req.guildDb, req.guildId)).filter(([, s]) => s.enabled && s.hasToken).map(([p]) => ({ provider: p, label: D.LABELS[p] }));
staff.get('/tickets/:id', async (req, res, next) => {
  try { const t = await ticketOf(req, res, false); if (!t) return; res.json({ issues: await D.linksOf(req.guildDb, t.id), providers: await enabledList(req) }); } catch (err) { next(err); }
});
staff.post('/tickets/:id', async (req, res, next) => {
  try {
    const t = await ticketOf(req, res, true); if (!t) return;
    const provider = String(req.body?.provider || '');
    const r = req.body?.ref ? await D.link(req.guildDb, t, provider, String(req.body.ref).slice(0, 200), dashboardActor(req)) : await D.create(req.guildDb, t, provider, req.body || {}, dashboardActor(req));
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    require('../../utils/sse').broadcast('ticket', { id: t.id }, req.guildId);
    res.json({ issues: await D.linksOf(req.guildDb, t.id), providers: await enabledList(req) });
  } catch (err) { next(err); }
});
staff.delete('/tickets/:id/:linkId', async (req, res, next) => {
  try { const t = await ticketOf(req, res, true); if (!t) return; await D.unlink(req.guildDb, t.id, parseInt(req.params.linkId) || 0); res.json({ issues: await D.linksOf(req.guildDb, t.id), providers: await enabledList(req) }); } catch (err) { next(err); }
});

const hooks = express.Router();
hooks.post('/:guildId/:provider/:secret', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    if (!/^\d{17,20}$/.test(req.params.guildId) || !D.PROVIDERS.includes(req.params.provider)) return res.status(404).end();
    const { allowBurst } = require('../../utils/rateLimit');
    if (!(await allowBurst(`devhook:${req.params.guildId}`, 120, 60 * 1000))) return res.status(429).end();
    const [g] = await require('../../utils/globalDb').globalQuery("SELECT guild_id FROM guilds WHERE guild_id = ? AND status = 'active'", [req.params.guildId]).catch(() => []);
    if (!g) return res.status(404).end();
    const db = require('../../utils/tenantDb').getTenantDb(g.guild_id);
    const r = await D.webhook(db, req.params.provider, String(req.params.secret), req.headers, Buffer.isBuffer(req.body) ? req.body : Buffer.from(''));
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, updated: r.updated });
  } catch (err) { console.error('dev hook:', err.message); res.status(500).end(); }
});

module.exports = { staff, hooks };

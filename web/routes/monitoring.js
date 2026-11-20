// Monitoring alerts (utils/monitoringAlerts.js, v7).
//   staff (founders and manage_settings): GET/POST/PUT/DELETE /api/monitoring-sources
//   tools: POST /api/monitoring/:guildId/:sourceId/:secret — before the CSRF guard, secret in the URL
const express = require('express');
const M = require('../../utils/monitoringAlerts');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const staff = express.Router();
staff.use((req, res, next) => (req.method === 'GET' || req.userIsFondateur || req.userPermissions?.has('manage_settings') ? next() : res.status(403).json({ error: 'Réservé aux fondateurs et à la permission « Paramètres »' })));
const out = async (req, res, r) => (r?.error ? res.status(r.status || 400).json({ error: r.error }) : res.json({ sources: await M.listSources(req.guildDb, req.guildId), kinds: M.KIND_LABELS }));
staff.get('/', async (req, res, next) => {
  try {
    if (!req.userIsFondateur && !req.userPermissions?.has('manage_settings')) return res.status(403).json({ error: 'Réservé aux fondateurs et à la permission « Paramètres »' }); // the addresses hold secrets
    await out(req, res);
  } catch (err) { next(err); }
});
staff.post('/', async (req, res, next) => {
  try { const r = await M.saveSource(req.guildDb, null, req.body || {}); if (r.ok) await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'monitoring_source', details: { name: req.body?.name } }); await out(req, res, r); } catch (err) { next(err); }
});
staff.put('/:id', async (req, res, next) => {
  try { const r = await M.saveSource(req.guildDb, parseInt(req.params.id) || 0, req.body || {}); if (r.ok) await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'monitoring_source', details: { id: parseInt(req.params.id) } }); await out(req, res, r); } catch (err) { next(err); }
});
staff.delete('/:id', async (req, res, next) => {
  try { await out(req, res, await M.deleteSource(req.guildDb, parseInt(req.params.id) || 0)); } catch (err) { next(err); }
});

const hooks = express.Router();
hooks.post('/:guildId/:sourceId/:secret', express.json({ limit: '1mb', type: '*/*' }), async (req, res) => {
  try {
    if (!/^\d{17,20}$/.test(req.params.guildId)) return res.status(404).end();
    const { allowBurst } = require('../../utils/rateLimit');
    if (!(await allowBurst(`monhook:${req.params.guildId}`, 300, 60 * 1000))) return res.status(429).end();
    const [g] = await require('../../utils/globalDb').globalQuery("SELECT guild_id FROM guilds WHERE guild_id = ? AND status = 'active'", [req.params.guildId]).catch(() => []);
    if (!g) return res.status(404).end();
    const r = await M.receive({ db: require('../../utils/tenantDb').getTenantDb(g.guild_id), client: req.app.locals.client, guildId: g.guild_id, sourceId: parseInt(req.params.sourceId) || 0, secret: req.params.secret, payload: req.body });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, ...r });
  } catch (err) { console.error('monitoring hook:', err.message); res.status(500).end(); }
});

module.exports = { staff, hooks };

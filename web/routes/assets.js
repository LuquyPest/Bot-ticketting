// Inventory / CMDB (utils/assets.js, v7), when the space turned it on (founders). Read by the staff;
// elements and relations written with the reply_ticket permission; types by the founders and the
// manage_settings permission. Each element keeps its history.
const express = require('express');
const router = express.Router();
const A = require('../../utils/assets');
const { getUserPermissions } = require('../../utils/gradePermissions');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const perms = async req => req.userPermissions || await getUserPermissions(req.session.user.id, req.guildDb);
const canWrite = async req => req.userIsFondateur || (await perms(req)).has('reply_ticket');
const canTypes = async req => req.userIsFondateur || (await perms(req)).has('manage_settings');
const send = (res, r, ok) => (r.error ? res.status(r.status || 400).json({ error: r.error }) : ok());
const id = req => parseInt(req.params.id) || 0;

router.get('/settings', async (req, res, next) => { try { res.json({ enabled: await A.enabled(req.guildDb) }); } catch (err) { next(err); } });
router.put('/settings', async (req, res, next) => {
  try {
    if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé aux fondateurs' });
    await req.guildDb('UPDATE guild_config SET assets_enabled = ? WHERE id = 1', [req.body?.enabled ? 1 : 0]);
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'assets_toggle', details: { enabled: !!req.body?.enabled } });
    res.json({ enabled: !!req.body?.enabled });
  } catch (err) { next(err); }
});
// Everything below: only when turned on
router.use(async (req, res, next) => ((await A.enabled(req.guildDb).catch(() => false)) ? next() : res.status(404).json({ error: 'Le parc n\'est pas activé' })));

router.get('/types', async (req, res, next) => { try { res.json({ types: await A.listTypes(req.guildDb), statuses: A.STATUSES, relations: A.RELATIONS }); } catch (err) { next(err); } });
router.post('/types', async (req, res, next) => {
  try {
    if (!(await canTypes(req))) return res.status(403).json({ error: 'Permission « Paramètres » requise' });
    const r = await A.saveType(req.guildDb, null, req.body || {});
    send(res, r, async () => { await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'asset_type_save', details: { name: req.body?.name } }); res.json({ id: r.id, types: await A.listTypes(req.guildDb) }); });
  } catch (err) { next(err); }
});
router.put('/types/:id', async (req, res, next) => {
  try {
    if (!(await canTypes(req))) return res.status(403).json({ error: 'Permission « Paramètres » requise' });
    const r = await A.saveType(req.guildDb, id(req), req.body || {});
    send(res, r, async () => { await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'asset_type_save', details: { id: id(req), name: req.body?.name } }); res.json({ types: await A.listTypes(req.guildDb) }); });
  } catch (err) { next(err); }
});
router.delete('/types/:id', async (req, res, next) => {
  try {
    if (!(await canTypes(req))) return res.status(403).json({ error: 'Permission « Paramètres » requise' });
    const r = await A.deleteType(req.guildDb, id(req));
    send(res, r, async () => res.json({ types: await A.listTypes(req.guildDb) }));
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const q = req.query;
    res.json(await A.listAssets(req.guildDb, { typeId: q.type, status: q.status, orgId: q.organization, contactId: q.contact, q: typeof q.q === 'string' ? q.q : '', limit: q.limit, offset: q.offset }));
  } catch (err) { next(err); }
});
router.get('/:id', async (req, res, next) => {
  try {
    const a = await A.getAsset(req.guildDb, id(req));
    if (!a) return res.status(404).json({ error: 'Élément introuvable' });
    res.json(a);
  } catch (err) { next(err); }
});
// Writes: the reply_ticket permission
router.use(async (req, res, next) => (req.method === 'GET' || await canWrite(req) ? next() : res.status(403).json({ error: 'Permission « Répondre » requise' })));
router.post('/', async (req, res, next) => {
  try {
    const r = await A.createAsset(req.guildDb, req.body || {}, dashboardActor(req));
    send(res, r, async () => res.json(await A.getAsset(req.guildDb, r.id)));
  } catch (err) { next(err); }
});
router.put('/:id', async (req, res, next) => {
  try {
    const r = await A.updateAsset(req.guildDb, id(req), req.body || {}, dashboardActor(req));
    send(res, r, async () => res.json(await A.getAsset(req.guildDb, id(req))));
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    const [a] = await req.guildDb('SELECT name FROM assets WHERE id = ?', [id(req)]);
    const r = await A.deleteAsset(req.guildDb, id(req));
    send(res, r, async () => { await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'asset_delete', targetType: 'asset', targetId: id(req), details: { name: a?.name } }); res.json({ ok: true }); });
  } catch (err) { next(err); }
});
// POST /api/assets/:id/relations { to, kind } · DELETE /api/assets/:id/relations/:to/:kind
router.post('/:id/relations', async (req, res, next) => {
  try {
    const r = await A.relate(req.guildDb, id(req), req.body?.to, req.body?.kind, dashboardActor(req));
    send(res, r, async () => res.json(await A.getAsset(req.guildDb, id(req))));
  } catch (err) { next(err); }
});
router.delete('/:id/relations/:to/:kind', async (req, res, next) => {
  try {
    await A.unrelate(req.guildDb, id(req), parseInt(req.params.to) || 0, String(req.params.kind), dashboardActor(req));
    res.json(await A.getAsset(req.guildDb, id(req)));
  } catch (err) { next(err); }
});

module.exports = router;

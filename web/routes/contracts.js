// Contracts of the organisations (utils/contracts.js, v7): read by the staff (ticket view, balance),
// written by the founders and the manage_settings permission, like the organisations.
const express = require('express');
const router = express.Router({ mergeParams: true });
const C = require('../../utils/contracts');
const { dashboardActor } = require('../../utils/audit');

const canManage = req => req.userIsFondateur || req.userPermissions?.has('manage_settings');
const manage = (req, res, next) => (canManage(req) ? next() : res.status(403).json({ error: 'Réservé aux fondateurs et à la permission « Paramètres »' }));
const orgId = req => parseInt(req.params.orgId) || 0;
const out = async (req, res, r) => {
  if (r?.error) return res.status(r.status || 400).json({ error: r.error });
  res.json({ contracts: await C.listContracts(req.guildDb, orgId(req)), active: await C.activeFor(req.guildDb, orgId(req)) });
};

router.get('/', async (req, res, next) => { try { await out(req, res); } catch (err) { next(err); } });
router.post('/', manage, async (req, res, next) => {
  try { await out(req, res, await C.saveContract(req.guildDb, orgId(req), null, req.body || {}, dashboardActor(req))); } catch (err) { next(err); }
});
router.put('/:id', manage, async (req, res, next) => {
  try { await out(req, res, await C.saveContract(req.guildDb, orgId(req), parseInt(req.params.id) || 0, req.body || {}, dashboardActor(req))); } catch (err) { next(err); }
});
router.delete('/:id', manage, async (req, res, next) => {
  try { await out(req, res, await C.deleteContract(req.guildDb, orgId(req), parseInt(req.params.id) || 0, dashboardActor(req))); } catch (err) { next(err); }
});

module.exports = router;

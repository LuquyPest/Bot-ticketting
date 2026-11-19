// Organisations (utils/organizations.js): read by the staff (contacts, tickets, rules, SLA), written
// by the founders and the manage_settings permission. Each change in the journal.
const express = require('express');
const router = express.Router();
const orgs = require('../../utils/organizations');
const { recordEvent, dashboardActor } = require('../../utils/audit');

const canManage = req => req.userIsFondateur || req.userPermissions?.has('manage_settings');
const manage = (req, res, next) => (canManage(req) ? next() : res.status(403).json({ error: 'Réservé aux fondateurs et à la permission « Paramètres »' }));

router.get('/', async (req, res, next) => {
  try {
    const list = await orgs.listOrgs(req.guildDb);
    // The notes and fields are for those who manage them; the others get the names (filters, cards)
    res.json(canManage(req) ? list : list.map(({ id, name, parentId, contacts, openTickets }) => ({ id, name, parentId, contacts, openTickets })));
  } catch (err) { next(err); }
});
router.get('/:id/contacts', manage, async (req, res, next) => {
  try {
    res.json(await req.guildDb(`SELECT c.id, c.display_name, c.email, c.org_manual, (SELECT ci.value FROM contact_identities ci WHERE ci.contact_id = c.id ORDER BY ci.value = c.seed DESC LIMIT 1) AS identity
      FROM contacts c WHERE c.organization_id = ? ORDER BY c.display_name LIMIT 500`, [parseInt(req.params.id) || 0]));
  } catch (err) { next(err); }
});
router.post('/', manage, async (req, res, next) => {
  try {
    const r = await orgs.saveOrg(req.guildDb, null, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'organization_save', targetType: 'organization', targetId: r.id, details: { name: req.body?.name } });
    res.json({ id: r.id, organizations: await orgs.listOrgs(req.guildDb) });
  } catch (err) { next(err); }
});
router.post('/import', manage, async (req, res, next) => {
  try {
    const r = await orgs.importCsv(req.guildDb, typeof req.body?.csv === 'string' ? req.body.csv.slice(0, 200000) : '');
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'organization_import', details: { created: r.created, updated: r.updated } });
    res.json({ ...r, organizations: await orgs.listOrgs(req.guildDb) });
  } catch (err) { next(err); }
});
router.put('/:id', manage, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await orgs.saveOrg(req.guildDb, id, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'organization_save', targetType: 'organization', targetId: id, details: { name: req.body?.name } });
    res.json({ organizations: await orgs.listOrgs(req.guildDb) });
  } catch (err) { next(err); }
});
router.delete('/:id', manage, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id) || 0;
    const r = await orgs.deleteOrg(req.guildDb, id);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'organization_delete', targetType: 'organization', targetId: id });
    res.json({ organizations: await orgs.listOrgs(req.guildDb) });
  } catch (err) { next(err); }
});

module.exports = router;

// Imports from other helpdesk tools (utils/helpdeskImport.js): founders only.
//   POST /api/imports { source, kind, format: csv | json, text, dryRun }
//   POST /api/imports/directory { dryRun }   contacts and organisations of the instance's LDAP
//                                            directory (founder who also owns the instance)
const express = require('express');
const router = express.Router();
const H = require('../../utils/helpdeskImport');
const { recordEvent, dashboardActor } = require('../../utils/audit');

router.use((req, res, next) => (req.userIsFondateur ? next() : res.status(403).json({ error: 'Réservé aux fondateurs' })));
router.post('/', async (req, res, next) => {
  try {
    const { source, kind, format, text, dryRun } = req.body || {};
    const update = req.body?.update === true;
    if (source === 'ldap') return res.status(400).json({ error: 'L\'annuaire s\'importe directement, sans fichier' });
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Colle ou choisis le fichier exporté' });
    if (text.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'Fichier trop gros (10 Mo au plus : découpe l\'export)' });
    const rows = H.parse(format === 'json' ? 'json' : 'csv', text);
    if (!rows.length) return res.status(400).json({ error: 'Aucune ligne lue : vérifie le format (CSV avec une ligne d\'en-tête, ou JSON)' });
    const r = await H.importRows(req.guildDb, { source, kind, rows, dryRun: !!dryRun, update });
    if (r.error) return res.status(400).json({ error: r.error });
    if (!dryRun) await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'helpdesk_import', details: { source, kind, created: r.created, updated: r.updated, skipped: r.skipped, errors: r.errors.length } });
    // What the columns were understood as, on the first row (to check before importing)
    const first = rows[0];
    const preview = Object.fromEntries(['id', 'subject', 'email', 'name', 'status', 'priority', 'organization', 'created', 'question', 'category'].map(k => [k, H.pick(first, k)]).filter(([, v]) => v !== null).map(([k, v]) => [k, String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 80)]));
    res.json({ ...r, dryRun: !!dryRun, preview });
  } catch (err) { next(err); }
});

// The directory is the instance's: only its owner brings its people into a space
router.post('/directory', async (req, res, next) => {
  try {
    if (req.session.user.demo || !(await require('../../utils/instance').isOwner(req.app.locals.client, req.session.user.id))) return res.status(403).json({ error: 'Réservé au propriétaire de l\'instance' });
    const got = await require('../../utils/ldapDirectory').contactRows();
    if (got.error) return res.status(400).json({ error: got.error });
    const dryRun = !!req.body?.dryRun;
    const r = await H.importRows(req.guildDb, { source: 'ldap', kind: 'contacts', rows: got.rows, dryRun, update: req.body?.update === true });
    if (!dryRun) await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'helpdesk_import', details: { source: 'ldap', kind: 'contacts', created: r.created, skipped: r.skipped, errors: r.errors.length } });
    const first = got.rows[0] || {};
    res.json({ ...r, dryRun, preview: Object.fromEntries(['id', 'email', 'name', 'organization'].filter(k => first[k]).map(k => [k, String(first[k]).slice(0, 80)])) });
  } catch (err) { next(err); }
});

module.exports = router;

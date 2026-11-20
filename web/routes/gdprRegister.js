// Record of processing activities of the space (utils/processingRegister.js, v8), founders only:
//   GET  /api/gdpr-register            → the identity filled in, and what the register holds
//   PUT  /api/gdpr-register            → { controller, address, dpo, contact, notes }
//   GET  /api/gdpr-register/export.md  → Markdown
//   GET  /api/gdpr-register/export.pdf → PDF
const express = require('express');
const router = express.Router();
const R = require('../../utils/processingRegister');
const { recordEvent, dashboardActor } = require('../../utils/audit');

router.get('/', async (req, res, next) => {
  try {
    const r = await R.build(req.guildDb, req.guildId);
    res.json({ identity: r.identity, activities: r.activities.length, recipients: r.recipients.length, markdown: R.markdown(r) });
  } catch (err) { next(err); }
});
router.put('/', async (req, res, next) => {
  try {
    await R.saveIdentity(req.guildDb, req.body || {});
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'gdpr_register' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.get('/export.md', async (req, res, next) => {
  try {
    const md = R.markdown(await R.build(req.guildDb, req.guildId));
    res.set({ 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="registre-des-traitements.md"', 'Cache-Control': 'no-store' }).send(md);
  } catch (err) { next(err); }
});
router.get('/export.pdf', async (req, res, next) => {
  try {
    const buf = await R.pdf(await R.build(req.guildDb, req.guildId));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="registre-des-traitements.pdf"', 'Cache-Control': 'no-store' }).send(buf);
  } catch (err) { next(err); }
});

module.exports = router;

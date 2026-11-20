// Simple electronic signatures (utils/signatures.js, v8).
//   staff:  GET  /api/signatures?type=change|release|ticket&id=N   → the requests of a target
//           POST /api/signatures { type, id, email, name | userId, message }  → asks (e-mail with a link)
//           GET  /api/signatures/:id/certificate                   → the PDF certificate of a signed one
//   public: POST /api/signature/link   { token }                    → the document to sign
//           POST /api/signature/answer { token, accept, name, reason } → the answer (once)
// The token comes from the fragment of /signature#<token> and travels in the body, never in a URL.
const express = require('express');
const S = require('../../utils/signatures');
const { dashboardActor } = require('../../utils/audit');
const { allowBurst } = require('../../utils/rateLimit');

// Who may ask, and see: the staff with « Répondre » who sees the ticket; for changes and releases,
// « Répondre » (as for writing them)
async function canSee(req, type, id) {
  const { canUserSeeTicket, getUserPermissions } = require('../../utils/gradePermissions');
  const perms = req.userPermissions || await getUserPermissions(req.session.user.id, req.guildDb);
  if (!req.userIsFondateur && !perms.has('reply_ticket')) return false;
  if (type === 'ticket') {
    const [t] = await req.guildDb('SELECT id, visibility_grade_id FROM tickets WHERE id = ?', [id]);
    return !!t && (req.userIsFondateur || await canUserSeeTicket(req.guildDb, req.session.user.id, t));
  }
  const table = type === 'change' ? 'changes' : 'releases';
  return (await req.guildDb(`SELECT 1 FROM ${table} WHERE id = ?`, [id]).catch(() => [])).length > 0;
}

const staff = express.Router();
staff.get('/', async (req, res, next) => {
  try {
    const type = String(req.query.type || ''), id = parseInt(req.query.id) || 0;
    if (!S.TARGETS.includes(type) || !(await canSee(req, type, id))) return res.status(404).json({ error: 'Introuvable' });
    res.json({ signatures: await S.listFor(req.guildDb, type, id) });
  } catch (err) { next(err); }
});
staff.post('/', async (req, res, next) => {
  try {
    const type = String(req.body?.type || ''), id = parseInt(req.body?.id) || 0;
    if (!S.TARGETS.includes(type) || !(await canSee(req, type, id))) return res.status(404).json({ error: 'Introuvable' });
    await S.request({ db: req.guildDb, guildId: req.guildId, type, id, input: req.body || {}, actor: dashboardActor(req) });
    res.json({ signatures: await S.listFor(req.guildDb, type, id) });
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});
staff.get('/:id/certificate', async (req, res, next) => {
  try {
    const [s] = await req.guildDb('SELECT target_type, target_id FROM signatures WHERE id = ?', [parseInt(req.params.id) || 0]);
    if (!s || !(await canSee(req, s.target_type, s.target_id))) return res.status(404).json({ error: 'Introuvable' });
    const c = await S.certificate(req.guildDb, parseInt(req.params.id) || 0);
    if (!c) return res.status(404).json({ error: 'Pas encore signé' });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${c.name}"`, 'Cache-Control': 'no-store' }).send(c.buffer);
  } catch (err) { next(err); }
});

const pub = express.Router();
const GONE = 'Ce lien a expiré ou a déjà servi';
pub.post('/link', async (req, res) => {
  try {
    if (!(await allowBurst(`siglink:${req.ip}`, 60, 10 * 60 * 1000))) return res.status(429).json({ error: 'Trop de tentatives' });
    const v = await S.publicView(req.body?.token);
    if (!v) return res.status(410).json({ error: GONE });
    res.json(v);
  } catch (err) { console.error('signature link:', err.message); res.status(500).json({ error: 'Erreur serveur' }); }
});
pub.post('/answer', async (req, res) => {
  try {
    if (!(await allowBurst(`siganswer:${req.ip}`, 20, 10 * 60 * 1000))) return res.status(429).json({ error: 'Trop de tentatives' });
    const r = await S.answer({ token: req.body?.token, accept: req.body?.accept === true, name: req.body?.name, reason: req.body?.reason, ip: req.ip, userAgent: req.get('User-Agent') || '' });
    res.json(r);
  } catch (err) {
    if (err.status) return res.status(err.status === 404 ? 410 : err.status).json({ error: err.status === 404 ? GONE : err.message });
    console.error('signature answer:', err.message); res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = { staff, pub };

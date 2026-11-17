// Invitations to the team of the space (utils/invitations.js), from the Équipe page:
//   GET    /api/invitations         → recent and pending invitations
//   POST   /api/invitations         { email, role, gradeId }   → e-mail sent
//   DELETE /api/invitations/:id     → revoked
// Founders invite with any role; a member with manage_users invites support members only, with a
// grade whose permissions they already hold.
const express = require('express');
const router = express.Router();
const inv = require('../../utils/invitations');
const { logAudit } = require('../../utils/gradePermissions');

const canManage = req => req.userIsFondateur || req.userPermissions?.has('manage_users');
const langOf = req => (/^fr\b/i.test(req.get('Accept-Language') || 'fr') ? 'fr' : 'en');

router.use((req, res, next) => (canManage(req) ? next() : res.status(403).json({ error: 'Permission insuffisante' })));

router.get('/', async (req, res, next) => {
  try { res.json(await inv.listInvitations(req.guildDb)); } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { email, role = 'support', gradeId = null } = req.body || {};
    if (role === 'fondateur' && !req.userIsFondateur) return res.status(403).json({ error: 'Seul un fondateur invite un fondateur' });
    if (gradeId != null && gradeId !== '' && !req.userIsFondateur) {
      const perms = await req.guildDb('SELECT permission FROM grade_permissions WHERE grade_id = ?', [Number(gradeId) || 0]);
      if (perms.some(p => !req.userPermissions.has(p.permission))) return res.status(403).json({ error: 'Ce grade donne des permissions que tu n\'as pas' });
    }
    const [guild] = await require('../../utils/globalDb').globalQuery('SELECT guild_id, guild_name FROM guilds WHERE guild_id = ?', [req.guildId]);
    const r = await inv.createInvitation(req.guildDb, guild, { email, role, gradeId, lang: langOf(req) }, req.session.user);
    if (r.error) return res.status(r.status).json({ error: r.error });
    await logAudit(req.session.user.id, req.session.user.username, 'invitation_sent', 'invitation', r.invitation.id,
      { email: r.invitation.email, role: r.invitation.role }, req.guildDb).catch(() => null);
    res.status(201).json(r.invitation);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!(await inv.revokeInvitation(req.guildDb, req.params.id))) return res.status(404).json({ error: 'Invitation introuvable ou plus en attente' });
    await logAudit(req.session.user.id, req.session.user.username, 'invitation_revoked', 'invitation', req.params.id, null, req.guildDb).catch(() => null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

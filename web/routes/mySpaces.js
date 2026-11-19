// « All my spaces » (v6, conception/v6.md §3.4): the open tickets of every space where the signed-in
// person is staff, each space read with the rights they have there — the same checks as entering it
// (active, not in maintenance, allowed IP, mandatory 2FA, role, view_tickets, grade and tag filters).
//   GET /api/my-spaces/tickets
const express = require('express');
const router = express.Router();
const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb } = require('../../utils/tenantDb');
const { parseJsonField } = require('../../utils/jsonField');
const { getUserPermissions, PERMISSIONS, visibilityFilter } = require('../../utils/gradePermissions');
const { requiredFor, hasTotp, guildPolicy } = require('../../utils/twoFactorPolicy');
const { buildAllowlist, isAllowed } = require('../middleware/guild');

const PER_SPACE = 50;
const ORDER = "FIELD(t.priority, 'urgent', 'normal', 'low'), COALESCE(t.last_message_at, t.created_at) DESC";

router.get('/tickets', async (req, res, next) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  if (user.demo) return res.json({ spaces: [], skipped: [] });
  try {
    const guilds = await globalQuery("SELECT guild_id, guild_name, maintenance_mode FROM guilds WHERE status = 'active' ORDER BY guild_name");
    const spaces = [], skipped = [];
    let totp = null;
    for (const g of guilds) {
      const db = getTenantDb(g.guild_id);
      const [du] = await db('SELECT role FROM dashboard_users WHERE user_id = ?', [user.id]).catch(() => []);
      if (!du || !['support', 'fondateur'].includes(du.role)) continue; // not staff there: nothing said about it
      const skip = reason => skipped.push({ guildId: g.guild_id, name: g.guild_name, reason });
      if (Number(g.maintenance_mode)) { skip('maintenance'); continue; }
      const founder = du.role === 'fondateur';
      if (!founder) {
        const [cfg] = await db('SELECT ip_allowlist FROM guild_config WHERE id = 1').catch(() => []);
        const list = parseJsonField(cfg?.ip_allowlist);
        if (list.length && !isAllowed(buildAllowlist(list), req.ip || '')) { skip('ip'); continue; }
      }
      if (requiredFor(await guildPolicy(db), du.role)) {
        if (totp === null) totp = await hasTotp(user.id);
        if (!totp) { skip('2fa'); continue; }
      }
      const perms = founder ? new Set(PERMISSIONS) : await getUserPermissions(user.id, db);
      if (!founder && !perms.has('view_tickets')) { skip('permission'); continue; }
      const vis = await visibilityFilter({ userIsFondateur: founder, session: { user }, guildDb: db }, 't.visibility_grade_id');
      const where = `t.status = 'open' AND ${vis.sql}`;
      const [{ n }] = await db(`SELECT COUNT(*) AS n FROM tickets t WHERE ${where}`, vis.params);
      const tickets = await db(`SELECT t.id, t.subject, t.priority, t.stage, t.owner_tag, t.created_at, t.last_message_at, t.resolved_at,
          EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = ?) AS mine
        FROM tickets t WHERE ${where} ORDER BY ${ORDER} LIMIT ${PER_SPACE}`, [user.id, ...vis.params]);
      spaces.push({ guildId: g.guild_id, name: g.guild_name, role: du.role, open: Number(n),
        tickets: tickets.map(t => ({ ...t, mine: !!Number(t.mine) })) });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ spaces, skipped });
  } catch (err) { next(err); }
});

module.exports = router;

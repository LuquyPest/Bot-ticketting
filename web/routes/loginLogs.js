const express = require('express');
const router = express.Router();
const { globalQuery }   = require('../../utils/globalDb');
const { getTenantDb }   = require('../../utils/tenantDb');

// Lightweight auth + role check — does not need guildMiddleware (no guild DB queries).
// Derives fondateur status directly from the guild DB tied to the session guild.
async function requireAuthAndRole(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Non authentifié' });
  const guildId = req.session.currentGuildId;
  if (!guildId) return res.status(400).json({ error: 'Aucun serveur sélectionné' });
  try {
    const db = getTenantDb(guildId);
    const [row] = await db('SELECT role FROM dashboard_users WHERE user_id = ? LIMIT 1', [req.session.user.id]);
    if (!row || !['support', 'fondateur'].includes(row.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    req.userIsFondateur = row.role === 'fondateur';
    next();
  } catch { res.status(500).json({ error: 'Erreur serveur' }); }
}

// GET /api/login-logs — own login history (or all logs for fondateur)
router.get('/', requireAuthAndRole, async (req, res) => {
  const userId = req.session.user.id;
  const isFondateur = req.userIsFondateur;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    const rows = isFondateur
      ? await globalQuery(
          `SELECT * FROM login_logs ORDER BY created_at DESC LIMIT ?`,
          [limit]
        )
      : await globalQuery(
          `SELECT * FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
          [userId, limit]
        );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

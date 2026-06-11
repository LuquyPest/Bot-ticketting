const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb }  = require('../../utils/tenantDb');

// Resolves the current guild from the session and attaches:
//   req.guildId   — Discord guild ID string
//   req.guildDb   — async query(sql, params) function for that guild's DB
//   req.guild     — row from ticketbot_global.guilds
//   req.guildConfig — row from guild_config (lazy-loaded on first use via getter)
module.exports = async function guildMiddleware(req, res, next) {
  const guildId = req.session?.currentGuildId;

  if (!guildId) {
    return res.status(400).json({ error: 'Aucun serveur sélectionné' });
  }

  try {
    const [guild] = await globalQuery(
      'SELECT * FROM guilds WHERE guild_id = ? AND status = "active"',
      [guildId]
    );

    if (!guild) {
      return res.status(403).json({ error: 'Serveur introuvable ou inactif' });
    }

    req.guildId = guildId;
    req.guildDb = getTenantDb(guildId);
    req.guild   = guild;

    // Update last_activity_at only on write operations to reduce DB noise on polling/SSE reads
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      globalQuery(
        'UPDATE guilds SET last_activity_at = NOW() WHERE guild_id = ?',
        [guildId]
      ).catch(() => {});
    }

    next();
  } catch (err) {
    console.error('guildMiddleware error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb }  = require('../../utils/tenantDb');
const net = require('net');

function ipMatchesCidr(ip, cidr) {
  if (!cidr.includes('/')) return ip === cidr;
  const [range, bits] = cidr.split('/');
  const mask = parseInt(bits, 10);
  if (net.isIPv4(ip) && net.isIPv4(range)) {
    const ipNum  = ip.split('.').reduce((a, o) => (a << 8) + parseInt(o, 10), 0) >>> 0;
    const rngNum = range.split('.').reduce((a, o) => (a << 8) + parseInt(o, 10), 0) >>> 0;
    const maskNum = (~0 << (32 - mask)) >>> 0;
    return (ipNum & maskNum) === (rngNum & maskNum);
  }
  return ip === range;
}

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

    if (guild.maintenance_mode) {
      return res.status(503).json({ error: 'Ce serveur est en maintenance — réessaie plus tard' });
    }

    req.guildId = guildId;
    req.guildDb = getTenantDb(guildId);

    // IP allowlist check (fondateur is always exempt)
    if (req.session?.user?.role !== 'fondateur') {
      const [cfgRow] = await req.guildDb('SELECT ip_allowlist FROM guild_config WHERE id = 1');
      const allowlist = (() => {
        try { return JSON.parse(cfgRow?.ip_allowlist || '[]'); } catch { return []; }
      })();
      if (allowlist.length > 0) {
        const clientIp = (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.socket.remoteAddress || '';
        const allowed = allowlist.some(cidr => ipMatchesCidr(clientIp, cidr));
        if (!allowed) return res.status(403).json({ error: 'Accès refusé depuis cette adresse IP' });
      }
    }
    req.guild = guild;

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

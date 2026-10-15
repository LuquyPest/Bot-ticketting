const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb }  = require('../../utils/tenantDb');
const net = require('net');
const { parseJsonField } = require('../../utils/jsonField');

// Builds a BlockList from "1.2.3.4", "10.0.0.0/8" or IPv6 entries; invalid entries are ignored.
function buildAllowlist(entries) {
  const list = new net.BlockList();
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    const [addr, bits] = entry.trim().split('/');
    const type = net.isIPv4(addr) ? 'ipv4' : net.isIPv6(addr) ? 'ipv6' : null;
    if (!type) continue;
    try {
      if (bits === undefined) list.addAddress(addr, type);
      else list.addSubnet(addr, parseInt(bits, 10), type);
    } catch { /* invalid prefix */ }
  }
  return list;
}

function isAllowed(list, ip) {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip; // IPv4-mapped IPv6
  if (net.isIPv4(v4)) return list.check(v4, 'ipv4');
  return net.isIPv6(ip) && list.check(ip, 'ipv6');
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
      const allowlist = parseJsonField(cfgRow?.ip_allowlist);
      if (allowlist.length > 0) {
        // req.ip honours `trust proxy` (the hop added by Traefik), unlike the raw X-Forwarded-For header
        if (!isAllowed(buildAllowlist(allowlist), req.ip || '')) return res.status(403).json({ error: 'Accès refusé depuis cette adresse IP' });
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

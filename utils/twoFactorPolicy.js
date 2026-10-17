// Mandatory 2FA, per guild (guild_config.require_2fa): 'none' | 'founders' | 'staff'.
// A staff member concerned without 2FA can only reach their profile to turn it on.
const { globalQuery } = require('./globalDb');

function requiredFor(policy, role) {
  if (policy === 'staff') return role === 'fondateur' || role === 'support';
  if (policy === 'founders') return role === 'fondateur';
  return false;
}

async function hasTotp(userId) {
  const [row] = await globalQuery('SELECT totp_enabled FROM user_totp WHERE user_id = ?', [userId]).catch(() => []);
  return !!row?.totp_enabled;
}

async function guildPolicy(db) {
  const [cfg] = await db('SELECT require_2fa FROM guild_config WHERE id = 1').catch(() => []);
  return cfg?.require_2fa || 'none';
}

module.exports = { requiredFor, hasTotp, guildPolicy };

const cooldowns = new Map();

function checkRateLimit(key, cooldownMs) {
  const last = cooldowns.get(key) || 0;
  const elapsed = Date.now() - last;
  if (elapsed < cooldownMs) {
    return Math.ceil((cooldownMs - elapsed) / 1000);
  }
  cooldowns.set(key, Date.now());
  return 0;
}

module.exports = { checkRateLimit };

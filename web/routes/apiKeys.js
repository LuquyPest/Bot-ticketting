const express = require('express');
const router = express.Router();
const { recordEvent, dashboardActor } = require('../../utils/audit');
const crypto = require('crypto');

// List API keys (no secret shown)
router.get('/', async (req, res) => {
  try {
    const cfg = await req.guildDb('SELECT api_keys_enabled FROM guild_config LIMIT 1');
    if (!cfg[0]?.api_keys_enabled) return res.json({ enabled: false, keys: [] });

    const keys = await req.guildDb(
      'SELECT id, name, key_prefix, permissions, created_by, last_used_at, expires_at, active, created_at FROM api_keys ORDER BY created_at DESC'
    );
    res.json({ enabled: true, keys });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Create a new API key
router.post('/', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Accès refusé' });
  const { name, permissions, expiresAt } = req.body;
  if (!name || typeof name !== 'string' || name.length > 100)
    return res.status(400).json({ error: 'Nom requis (max 100 chars)' });

  const VALID_PERMS = ['read_tickets', 'close_tickets', 'read_stats'];
  const perms = Array.isArray(permissions) ? permissions.filter(p => VALID_PERMS.includes(p)) : [];
  let expires = null;
  if (expiresAt) {
    expires = new Date(expiresAt);
    if (typeof expiresAt !== 'string' || isNaN(expires) || expires <= new Date()) {
      return res.status(400).json({ error: 'Date d\'expiration invalide (doit être dans le futur)' });
    }
  }

  try {
    // The guild ID is embedded so /api/v1 knows which tenant DB to check (see routes/apiV1.js)
    const secret = crypto.randomBytes(32).toString('hex');
    const rawKey = `tb_${req.guildId}_${secret}`;
    const keyPrefix = secret.slice(0, 8);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    await req.guildDb(
      `INSERT INTO api_keys (name, key_hash, key_prefix, permissions, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, keyHash, keyPrefix, JSON.stringify(perms), req.session.user.id, expires]
    );

    // Return the raw key ONCE — never stored in plain text
    await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'api_key_create', targetType: 'api_key', targetId: keyPrefix, details: { name, permissions: perms } });
    res.json({ ok: true, key: rawKey, prefix: keyPrefix, name, permissions: perms });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Revoke (deactivate) an API key
router.delete('/:id', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Accès refusé' });
  try {
    const [key] = await req.guildDb('SELECT name FROM api_keys WHERE id = ?', [parseInt(req.params.id)]);
    await req.guildDb('UPDATE api_keys SET active = 0 WHERE id = ?', [parseInt(req.params.id)]);
    if (key) await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'api_key_revoke', targetType: 'api_key', targetId: req.params.id, details: { name: key.name } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

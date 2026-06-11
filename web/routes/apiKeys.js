const express = require('express');
const router = express.Router();
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

  const VALID_PERMS = ['read_tickets', 'create_tickets', 'close_tickets', 'read_stats'];
  const perms = Array.isArray(permissions) ? permissions.filter(p => VALID_PERMS.includes(p)) : [];

  try {
    const rawKey = `tb_${crypto.randomBytes(32).toString('hex')}`;
    const keyPrefix = rawKey.slice(0, 8);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    await req.guildDb(
      `INSERT INTO api_keys (name, key_hash, key_prefix, permissions, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, keyHash, keyPrefix, JSON.stringify(perms), req.session.user.id, expiresAt || null]
    );

    // Return the raw key ONCE — never stored in plain text
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
    await req.guildDb('UPDATE api_keys SET active = 0 WHERE id = ?', [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Verify an API key (for external use)
router.post('/verify', async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'Clé requise' });
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  try {
    const [row] = await req.guildDb(
      'SELECT id, name, permissions, expires_at FROM api_keys WHERE key_hash = ? AND active = 1',
      [keyHash]
    );
    if (!row) return res.status(401).json({ error: 'Clé invalide ou révoquée' });
    if (row.expires_at && new Date(row.expires_at) < new Date())
      return res.status(401).json({ error: 'Clé expirée' });

    await req.guildDb('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [row.id]);
    let perms = [];
    try { perms = Array.isArray(row.permissions) ? row.permissions : JSON.parse(row.permissions || '[]'); } catch {}
    res.json({ valid: true, name: row.name, permissions: perms });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

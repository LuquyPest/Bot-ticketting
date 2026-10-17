// AES-256-GCM encryption for secrets stored in the database (TOTP secrets).
// Current key: config.dashboard.encryptionKey (64 hex chars) or, failing that, derived from
// sessionSecret. Older keys listed in dashboard.previousEncryptionKeys are still accepted for
// reading, so the key can be rotated: set the new key, keep the old one there, restart, run
// scripts/rotate-encryption-key.js (re-encrypts everything), then drop the old key.
//
// Formats: enc:v2:<keyId>:<base64(iv|tag|ciphertext)> (keyId = first 8 hex of sha256(key));
// enc:v1:<…> written before rotation existed (tried with every known key); plain base32 legacy.
const crypto = require('crypto');

const V1 = 'enc:v1:';
const V2 = 'enc:v2:';
let _keys = null; // [{ id, key }], current first

const keyId = k => crypto.createHash('sha256').update(k).digest('hex').slice(0, 8);

function keys() {
  if (_keys) return _keys;
  const { dashboard = {} } = require('./config').config;
  const isHex = v => /^[0-9a-f]{64}$/i.test(v || '');
  const derived = dashboard.sessionSecret ? Buffer.from(crypto.hkdfSync('sha256', dashboard.sessionSecret, 'ticketbot', 'secret-box-v1', 32)) : null;
  const list = [];
  if (isHex(dashboard.encryptionKey)) list.push(Buffer.from(dashboard.encryptionKey, 'hex'));
  else if (derived) list.push(derived);
  for (const k of Array.isArray(dashboard.previousEncryptionKeys) ? dashboard.previousEncryptionKeys : []) if (isHex(k)) list.push(Buffer.from(k, 'hex'));
  if (derived) list.push(derived); // the key used when no encryptionKey was configured
  const seen = new Set();
  _keys = list.filter(k => !seen.has(k.toString('hex')) && seen.add(k.toString('hex'))).map(k => ({ id: keyId(k), key: k }));
  if (!_keys.length) throw new Error('Aucune clé de chiffrement disponible (dashboard.encryptionKey ou sessionSecret)');
  return _keys;
}

function seal(plain) {
  const { id, key } = keys()[0];
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${V2}${id}:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
}

function decrypt(key, buf) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

function open(stored) {
  if (typeof stored !== 'string') return stored;
  if (stored.startsWith(V2)) {
    const [id, data] = stored.slice(V2.length).split(':');
    const k = keys().find(x => x.id === id);
    if (!k) throw new Error(`Clé de chiffrement ${id} inconnue (ajoute-la à dashboard.previousEncryptionKeys)`);
    return decrypt(k.key, Buffer.from(data, 'base64'));
  }
  if (stored.startsWith(V1)) {
    const buf = Buffer.from(stored.slice(V1.length), 'base64');
    for (const { key } of keys()) { try { return decrypt(key, buf); } catch { /* next key */ } }
    throw new Error('Aucune clé connue ne déchiffre ce secret');
  }
  return stored; // legacy plaintext
}

const isSealed = stored => typeof stored === 'string' && (stored.startsWith(V2) || stored.startsWith(V1));
// Sealed with the current key (nothing to re-encrypt)
const isCurrent = stored => typeof stored === 'string' && stored.startsWith(`${V2}${keys()[0].id}:`);

// Tests and the rotation script reload the configuration
const resetKeys = () => { _keys = null; };

module.exports = { seal, open, isSealed, isCurrent, resetKeys, keyId };

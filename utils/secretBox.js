// AES-256-GCM encryption for secrets stored in the database (TOTP secrets).
// Key: config.dashboard.encryptionKey (64 hex chars) or, failing that, derived from sessionSecret.
// Values written before encryption existed (plain base32) are still accepted by open().
const crypto = require('crypto');

const PREFIX = 'enc:v1:';
let _key = null;

function key() {
  if (_key) return _key;
  const { dashboard = {} } = require('../config.json');
  _key = /^[0-9a-f]{64}$/i.test(dashboard.encryptionKey || '')
    ? Buffer.from(dashboard.encryptionKey, 'hex')
    : Buffer.from(crypto.hkdfSync('sha256', dashboard.sessionSecret, 'ticketbot', 'secret-box-v1', 32));
  return _key;
}

function seal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

function open(stored) {
  if (!stored || !stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

const isSealed = stored => typeof stored === 'string' && stored.startsWith(PREFIX);

module.exports = { seal, open, isSealed };

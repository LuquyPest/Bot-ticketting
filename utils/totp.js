// TOTP verification with replay protection and recovery codes.
const crypto = require('crypto');
const { authenticator } = require('otplib');
const { open } = require('./secretBox');

authenticator.options = { window: 1 }; // tolerate ±30 s of clock drift

// Returns the accepted time step, or null when the code is invalid or was already used.
function verifyTotp(code, storedSecret, lastStep = 0) {
  if (typeof code !== 'string') return null;
  const token = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(token)) return null;
  const delta = authenticator.checkDelta(token, open(storedSecret));
  if (delta === null) return null;
  const step = Math.floor(Date.now() / 30000) + delta;
  return step > Number(lastStep || 0) ? step : null;
}

const hashCode = c => crypto.createHash('sha256').update(c.replace(/[\s-]/g, '').toLowerCase()).digest('hex');

// 10 one-time codes like "a1b2c-d3e4f"; only their hashes are stored.
function generateRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => {
    const h = crypto.randomBytes(5).toString('hex');
    return `${h.slice(0, 5)}-${h.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashCode) };
}

// Returns the remaining hashes when `code` matches one, otherwise null.
function consumeRecoveryCode(code, storedHashes) {
  if (typeof code !== 'string') return null;
  let hashes = [];
  try { hashes = JSON.parse(storedHashes || '[]'); } catch {}
  const h = hashCode(code);
  const idx = hashes.findIndex(x => x.length === h.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h)));
  if (idx === -1) return null;
  hashes.splice(idx, 1);
  return hashes;
}

module.exports = { verifyTotp, generateRecoveryCodes, consumeRecoveryCode };

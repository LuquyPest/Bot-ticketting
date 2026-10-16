// TOTP verification with replay protection and recovery codes.
const crypto = require('crypto');
const { verifySync, generateSecret, generateURI, createGuardrails } = require('otplib');
const { open } = require('./secretBox');

// Secrets created before otplib 13 are 10 bytes; new ones are 20 bytes. Both must keep working.
const guardrails = createGuardrails({ MIN_SECRET_BYTES: 10 });
const TOLERANCE_SECONDS = 30; // ±1 step of clock drift

const newTotpSecret = () => generateSecret();
const totpUri = (label, issuer, secret) => generateURI({ issuer, label, secret });

// Returns the accepted time step, or null when the code is invalid or was already used.
function verifyTotp(code, storedSecret, lastStep = 0) {
  if (typeof code !== 'string') return null;
  const token = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(token)) return null;
  // afterTimeStep: a code of an already accepted step is refused (anti-replay)
  const result = verifySync({ secret: open(storedSecret), token, epochTolerance: TOLERANCE_SECONDS, afterTimeStep: Number(lastStep || 0), guardrails });
  return result.valid ? result.timeStep : null;
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

module.exports = { verifyTotp, newTotpSecret, totpUri, generateRecoveryCodes, consumeRecoveryCode };

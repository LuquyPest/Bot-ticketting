// Passwords of the accounts (v4, conception/v4.md §5): scrypt from Node (no dependency), a salt
// per account, the parameters stored with the hash so that they can be raised later.
//   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
const crypto = require('crypto');

const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };
const MAXMEM = 64 * 1024 * 1024;
const MIN = 10, MAX = 200;

const derive = (password, salt, { N, r, p, keylen }) => new Promise((resolve, reject) =>
  crypto.scrypt(String(password).normalize('NFKC'), salt, keylen, { N, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))));

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

// Constant-time comparison; a missing or malformed hash still costs one derivation (same timing
// whether the account exists or not)
const DUMMY = `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(64).toString('base64')}`;
async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  const valid = parts.length === 6 && parts[0] === 'scrypt';
  const [, N, r, p, salt, hash] = valid ? parts : DUMMY.split('$');
  const expected = Buffer.from(hash, 'base64');
  const key = await derive(String(password ?? ''), Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p), keylen: expected.length });
  return valid && key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// null when acceptable, else the reason (French: shown in the dashboard, translated there)
function passwordProblem(password, { email = '' } = {}) {
  const p = String(password ?? '');
  if (p.length < MIN) return `Au moins ${MIN} caractères`;
  if (p.length > MAX) return `${MAX} caractères au plus`;
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && p.toLowerCase().includes(local)) return 'Le mot de passe ne doit pas contenir ton adresse e-mail';
  if (/^(.)\1+$/.test(p)) return 'Mot de passe trop simple';
  return null;
}

module.exports = { hashPassword, verifyPassword, passwordProblem, MIN, MAX };

// First owner of an instance installed without Discord (v4 PR 6, conception/v4.md §3.5).
// While the instance has no owner — no Discord application owner, no OWNER_IDS, no owner account —
// the page /installation creates the owner account (e-mail, name, password) with the install
// token: INSTALL_TOKEN from .env (scripts/setup.sh writes it), or, without it, a token generated
// at start-up and printed in the logs (only its SHA-256 is stored). Once an owner exists, the page
// refuses everything: the token is useless.
const crypto = require('crypto');
const { getSetting, setSetting } = require('./instanceSettings');
const { config } = require('./config');

const KEY = 'install_token';
const sha = t => crypto.createHash('sha256').update(String(t)).digest();
const ownerExists = client => require('./instance').hasAnyOwner(client);

async function setupNeeded(client) {
  return !(await ownerExists(client));
}

// At start-up: no owner yet → the address to open, in the logs
async function announceIfNeeded(client) {
  if (!(await setupNeeded(client))) return null;
  let token = process.env.INSTALL_TOKEN || null;
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    await setSetting(KEY, { hash: sha(token).toString('hex'), at: Date.now() });
  }
  const url = `${(config.webServerBaseUrl || '').replace(/\/$/, '')}/installation${process.env.INSTALL_TOKEN ? '' : `?token=${token}`}`;
  require('./logger').warn(process.env.INSTALL_TOKEN
    ? `Aucun propriétaire : crée le compte du propriétaire sur ${url} avec le jeton INSTALL_TOKEN de ton .env`
    : `Aucun propriétaire : crée le compte du propriétaire sur ${url}`);
  console.log(`\n  ➜ Première installation : ${url}\n`);
  return url;
}

async function tokenValid(token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 200) return false;
  const given = sha(token);
  if (process.env.INSTALL_TOKEN && crypto.timingSafeEqual(given, sha(process.env.INSTALL_TOKEN))) return true;
  const stored = await getSetting(KEY, {});
  return !!stored.hash && crypto.timingSafeEqual(given, Buffer.from(stored.hash, 'hex'));
}

// Creates the owner account. Returns { account } or { error, status }.
async function createOwner(client, input) {
  // One creation at a time: two forms sent together must not give two owners
  const { getRedis } = require('./redis');
  if (!(await getRedis().set('lock:installation', '1', 'EX', 30, 'NX'))) return { status: 409, error: 'Création déjà en cours, réessaie dans un instant' };
  try { return await createOwnerUnlocked(client, input); } finally { await getRedis().del('lock:installation').catch(() => null); }
}

async function createOwnerUnlocked(client, { token, email, displayName, password }) {
  if (!(await setupNeeded(client))) return { status: 410, error: 'L\'instance a déjà un propriétaire' };
  if (!(await tokenValid(token))) return { status: 403, error: 'Jeton d\'installation invalide' };
  const accounts = require('./accounts');
  const { EMAIL_RE } = require('./emailTickets');
  const { hashPassword, passwordProblem } = require('./passwords');
  const mail = accounts.normEmail(email);
  const name = String(displayName || '').trim().slice(0, 100);
  if (!EMAIL_RE.test(mail)) return { status: 400, error: 'Adresse e-mail invalide' };
  if (!name) return { status: 400, error: 'Nom requis' };
  const problem = passwordProblem(password, { email: mail });
  if (problem) return { status: 400, error: problem };
  const id = `u_${crypto.randomBytes(12).toString('hex')}`;
  const { globalQuery } = require('./globalDb');
  await globalQuery(
    'INSERT INTO accounts (id, email, email_verified, display_name, password_hash, instance_owner, last_login_at) VALUES (?, ?, 1, ?, ?, 1, NOW())',
    [id, mail, name, await hashPassword(password)]
  );
  await setSetting(KEY, {}); // the generated token is spent
  require('./instance').resetOwnerCache();
  return { account: await accounts.getAccount(id) };
}

module.exports = { setupNeeded, announceIfNeeded, createOwner, tokenValid };

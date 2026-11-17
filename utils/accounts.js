// Accounts of the instance (v4, conception/v4.md §3.3): one per person, independent of the way
// they sign in. Sign-in methods are identities (account_identities): today Discord; e-mail and
// password, Google, Microsoft and OIDC come in later pull requests.
// An account born from a Discord sign-in has the Discord ID as its ID, so that everything that
// already stores user IDs (staff accounts, assignees, notes, 2FA, preferences) stays valid.
const { globalQuery } = require('./globalDb');

const PROVIDERS = { discord: 'Discord' };

// Discord sign-in: finds or creates the account, keeps its name and avatar up to date.
// Returns the account ({ id, display_name, disabled… }).
async function signInWithDiscord(discordUser) {
  const subject = String(discordUser.id);
  const name = String(discordUser.global_name || discordUser.username || subject).slice(0, 100);
  const avatar = discordUser.avatar ? String(discordUser.avatar).slice(0, 255) : null;
  const [identity] = await globalQuery("SELECT account_id FROM account_identities WHERE provider = 'discord' AND subject = ?", [subject]);
  const accountId = identity?.account_id || subject;
  await globalQuery(
    `INSERT INTO accounts (id, display_name, avatar, last_login_at) VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), avatar = VALUES(avatar), last_login_at = NOW()`,
    [accountId, name, avatar]
  );
  await globalQuery(
    `INSERT INTO account_identities (provider, subject, account_id, last_used_at) VALUES ('discord', ?, ?, NOW())
     ON DUPLICATE KEY UPDATE last_used_at = NOW()`,
    [subject, accountId]
  );
  return getAccount(accountId);
}

async function getAccount(id) {
  const [row] = await globalQuery('SELECT id, email, email_verified, display_name, avatar, password_hash IS NOT NULL AS has_password, disabled, created_at, last_login_at FROM accounts WHERE id = ?', [String(id)]);
  return row ? { ...row, has_password: !!Number(row.has_password), disabled: !!Number(row.disabled), email_verified: !!Number(row.email_verified) } : null;
}

// Sign-in methods of an account, for Profil → Connexion
async function loginMethods(accountId) {
  const account = await getAccount(accountId);
  const identities = await globalQuery('SELECT provider, subject, created_at, last_used_at FROM account_identities WHERE account_id = ? ORDER BY created_at', [String(accountId)]);
  return {
    account: account && { id: account.id, displayName: account.display_name, email: account.email, emailVerified: account.email_verified, createdAt: account.created_at },
    password: !!account?.has_password,
    identities: identities.map(i => ({ provider: i.provider, label: PROVIDERS[i.provider] || i.provider, subject: i.subject, createdAt: i.created_at, lastUsedAt: i.last_used_at })),
  };
}

// ── E-mail and password (v4 PR 5) ──
const normEmail = e => String(e || '').trim().toLowerCase();

// The account whose verified address this is (the only one that can sign in with it)
async function findByVerifiedEmail(email) {
  const [row] = await globalQuery('SELECT id, password_hash, disabled, display_name, avatar FROM accounts WHERE email = ? AND email_verified = 1', [normEmail(email)]);
  return row ? { ...row, disabled: !!Number(row.disabled) } : null;
}

// Another account already holds this address (verified)
async function emailTaken(email, exceptId) {
  const [row] = await globalQuery('SELECT id FROM accounts WHERE email = ? AND email_verified = 1 AND id <> ?', [normEmail(email), String(exceptId)]);
  return !!row;
}

// After the link sent to the address was opened. A change of address removes the password: it
// only ever works with the address it was set for.
async function setVerifiedEmail(accountId, email) {
  if (await emailTaken(email, accountId)) return { error: 'Adresse déjà utilisée par un autre compte' };
  const current = await getAccount(accountId);
  const changed = normEmail(current?.email) !== normEmail(email);
  await globalQuery(`UPDATE accounts SET email = ?, email_verified = 1${changed ? ', password_hash = NULL' : ''} WHERE id = ?`, [normEmail(email), String(accountId)]);
  return { ok: true, passwordRemoved: changed && !!current?.has_password };
}

async function setPasswordHash(accountId, hash) {
  await globalQuery('UPDATE accounts SET password_hash = ? WHERE id = ?', [hash, String(accountId)]);
}

async function passwordHashOf(accountId) {
  const [row] = await globalQuery('SELECT password_hash FROM accounts WHERE id = ?', [String(accountId)]);
  return row?.password_hash || null;
}

const touchLogin = accountId => globalQuery('UPDATE accounts SET last_login_at = NOW() WHERE id = ?', [String(accountId)]);

module.exports = {
  signInWithDiscord, getAccount, loginMethods, PROVIDERS,
  normEmail, findByVerifiedEmail, emailTaken, setVerifiedEmail, setPasswordHash, passwordHashOf, touchLogin,
};

// Invitations to the team of a space by e-mail (v4 PR 8, conception/v4.md §3.3).
// A founder (or a member with manage_users, for the support role) invites an address with a role
// and, optionally, a grade. The link carries a one-time token: only its SHA-256 is kept, in the
// table of the space (team_invitations); it is valid 7 days. Opening it:
//   - signed in: the account joins the team;
//   - not signed in, no account with this verified address: the account is created (address
//     confirmed by the link itself, name and password chosen), then joins the team;
//   - not signed in, an account already has this verified address: sign in first.
// Token format: <space ID>.<random>, so the link finds its space without a global table.
const crypto = require('crypto');
const { globalQuery } = require('./globalDb');
const { getTenantDb } = require('./tenantDb');
const accounts = require('./accounts');
const { EMAIL_RE } = require('./emailTickets');

const TTL_DAYS = 7;
const MAX_PENDING = 200;
const ROLES = ['support', 'fondateur'];
const TOKEN_RE = /^(\d{17,20})\.([A-Za-z0-9_-]{43})$/;

const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const base = () => (require('./config').config.webServerBaseUrl || '').replace(/\/$/, '');

const PENDING = 'accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()';

function statusOf(row) {
  if (row.accepted_at) return 'accepted';
  if (row.revoked_at) return 'revoked';
  if (new Date(row.expires_at) <= new Date()) return 'expired';
  return 'pending';
}

async function listInvitations(db) {
  const rows = await db(
    `SELECT i.id, i.email, i.role, i.grade_id, g.name AS grade_name, i.invited_by_tag, i.created_at, i.expires_at, i.accepted_at, i.revoked_at
     FROM team_invitations i LEFT JOIN grades g ON g.id = i.grade_id
     WHERE i.created_at > NOW() - INTERVAL 30 DAY OR (${PENDING.replace(/(accepted_at|revoked_at|expires_at)/g, 'i.$1')})
     ORDER BY i.created_at DESC LIMIT 300`
  );
  return rows.map(r => ({ ...r, status: statusOf(r) }));
}

// Returns { invitation } or { status, error }. Sends the e-mail; without the instance e-mail, nothing
// is created (the link is never shown to the one who invites: only the address it is sent to opens it).
async function createInvitation(db, guild, { email, role = 'support', gradeId = null, lang = 'fr' }, actor) {
  const mail = accounts.normEmail(email);
  if (!EMAIL_RE.test(mail) || mail.length > 254) return { status: 400, error: 'Adresse e-mail invalide' };
  if (!ROLES.includes(role)) return { status: 400, error: 'Rôle invalide' };
  const grade = gradeId == null || gradeId === '' ? null : Number(gradeId);
  if (grade !== null) {
    if (!Number.isInteger(grade) || !(await db('SELECT 1 FROM grades WHERE id = ?', [grade])).length) return { status: 400, error: 'Grade introuvable' };
  }
  const mailer = require('./instanceMail');
  if (!(await mailer.mailSettings()).enabled) return { status: 409, error: 'Configure d\'abord l\'e-mail de l\'instance (Instance → E-mail) : l\'invitation part par e-mail' };
  const member = await accounts.findByVerifiedEmail(mail);
  if (member) {
    const [row] = await db("SELECT role FROM dashboard_users WHERE user_id = ? AND role IN ('support','fondateur')", [member.id]);
    if (row) return { status: 409, error: 'Cette personne fait déjà partie de l\'équipe' };
  }
  const [{ n }] = await db(`SELECT COUNT(*) AS n FROM team_invitations WHERE ${PENDING}`);
  if (Number(n) >= MAX_PENDING) return { status: 429, error: `Trop d'invitations en attente (${MAX_PENDING}) : révoque les anciennes` };

  const token = `${guild.guild_id}.${crypto.randomBytes(32).toString('base64url')}`;
  // A new invitation to the same address replaces the one still pending
  await db(`UPDATE team_invitations SET revoked_at = NOW() WHERE email = ? AND ${PENDING}`, [mail]);
  const { insertId } = await db(
    'INSERT INTO team_invitations (email, role, grade_id, token_hash, invited_by_id, invited_by_tag, expires_at) VALUES (?, ?, ?, ?, ?, ?, NOW() + INTERVAL ? DAY)',
    [mail, role, grade, sha(token), String(actor.id), String(actor.username || actor.id).slice(0, 100), TTL_DAYS]
  );
  try {
    await mailer.sendInstanceMail({
      to: mail, template: 'invitation', lang: lang === 'fr' ? 'fr' : 'en',
      vars: { space: guild.guild_name, by: actor.username, link: `${base()}/invitation?token=${encodeURIComponent(token)}`, days: TTL_DAYS },
    });
  } catch (err) {
    await db('DELETE FROM team_invitations WHERE id = ?', [insertId]);
    return { status: 502, error: `E-mail non envoyé : ${String(err.message).slice(0, 200)}` };
  }
  const [row] = await db('SELECT id, email, role, grade_id, created_at, expires_at FROM team_invitations WHERE id = ?', [insertId]);
  return { invitation: { ...row, status: 'pending' } };
}

async function revokeInvitation(db, id) {
  const r = await db(`UPDATE team_invitations SET revoked_at = NOW() WHERE id = ? AND ${PENDING}`, [Number(id) || 0]);
  return r.affectedRows === 1;
}

// The space and the invitation behind a token, whatever its state; null when unknown
async function lookup(token) {
  const m = TOKEN_RE.exec(typeof token === 'string' ? token : '');
  if (!m) return null;
  const [guild] = await globalQuery("SELECT guild_id, guild_name, guild_icon, discord FROM guilds WHERE guild_id = ? AND status = 'active'", [m[1]]);
  if (!guild) return null;
  const db = getTenantDb(guild.guild_id);
  const [inv] = await db('SELECT * FROM team_invitations WHERE token_hash = ?', [sha(token)]).catch(() => []);
  return inv ? { guild, db, inv, status: statusOf(inv) } : null;
}

const STATUS_ERRORS = {
  accepted: 'Cette invitation a déjà été utilisée',
  revoked: 'Cette invitation a été révoquée',
  expired: 'Cette invitation a expiré : demande-en une nouvelle',
};

// What the page /invitation shows before accepting
async function describe(token, sessionUser) {
  const found = await lookup(token);
  if (!found) return { status: 404, error: 'Invitation introuvable' };
  if (found.status !== 'pending') return { status: 410, error: STATUS_ERRORS[found.status] };
  const { guild, inv } = found;
  const existing = sessionUser ? null : await accounts.findByVerifiedEmail(inv.email);
  return {
    space: guild.guild_name, email: inv.email, role: inv.role, invitedBy: inv.invited_by_tag, expiresAt: inv.expires_at,
    signedIn: sessionUser ? { username: sessionUser.username } : null,
    // Not signed in: create an account, or sign in to the one that has this address
    needsLogin: !sessionUser && !!existing,
  };
}

// Accepts. sessionUser: the signed-in account, or null (then { displayName, password } create one).
// Returns { guildId, account, created } or { status, error }.
async function accept(token, sessionUser, { displayName, password } = {}) {
  const found = await lookup(token);
  if (!found) return { status: 404, error: 'Invitation introuvable' };
  if (found.status !== 'pending') return { status: 410, error: STATUS_ERRORS[found.status] };
  const { guild, db, inv } = found;

  let account = null;
  let toCreate = null;
  if (sessionUser) {
    account = await accounts.getAccount(sessionUser.id);
    if (!account || account.disabled) return { status: 403, error: 'Ce compte est désactivé' };
  } else {
    if (await accounts.findByVerifiedEmail(inv.email)) return { status: 409, error: 'Un compte utilise déjà cette adresse : connecte-toi puis rouvre le lien', needsLogin: true };
    const name = String(displayName || '').trim().slice(0, 100);
    if (!name) return { status: 400, error: 'Nom requis' };
    const { passwordProblem, hashPassword } = require('./passwords');
    const problem = passwordProblem(typeof password === 'string' ? password : '', { email: inv.email });
    if (problem) return { status: 400, error: problem };
    toCreate = { id: `u_${crypto.randomBytes(12).toString('hex')}`, name, hash: await hashPassword(password) };
  }

  // One use: the first request that marks it wins
  const claim = await db(`UPDATE team_invitations SET accepted_at = NOW(), accepted_by = ? WHERE id = ? AND ${PENDING}`,
    [toCreate?.id || account.id, inv.id]);
  if (claim.affectedRows !== 1) return { status: 410, error: STATUS_ERRORS.accepted };

  if (toCreate) {
    // The link reached this address: it is confirmed
    await globalQuery(
      'INSERT INTO accounts (id, email, email_verified, display_name, password_hash, last_login_at) VALUES (?, ?, 1, ?, ?, NOW())',
      [toCreate.id, inv.email, toCreate.name, toCreate.hash]
    );
    account = await accounts.getAccount(toCreate.id);
  }

  // Joins the team, managed by hand (a Discord role sync never removes it); a founder stays founder
  await db(
    `INSERT INTO dashboard_users (user_id, username, avatar, role, discord_has_role, approved_by, approved_at) VALUES (?, ?, ?, ?, 0, ?, NOW())
     ON DUPLICATE KEY UPDATE role = IF(role = 'fondateur', role, VALUES(role)), discord_has_role = 0, approved_by = VALUES(approved_by), approved_at = NOW()`,
    [account.id, String(account.display_name || account.id).slice(0, 100), account.avatar || null, inv.role, inv.invited_by_id]
  );
  if (inv.grade_id) {
    await db('INSERT IGNORE INTO user_grades (user_id, grade_id, assigned_by_id, assigned_by_tag) VALUES (?, ?, ?, ?)',
      [account.id, inv.grade_id, inv.invited_by_id, inv.invited_by_tag]).catch(() => null);
  }
  await require('./audit').recordEvent(db, {
    actor: { id: account.id, tag: account.display_name }, action: 'invitation_accepted', targetType: 'user', targetId: account.id,
    details: { email: inv.email, role: inv.role, invitedBy: inv.invited_by_tag },
  }).catch(() => null);
  return { guildId: guild.guild_id, account, created: !!toCreate };
}

module.exports = { listInvitations, createInvitation, revokeInvitation, describe, accept, TTL_DAYS, ROLES };

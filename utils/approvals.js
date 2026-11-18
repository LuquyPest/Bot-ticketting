// Approvals (v4.2): a ticket asks a person for their agreement before it moves on — a staff
// member (decides on the ticket view), or someone outside the team by e-mail (decides through a
// one-time link, 14 days, only its SHA-256 kept). Agreed: the ticket can move to the status chosen
// when asking (next_stage); refused: it stays where it is, with the comment. Pending approvals are
// reminded by hand (once an hour at most) and automatically after 24 h (3 times at most).
// Every step is a system note in the ticket and an event of its journal.
const crypto = require('crypto');
const { recordEvent } = require('./audit');
const { broadcast, sendToUser } = require('./sse');
const { CONFIDENTIAL } = require('./gradePermissions');

const LINK_DAYS = 14;
const MANUAL_REMIND_MS = 60 * 60 * 1000;
const AUTO_REMIND_MS = 24 * 3600 * 1000;
const MAX_AUTO_REMINDERS = 3;
const MAX_REMINDERS = 5;
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const base = () => (require('./config').config.webServerBaseUrl || '').replace(/\/$/, '');
const err = (message, status = 400) => Object.assign(new Error(message), { status });

async function note(db, ticketId, actor, content) {
  const r = await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, 'system')",
    [ticketId, actor?.id || 'system', String(actor?.tag || actor?.username || 'Système').slice(0, 100), content.slice(0, 4000)]);
  return r.insertId;
}

const shape = a => ({
  id: a.id, ticketId: a.ticket_id, status: a.status, reason: a.reason, nextStage: a.next_stage,
  approver: { id: a.approver_id || null, email: a.approver_email || null, name: a.approver_name },
  requestedBy: a.requested_by_tag, requestedById: a.requested_by_id, comment: a.decision_comment, decidedBy: a.decided_by_tag,
  decidedAt: a.decided_at, remindedAt: a.reminded_at, remindCount: Number(a.remind_count) || 0, createdAt: a.created_at,
});

async function listForTicket(db, ticketId) {
  return (await db('SELECT * FROM ticket_approvals WHERE ticket_id = ? ORDER BY id DESC', [ticketId])).map(shape);
}

// Tells the approver: dashboard notification, push and DM for staff; e-mail with a new link otherwise
async function notifyApprover(db, client, guildId, a, ticket, by, { reminder = false } = {}) {
  const title = reminder ? `Relance : validation demandée (ticket #${ticket.id})` : `Validation demandée (ticket #${ticket.id})`;
  if (a.approver_id) {
    sendToUser(guildId, a.approver_id, 'approval', { ticketId: ticket.id, approvalId: a.id, by, reminder });
    require('../web/routes/push').sendPushToUser(guildId, a.approver_id, { type: 'approval', title, body: `${by} : ${String(a.reason).slice(0, 120)}`, ticketId: ticket.id }).catch(() => null);
    const user = await client?.users?.fetch(a.approver_id).catch(() => null);
    if (user) {
      const link = base() ? `\n${base()}/tickets/${ticket.id}` : '';
      await user.send({ content: `🛂 **${title}**\n${by} demande ton accord sur « ${ticket.subject || 'Sans sujet'} » :\n> ${String(a.reason).slice(0, 500)}${link}` }).catch(() => null);
    }
    return;
  }
  // E-mail: a new link each time (the previous one stops working)
  const token = crypto.randomBytes(32).toString('base64url');
  await db('UPDATE ticket_approvals SET token_hash = ?, expires_at = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id = ?', [sha(token), LINK_DAYS, a.id]);
  const { globalQuery } = require('./globalDb');
  const [space] = await globalQuery('SELECT guild_name FROM guilds WHERE guild_id = ?', [guildId]).catch(() => []);
  await require('./instanceMail').sendInstanceMail({
    to: a.approver_email, template: 'approvalRequest', lang: require('./i18n').lang(),
    vars: { space: space?.guild_name || 'Support', id: ticket.id, subject: ticket.subject || '—', by, reason: a.reason, link: `${base()}/validation#${token}`, days: LINK_DAYS },
  });
}

// input: { approverId | approverEmail, approverName?, reason, nextStage? }
async function requestApproval({ db, client, guildId, ticket, input, actor }) {
  if (!ticket || ticket.status !== 'open') throw err('Ticket fermé');
  const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 2000) : '';
  if (!reason) throw err('Explique ce qui doit être validé');
  const [pending] = await db("SELECT id FROM ticket_approvals WHERE ticket_id = ? AND status = 'pending'", [ticket.id]);
  if (pending) throw err('Une validation est déjà en attente sur ce ticket', 409);
  let nextStage = null;
  if (input?.nextStage) {
    if (!(await require('./stages').stageOf(db, String(input.nextStage)))) throw err('Statut inconnu');
    nextStage = String(input.nextStage);
  }
  const confidential = ticket.visibility_grade_id === CONFIDENTIAL;
  let approverId = null, approverEmail = null, name;
  if (input?.approverId) {
    approverId = String(input.approverId);
    const [u] = await db("SELECT user_id, username, role FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [approverId]);
    if (!u) throw err('Seul le staff de l\'espace peut valider depuis le dashboard');
    if (confidential && u.role !== 'fondateur') throw err('Un ticket confidentiel ne peut être validé que par un fondateur');
    if (!(await require('./teams').canSee(db, approverId, ticket.id))) throw err('Cette personne ne peut pas voir le ticket');
    if (approverId === String(actor.id)) throw err('Demande l\'accord de quelqu\'un d\'autre que toi');
    name = u.username || approverId;
  } else {
    const { EMAIL_RE } = require('./emailTickets');
    approverEmail = String(input?.approverEmail || '').trim().toLowerCase();
    if (!EMAIL_RE.test(approverEmail) || approverEmail.length > 254) throw err('Adresse e-mail invalide');
    if (confidential) throw err('Un ticket confidentiel ne peut pas être envoyé à l\'extérieur');
    if (!(await require('./instanceMail').mailSettings().catch(() => ({}))).enabled) throw err('L\'e-mail de l\'instance n\'est pas configuré (Instance → Santé)', 409);
    name = (typeof input?.approverName === 'string' && input.approverName.replace(/[\r\n]+/g, ' ').trim().slice(0, 100)) || approverEmail;
  }
  const by = String(actor.username || actor.tag || 'Le staff').slice(0, 100);
  const { insertId } = await db(
    'INSERT INTO ticket_approvals (ticket_id, approver_id, approver_email, approver_name, reason, next_stage, requested_by_id, requested_by_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [ticket.id, approverId, approverEmail, name, reason, nextStage, String(actor.id), by]);
  const [a] = await db('SELECT * FROM ticket_approvals WHERE id = ?', [insertId]);
  try { await notifyApprover(db, client, guildId, a, ticket, by); } catch (e) {
    await db('DELETE FROM ticket_approvals WHERE id = ?', [insertId]);
    throw err(`Envoi impossible : ${e.message}`, 502);
  }
  await note(db, ticket.id, actor, `🛂 Validation demandée à ${name} : ${reason}`);
  await recordEvent(db, { actor, action: 'approval_request', ticketId: ticket.id, details: { approver: name, external: !approverId, nextStage } });
  broadcast('ticket', { id: ticket.id, approval: 'pending' }, guildId);
  return shape(a);
}

// decision: 'approved' | 'rejected'. decider: { id, tag } (dashboard) or the external approver
async function decide({ db, client, guildId, approval, decision, comment, decider, tm }) {
  if (!['approved', 'rejected'].includes(decision)) throw err('Décision invalide');
  if (approval.status !== 'pending') throw err('Cette validation a déjà reçu une réponse', 409);
  const text = typeof comment === 'string' ? comment.trim().slice(0, 1000) : '';
  const tag = String(decider.tag || decider.username || approval.approver_name).slice(0, 100);
  // Only the first answer counts (two tabs, a link opened twice)
  const r = await db("UPDATE ticket_approvals SET status = ?, decision_comment = ?, decided_by_tag = ?, decided_at = NOW(), token_hash = NULL WHERE id = ? AND status = 'pending'",
    [decision, text || null, tag, approval.id]);
  if (!r.affectedRows) throw err('Cette validation a déjà reçu une réponse', 409);
  const actor = { id: decider.id || 'approval', tag, source: decider.id ? 'dashboard' : 'approval' };
  await note(db, approval.ticket_id, actor, `${decision === 'approved' ? '✅ Validation accordée' : '❌ Validation refusée'} par ${tag}${text ? ` : ${text}` : ''}`);
  await recordEvent(db, { actor, action: decision === 'approved' ? 'approval_approved' : 'approval_rejected', ticketId: approval.ticket_id, details: { approver: approval.approver_name, comment: text || null } });
  let moved = null;
  if (decision === 'approved' && approval.next_stage && tm) {
    const [t] = await db('SELECT status FROM tickets WHERE id = ?', [approval.ticket_id]);
    if (t?.status === 'open') moved = await tm.moveToStage(approval.ticket_id, approval.next_stage, actor).catch(e => ({ ok: false, error: e.message }));
  }
  // The person who asked is told
  if (approval.requested_by_id) {
    sendToUser(guildId, approval.requested_by_id, 'approval', { ticketId: approval.ticket_id, approvalId: approval.id, decision, by: tag });
    require('../web/routes/push').sendPushToUser(guildId, approval.requested_by_id, {
      type: 'approval', title: `${decision === 'approved' ? 'Validation accordée' : 'Validation refusée'} (ticket #${approval.ticket_id})`, body: `${tag}${text ? ` : ${text.slice(0, 120)}` : ''}`, ticketId: approval.ticket_id,
    }).catch(() => null);
  }
  broadcast('ticket', { id: approval.ticket_id, approval: decision }, guildId);
  return { ok: true, moved: moved ? !!moved.ok : null, moveError: moved && !moved.ok ? moved.error : null };
}

async function remind({ db, client, guildId, approval, actor, auto = false }) {
  if (approval.status !== 'pending') throw err('Cette validation a déjà reçu une réponse', 409);
  if (Number(approval.remind_count) >= MAX_REMINDERS) throw err(`${MAX_REMINDERS} relances au plus`, 429);
  const last = new Date(approval.reminded_at || approval.created_at).getTime();
  if (!auto && Date.now() - last < MANUAL_REMIND_MS) throw err('Une relance par heure au plus', 429);
  const [ticket] = await db('SELECT id, subject, status FROM tickets WHERE id = ?', [approval.ticket_id]);
  if (!ticket || ticket.status !== 'open') throw err('Ticket fermé');
  await notifyApprover(db, client, guildId, approval, ticket, auto ? 'Rappel automatique' : String(actor.username || actor.tag || 'Le staff'), { reminder: true });
  await db('UPDATE ticket_approvals SET reminded_at = NOW(), remind_count = remind_count + 1 WHERE id = ?', [approval.id]);
  await recordEvent(db, { actor: actor || { id: 'system', tag: 'Rappel automatique', source: 'system' }, action: 'approval_remind', ticketId: ticket.id, details: { approver: approval.approver_name, auto } });
  return { ok: true };
}

async function cancel({ db, guildId, approval, actor }) {
  if (approval.status !== 'pending') throw err('Cette validation a déjà reçu une réponse', 409);
  await db("UPDATE ticket_approvals SET status = 'cancelled', token_hash = NULL, decided_by_tag = ?, decided_at = NOW() WHERE id = ? AND status = 'pending'", [String(actor.username || actor.tag).slice(0, 100), approval.id]);
  await note(db, approval.ticket_id, actor, `🛂 Demande de validation à ${approval.approver_name} annulée`);
  await recordEvent(db, { actor, action: 'approval_cancel', ticketId: approval.ticket_id, details: { approver: approval.approver_name } });
  broadcast('ticket', { id: approval.ticket_id, approval: 'cancelled' }, guildId);
  return { ok: true };
}

// External link « <space>.<id> » is not needed: the token is looked up in every active space
async function findByToken(token) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 60) return null;
  const { getActiveGuilds } = require('./guildScan');
  const { getTenantDb } = require('./tenantDb');
  const hash = sha(token);
  for (const { guild_id } of await getActiveGuilds()) {
    const db = getTenantDb(guild_id);
    const [a] = await db("SELECT * FROM ticket_approvals WHERE token_hash = ? AND status = 'pending' AND expires_at > NOW()", [hash]).catch(() => []);
    if (a) return { guildId: guild_id, db, approval: a };
  }
  return null;
}

// Job « approval-reminders » (hourly): pending for 24 h since the request or the last reminder
async function runApprovalReminders(client) {
  const { getActiveGuilds } = require('./guildScan');
  const { getTenantDb } = require('./tenantDb');
  let sent = 0;
  for (const { guild_id } of await getActiveGuilds()) {
    const db = getTenantDb(guild_id);
    const due = await db(
      `SELECT a.* FROM ticket_approvals a JOIN tickets t ON t.id = a.ticket_id
       WHERE a.status = 'pending' AND t.status = 'open' AND a.remind_count < ?
         AND COALESCE(a.reminded_at, a.created_at) <= NOW() - INTERVAL ? SECOND`, [MAX_AUTO_REMINDERS, AUTO_REMIND_MS / 1000]).catch(() => []);
    for (const a of due) {
      await remind({ db, client, guildId: guild_id, approval: a, actor: null, auto: true }).then(() => sent++).catch(() => null);
    }
  }
  return { sent };
}

module.exports = { LINK_DAYS, listForTicket, requestApproval, decide, remind, cancel, findByToken, runApprovalReminders, shape };

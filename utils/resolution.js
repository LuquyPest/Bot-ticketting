// Resolving a ticket (v5.1, conception/v5.md §3.2): the staff writes the solution, the requester
// receives it on their channel and confirms (button in DM, member space, single-use link by
// e-mail) — then the ticket closes as usual (transcript, rating request). If the requester writes
// anything instead, the ticket goes on. Without an answer, it closes after N days.
// A resolved ticket stays « open » until then: its deadline is stopped, no inactivity reminder.
const crypto = require('crypto');
const { recordEvent } = require('./audit');
const { broadcast } = require('./sse');
const { config } = require('./config');

const SOLUTION_MAX = 4000;
const AUTO_CLOSER = { id: 'system', tag: 'Clôture automatique (résolu)', username: 'Clôture automatique', source: 'system', reason: 'résolu, sans réponse du demandeur' };
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const base = () => (config.webServerBaseUrl || '').replace(/\/$/, '');
const err = (message, status = 400) => Object.assign(new Error(message), { status });

async function resolutionSettings(db) {
  const [cfg] = await db('SELECT resolution_enabled, resolution_autoclose_days FROM guild_config WHERE id = 1').catch(() => []);
  const days = Number(cfg?.resolution_autoclose_days);
  return { enabled: !!Number(cfg?.resolution_enabled), autoCloseDays: Number.isInteger(days) && days >= 0 && days <= 90 ? days : 7 };
}

async function note(db, ticketId, actor, content) {
  await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, 'system')",
    [ticketId, String(actor?.id || 'system'), String(actor?.tag || actor?.username || 'Système').slice(0, 100), content.slice(0, 4000)]);
}

// actor: who resolves (staff or API key). → { ok, url } (the confirmation link, for the tests)
async function resolveTicket({ db, client, guildId, ticket, solution, actor }) {
  const s = await resolutionSettings(db);
  if (!s.enabled) throw err('La résolution n\'est pas activée (Paramètres → Tickets) : ferme le ticket');
  if (!ticket || ticket.status !== 'open') throw err('Ticket fermé');
  if (ticket.resolved_at) throw err('Ce ticket est déjà résolu, en attente du demandeur', 409);
  const text = typeof solution === 'string' ? solution.trim() : '';
  if (!text || text.length > SOLUTION_MAX) throw err(`Écris la solution (${SOLUTION_MAX} caractères au plus)`);
  const token = crypto.randomBytes(32).toString('base64url');
  const by = String(actor.username || actor.tag || 'Le staff').slice(0, 100);
  const r = await db('UPDATE tickets SET resolved_at = NOW(), resolution = ?, resolved_by_tag = ?, resolution_token = ? WHERE id = ? AND status = ? AND resolved_at IS NULL',
    [text, by, sha(token), ticket.id, 'open']);
  if (!r.affectedRows) throw err('Ce ticket est déjà résolu, en attente du demandeur', 409);
  await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, 'reply')", [ticket.id, String(actor.id), by, `✅ Solution : ${text}`]);
  await recordEvent(db, { actor, action: 'ticket_resolve', ticketId: ticket.id, details: { excerpt: text.slice(0, 120) } });
  const url = `${base()}/solution#${guildId}.${token}`;
  // To each requester of the ticket, on their channel, with the way to confirm
  const { t, sendToMember } = require('./i18n');
  const { ticketNoticeDmEmbed } = require('./dmEmbeds');
  const { resolutionButtons } = require('./components');
  const tm = require('./ticketManager').createManager(db, client, guildId);
  for (const uid of await tm.getAllLinkedUserIds(ticket.id)) {
    await sendToMember(client, uid, guildId, () => ({
      embeds: [ticketNoticeDmEmbed(client, guildId, ticket, {
        title: t('resolution.title'), color: 'success',
        description: `${text}\n\n${t('resolution.body')}${s.autoCloseDays ? `\n${t('resolution.autoclose', { days: s.autoCloseDays })}` : ''}\n\n${t('resolution.link', { url })}`,
      })],
      components: [resolutionButtons(ticket.id, guildId)],
    }), { ticketId: ticket.id, sender: { id: actor.id } }).catch(() => null);
  }
  broadcast('ticket', { id: ticket.id, resolved: true }, guildId);
  return { ok: true, url };
}

// The requester confirms: the ticket closes (transcript, rating request), as when they close it
async function acceptResolution({ db, client, guildId, ticket, by }) {
  if (!ticket || ticket.status !== 'open' || !ticket.resolved_at) throw err('Ce ticket n\'attend plus de confirmation', 410);
  const r = await db('UPDATE tickets SET resolution_token = NULL WHERE id = ? AND resolved_at IS NOT NULL AND status = ?', [ticket.id, 'open']);
  if (!r.affectedRows) throw err('Ce ticket n\'attend plus de confirmation', 410);
  await note(db, ticket.id, by, '👍 Solution confirmée par le demandeur.');
  await recordEvent(db, { actor: by, action: 'ticket_resolution_accept', ticketId: ticket.id });
  await closeResolved({ db, client, guildId, ticket, by: { ...by, member: true, reason: 'Solution confirmée' } });
}

async function closeResolved({ db, client, guildId, ticket, by }) {
  const channel = await require('./virtualChannel').ticketChannel(client, db, ticket);
  const tm = require('./ticketManager').createManager(db, client, guildId);
  if (channel) await tm.closeTicketWithTranscript(channel, by);
  else {
    await db("UPDATE tickets SET status = 'closed', closed_at = NOW(), closed_by_tag = ? WHERE id = ?", [String(by.tag || 'Système').slice(0, 100), ticket.id]);
    await recordEvent(db, { actor: by, action: 'ticket_close', ticketId: ticket.id, details: { reason: by.reason } });
  }
  broadcast('ticket', { id: ticket.id, status: 'closed' }, guildId);
}

// Not solved after all: the requester wrote again, or said so, or the staff cancels — it goes on
async function reopenResolution({ db, guildId, ticket, by, comment = '', fromRequester = true }) {
  const r = await db('UPDATE tickets SET resolved_at = NULL, resolution_token = NULL, stage_changed_at = NOW() WHERE id = ? AND resolved_at IS NOT NULL', [ticket.id]);
  if (!r.affectedRows) return false;
  const c = String(comment || '').trim().slice(0, 1000);
  await note(db, ticket.id, by, fromRequester ? `↩️ Le demandeur n'est pas d'accord : le ticket reprend.${c ? `\n${c}` : ''}` : `↩️ Résolution annulée par ${by.tag || by.username}.`);
  await recordEvent(db, { actor: by, action: 'ticket_resolution_reopen', ticketId: ticket.id, details: { fromRequester, ...(c ? { comment: c } : {}) } });
  broadcast('ticket', { id: ticket.id, resolved: false }, guildId);
  return true;
}

// The ticket behind a confirmation link « <space>.<token> »
async function findByToken(link) {
  const m = /^(\d{17,20})\.([A-Za-z0-9_-]{40,50})$/.exec(String(link || ''));
  if (!m) return null;
  const { globalQuery } = require('./globalDb');
  const [g] = await globalQuery("SELECT guild_id, guild_name FROM guilds WHERE guild_id = ? AND status = 'active'", [m[1]]).catch(() => []);
  if (!g) return null;
  const db = require('./tenantDb').getTenantDb(g.guild_id);
  const [ticket] = await db("SELECT * FROM tickets WHERE resolution_token = ? AND status = 'open' AND resolved_at IS NOT NULL", [sha(m[2])]).catch(() => []);
  return ticket ? { guildId: g.guild_id, space: g.guild_name, db, ticket } : null;
}

// Job « resolution-autoclose » (hourly): resolved for N days without an answer → closed
async function runResolutionAutoClose(client) {
  const { getActiveGuilds } = require('./guildScan');
  const { getTenantDb } = require('./tenantDb');
  let closed = 0;
  for (const { guild_id } of await getActiveGuilds()) {
    const db = getTenantDb(guild_id);
    const s = await resolutionSettings(db).catch(() => ({ enabled: false }));
    if (!s.autoCloseDays) continue;
    // Also when the setting was turned off later: a resolved ticket never waits forever
    const due = await db("SELECT * FROM tickets WHERE status = 'open' AND resolved_at IS NOT NULL AND resolved_at <= NOW() - INTERVAL ? DAY", [s.autoCloseDays]).catch(() => []);
    for (const ticket of due) {
      await note(db, ticket.id, AUTO_CLOSER, `🔒 Fermé automatiquement : résolu depuis ${s.autoCloseDays} jour(s), sans réponse du demandeur.`).catch(() => null);
      await closeResolved({ db, client, guildId: guild_id, ticket, by: AUTO_CLOSER }).then(() => closed++).catch(e => console.error('résolution: clôture auto', guild_id, ticket.id, e.message));
    }
  }
  return closed;
}

module.exports = { SOLUTION_MAX, resolutionSettings, resolveTicket, acceptResolution, reopenResolution, findByToken, runResolutionAutoClose, closeResolved };

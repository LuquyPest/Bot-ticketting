// Personal data of a member on this server (GDPR): summary, JSON export, erasure. Founders only.
// Erasure removes the member's tickets (and everything attached: messages, transcripts, ratings,
// tags, scheduled messages), their messages and participation in other people's tickets, their
// blacklist entry and their pending conversations; journal entries are kept but anonymised.
// Other people's tickets are never deleted.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { recordEvent, dashboardActor } = require('../../utils/audit');
const { broadcast } = require('../../utils/sse');

const SNOWFLAKE_RE = /^\d{17,20}$/;

router.use((req, res, next) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  next();
});
router.param('userId', (req, res, next, id) => (SNOWFLAKE_RE.test(id) ? next() : res.status(400).json({ error: 'ID Discord invalide' })));

async function collect(db, userId) {
  const tickets = await db('SELECT * FROM tickets WHERE owner_id = ? ORDER BY id', [userId]);
  const ids = tickets.map(t => t.id);
  const inIds = ids.length ? ids : [0];
  const [notes, ratings, transcripts, participations, otherMessages, blacklist, journal] = await Promise.all([
    db('SELECT id, ticket_id, author_id, author_tag, content, source, created_at FROM ticket_notes WHERE ticket_id IN (?) ORDER BY id', [inIds]),
    db('SELECT ticket_id, rating, comment, rated_at FROM ticket_ratings WHERE owner_id = ?', [userId]),
    db('SELECT id, ticket_id, created_at, message_count, txt FROM transcript_snapshots WHERE ticket_id IN (?) ORDER BY id', [inIds]),
    db('SELECT p.ticket_id, t.subject, p.added_at FROM ticket_participants p JOIN tickets t ON t.id = p.ticket_id WHERE p.user_id = ? AND t.owner_id <> ?', [userId, userId]),
    db("SELECT n.id, n.ticket_id, n.content, n.created_at FROM ticket_notes n JOIN tickets t ON t.id = n.ticket_id WHERE n.author_id = ? AND n.source = 'user' AND t.owner_id <> ?", [userId, userId]),
    db('SELECT reason, added_at, expires_at FROM blacklist WHERE user_id = ?', [userId]),
    db('SELECT action, source, ticket_id, details, created_at FROM audit_log WHERE actor_id = ? OR target_id = ? ORDER BY id', [userId, userId]),
  ]);
  const staffNotes = await db('SELECT author_tag, content, created_at FROM member_notes WHERE member_id = ? ORDER BY id', [userId]).catch(() => []);
  const [profileRow] = await db('SELECT labels FROM member_profiles WHERE member_id = ?', [userId]).catch(() => []);
  const { openTranscript } = require('../../utils/transcriptCrypto');
  return { tickets, notes, ratings, transcripts: transcripts.map(t => ({ ...t, txt: openTranscript(t.txt) })), participations, otherMessages, blacklist, journal, staffNotes, labels: profileRow?.labels || null };
}

// GET /api/members/:userId — what the server holds about this member
router.get('/:userId', async (req, res) => {
  const d = await collect(req.guildDb, req.params.userId);
  res.json({
    userId: req.params.userId,
    tickets: d.tickets.length, openTickets: d.tickets.filter(t => t.status === 'open').length,
    messages: d.notes.length + d.otherMessages.length, transcripts: d.transcripts.length,
    ratings: d.ratings.length, participations: d.participations.length,
    blacklisted: d.blacklist.length > 0, journalEntries: d.journal.length,
    tag: d.tickets[0]?.owner_tag || null,
  });
});

// GET /api/members/:userId/export — full JSON export (download)
router.get('/:userId/export', async (req, res) => {
  const data = await collect(req.guildDb, req.params.userId);
  await recordEvent(req.guildDb, { actor: dashboardActor(req), action: 'member_data_export', targetType: 'user', targetId: req.params.userId });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="donnees-${req.params.userId}.json"`);
  res.send(JSON.stringify({ exportedAt: new Date().toISOString(), guildId: req.guildId, userId: req.params.userId, ...data }, null, 2));
});

// DELETE /api/members/:userId — erase the member's data on this server. Body: { confirm: userId }
router.delete('/:userId', async (req, res) => {
  try {
  const userId = req.params.userId;
  if (req.body?.confirm !== userId) return res.status(400).json({ error: 'Confirmation requise : renvoyer l\'ID du membre dans « confirm »' });
  const staff = await req.guildDb("SELECT role FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [userId]);
  if (staff.length) return res.status(400).json({ error: 'Ce compte fait partie du staff : retire-le d\'abord depuis la page Équipe' });

  const db = req.guildDb;
  const tickets = await db('SELECT id, channel_id, status FROM tickets WHERE owner_id = ?', [userId]);
  const client = req.app.locals.client;

  // Open tickets: their Discord channel goes too
  for (const t of tickets.filter(x => x.status === 'open' && x.channel_id)) {
    const ch = await client?.channels.fetch(t.channel_id).catch(() => null);
    await ch?.delete('Suppression des données du membre (RGPD)').catch(() => null);
  }
  const counts = { tickets: tickets.length };
  counts.ticketsDeleted = tickets.length ? (await db('DELETE FROM tickets WHERE owner_id = ?', [userId])).affectedRows : 0;
  counts.messagesElsewhere = (await db("DELETE FROM ticket_notes WHERE author_id = ? AND source = 'user'", [userId])).affectedRows;
  counts.participations = (await db('DELETE FROM ticket_participants WHERE user_id = ?', [userId])).affectedRows;
  await db('DELETE FROM ticket_ratings WHERE owner_id = ?', [userId]);
  await db('DELETE FROM blacklist WHERE user_id = ?', [userId]);
  // Staff notes and labels about the member (profile)
  counts.profileNotes = (await db('DELETE FROM member_notes WHERE member_id = ?', [userId]).catch(() => ({ affectedRows: 0 }))).affectedRows;
  await db('DELETE FROM member_profiles WHERE member_id = ?', [userId]).catch(() => null);
  counts.journalAnonymised = (await db(
    // SET runs left to right: actor_tag must be rewritten before actor_id changes
    "UPDATE audit_log SET actor_tag = IF(actor_id = ?, '[membre supprimé]', actor_tag), actor_id = IF(actor_id = ?, 'supprime', actor_id), target_id = IF(target_id = ?, NULL, target_id), details = NULL WHERE actor_id = ? OR target_id = ?",
    [userId, userId, userId, userId, userId]
  )).affectedRows;

  // Pending DM conversations and remembered language
  try {
    const r = require('../../utils/redis').getRedis();
    const keys = [...await r.keys(`pending:*:${userId}`), `locale:${userId}`];
    if (keys.length) await r.del(...keys);
    for (const k of keys.filter(k => k.startsWith('pending:'))) await r.zrem('pending:expiry', k.slice('pending:'.length));
  } catch { /* Redis unavailable: states expire on their own */ }

  // Traceability without keeping the identifier: only a hash
  const ref = crypto.createHash('sha256').update(`${req.guildId}:${userId}`).digest('hex').slice(0, 16);
  await recordEvent(db, { actor: dashboardActor(req), action: 'member_data_delete', targetType: 'member', targetId: ref, details: counts });
  for (const t of tickets) broadcast('ticket', { id: t.id, deleted: true }, req.guildId);
  res.json({ ok: true, ...counts });
  } catch (err) {
    console.error('member data delete:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

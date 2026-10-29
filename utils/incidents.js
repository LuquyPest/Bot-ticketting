// Incident announcements: while an incident is open, every new ticket (all, or the chosen
// subjects) gets its message by DM right after the welcome, and is counted as affected. When the
// incident is resolved, the affected members can be told.
const { EmbedBuilder } = require('discord.js');
const { matchesSubject } = require('./subjectMatch');
const { parseJsonField } = require('./jsonField');
const { t, sendToMember } = require('./i18n');
const { broadcast } = require('./sse');
const logger = require('./logger');

const applies = (incident, subject) => {
  const subjects = parseJsonField(incident.subjects, null);
  return !subjects?.length || (!!subject && subjects.some(s => matchesSubject(s, subject)));
};

async function activeIncidents(db) {
  return db('SELECT * FROM incidents WHERE resolved_at IS NULL ORDER BY id');
}

// Called once a ticket is created (after the welcome DM)
async function notifyNewTicket({ db, client, guildId, ticketId, ownerId, subject }) {
  const list = (await activeIncidents(db).catch(() => [])).filter(i => applies(i, subject));
  for (const inc of list) {
    try {
      const { affectedRows } = await db('INSERT IGNORE INTO incident_tickets (incident_id, ticket_id, owner_id) VALUES (?, ?, ?)', [inc.id, ticketId, ownerId]);
      if (!affectedRows) continue;
      await sendToMember(client, ownerId, guildId, () => ({
        embeds: [new EmbedBuilder().setColor(0xf59e0b).setTitle(t('incident.title')).setDescription(`**${inc.title}**\n${inc.message}`).setFooter({ text: t('incident.footer') })],
      }));
      const nr = await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, '0', 'Système', ?, 'system')",
        [ticketId, `📢 Incident « ${inc.title} » communiqué au membre`]);
      broadcast('note', { ticketId, note: { id: nr.insertId, ticket_id: ticketId, author_id: '0', author_tag: 'Système', content: `📢 Incident « ${inc.title} » communiqué au membre`, source: 'system', created_at: new Date() } }, guildId);
    } catch (err) {
      logger.error('Annonce d\'incident', { guildId, ticketId, incident: inc.id, err: err.message });
    }
  }
  return list.map(i => i.id);
}

async function listIncidents(db) {
  const rows = await db(`SELECT i.*, (SELECT COUNT(DISTINCT owner_id) FROM incident_tickets it WHERE it.incident_id = i.id) AS members,
                                (SELECT COUNT(*) FROM incident_tickets it WHERE it.incident_id = i.id) AS tickets
                         FROM incidents i ORDER BY i.resolved_at IS NULL DESC, i.id DESC LIMIT 100`);
  return rows.map(r => ({ ...r, subjects: parseJsonField(r.subjects, null), members: Number(r.members), tickets: Number(r.tickets), notify_on_resolve: !!r.notify_on_resolve }));
}

// Resolves and tells every affected member (once each); returns the number of DMs sent
async function resolveIncident({ db, client, guildId, incident, message, actor }) {
  await db('UPDATE incidents SET resolved_at = NOW(), resolved_by_tag = ?, resolved_message = ? WHERE id = ?', [actor.username, message || null, incident.id]);
  if (!incident.notify_on_resolve) return 0;
  const owners = await db('SELECT DISTINCT owner_id FROM incident_tickets WHERE incident_id = ?', [incident.id]);
  let sent = 0;
  for (const { owner_id } of owners) {
    const ok = await sendToMember(client, owner_id, guildId, () => ({
      embeds: [new EmbedBuilder().setColor(0x10b981).setTitle(t('incident.resolved')).setDescription(`**${incident.title}**${message ? `\n${message}` : ''}`)],
    }));
    if (ok) sent++;
  }
  return sent;
}

module.exports = { notifyNewTicket, listIncidents, resolveIncident, applies };

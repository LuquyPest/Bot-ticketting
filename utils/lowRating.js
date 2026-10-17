// Low satisfaction rating (≤ guild_config.low_rating_threshold, 0 = off): the founders and the
// chief support members are told (live notification, push, Discord DM with the ticket link)
// so someone can get back to the member (POST /api/tickets/:id/followup).
const { EmbedBuilder } = require('discord.js');
const { sendToUser } = require('./sse');
const logger = require('./logger');

async function notifyLowRating(db, client, guildId, ticketId, rating) {
  try {
    const [cfg] = await db('SELECT low_rating_threshold, chief_grade_id FROM guild_config WHERE id = 1');
    const threshold = Number(cfg?.low_rating_threshold ?? 2);
    if (!threshold || rating > threshold) return [];
    const [ticket] = await db('SELECT id, subject, owner_tag FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) return [];
    const recipients = await db(
      `SELECT DISTINCT u.user_id FROM dashboard_users u
       WHERE u.role = 'fondateur' OR (u.role = 'support' AND u.user_id IN (SELECT user_id FROM user_grades WHERE grade_id = ?))`,
      [cfg?.chief_grade_id || 0]
    );
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    const { config } = require('./config');
    const base = config.webServerBaseUrl;
    for (const r of recipients) {
      sendToUser(guildId, r.user_id, 'low_rating', { ticketId: ticket.id, rating, subject: ticket.subject, ownerTag: ticket.owner_tag });
      require('../web/routes/push').sendPushToUser(guildId, r.user_id, {
        type: 'low_rating', title: `Note ${rating}/5 · ticket #${ticket.id}`, body: `${ticket.owner_tag} — à recontacter`, ticketId: ticket.id,
      }).catch(() => null);
      const user = await client?.users.fetch(r.user_id).catch(() => null);
      if (!user) continue;
      const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setAuthor({ name: `${client.guilds.cache.get(guildId)?.name || 'Support'} · Ticket #${ticket.id}${ticket.subject ? ` — ${ticket.subject}` : ''}`.slice(0, 256) })
        .setDescription(`**${stars}** — ${ticket.owner_tag} a donné une note de **${rating}/5**.\nQuelqu'un peut le recontacter depuis la fiche du ticket.`)
        .setTimestamp();
      if (base) embed.setTitle('Ouvrir le ticket').setURL(`${base.replace(/\/$/, '')}/tickets/${ticket.id}`);
      await user.send({ embeds: [embed] }).catch(() => null);
    }
    return recipients.map(r => r.user_id);
  } catch (err) {
    logger.error('Alerte de note basse', { guildId, ticketId, err: err.message });
    return [];
  }
}

module.exports = { notifyLowRating };

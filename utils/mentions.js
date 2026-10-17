// @mentions in internal notes: "@username" (dashboard username) or "<@discordId>".
// The mentioned staff members who can see the ticket get a live notification, a push and a
// Discord DM with a link to the ticket (DM can be turned off from the profile).
const { EmbedBuilder } = require('discord.js');
const { sendToUser } = require('./sse');
const { canUserSeeTicket } = require('./gradePermissions');
const logger = require('./logger');

const MENTION_RE = /<@!?(\d{17,20})>|(?:^|[\s(])@([\w.]{2,32})/g;

async function findMentionedStaff(db, content) {
  const ids = new Set(), names = new Set();
  for (const m of String(content || '').matchAll(MENTION_RE)) {
    if (m[1]) ids.add(m[1]); else names.add(m[2].toLowerCase());
  }
  if (!ids.size && !names.size) return [];
  const staff = await db("SELECT user_id, username, notify_mention_dm FROM dashboard_users WHERE role IN ('support', 'fondateur')");
  return staff.filter(s => ids.has(s.user_id) || names.has(String(s.username).toLowerCase()));
}

async function notifyMentions(db, client, guildId, ticket, content, author) {
  try {
    const mentioned = (await findMentionedStaff(db, content)).filter(s => s.user_id !== author.id);
    const notified = [];
    for (const s of mentioned) {
      if (!(await canUserSeeTicket(db, s.user_id, ticket.visibility_grade_id).catch(() => false))) continue;
      const excerpt = String(content).slice(0, 200);
      sendToUser(guildId, s.user_id, 'mention', { ticketId: ticket.id, subject: ticket.subject, by: author.username, excerpt });
      require('../web/routes/push').sendPushToUser(guildId, s.user_id, {
        type: 'mention', title: `${author.username} t'a mentionné · ticket #${ticket.id}`, body: excerpt, ticketId: ticket.id,
      }).catch(() => null);
      if (s.notify_mention_dm) {
        const user = await client?.users.fetch(s.user_id).catch(() => null);
        if (user) {
          const { config } = require('./config');
          const base = config.webServerBaseUrl;
          const guildName = client.guilds.cache.get(guildId)?.name;
          const embed = new EmbedBuilder()
            .setColor(0x6366f1)
            .setAuthor({ name: `${guildName || 'Support'} · Ticket #${ticket.id}${ticket.subject ? ` — ${ticket.subject}` : ''}`.slice(0, 256) })
            .setDescription(`**${author.username}** t'a mentionné dans une note interne :\n> ${excerpt.replace(/\n/g, '\n> ')}`)
            .setFooter({ text: 'Désactivable depuis ton profil sur le dashboard' });
          if (base) embed.setTitle('Ouvrir le ticket').setURL(`${base.replace(/\/$/, '')}/tickets/${ticket.id}`);
          await user.send({ embeds: [embed] }).catch(() => null);
        }
      }
      notified.push(s.user_id);
    }
    return notified;
  } catch (err) {
    logger.error('Notification de mention', { guildId, ticketId: ticket.id, err: err.message });
    return [];
  }
}

module.exports = { notifyMentions, findMentionedStaff };

// @mentions in internal notes: "@username" (dashboard username), "<@discordId>" or "@Grade name"
// (every staff member holding that grade).
// The mentioned staff members who can see the ticket get a live notification, a push and a
// Discord DM with a link to the ticket (DM can be turned off from the profile).
const { EmbedBuilder } = require('discord.js');
const { sendToUser } = require('./sse');
const { canUserSeeTicket } = require('./gradePermissions');
const logger = require('./logger');

const MENTION_RE = /<@!?(\d{17,20})>|(?:^|[\s(])@([\w.]{2,32})/g;

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Grades mentioned as "@Chef support" (the grade name, spaces included, case-insensitive)
async function findMentionedGrades(db, content) {
  const text = String(content || '');
  if (!text.includes('@')) return [];
  const grades = await db('SELECT id, name FROM grades');
  return grades.filter(g => g.name && new RegExp(`(^|[\\s(])@${escapeRe(g.name)}(?=$|[\\s.,;:!?)])`, 'i').test(text));
}

// Staff members mentioned directly or through one of their grades (`grade` set in that case)
async function findMentionedStaff(db, content) {
  const ids = new Set(), names = new Set();
  for (const m of String(content || '').matchAll(MENTION_RE)) {
    if (m[1]) ids.add(m[1]); else names.add(m[2].toLowerCase());
  }
  const grades = await findMentionedGrades(db, content);
  const viaGrade = new Map();
  if (grades.length) {
    const members = await db('SELECT user_id, grade_id FROM user_grades WHERE grade_id IN (?)', [grades.map(g => g.id)]);
    for (const m of members) if (!viaGrade.has(m.user_id)) viaGrade.set(m.user_id, grades.find(g => g.id === m.grade_id).name);
  }
  if (!ids.size && !names.size && !viaGrade.size) return [];
  const staff = await db("SELECT user_id, username, notify_mention_dm FROM dashboard_users WHERE role IN ('support', 'fondateur')");
  return staff
    .filter(s => ids.has(s.user_id) || names.has(String(s.username).toLowerCase()) || viaGrade.has(s.user_id))
    .map(s => ((ids.has(s.user_id) || names.has(String(s.username).toLowerCase())) ? s : { ...s, grade: viaGrade.get(s.user_id) }));
}

async function notifyMentions(db, client, guildId, ticket, content, author) {
  try {
    const mentioned = (await findMentionedStaff(db, content)).filter(s => s.user_id !== author.id);
    const notified = [];
    for (const s of mentioned) {
      if (!(await canUserSeeTicket(db, s.user_id, ticket.visibility_grade_id).catch(() => false))) continue;
      const excerpt = String(content).slice(0, 200);
      sendToUser(guildId, s.user_id, 'mention', { ticketId: ticket.id, subject: ticket.subject, by: author.username, excerpt, grade: s.grade || null });
      require('../web/routes/push').sendPushToUser(guildId, s.user_id, {
        type: 'mention', title: s.grade ? `${author.username} a mentionné « ${s.grade} » · ticket #${ticket.id}` : `${author.username} t'a mentionné · ticket #${ticket.id}`, body: excerpt, ticketId: ticket.id,
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
            .setDescription(`**${author.username}** ${s.grade ? `a mentionné ton grade **${s.grade}**` : 't\'a mentionné'} dans une note interne :\n> ${excerpt.replace(/\n/g, '\n> ')}`)
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

module.exports = { notifyMentions, findMentionedStaff, findMentionedGrades };

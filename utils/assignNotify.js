// "A ticket was assigned to you": live dashboard notification, browser push and a Discord DM
// (DM can be turned off from the profile). Nothing is sent when people assign themselves.
const { EmbedBuilder } = require('discord.js');
const { sendToUser } = require('./sse');
const logger = require('./logger');

async function notifyAssignee(db, client, guildId, ticketId, assignee, byUser) {
  if (!assignee?.id || !byUser?.id || assignee.id === byUser.id) return;
  try {
    const [ticket] = await db('SELECT id, subject, owner_tag, channel_id, priority FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) return;
    const by = byUser.username || byUser.tag || 'Un membre du staff';
    const title = `Ticket #${ticket.id} attribué`;
    const body = `${by} t'a attribué « ${ticket.subject || 'Sans sujet'} » (${ticket.owner_tag})`;

    sendToUser(guildId, assignee.id, 'assigned', { ticketId: ticket.id, subject: ticket.subject, ownerTag: ticket.owner_tag, by });
    require('../web/routes/push').sendPushToUser(guildId, assignee.id, { type: 'assigned', title, body, ticketId: ticket.id })
      .catch(() => null);

    const [prefs] = await db('SELECT notify_assign_dm FROM dashboard_users WHERE user_id = ?', [assignee.id]);
    if (prefs && !prefs.notify_assign_dm) return;
    const user = await client?.users.fetch(assignee.id).catch(() => null);
    if (!user) return;
    const { config } = require('./config');
    const base = config.webServerBaseUrl;
    const guildName = client.guilds.cache.get(guildId)?.name;
    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setAuthor({ name: `${guildName || 'Support'} · ${title}` })
      .setDescription(`${by} t'a attribué ce ticket.`)
      .addFields(
        { name: 'Sujet', value: ticket.subject || 'Sans sujet', inline: true },
        { name: 'Membre', value: ticket.owner_tag || '—', inline: true },
      );
    if (ticket.channel_id) embed.addFields({ name: 'Salon', value: `<#${ticket.channel_id}>`, inline: true });
    if (base) embed.setURL(`${base.replace(/\/$/, '')}/tickets/${ticket.id}`).setTitle('Ouvrir dans le dashboard');
    embed.setFooter({ text: 'Désactivable depuis ton profil sur le dashboard' });
    await user.send({ embeds: [embed] }).catch(() => null);
  } catch (err) {
    logger.error('Notification d\'attribution', { guildId, ticketId, err: err.message });
  }
}

module.exports = { notifyAssignee };

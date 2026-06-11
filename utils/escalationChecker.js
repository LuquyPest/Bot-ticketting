const { EmbedBuilder } = require('discord.js');
const { getActiveGuilds } = require('./guildScan');
const { getTenantDb } = require('./tenantDb');
const { createManager, getGuildConfig } = require('./ticketManager');

async function runEscalationCheckForGuild(client, guild_id) {
  const db = getTenantDb(guild_id);
  const tm = createManager(db, client, guild_id);
  const cfg = await getGuildConfig(db);

  const alertHours = cfg.escalation_alert_hours ?? 24;
  const closeHours = cfg.escalation_close_hours ?? 72;
  const alertChId  = cfg.escalation_alert_channel_id || cfg.close_log_channel_id;

  // 1. Tickets urgents sans réponse staff depuis alertHours → alerte
  const toAlert = await db(
    `SELECT t.id, t.channel_id, t.owner_tag, t.subject, t.claimed_by
     FROM tickets t
     WHERE t.status = 'open'
       AND t.priority = 'urgent'
       AND t.claimed_by IS NOT NULL
       AND t.escalation_alerted = 0
       AND (
         t.last_message_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
         OR (t.last_message_at IS NULL AND t.created_at < DATE_SUB(NOW(), INTERVAL ? HOUR))
       )`,
    [alertHours, alertHours]
  );

  for (const ticket of toAlert) {
    const [lastStaffReply] = await db(
      `SELECT created_at FROM ticket_notes
       WHERE ticket_id = ? AND source IN ('reply','web')
       ORDER BY created_at DESC LIMIT 1`,
      [ticket.id]
    );
    if (lastStaffReply && (Date.now() - new Date(lastStaffReply.created_at).getTime()) < alertHours * 3600000) {
      continue;
    }

    if (alertChId) {
      const ch = await client.channels.fetch(alertChId).catch(() => null);
      if (ch?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle(`🚨 Escalade — Ticket #${ticket.id}`)
          .setDescription(`Un ticket **urgent** n'a pas reçu de réponse staff depuis plus de **${alertHours}h**.`)
          .addFields(
            { name: 'Utilisateur',    value: ticket.owner_tag,           inline: true },
            { name: 'Pris en charge', value: ticket.claimed_by || '—',   inline: true },
            { name: 'Sujet',          value: ticket.subject || '(aucun)', inline: false }
          )
          .setFooter({ text: `Fermeture automatique prévue dans ${closeHours - alertHours}h si pas de réponse.` })
          .setTimestamp();
        await ch.send({ embeds: [embed] }).catch(() => null);
      }
    }
    await db('UPDATE tickets SET escalation_alerted = 1 WHERE id = ?', [ticket.id]);
  }

  // 2. Tickets déjà alertés dépassant closeHours → fermeture auto
  const toClose = await db(
    `SELECT id, channel_id FROM tickets
     WHERE status = 'open'
       AND priority = 'urgent'
       AND claimed_by IS NOT NULL
       AND escalation_alerted = 1
       AND (
         last_message_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
         OR (last_message_at IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR))
       )`,
    [closeHours, closeHours]
  );

  for (const ticket of toClose) {
    const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
    if (!channel) {
      await db(`UPDATE tickets SET status='closed', closed_at=NOW() WHERE id=?`, [ticket.id]);
      continue;
    }
    await channel.send('⏱️ Ce ticket urgent est fermé automatiquement après inactivité prolongée.').catch(() => null);
    await tm.closeTicketWithTranscript(channel, client.user).catch(console.error);
  }
}

async function runEscalationCheck(client) {
  let guilds;
  try {
    guilds = await getActiveGuilds();
  } catch (err) {
    console.error('escalationChecker: getActiveGuilds error:', err);
    return;
  }

  for (const { guild_id } of guilds) {
    try {
      await runEscalationCheckForGuild(client, guild_id);
    } catch (err) {
      console.error(`Erreur escalation checker [${guild_id}]:`, err);
    }
  }
}

function startEscalationChecker(client) {
  const intervalMs = 30 * 60 * 1000;
  setTimeout(async () => {
    await runEscalationCheck(client);
    setInterval(() => runEscalationCheck(client), intervalMs);
  }, 8 * 60 * 1000);
}

module.exports = { startEscalationChecker };

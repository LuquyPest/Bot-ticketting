const { SlashCommandBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');
const { checkRateLimit } = require('../utils/rateLimit');
const { broadcast } = require('../utils/sse');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Répond au membre')
    .addStringOption(o => o.setName('message').setDescription('Message à envoyer').setRequired(false))
    .addAttachmentOption(o => o.setName('fichier').setDescription('Fichier à envoyer').setRequired(false)),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db))) return;

    const cfg = await tm.getGuildConfig(db);
    const cooldown = ((cfg.reply_rate_limit_seconds ?? client.config?.replyRateLimitSeconds ?? 3)) * 1000;
    const remaining = checkRateLimit(`reply:${interaction.user.id}:${interaction.guildId}`, cooldown);
    if (remaining > 0) {
      return interaction.reply({ content: `Attends encore ${remaining}s avant de renvoyer une réponse.`, ephemeral: true });
    }

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) return interaction.reply({ content: 'Pas un ticket.', ephemeral: true });

    const content = interaction.options.getString('message') || '';
    const file    = interaction.options.getAttachment('fichier');
    if (!content && !file) return interaction.reply({ content: 'Message ou fichier requis.', ephemeral: true });

    const linkedUserIds = await tm.getAllLinkedUserIds(ticket.id);
    let msg = `--- ${interaction.user.username} : ${content || ''}`.trim();
    if (file) msg += `\nFichier : ${file.url}`;

    for (const userId of linkedUserIds) {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) await user.send(msg).catch(() => null);
    }

    await tm.recordStaffResponse(ticket.id, interaction.user);
    await tm.updateLastMessage(ticket.id);
    await interaction.reply({ content: 'Envoyé.', ephemeral: true });
    await interaction.channel.send(msg);

    const noteContent = [content, file?.url].filter(Boolean).join('\n');
    const result = await db(
      'INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, "reply")',
      [ticket.id, interaction.user.id, interaction.user.username, noteContent]
    ).catch(() => null);

    if (result) {
      broadcast('note', { ticketId: ticket.id, note: { id: result.insertId, ticket_id: ticket.id, author_id: interaction.user.id, author_tag: interaction.user.username, content: noteContent, source: 'reply', created_at: new Date() } }, interaction.guildId);
    }
  }
};

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');
const { checkRateLimit } = require('../utils/rateLimit');
const { sendDiscordReply } = require('../utils/discordReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('areply')
    .setDescription('Reponse anonyme')
    .addStringOption(option =>
      option.setName('message').setDescription('Message a envoyer').setRequired(false)
    )
    .addAttachmentOption(option =>
      option.setName('fichier').setDescription('Fichier a envoyer').setRequired(false)
    ),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'reply_ticket'))) return;

    const cfg = await tm.getGuildConfig(db);
    const cooldown = ((cfg.reply_rate_limit_seconds ?? client.config?.replyRateLimitSeconds ?? 3)) * 1000;
    const remaining = await checkRateLimit(`areply:${interaction.user.id}:${interaction.guildId}`, cooldown);
    if (remaining > 0) {
      return interaction.reply({ content: `Attends encore ${remaining}s avant de renvoyer une réponse.`, flags: MessageFlags.Ephemeral });
    }

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) return interaction.reply({ content: 'Pas un ticket', flags: MessageFlags.Ephemeral });

    const content = interaction.options.getString('message') || '';
    const file = interaction.options.getAttachment('fichier');
    if (!content && !file) return interaction.reply({ content: 'Tu dois fournir un message, un fichier ou les deux.', flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await sendDiscordReply({
      client, db, tm, guildId: interaction.guildId, ticket, author: interaction.user, channel: interaction.channel,
      content, fileUrl: file?.url || null, anonymous: true,
    });
    await interaction.editReply({ content: 'Envoyé.' });
  }
};

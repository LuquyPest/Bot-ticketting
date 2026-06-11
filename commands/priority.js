const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager, getGuildConfig } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');

const LABELS  = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };
const EMOJI   = { low: '🟢', normal: '🔵', urgent: '🔴' };
const COLORS  = { low: 0x3ba55c, normal: 0x5865f2, urgent: 0xed4245 };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('priority')
    .setDescription('Définit la priorité du ticket')
    .addStringOption(option =>
      option
        .setName('niveau')
        .setDescription('Niveau de priorité')
        .setRequired(true)
        .addChoices(
          { name: '🟢 Faible', value: 'low' },
          { name: '🔵 Normal', value: 'normal' },
          { name: '🔴 Urgent', value: 'urgent' }
        )
    ),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: 'Pas un ticket valide.', ephemeral: true });
    }

    const priority = interaction.options.getString('niveau', true);
    await tm.setPriority(ticket.id, priority);
    await tm.updateChannelTopic(ticket.id).catch(() => null);

    const label = LABELS[priority];
    const emoji = EMOJI[priority];

    const prioEmbed = new EmbedBuilder()
      .setColor(COLORS[priority])
      .setTitle(`${emoji} Priorité mise à jour`)
      .addFields(
        { name: 'Priorité', value: `${emoji} ${label}`, inline: true },
        { name: 'Modifié par', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Heure', value: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), inline: true }
      );
    const msg = await interaction.channel.send({ embeds: [prioEmbed] });
    await msg.pin().catch(() => null);

    // Mention support roles when escalated to urgent
    if (priority === 'urgent') {
      const cfg = await getGuildConfig(db);
      const roleIds = Array.isArray(cfg.support_role_ids)
        ? cfg.support_role_ids
        : JSON.parse(cfg.support_role_ids || '[]');
      if (roleIds.length) {
        const mentions = roleIds.map(id => `<@&${id}>`).join(' ');
        await interaction.channel.send(`🚨 **Ticket urgent** — ${mentions}`).catch(() => null);
      }
    }

    await interaction.reply({ content: `Priorité mise à jour : ${emoji} **${label}**`, ephemeral: true });
  }
};

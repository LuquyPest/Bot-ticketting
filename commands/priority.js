const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { parseJsonField } = require('../utils/jsonField');
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
    const L = await require('../utils/staffI18n').forInteraction(interaction);
    const Ls = await require('../utils/staffI18n').forInteraction(interaction, { shared: true });
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'reply_ticket'))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: L('notTicket'), flags: MessageFlags.Ephemeral });
    }

    const priority = interaction.options.getString('niveau', true);
    await tm.setPriority(ticket.id, priority, interaction.user);
    await tm.updateChannelTopic(ticket.id).catch(() => null);

    const label = Ls(`prio.${priority}`);
    const emoji = EMOJI[priority];

    const prioEmbed = new EmbedBuilder()
      .setColor(COLORS[priority])
      .setTitle(Ls('priority.title', { emoji }))
      .addFields(
        { name: Ls('field.priority'), value: `${emoji} ${label}`, inline: true },
        { name: Ls('field.changedBy'), value: `<@${interaction.user.id}>`, inline: true },
        { name: Ls('field.time'), value: Ls.time(), inline: true }
      );
    // Missing permission in the channel must not keep the command from answering
    const msg = await interaction.channel.send({ embeds: [prioEmbed] }).catch(() => null);
    await msg?.pin?.().catch(() => null);

    // Mention support roles when escalated to urgent
    if (priority === 'urgent') {
      const cfg = await getGuildConfig(db);
      const roleIds = parseJsonField(cfg.support_role_ids);
      if (roleIds.length) {
        const mentions = roleIds.map(id => `<@&${id}>`).join(' ');
        await interaction.channel.send({ content: Ls('priority.urgentPing', { mentions }), allowedMentions: { roles: roleIds } }).catch(() => null);
      }
    }

    await interaction.reply({ content: L('priority.done', { emoji, label: L(`prio.${priority}`) }), flags: MessageFlags.Ephemeral });
  }
};

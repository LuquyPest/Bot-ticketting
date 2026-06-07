const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const { getOpenTicketByChannelId, setPriority, updateChannelTopic } = require('../utils/ticketManager');

const LABELS = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };
const EMOJI  = { low: '🟢', normal: '🔵', urgent: '🔴' };

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
    if (!(await ensureSupport(interaction, client))) return;

    const ticket = await getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: 'Pas un ticket valide.', ephemeral: true });
    }

    const priority = interaction.options.getString('niveau', true);
    await setPriority(ticket.id, priority);
    await updateChannelTopic(client, ticket.id).catch(() => null);

    const label = LABELS[priority];
    const emoji = EMOJI[priority];

    // Épingler un embed de priorité dans le salon
    const msg = await interaction.channel.send(
      `${emoji} Priorité définie sur **${label}** par ${interaction.user.username}`
    );
    await msg.pin().catch(() => null);

    await interaction.reply({ content: `Priorité mise à jour : ${emoji} **${label}**`, ephemeral: true });
  }
};

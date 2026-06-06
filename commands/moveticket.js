const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const { getOpenTicketByChannelId, logMoveTicket } = require('../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moveticket')
    .setDescription('Déplace le ticket dans une catégorie par son nom')
    .addStringOption(option =>
      option
        .setName('categorie')
        .setDescription('Nom exact de la catégorie')
        .setRequired(true)
    ),

  async execute(client, interaction) {
    const allowed = await ensureSupport(interaction, client);
    if (!allowed) return;

    const ticket = await getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      await interaction.reply({
        content: '❌ Cette commande doit être utilisée dans un ticket.',
        ephemeral: true
      });
      return;
    }

    const inputName = interaction.options.getString('categorie', true).trim().toLowerCase();

    const allChannels = await interaction.guild.channels.fetch();
    const categories = allChannels.filter(c => c.type === ChannelType.GuildCategory);
    const matches = categories.filter(cat => cat.name.toLowerCase() === inputName);

    if (matches.size === 0) {
      await interaction.reply({
        content: `❌ Aucune catégorie trouvée avec le nom **${inputName}**.`,
        ephemeral: true
      });
      return;
    }

    if (matches.size > 1) {
      await interaction.reply({
        content: `❌ Plusieurs catégories portent ce nom (**${inputName}**). Utilise un nom unique.`,
        ephemeral: true
      });
      return;
    }

    const targetCategory = matches.first();

    try {
      await interaction.channel.setParent(targetCategory.id, { lockPermissions: false });
      await logMoveTicket(client, ticket.id, targetCategory.name, interaction.user);

      await interaction.reply({ content: `✅ Ticket déplacé dans **${targetCategory.name}**.`, ephemeral: true });
      await interaction.channel.send(
        `📂 Ticket déplacé dans **${targetCategory.name}** par **${interaction.user.username}**.`
      );
    } catch (error) {
      console.error('Erreur moveticket:', error);
      await interaction.reply({ content: '❌ Impossible de déplacer le ticket.', ephemeral: true });
    }
  }
};

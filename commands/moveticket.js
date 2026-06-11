const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');

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
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: '❌ Cette commande doit être utilisée dans un ticket.', ephemeral: true });
    }

    const inputName = interaction.options.getString('categorie', true).trim().toLowerCase();

    const allChannels = await interaction.guild.channels.fetch();
    const categories = allChannels.filter(c => c.type === ChannelType.GuildCategory);
    const matches = categories.filter(cat => cat.name.toLowerCase() === inputName);

    if (matches.size === 0) {
      return interaction.reply({ content: `❌ Aucune catégorie trouvée avec le nom **${inputName}**.`, ephemeral: true });
    }

    if (matches.size > 1) {
      return interaction.reply({ content: `❌ Plusieurs catégories portent ce nom (**${inputName}**). Utilise un nom unique.`, ephemeral: true });
    }

    const targetCategory = matches.first();

    try {
      await interaction.channel.setParent(targetCategory.id, { lockPermissions: false });
      await tm.logMoveTicket(ticket.id, targetCategory.name, interaction.user);

      await interaction.reply({ content: `✅ Ticket déplacé dans **${targetCategory.name}**.`, ephemeral: true });
      await interaction.channel.send(`📂 Ticket déplacé dans **${targetCategory.name}** par **${interaction.user.username}**.`);
    } catch (error) {
      await interaction.reply({ content: '❌ Impossible de déplacer le ticket.', ephemeral: true });
    }
  }
};

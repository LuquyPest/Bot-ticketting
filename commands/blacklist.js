const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ensureChiefSupport } = require('../utils/permissions');
const { addToBlacklist, removeFromBlacklist, getBlacklist } = require('../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Gérer la blacklist des tickets')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Bloquer un utilisateur')
        .addUserOption(o => o.setName('utilisateur').setDescription('Utilisateur à bloquer').setRequired(true))
        .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Débloquer un utilisateur')
        .addUserOption(o => o.setName('utilisateur').setDescription('Utilisateur à débloquer').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Afficher la liste des utilisateurs bloqués')
    ),

  async execute(client, interaction) {
    if (!(await ensureChiefSupport(interaction, client))) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const user = interaction.options.getUser('utilisateur', true);
      const raison = interaction.options.getString('raison') || null;

      if (user.bot) {
        return interaction.reply({ content: 'Impossible de blacklister un bot.', ephemeral: true });
      }

      await addToBlacklist(user.id, user.tag, raison, interaction.user);

      await interaction.reply({
        content: `${user.tag} a été ajouté à la blacklist.${raison ? `\nRaison : ${raison}` : ''}`,
        ephemeral: true
      });

      await user.send(
        `Tu as été bloqué et ne peux plus ouvrir de tickets.${raison ? `\nRaison : ${raison}` : ''}`
      ).catch(() => null);
      return;
    }

    if (sub === 'remove') {
      const user = interaction.options.getUser('utilisateur', true);
      const removed = await removeFromBlacklist(user.id);

      if (!removed) {
        return interaction.reply({ content: `${user.tag} n'est pas dans la blacklist.`, ephemeral: true });
      }

      await interaction.reply({ content: `${user.tag} a été retiré de la blacklist.`, ephemeral: true });
      await user.send('Tu as été retiré de la blacklist et peux à nouveau ouvrir des tickets.').catch(() => null);
      return;
    }

    if (sub === 'list') {
      const list = await getBlacklist();

      if (!list.length) {
        return interaction.reply({ content: 'La blacklist est vide.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('Blacklist')
        .setDescription(
          list.slice(0, 20).map(row =>
            `**${row.user_tag}** (${row.user_id})\nRaison : ${row.reason || '-'}\nAjouté par : ${row.added_by_tag}`
          ).join('\n\n')
        )
        .setFooter({ text: `${list.length} utilisateur(s) bloqué(s)` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureChiefSupport } = require('../utils/permissions');
const { t, sendToMember } = require('../utils/i18n');

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
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureChiefSupport(interaction, client, db))) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const user = interaction.options.getUser('utilisateur', true);
      const raison = interaction.options.getString('raison') || null;

      if (user.bot) {
        return interaction.reply({ content: 'Impossible de blacklister un bot.', flags: MessageFlags.Ephemeral });
      }

      await tm.addToBlacklist(user.id, user.username, raison, interaction.user);

      await interaction.reply({
        content: `${user.username} a été ajouté à la blacklist.${raison ? `\nRaison : ${raison}` : ''}`,
        flags: MessageFlags.Ephemeral
      });

      await sendToMember(client, user, interaction.guildId, () => [t('blacklisted.dm'), raison ? t('blacklisted.reason', { reason: raison }) : null].filter(Boolean).join('\n'));
      return;
    }

    if (sub === 'remove') {
      const user = interaction.options.getUser('utilisateur', true);
      const removed = await tm.removeFromBlacklist(user.id, interaction.user);

      if (!removed) {
        return interaction.reply({ content: `${user.username} n'est pas dans la blacklist.`, flags: MessageFlags.Ephemeral });
      }

      await interaction.reply({ content: `${user.username} a été retiré de la blacklist.`, flags: MessageFlags.Ephemeral });
      await sendToMember(client, user, interaction.guildId, () => t('unblacklisted'));
      return;
    }

    if (sub === 'list') {
      const list = await tm.getBlacklist();

      if (!list.length) {
        return interaction.reply({ content: 'La blacklist est vide.', flags: MessageFlags.Ephemeral });
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

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  }
};

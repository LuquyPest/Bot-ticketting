const { SlashCommandBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');
const { broadcast } = require('../utils/sse');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adduser')
    .setDescription('Ajoute un utilisateur en participant DM lie au ticket')
    .addUserOption(option =>
      option
        .setName('utilisateur')
        .setDescription('Utilisateur a ajouter en DM lie')
        .setRequired(true)
    ),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: 'Pas un ticket valide.', ephemeral: true });
    }

    const user = interaction.options.getUser('utilisateur');

    if (user.bot) {
      return interaction.reply({ content: 'Impossible d ajouter un bot.', ephemeral: true });
    }

    if (user.id === ticket.owner_id) {
      return interaction.reply({ content: 'Cet utilisateur est deja le proprietaire principal du ticket.', ephemeral: true });
    }

    const existingOpenTicket = await tm.getAnyOpenTicketForUser(user.id);
    if (existingOpenTicket) {
      return interaction.reply({
        content: `Impossible d'ajouter ${user.username} : il a deja un ticket ouvert (ticket #${existingOpenTicket.id}). Ferme ce ticket d'abord, ou utilise /removeuser sur son ticket actuel.`,
        ephemeral: true
      });
    }

    await tm.addParticipant(ticket.id, user.id);
    await tm.logAddUser(ticket.id, user.id, interaction.user);
    broadcast('participant_add', { ticketId: ticket.id, userId: user.id, tag: user.username }, interaction.guildId);

    await user.send(
      `Tu as ete ajoute au ticket #${ticket.id}.\n` +
      `Si tu reponds a ce bot en message prive, ton message ira dans ce ticket.`
    ).catch(() => null);

    await interaction.reply({ content: `Utilisateur ajoute en participant DM lie : ${user.username}`, ephemeral: true });
    await interaction.channel.send(`--- ${interaction.user.username} : a ajoute ${user.username} comme participant DM lie au ticket`);
  }
};

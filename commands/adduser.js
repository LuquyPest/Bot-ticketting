const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');
const { broadcast } = require('../utils/sse');
const { ticketNoticeDmEmbed } = require('../utils/dmEmbeds');
const { t, sendToMember } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adduser')
    .setDescription('Ajoute un utilisateur en participant DM lié au ticket')
    .addUserOption(option =>
      option
        .setName('utilisateur')
        .setDescription('Utilisateur à ajouter en DM lié')
        .setRequired(true)
    ),

  async execute(client, interaction) {
    const L = await require('../utils/staffI18n').forInteraction(interaction);
    const Ls = await require('../utils/staffI18n').forInteraction(interaction, { shared: true });
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'manage_participants'))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: L('notTicket'), flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('utilisateur');

    if (user.bot) {
      return interaction.reply({ content: L('adduser.bot'), flags: MessageFlags.Ephemeral });
    }

    if (user.id === ticket.owner_id) {
      return interaction.reply({ content: L('adduser.owner'), flags: MessageFlags.Ephemeral });
    }

    const existingOpenTicket = await tm.getAnyOpenTicketForUser(user.id);
    if (existingOpenTicket) {
      return interaction.reply({
        content: L('adduser.busy', { user: user.username, id: existingOpenTicket.id }),
        flags: MessageFlags.Ephemeral
      });
    }

    await tm.addParticipant(ticket.id, user.id);
    await tm.logAddUser(ticket.id, user.id, interaction.user);
    broadcast('participant_add', { ticketId: ticket.id, userId: user.id, tag: user.username }, interaction.guildId);

    await sendToMember(client, user, interaction.guildId, () => ({ embeds: [ticketNoticeDmEmbed(client, interaction.guildId, ticket, {
      title: t('added.title'), description: t('added.body'), footer: t('reply.footer', { id: ticket.id }),
    })] }), { ticketId: ticket.id });

    await interaction.reply({ content: L('adduser.done', { user: user.username }), flags: MessageFlags.Ephemeral });
    await interaction.channel.send(Ls('adduser.log', { by: interaction.user.username, user: user.username }));
  }
};

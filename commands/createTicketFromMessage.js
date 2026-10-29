// Right click on a message → Applications → « Créer un ticket »: the staff turns a message of a
// public channel into a ticket with its author (subject and first message asked in a modal).
const {
  ContextMenuCommandBuilder, ApplicationCommandType, ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, MessageFlags,
} = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');
const { openFromDiscord } = require('../utils/staffTicket');

const MODAL_PREFIX = 'msgticket_';

module.exports = {
  data: new ContextMenuCommandBuilder().setName('Créer un ticket').setType(ApplicationCommandType.Message),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'reply_ticket'))) return;
    const msg = interaction.targetMessage;
    if (msg.author.bot) return interaction.reply({ content: 'Impossible d\'ouvrir un ticket pour un bot.', flags: MessageFlags.Ephemeral });
    const modal = new ModalBuilder().setCustomId(`${MODAL_PREFIX}${msg.channelId}_${msg.id}`).setTitle('Créer un ticket');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('subject').setLabel('Sujet')
        .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('message').setLabel(`Message à ${msg.author.username}`.slice(0, 45))
        .setPlaceholder('Facultatif : envoyé au membre en MP à l\'ouverture').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000)),
    );
    return interaction.showModal(modal);
  },

  isModal: customId => customId.startsWith(MODAL_PREFIX),

  async handleModal(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'reply_ticket'))) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [channelId, messageId] = interaction.customId.slice(MODAL_PREFIX.length).split('_');
    const channel = await client.channels.fetch(channelId).catch(() => null);
    const msg = channel?.guildId === interaction.guildId ? await channel.messages.fetch(messageId).catch(() => null) : null;
    if (!msg) return interaction.editReply({ content: '❌ Message introuvable (supprimé entre-temps ?).' });
    const tm = createManager(db, client, interaction.guildId);
    const r = await openFromDiscord({
      client, db, tm, guildId: interaction.guildId, member: msg.author, staff: interaction.user,
      subject: interaction.fields.getTextInputValue('subject').trim() || null,
      message: interaction.fields.getTextInputValue('message').trim(),
      quote: { content: msg.content, url: msg.url, channelId: msg.channelId, attachments: [...msg.attachments.values()].map(a => a.url) },
    });
    await interaction.editReply({ content: r.error ? `❌ ${r.error}` : `✅ Ticket #${r.ticket.id} ouvert : <#${r.channel.id}>` });
  },
};

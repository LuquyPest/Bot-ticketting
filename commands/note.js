const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager, getGuildConfig } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');

const NOTE_PREFIX = require('../utils/notePrefix');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Ajoute une note interne (non visible par l\'utilisateur, hors transcript)')
    .addStringOption(o =>
      o.setName('message').setDescription('Contenu de la note').setRequired(true).setMaxLength(2000)
    ),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const cfg = await getGuildConfig(db);
    if (!cfg.internal_notes_enabled) {
      return interaction.reply({ content: 'Les notes internes ne sont pas activées sur ce serveur.', ephemeral: true });
    }
    if (!(await ensureSupport(interaction, client, db))) return;

    const tm = createManager(db, client, interaction.guildId);
    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) return interaction.reply({ content: 'Pas un ticket ouvert.', ephemeral: true });

    const content = interaction.options.getString('message');

    await db(
      'INSERT INTO staff_notes (ticket_id, author_id, author_tag, content) VALUES (?, ?, ?, ?)',
      [ticket.id, interaction.user.id, interaction.user.username, content]
    );

    const noteEmbed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setAuthor({ name: '🔒 Note interne — visible staff uniquement' })
      .setDescription(content)
      .setFooter({ text: `${interaction.user.username} · ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` });
    await interaction.reply({ embeds: [noteEmbed] });
  }
};

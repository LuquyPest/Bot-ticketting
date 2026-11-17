const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport } = require('../utils/permissions');
const { hostTranscript, buildUrl } = require('../utils/transcriptServer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gettranscript')
    .setDescription('Récupère un transcript par son ID et génère un lien temporaire')
    .addIntegerOption(option =>
      option.setName('transcriptid').setDescription('ID du transcript').setRequired(true)
    ),

  async execute(client, interaction) {
    const L = await require('../utils/staffI18n').forInteraction(interaction);
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'view_transcripts'))) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const transcriptId = interaction.options.getInteger('transcriptid', true);
    const transcript = await tm.getTranscriptById(transcriptId);

    const { discordStaffCanSee } = require('../utils/gradePermissions');
    if (!transcript || !(await discordStaffCanSee(db, interaction.user.id, { id: transcript.ticket_id, visibility_grade_id: transcript.visibility_grade_id }))) {
      return interaction.editReply({ content: L('transcript.notFound') });
    }

    const token = hostTranscript(transcript.html);
    const url = buildUrl(client.config.webServerBaseUrl, token);

    await interaction.editReply({
      content: L('transcript.link', { id: transcript.id, ticket: transcript.ticket_id, url })
    });
  }
};

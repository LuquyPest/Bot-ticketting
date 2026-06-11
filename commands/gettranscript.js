const { SlashCommandBuilder } = require('discord.js');
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
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db))) return;

    await interaction.deferReply({ ephemeral: true });

    const transcriptId = interaction.options.getInteger('transcriptid', true);
    const transcript = await tm.getTranscriptById(transcriptId);

    if (!transcript) {
      return interaction.editReply({ content: 'Transcript introuvable.' });
    }

    const token = hostTranscript(transcript.html);
    const url = buildUrl(client.config.webServerBaseUrl, token);

    await interaction.editReply({
      content: `Transcript #${transcript.id} (ticket #${transcript.ticket_id})\nLien valable 10 minutes : ${url}`
    });
  }
};

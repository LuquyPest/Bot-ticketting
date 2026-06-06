const { SlashCommandBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const { getTranscriptById } = require('../utils/ticketManager');
const { hostTranscript, buildUrl } = require('../utils/transcriptServer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gettranscript')
    .setDescription('Récupère un transcript par son ID et génère un lien temporaire')
    .addIntegerOption(option =>
      option.setName('transcriptid').setDescription('ID du transcript').setRequired(true)
    ),

  async execute(client, interaction) {
    const allowed = await ensureSupport(interaction, client);
    if (!allowed) return;

    await interaction.deferReply({ ephemeral: true });

    const transcriptId = interaction.options.getInteger('transcriptid', true);
    const transcript = await getTranscriptById(transcriptId);

    if (!transcript) {
      await interaction.editReply({ content: 'Transcript introuvable.' });
      return;
    }

    const token = hostTranscript(transcript.html);
    const url = buildUrl(client.config.webServerBaseUrl, token);

    await interaction.editReply({
      content: `Transcript #${transcript.id} (ticket #${transcript.ticket_id})\nLien valable 10 minutes : ${url}`
    });
  }
};

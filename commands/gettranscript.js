const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { ensureSupport } = require('../utils/permissions');
const { getTranscriptById } = require('../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gettranscript')
    .setDescription('Récupère un transcript HTML par son ID')
    .addIntegerOption(option =>
      option.setName('transcriptid').setDescription('ID du transcript').setRequired(true)
    ),

  async execute(client, interaction) {
    const allowed = await ensureSupport(interaction, client);
    if (!allowed) return;

    const transcriptId = interaction.options.getInteger('transcriptid', true);
    const transcript = await getTranscriptById(transcriptId);

    if (!transcript) {
      await interaction.reply({ content: '❌ Transcript introuvable.', ephemeral: true });
      return;
    }

    const file = new AttachmentBuilder(Buffer.from(transcript.html, 'utf8'), {
      name: `transcript-${transcript.id}.html`
    });

    await interaction.reply({
      content: `📝 Transcript #${transcript.id} du ticket #${transcript.ticket_id}`,
      files: [file],
      ephemeral: true
    });
  }
};

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_transcript')
      .setLabel('Transcript')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ticket_close_with_transcript')
      .setLabel('Fermer et enregistrer le transcript')
      .setStyle(ButtonStyle.Danger)
  );
}

function closeConfirmationButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close_with_transcript_confirm')
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ticket_close_with_transcript_cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
  );
}

function oldTicketsPaginationButtons(userId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`oldtickets_prev_${userId}_${page}`)
      .setLabel('◀ Précédent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`oldtickets_next_${userId}_${page}`)
      .setLabel('Suivant ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );
}

function subjectButtons(subjects) {
  const rows = [];
  let row = new ActionRowBuilder();
  let count = 0;

  for (const subject of subjects) {
    if (count > 0 && count % 5 === 0) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    const safe = subject.slice(0, 80);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`subject_${safe}`)
        .setLabel(safe)
        .setStyle(ButtonStyle.Primary)
    );
    count++;
    if (rows.length >= 4) break;
  }
  rows.push(row);
  return rows;
}

module.exports = {
  ticketButtons,
  closeConfirmationButtons,
  oldTicketsPaginationButtons,
  subjectButtons
};

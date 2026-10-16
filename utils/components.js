const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close_with_transcript')
      .setLabel('🔒 Fermer le ticket')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ticket_transcript')
      .setLabel('📋 Transcript')
      .setStyle(ButtonStyle.Secondary)
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

// Configured subjects as buttons (max 24) + "Autre sujet" for a free-text subject.
function subjectButtons(subjects) {
  const rows = [];
  let row = new ActionRowBuilder();
  let count = 0;
  subjects = subjects.slice(0, 24);

  // customId carries the index, not the text: labels are truncated to 80 chars
  // and two long subjects could otherwise collide (Discord rejects duplicate IDs).
  for (const [i, subject] of subjects.entries()) {
    if (count > 0 && count % 5 === 0) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`subject_${i}`)
        .setLabel(subject.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    count++;
  }
  if (count > 0 && count % 5 === 0) { rows.push(row); row = new ActionRowBuilder(); }
  row.addComponents(new ButtonBuilder().setCustomId('subject_other').setLabel('✏️ Autre sujet').setStyle(ButtonStyle.Secondary));
  rows.push(row);
  return rows;
}

// customId: rating_<stars>_<ticketId>_<guildId> (ticket IDs are only unique per guild)
function ratingButtons(ticketId, guildId) {
  const stars = ['⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'];
  const styles = [ButtonStyle.Danger, ButtonStyle.Danger, ButtonStyle.Secondary, ButtonStyle.Success, ButtonStyle.Success];
  return new ActionRowBuilder().addComponents(
    stars.map((label, i) =>
      new ButtonBuilder()
        .setCustomId(`rating_${i + 1}_${ticketId}${guildId ? `_${guildId}` : ''}`)
        .setLabel(label)
        .setStyle(styles[i])
    )
  );
}

// After a rating: optional free comment (customId ratecomment_<ticketId>_<guildId>)
function ratingCommentButton(ticketId, guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ratecomment_${ticketId}_${guildId}`).setLabel('💬 Ajouter un commentaire').setStyle(ButtonStyle.Secondary)
  );
}

// On the member's ticket DMs (owner only): close the ticket themselves
function memberCloseButton(ticketId, guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`memberclose_${ticketId}_${guildId}`).setLabel('🔒 Fermer mon ticket').setStyle(ButtonStyle.Secondary)
  );
}

function memberCloseConfirmButtons(ticketId, guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`memberclose_confirm_${ticketId}_${guildId}`).setLabel('Oui, fermer le ticket').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('memberclose_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
  );
}

// Components for a DM about a ticket: the close button only for its owner.
function ticketDmComponents(ticket, guildId, recipientId) {
  return ticket?.owner_id && ticket.owner_id === recipientId && ticket.id ? [memberCloseButton(ticket.id, guildId)] : [];
}

module.exports = {
  ratingCommentButton,
  memberCloseButton,
  memberCloseConfirmButtons,
  ticketDmComponents,
  ticketButtons,
  closeConfirmationButtons,
  oldTicketsPaginationButtons,
  subjectButtons,
  ratingButtons
};

const { t } = require('./i18n');
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

// Configured subjects as buttons + « Autre sujet » (free-text subject) + « Demande confidentielle ».
// Discord allows 25 buttons (5 rows of 5): 23 subjects at most.
function subjectButtons(subjects) {
  // customId carries the index, not the text: labels are truncated to 80 chars
  // and two long subjects could otherwise collide (Discord rejects duplicate IDs).
  const buttons = subjects.slice(0, 23).map((subject, i) =>
    new ButtonBuilder().setCustomId(`subject_${i}`).setLabel(subject.slice(0, 80)).setStyle(ButtonStyle.Primary));
  buttons.push(
    new ButtonBuilder().setCustomId('subject_other').setLabel(t('subject.other')).setStyle(ButtonStyle.Secondary),
    confidentialButton(),
  );
  const rows = [];
  for (let k = 0; k < buttons.length; k += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(k, k + 5)));
  return rows;
}

const confidentialButton = () =>
  new ButtonBuilder().setCustomId('subject_confidential').setLabel(t('confidential.button')).setEmoji('🔒').setStyle(ButtonStyle.Secondary);

// « Confidential request »: only the founders will see the ticket
function confidentialRow() {
  return new ActionRowBuilder().addComponents(confidentialButton());
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
    new ButtonBuilder().setCustomId(`ratecomment_${ticketId}_${guildId}`).setLabel(t('rating.addComment')).setStyle(ButtonStyle.Secondary)
  );
}

// On the member's ticket DMs (owner only): close the ticket themselves, see all their tickets
function memberCloseButton(ticketId, guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`memberclose_${ticketId}_${guildId}`).setLabel(t('close.button')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('my_tickets').setLabel(t('myTickets')).setStyle(ButtonStyle.Secondary)
  );
}

function memberReopenButton(ticketId, guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`memberreopen_${ticketId}_${guildId}`).setLabel(t('reopen.button')).setStyle(ButtonStyle.Secondary)
  );
}

function memberCloseConfirmButtons(ticketId, guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`memberclose_confirm_${ticketId}_${guildId}`).setLabel(t('close.yes')).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('memberclose_cancel').setLabel(t('close.cancel')).setStyle(ButtonStyle.Secondary)
  );
}

// Components for a DM about a ticket: the close button only for its owner.
// Buttons under a ticket DM: close + my tickets (owner), and « View on the web » (member space,
// when the server keeps it on) for the owner and the participants
async function ticketDmComponents(ticket, guildId, recipientId) {
  if (!ticket?.id) return [];
  const isOwner = ticket.owner_id && ticket.owner_id === recipientId;
  const row = isOwner ? memberCloseButton(ticket.id, guildId) : new ActionRowBuilder();
  const url = await require('./memberPortal').ticketWebUrl(guildId, ticket.id).catch(() => null);
  if (url) row.addComponents(new ButtonBuilder().setLabel(t('portal.view')).setStyle(ButtonStyle.Link).setURL(url));
  return row.components.length ? [row] : [];
}

// FAQ suggestions: one "solved" button per answer + open a ticket anyway
function faqButtons(matches) {
  const row = new ActionRowBuilder();
  matches.forEach((m, i) => row.addComponents(
    new ButtonBuilder().setCustomId(`faq_solved_${m.id}`).setLabel(t('faq.solved', { n: i + 1 })).setStyle(ButtonStyle.Success)
  ));
  row.addComponents(new ButtonBuilder().setCustomId('faq_continue').setLabel(t('faq.continue')).setStyle(ButtonStyle.Primary));
  return [row];
}

module.exports = { memberReopenButton, faqButtons, ratingCommentButton, memberCloseConfirmButtons, ticketDmComponents, ticketButtons, closeConfirmationButtons, oldTicketsPaginationButtons, subjectButtons, confidentialRow, ratingButtons };

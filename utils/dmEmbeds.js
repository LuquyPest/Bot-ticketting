// Member-facing DM embeds. Texts come from utils/i18n.js in the current member's language.
const { EmbedBuilder } = require('discord.js');
const { t } = require('./i18n');

const C = {
  primary: 0x5865f2,  // Discord blurple
  success: 0x57f287,  // Discord green
  warning: 0xf59e0b,  // Amber
  danger:  0xed4245,  // Discord red
  neutral: 0x4e5058,  // Dark grey
};

function emptyMessageEmbed() {
  return new EmbedBuilder().setColor(C.neutral).setDescription(t('empty'));
}

function blacklistedEmbed() {
  return new EmbedBuilder()
    .setColor(C.danger)
    .setAuthor({ name: t('blacklisted.title') })
    .setDescription(t('blacklisted.body'))
    .setTimestamp();
}

function notInGuildEmbed() {
  return new EmbedBuilder().setColor(C.neutral).setDescription(t('notInGuild'));
}

function serverLimitEmbed() {
  return new EmbedBuilder()
    .setColor(C.warning)
    .setAuthor({ name: t('serverLimit.title') })
    .setDescription(t('serverLimit.body'))
    .setTimestamp();
}

function dailyLimitEmbed(max) {
  return new EmbedBuilder()
    .setColor(C.warning)
    .setAuthor({ name: t('dailyLimit.title') })
    .setDescription(t('dailyLimit.body', { max }))
    .setTimestamp();
}

function serverSelectEmbed() {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: t('serverSelect.title') })
    .setDescription(t('serverSelect.body'))
    .setFooter({ text: t('expires10') });
}

const newTicketAuthor = guildName => ({ name: guildName ? `${t('newTicket')} · ${guildName}` : t('newTicket') });

function subjectSelectEmbed(guildName) {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor(newTicketAuthor(guildName))
    .setDescription(t('subject.select'))
    .setFooter({ text: t('subject.timeout') });
}

// Free-text subject question, sent after the member's first message.
function subjectAskEmbed(guildName) {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor(newTicketAuthor(guildName))
    .setTitle(t('subject.ask.title'))
    .setDescription(t('subject.ask.body'))
    .setFooter({ text: t('subject.timeout') });
}

// Shown when the member has open tickets: pick the ticket for this message, or open a new one.
function ticketRouteEmbed(count) {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: count > 1 ? t('route.many', { count }) : t('route.one') })
    .setDescription(t('route.body'))
    .setFooter({ text: t('expires10') });
}

const subjectSuffix = ticket => (ticket.subject ? ` — ${ticket.subject}` : '');

function relayedToTicketEmbed(guildName, ticket) {
  return new EmbedBuilder()
    .setColor(C.success)
    .setDescription(t('relayed', { id: ticket.id, subject: subjectSuffix(ticket), guild: guildName }));
}

function intakeFormStartEmbed(firstQuestion, step, total) {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: t('intake.title', { step, total }) })
    .setDescription(t('intake.start', { question: firstQuestion }))
    .setFooter({ text: t('intake.footer') });
}

function intakeFormStepEmbed(question, step, total) {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: t('intake.title', { step, total }) })
    .setDescription(`**${question}**`)
    .setFooter({ text: t('intake.footer') });
}

function sessionExpiredEmbed() {
  return new EmbedBuilder().setColor(C.neutral).setDescription(t('expired'));
}

// Short confirmation replacing a menu once the member has chosen.
function choiceEmbed(text) {
  return new EmbedBuilder().setColor(C.neutral).setDescription(text);
}

function ticketCreatingEmbed(guildName) {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setDescription(guildName ? t('creatingOn', { guild: guildName }) : t('creating'));
}

function ratingConfirmEmbed(rating) {
  const filled = '★'.repeat(rating);
  const empty  = '☆'.repeat(5 - rating);
  return new EmbedBuilder()
    .setColor(C.success)
    .setAuthor({ name: t('rating.thanks') })
    .setDescription(`**${filled}${empty}** — ${rating} / 5\n${t('rating.body')}`)
    .setTimestamp();
}

function ratingCommentEmbed(rating, comment) {
  return ratingConfirmEmbed(rating).addFields({ name: t('rating.comment'), value: comment.slice(0, 1024) });
}

function memberCloseConfirmEmbed(ticket) {
  return new EmbedBuilder()
    .setColor(C.warning)
    .setDescription(t('close.confirm', { id: ticket.id, subject: subjectSuffix(ticket) }));
}

function faqSuggestEmbed(guildName, matches) {
  const embed = new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: t('faq.title', { guild: guildName || 'Support' }) })
    .setDescription(t('faq.body'));
  matches.forEach((m, i) => embed.addFields({ name: `${i + 1}. ${m.question}`.slice(0, 256), value: m.answer.slice(0, 1024) }));
  return embed;
}

function alreadyRatedEmbed() {
  return new EmbedBuilder().setColor(C.neutral).setDescription(t('rating.already'));
}

// ── Ticket DMs ── a member can have open tickets on several servers: every DM about a ticket
// carries the server and the ticket it comes from.
function ticketContextAuthor(client, guildId, ticket) {
  const guild = client?.guilds?.cache?.get(guildId);
  const name = `${guild?.name || 'Support'} · Ticket #${ticket.id}${subjectSuffix(ticket)}`;
  return { name: name.slice(0, 256), iconURL: guild?.iconURL({ size: 64 }) || undefined };
}

function staffReplyDmEmbed(client, guildId, ticket, { sender, content, fileUrl, scheduled = false }) {
  const embed = new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor(ticketContextAuthor(client, guildId, ticket))
    .setTitle(`💬 ${sender}${scheduled ? t('reply.scheduled') : ''}`.slice(0, 256))
    .setFooter({ text: t('reply.footer', { id: ticket.id }) })
    .setTimestamp();
  if (content) embed.setDescription(String(content).slice(0, 4096));
  if (fileUrl) embed.addFields({ name: t('reply.file'), value: String(fileUrl).slice(0, 1024) });
  return embed;
}

function ticketNoticeDmEmbed(client, guildId, ticket, { title, description, color = 'neutral', footer }) {
  const embed = new EmbedBuilder()
    .setColor(C[color] ?? C.neutral)
    .setAuthor(ticketContextAuthor(client, guildId, ticket))
    .setTitle(title.slice(0, 256))
    .setTimestamp();
  if (description) embed.setDescription(description.slice(0, 4096));
  if (footer) embed.setFooter({ text: footer.slice(0, 2048) });
  return embed;
}

module.exports = {
  subjectAskEmbed,
  ticketRouteEmbed,
  relayedToTicketEmbed,
  ticketContextAuthor,
  staffReplyDmEmbed,
  ticketNoticeDmEmbed,
  emptyMessageEmbed,
  blacklistedEmbed,
  notInGuildEmbed,
  serverLimitEmbed,
  dailyLimitEmbed,
  serverSelectEmbed,
  subjectSelectEmbed,
  intakeFormStartEmbed,
  intakeFormStepEmbed,
  sessionExpiredEmbed,
  choiceEmbed,
  ticketCreatingEmbed,
  ratingConfirmEmbed,
  ratingCommentEmbed,
  faqSuggestEmbed,
  memberCloseConfirmEmbed,
  alreadyRatedEmbed,
};

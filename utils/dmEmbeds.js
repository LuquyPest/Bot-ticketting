const { EmbedBuilder } = require('discord.js');

const C = {
  primary: 0x5865f2,  // Discord blurple
  success: 0x57f287,  // Discord green
  warning: 0xf59e0b,  // Amber
  danger:  0xed4245,  // Discord red
  neutral: 0x4e5058,  // Dark grey
};

function emptyMessageEmbed() {
  return new EmbedBuilder()
    .setColor(C.neutral)
    .setDescription('Envoie un message texte ou une pièce jointe pour contacter le support.');
}

function blacklistedEmbed() {
  return new EmbedBuilder()
    .setColor(C.danger)
    .setAuthor({ name: 'Accès refusé' })
    .setDescription('Tu ne peux pas contacter le support pour le moment.\nSi tu penses qu\'il s\'agit d\'une erreur, contacte un administrateur.')
    .setTimestamp();
}

function notInGuildEmbed() {
  return new EmbedBuilder()
    .setColor(C.neutral)
    .setDescription('Tu ne fais partie d\'aucun serveur utilisant ce bot.');
}

function serverLimitEmbed() {
  return new EmbedBuilder()
    .setColor(C.warning)
    .setAuthor({ name: 'Serveur complet' })
    .setDescription('Ce serveur a atteint sa limite de tickets simultanés.\nMerci de réessayer un peu plus tard.')
    .setTimestamp();
}

function dailyLimitEmbed(max) {
  return new EmbedBuilder()
    .setColor(C.warning)
    .setAuthor({ name: 'Limite quotidienne atteinte' })
    .setDescription(`Tu as déjà ouvert **${max}** ticket${max > 1 ? 's' : ''} aujourd'hui.\nTu pourras en ouvrir un nouveau demain.`)
    .setTimestamp();
}

function serverSelectEmbed() {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: 'Choisir un serveur' })
    .setDescription('Tu es membre de **plusieurs serveurs** utilisant ce bot.\nSur lequel souhaites-tu ouvrir un ticket ?')
    .setFooter({ text: 'Cette sélection expire dans 10 minutes' });
}

function subjectSelectEmbed(guildName) {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: guildName ? `Nouveau ticket · ${guildName}` : 'Nouveau ticket' })
    .setDescription('Ton message est bien noté. Quel est le **sujet de ton ticket** ?\nChoisis-le ci-dessous, ou « Autre sujet » pour l\'écrire toi-même.')
    .setFooter({ text: 'Sans réponse sous 10 minutes, le ticket sera ouvert sans sujet' });
}

// Free-text subject question, sent after the member's first message.
function subjectAskEmbed(guildName) {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: guildName ? `Nouveau ticket · ${guildName}` : 'Nouveau ticket' })
    .setTitle('📝 Quel est le sujet de ton ticket ?')
    .setDescription('Ton message est bien noté. Réponds avec **le sujet** en quelques mots (100 caractères max) — il servira de titre au ticket.')
    .setFooter({ text: 'Sans réponse sous 10 minutes, le ticket sera ouvert sans sujet' });
}

// Shown when the member has open tickets: pick the ticket for this message, or open a new one.
function ticketRouteEmbed(count) {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: count > 1 ? `Tu as ${count} tickets ouverts` : 'Tu as un ticket ouvert' })
    .setDescription('Dans quel ticket veux-tu envoyer ce message ? Tu peux aussi ouvrir un **nouveau ticket**.')
    .setFooter({ text: 'Cette sélection expire dans 10 minutes' });
}

function relayedToTicketEmbed(guildName, ticket) {
  return new EmbedBuilder()
    .setColor(C.success)
    .setDescription(`✅ Message envoyé dans le ticket **#${ticket.id}${ticket.subject ? ` — ${ticket.subject}` : ''}** (${guildName}).`);
}

function intakeFormStartEmbed(firstQuestion, step, total) {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: `Formulaire — Question ${step} sur ${total}` })
    .setDescription(`Avant d'ouvrir ton ticket, nous avons besoin de quelques informations.\n\n**${firstQuestion}**`)
    .setFooter({ text: 'Réponds simplement par message texte' });
}

function intakeFormStepEmbed(question, step, total) {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: `Formulaire — Question ${step} sur ${total}` })
    .setDescription(`**${question}**`)
    .setFooter({ text: 'Réponds simplement par message texte' });
}

function sessionExpiredEmbed() {
  return new EmbedBuilder()
    .setColor(C.neutral)
    .setDescription('Cette session a expiré.\nRenvoie un message pour recommencer.');
}

// Short confirmation replacing a menu once the member has chosen.
function choiceEmbed(text) {
  return new EmbedBuilder().setColor(C.neutral).setDescription(text);
}

function ticketCreatingEmbed(guildName) {
  const desc = guildName
    ? `Création de ton ticket sur **${guildName}**…`
    : 'Création de ton ticket en cours…';
  return new EmbedBuilder()
    .setColor(C.primary)
    .setDescription(desc);
}

function ratingConfirmEmbed(rating) {
  const filled = '★'.repeat(rating);
  const empty  = '☆'.repeat(5 - rating);
  return new EmbedBuilder()
    .setColor(C.success)
    .setAuthor({ name: 'Merci pour ton retour !' })
    .setDescription(`**${filled}${empty}** — ${rating} / 5\nTon avis nous aide à améliorer la qualité du support.`)
    .setTimestamp();
}

function alreadyRatedEmbed() {
  return new EmbedBuilder()
    .setColor(C.neutral)
    .setDescription('Tu as déjà noté ce ticket.');
}

// ── Ticket DMs ── a member can have open tickets on several servers: every DM about a ticket
// carries the server and the ticket it comes from.
function ticketContextAuthor(client, guildId, ticket) {
  const guild = client?.guilds?.cache?.get(guildId);
  const name = `${guild?.name || 'Support'} · Ticket #${ticket.id}${ticket.subject ? ` — ${ticket.subject}` : ''}`;
  return { name: name.slice(0, 256), iconURL: guild?.iconURL({ size: 64 }) || undefined };
}

function staffReplyDmEmbed(client, guildId, ticket, { sender, content, fileUrl, scheduled = false }) {
  const embed = new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor(ticketContextAuthor(client, guildId, ticket))
    .setTitle(`💬 ${sender}${scheduled ? ' · message programmé' : ''}`.slice(0, 256))
    .setFooter({ text: `Réponds ici pour écrire dans le ticket #${ticket.id}` })
    .setTimestamp();
  if (content) embed.setDescription(String(content).slice(0, 4096));
  if (fileUrl) embed.addFields({ name: '📎 Fichier', value: String(fileUrl).slice(0, 1024) });
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
  alreadyRatedEmbed,
};

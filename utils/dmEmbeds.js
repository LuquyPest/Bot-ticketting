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

function serverSelectEmbed(mode) {
  if (mode === 'relay') {
    return new EmbedBuilder()
      .setColor(C.primary)
      .setAuthor({ name: 'Plusieurs tickets ouverts' })
      .setDescription('Tu as des tickets en cours sur **plusieurs serveurs**.\nSélectionne celui auquel tu souhaites répondre.')
      .setFooter({ text: 'Cette sélection expire dans 10 minutes' });
  }
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: 'Choisir un serveur' })
    .setDescription('Tu es membre de **plusieurs serveurs** utilisant ce bot.\nSur lequel souhaites-tu ouvrir un ticket ?')
    .setFooter({ text: 'Cette sélection expire dans 10 minutes' });
}

function subjectSelectEmbed() {
  return new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: 'Nouveau ticket' })
    .setDescription('Quel est le **sujet de ta demande** ?\nChoisis une catégorie ci-dessous.')
    .setFooter({ text: 'Cette sélection expire dans 10 minutes' });
}

function faqEmbed(response, allowTicket) {
  const embed = new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: 'Réponse automatique' })
    .setDescription(response);
  if (allowTicket) {
    embed.setFooter({ text: 'Cette réponse ne répond pas à ta question ? Tu peux quand même ouvrir un ticket.' });
  }
  return embed;
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

function relayConfirmEmbed(guildName) {
  return new EmbedBuilder()
    .setColor(C.success)
    .setDescription(`Message transmis à ton ticket sur **${guildName}**.`);
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

module.exports = {
  emptyMessageEmbed,
  blacklistedEmbed,
  notInGuildEmbed,
  serverLimitEmbed,
  dailyLimitEmbed,
  serverSelectEmbed,
  subjectSelectEmbed,
  faqEmbed,
  intakeFormStartEmbed,
  intakeFormStepEmbed,
  sessionExpiredEmbed,
  relayConfirmEmbed,
  ticketCreatingEmbed,
  ratingConfirmEmbed,
  alreadyRatedEmbed,
};

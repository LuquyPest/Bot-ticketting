// Language of the messages the bot sends to members (French or English).
// The current language travels with the async call chain (AsyncLocalStorage): entry points
// (DM received, button clicked, staff reply, automation) call withLang(), and every message
// builder simply calls t(). Staff-facing texts (dashboard, staff DMs, channel logs) stay French.
//
// Per guild (guild_config.bot_language): 'fr' | 'en' | 'auto'. In 'auto', the member's Discord
// language is used (remembered from their last interaction with the bot), else the server's.
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
const LANGS = ['fr', 'en'];

const lang = () => als.getStore() || 'fr';
const withLang = (l, fn) => als.run(LANGS.includes(l) ? l : 'fr', fn);
const fromLocale = locale => (String(locale || '').toLowerCase().startsWith('fr') ? 'fr' : 'en');

const D = {
  fr: {
    'empty': 'Envoie un message texte ou une pièce jointe pour contacter le support.',
    'blacklisted.title': 'Accès refusé',
    'blacklisted.body': 'Tu ne peux pas contacter le support pour le moment.\nSi tu penses qu\'il s\'agit d\'une erreur, contacte un administrateur.',
    'notInGuild': 'Tu ne fais partie d\'aucun serveur utilisant ce bot.',
    'serverLimit.title': 'Serveur complet',
    'serverLimit.body': 'Ce serveur a atteint sa limite de tickets simultanés.\nMerci de réessayer un peu plus tard.',
    'dailyLimit.title': 'Limite quotidienne atteinte',
    'dailyLimit.body': 'Tu as déjà ouvert **{max}** ticket(s) aujourd\'hui.\nTu pourras en ouvrir un nouveau demain.',
    'serverSelect.title': 'Choisir un serveur',
    'serverSelect.body': 'Tu es membre de **plusieurs serveurs** utilisant ce bot.\nSur lequel souhaites-tu ouvrir un ticket ?',
    'serverSelect.placeholder': 'Choisir un serveur…',
    'serverSelect.option': 'Ouvrir un ticket sur ce serveur',
    'expires10': 'Cette sélection expire dans 10 minutes',
    'newTicket': 'Nouveau ticket',
    'subject.select': 'Ton message est bien noté. Quel est le **sujet de ton ticket** ?\nChoisis-le ci-dessous, ou « Autre sujet » pour l\'écrire toi-même.',
    'subject.ask.title': '📝 Quel est le sujet de ton ticket ?',
    'subject.ask.body': 'Ton message est bien noté. Réponds avec **le sujet** en quelques mots (100 caractères max) — il servira de titre au ticket.',
    'subject.timeout': 'Sans réponse sous 10 minutes, le ticket sera ouvert sans sujet',
    'subject.textOnly': '📝 Envoie le sujet de ton ticket en texte (quelques mots).',
    'subject.other': '✏️ Autre sujet',
    'route.one': 'Tu as un ticket ouvert',
    'route.many': 'Tu as {count} tickets ouverts',
    'route.body': 'Dans quel ticket veux-tu envoyer ce message ? Tu peux aussi ouvrir un **nouveau ticket**.',
    'route.placeholder': 'Choisir le ticket…',
    'route.new': 'Ouvrir un nouveau ticket',
    'route.participant': ' · tu es participant',
    'route.noSubject': 'Sans sujet',
    'relayed': '✅ Message envoyé dans le ticket **#{id}{subject}** ({guild}).',
    'intake.title': 'Formulaire — Question {step} sur {total}',
    'intake.start': 'Avant d\'ouvrir ton ticket, nous avons besoin de quelques informations.\n\n**{question}**',
    'intake.footer': 'Réponds simplement par message texte',
    'expired': 'Cette session a expiré.\nRenvoie un message pour recommencer.',
    'creating': 'Création de ton ticket en cours…',
    'creatingOn': 'Création de ton ticket sur **{guild}**…',
    'rating.thanks': 'Merci pour ton retour !',
    'rating.body': 'Ton avis nous aide à améliorer la qualité du support.',
    'rating.comment': '💬 Ton commentaire',
    'rating.already': 'Tu as déjà noté ce ticket.',
    'rating.ask': '**Comment s\'est passée ton expérience avec notre équipe ?**',
    'rating.addComment': '💬 Ajouter un commentaire',
    'rating.modalTitle': 'Ton avis sur le support',
    'rating.modalLabel': 'Commentaire',
    'rating.modalPlaceholder': 'Ce qui t\'a plu, ce qui pourrait être amélioré…',
    'rating.commentSaved': 'Tu as déjà laissé un commentaire pour ce ticket.',
    'rating.commentError': 'Impossible d\'enregistrer ce commentaire.',
    'rating.cannot': 'Tu ne peux pas noter ce ticket.',
    'close.confirm': 'Fermer le ticket **#{id}{subject}** ?\nLe staff ne pourra plus te répondre dans ce ticket.',
    'close.button': '🔒 Fermer mon ticket',
    'close.yes': 'Oui, fermer le ticket',
    'close.cancel': 'Annuler',
    'close.cancelled': 'Fermeture annulée.',
    'close.already': 'Ce ticket est déjà fermé.',
    'close.closing': 'Fermeture du ticket #{id}…',
    'close.unavailable': 'Impossible de fermer ce ticket pour le moment. Écris au staff pour qu\'il le ferme.',
    'closed.title': '🔒 Ticket #{id} fermé',
    'closed.body': 'Merci de nous avoir contactés. Ton ticket a été traité et fermé.',
    'closed.duration': '⏱️ Durée',
    'closed.staff': '🛡️ Staff',
    'closed.by': '🔒 Fermé par',
    'closed.member': '{tag} (membre)',
    'faq.title': '{guild} · Avant d\'ouvrir un ticket',
    'faq.body': 'Ces réponses pourraient t\'aider. Si ce n\'est pas le cas, ouvre un ticket : ton message sera transmis au staff.',
    'faq.solved': '✅ La réponse {n} m\'a aidé',
    'faq.continue': '📩 Ouvrir un ticket quand même',
    'faq.opening': '📩 Ouverture d\'un ticket…',
    'faq.great': '✅ Super ! Aucun ticket n\'a été ouvert. Écris-moi si tu as encore besoin d\'aide.',
    'reply.scheduled': ' · message programmé',
    'reply.footer': 'Réponds ici pour écrire dans le ticket #{id}',
    'reply.file': '📎 Fichier',
    'reply.fileAttached': '📎 Fichier joint',
    'welcome.default': 'Ton ticket a été créé. Le support va te répondre bientôt.',
    'welcome.title': '🎫 Ticket #{id} créé',
    'welcome.titleNoId': '🎫 Ticket créé',
    'welcome.footer': 'Réponds ici pour envoyer un message au staff',
    'welcome.subject': '📂 Sujet',
    'myTickets': '📋 Mes tickets',
    'myTickets.title': '📋 Mes tickets ouverts',
    'myTickets.none': 'Tu n\'as aucun ticket ouvert. Écris-moi pour en ouvrir un.',
    'myTickets.footer': 'Écris-moi pour ajouter un message à l\'un de ces tickets',
    'myTickets.last': 'Dernier message {when}',
    'status.waiting': '⏳ En attente de ta réponse',
    'status.inProgress': '🛠️ En cours de traitement',
    'status.assigned': '👤 Pris en charge par le staff',
    'status.received': '📨 Reçu, bientôt pris en charge',
    'added.title': '👥 Tu as été ajouté à un ticket',
    'added.body': 'Tu peux suivre et participer à ce ticket : réponds à ce message privé pour écrire dedans.',
    'merged.title': '🔀 Tickets regroupés',
    'merged.body': 'Ton ticket #{from}{subject} a été regroupé avec celui-ci. La conversation continue ici.',
    'inactive.warn.title': '⚠️ Ton ticket attend ta réponse',
    'inactive.warn.body': 'Le staff t\'a répondu mais nous n\'avons pas eu de nouvelle depuis {warn} h.\nSans message de ta part dans les {left} h, le ticket sera fermé automatiquement.',
    'inactive.closed.title': '🔒 Ticket fermé automatiquement',
    'inactive.closed.body': 'Fermé après {hours} h sans réponse de ta part. Tu peux en ouvrir un nouveau à tout moment.',
    'flood': '⏳ Tu envoies trop de messages à la suite — attends quelques secondes avant de réessayer.',
    'ticketInvalid': 'Ticket invalide.',
    'ticketNotOpen': 'Ce ticket n\'est plus ouvert. Renvoie ton message pour choisir un autre ticket.',
    'ticketUnreachable': 'Impossible de joindre le salon de ce ticket. Réessaie plus tard.',
    'serverInvalid': 'Serveur invalide.',
    'serverChosen': 'Serveur choisi : **{guild}**',
    'newTicketChosen': '➕ Nouveau ticket',
    'fields.title': 'Informations — {step} sur {total}',
    'fields.optional': 'Facultatif : réponds « passer » pour ignorer.',
    'fields.number': 'Réponds avec un nombre.',
    'fields.empty': 'Cette information est obligatoire.',
    'fields.skip': 'passer',
    'stage.open.title': '📨 Ton ticket est de nouveau en file d\'attente',
    'stage.open.body': 'Il sera repris par le staff dès que possible.',
    'stage.waiting.title': '⏳ Ton ticket est en attente',
    'stage.waiting.body': 'Le staff attend une information. Si on t\'a demandé quelque chose, réponds ici.',
    'stage.in_progress.title': '🛠️ Ton ticket est en cours de traitement',
    'stage.in_progress.body': 'Un membre du staff s\'en occupe.',
    'reopen.button': '🔄 Rouvrir mon ticket',
    'reopen.hint': 'Tu peux rouvrir ce ticket pendant {days} jour(s) si le problème revient.',
    'portal.title': '📂 Tes tickets',
    'confidential.button': 'Demande confidentielle',
    'confidential.subject': 'Demande confidentielle',
    'confidential.welcome': '🔒 Ticket confidentiel : seuls les fondateurs du serveur peuvent le lire.',
    'portal.view': 'Voir sur le web',
    'incident.title': '📢 Problème connu en cours',
    'incident.footer': 'Ton ticket est bien ouvert : l\'équipe te répondra dès que possible.',
    'incident.resolved': '✅ Problème résolu',
    'portal.body': 'Retrouve cet échange et tous tes tickets sur {url}',
    'portal.list': 'Tes tickets fermés et leur historique : {url}',
    'reopen.expired': 'Ce ticket ne peut plus être rouvert. Écris-moi pour en ouvrir un nouveau.',
    'reopen.done': '🔄 Ticket #{id} rouvert : écris-moi ici pour continuer la conversation.',
    'reopened.title': '🔄 Ticket #{id} réouvert',
    'reopened.body': 'Ton ticket a été réouvert. Tu peux continuer à répondre ici.',
    'blacklisted.dm': 'Tu as été bloqué et ne peux plus ouvrir de tickets.',
    'blacklisted.reason': 'Raison : {reason}',
    'invalidButton': 'Bouton invalide ou expiré.',
    'invalidInteraction': 'Interaction invalide.',
    'error': 'Une erreur est survenue.',
    'unblacklisted': 'Tu as été retiré de la blacklist et peux à nouveau ouvrir des tickets.',
    'panel.subject': 'Sujet du ticket',
    'panel.subjectPlaceholder': 'En quelques mots — sert de titre au ticket',
    'panel.form': '📋 **Formulaire :**',
    'panel.created': '✅ Ton ticket #{id} a été créé. La suite se passe en message privé avec le bot.',
    'panel.exists': 'ℹ️ Tu as déjà un ticket ouvert (#{id}). Écris au bot en message privé pour le suivre.',
    'panel.failed': '❌ Impossible de créer le ticket. Réessaie dans quelques instants.',
    'panel.blacklisted': '❌ Tu ne peux pas ouvrir de ticket.',
    'panel.serverLimit': '❌ Le serveur a atteint sa limite de tickets simultanés. Réessaie plus tard.',
    'panel.dailyLimit': '❌ Tu as déjà ouvert {max} ticket(s) aujourd\'hui. Réessaie demain.',
  },
  en: {
    'empty': 'Send a text message or an attachment to contact the support team.',
    'blacklisted.title': 'Access denied',
    'blacklisted.body': 'You cannot contact the support team at the moment.\nIf you think this is a mistake, contact an administrator.',
    'notInGuild': 'You are not a member of any server using this bot.',
    'serverLimit.title': 'Server busy',
    'serverLimit.body': 'This server has reached its limit of open tickets.\nPlease try again a little later.',
    'dailyLimit.title': 'Daily limit reached',
    'dailyLimit.body': 'You have already opened **{max}** ticket(s) today.\nYou can open a new one tomorrow.',
    'serverSelect.title': 'Choose a server',
    'serverSelect.body': 'You are a member of **several servers** using this bot.\nOn which one do you want to open a ticket?',
    'serverSelect.placeholder': 'Choose a server…',
    'serverSelect.option': 'Open a ticket on this server',
    'expires10': 'This selection expires in 10 minutes',
    'newTicket': 'New ticket',
    'subject.select': 'Your message has been noted. What is the **subject of your ticket**?\nPick it below, or « Other subject » to type it yourself.',
    'subject.ask.title': '📝 What is your ticket about?',
    'subject.ask.body': 'Your message has been noted. Reply with **the subject** in a few words (100 characters max) — it will be the ticket title.',
    'subject.timeout': 'Without an answer within 10 minutes, the ticket will be opened without a subject',
    'subject.textOnly': '📝 Send the subject of your ticket as text (a few words).',
    'subject.other': '✏️ Other subject',
    'route.one': 'You have one open ticket',
    'route.many': 'You have {count} open tickets',
    'route.body': 'Which ticket should this message go to? You can also open a **new ticket**.',
    'route.placeholder': 'Choose the ticket…',
    'route.new': 'Open a new ticket',
    'route.participant': ' · you are a participant',
    'route.noSubject': 'No subject',
    'relayed': '✅ Message sent to ticket **#{id}{subject}** ({guild}).',
    'intake.title': 'Form — Question {step} of {total}',
    'intake.start': 'Before opening your ticket, we need a few details.\n\n**{question}**',
    'intake.footer': 'Just reply with a text message',
    'expired': 'This session has expired.\nSend a message again to start over.',
    'creating': 'Creating your ticket…',
    'creatingOn': 'Creating your ticket on **{guild}**…',
    'rating.thanks': 'Thanks for your feedback!',
    'rating.body': 'Your opinion helps us improve our support.',
    'rating.comment': '💬 Your comment',
    'rating.already': 'You have already rated this ticket.',
    'rating.ask': '**How was your experience with our team?**',
    'rating.addComment': '💬 Add a comment',
    'rating.modalTitle': 'Your feedback on the support',
    'rating.modalLabel': 'Comment',
    'rating.modalPlaceholder': 'What you liked, what could be improved…',
    'rating.commentSaved': 'You have already left a comment for this ticket.',
    'rating.commentError': 'This comment could not be saved.',
    'rating.cannot': 'You cannot rate this ticket.',
    'close.confirm': 'Close ticket **#{id}{subject}**?\nThe staff will no longer be able to answer you in this ticket.',
    'close.button': '🔒 Close my ticket',
    'close.yes': 'Yes, close the ticket',
    'close.cancel': 'Cancel',
    'close.cancelled': 'Closing cancelled.',
    'close.already': 'This ticket is already closed.',
    'close.closing': 'Closing ticket #{id}…',
    'close.unavailable': 'This ticket cannot be closed right now. Ask the staff to close it.',
    'closed.title': '🔒 Ticket #{id} closed',
    'closed.body': 'Thanks for contacting us. Your ticket has been handled and closed.',
    'closed.duration': '⏱️ Duration',
    'closed.staff': '🛡️ Staff',
    'closed.by': '🔒 Closed by',
    'closed.member': '{tag} (member)',
    'faq.title': '{guild} · Before opening a ticket',
    'faq.body': 'These answers might help. If they don\'t, open a ticket: your message will be sent to the staff.',
    'faq.solved': '✅ Answer {n} helped me',
    'faq.continue': '📩 Open a ticket anyway',
    'faq.opening': '📩 Opening a ticket…',
    'faq.great': '✅ Great! No ticket was opened. Message me if you still need help.',
    'reply.scheduled': ' · scheduled message',
    'reply.footer': 'Reply here to write in ticket #{id}',
    'reply.file': '📎 File',
    'reply.fileAttached': '📎 Attached file',
    'welcome.default': 'Your ticket has been created. The support team will answer you soon.',
    'welcome.title': '🎫 Ticket #{id} created',
    'welcome.titleNoId': '🎫 Ticket created',
    'welcome.footer': 'Reply here to send a message to the staff',
    'welcome.subject': '📂 Subject',
    'myTickets': '📋 My tickets',
    'myTickets.title': '📋 My open tickets',
    'myTickets.none': 'You have no open ticket. Message me to open one.',
    'myTickets.footer': 'Message me to add a message to one of these tickets',
    'myTickets.last': 'Last message {when}',
    'status.waiting': '⏳ Waiting for your answer',
    'status.inProgress': '🛠️ Being worked on',
    'status.assigned': '👤 Handled by the staff',
    'status.received': '📨 Received, will be handled soon',
    'added.title': '👥 You were added to a ticket',
    'added.body': 'You can follow and take part in this ticket: reply to this private message to write in it.',
    'merged.title': '🔀 Tickets merged',
    'merged.body': 'Your ticket #{from}{subject} was merged with this one. The conversation continues here.',
    'inactive.warn.title': '⚠️ Your ticket is waiting for your answer',
    'inactive.warn.body': 'The staff answered you but we haven\'t heard from you for {warn} h.\nWithout a message from you within {left} h, the ticket will be closed automatically.',
    'inactive.closed.title': '🔒 Ticket closed automatically',
    'inactive.closed.body': 'Closed after {hours} h without an answer from you. You can open a new one at any time.',
    'flood': '⏳ You are sending too many messages in a row — wait a few seconds before trying again.',
    'ticketInvalid': 'Invalid ticket.',
    'ticketNotOpen': 'This ticket is no longer open. Send your message again to choose another ticket.',
    'ticketUnreachable': 'This ticket\'s channel cannot be reached. Try again later.',
    'serverInvalid': 'Invalid server.',
    'serverChosen': 'Server chosen: **{guild}**',
    'newTicketChosen': '➕ New ticket',
    'fields.title': 'Details — {step} of {total}',
    'fields.optional': 'Optional: reply « skip » to leave it out.',
    'fields.number': 'Reply with a number.',
    'fields.empty': 'This information is required.',
    'fields.skip': 'skip',
    'stage.open.title': '📨 Your ticket is back in the queue',
    'stage.open.body': 'The staff will pick it up as soon as possible.',
    'stage.waiting.title': '⏳ Your ticket is on hold',
    'stage.waiting.body': 'The staff is waiting for some information. If you were asked something, reply here.',
    'stage.in_progress.title': '🛠️ Your ticket is being worked on',
    'stage.in_progress.body': 'A staff member is taking care of it.',
    'reopen.button': '🔄 Reopen my ticket',
    'reopen.hint': 'You can reopen this ticket for {days} day(s) if the problem comes back.',
    'portal.title': '📂 Your tickets',
    'confidential.button': 'Confidential request',
    'confidential.subject': 'Confidential request',
    'confidential.welcome': '🔒 Confidential ticket: only the server founders can read it.',
    'portal.view': 'View on the web',
    'incident.title': '📢 Known issue in progress',
    'incident.footer': 'Your ticket is open: the team will answer as soon as possible.',
    'incident.resolved': '✅ Issue resolved',
    'portal.body': 'Find this conversation and all your tickets at {url}',
    'portal.list': 'Your closed tickets and their history: {url}',
    'reopen.expired': 'This ticket can no longer be reopened. Message me to open a new one.',
    'reopen.done': '🔄 Ticket #{id} reopened: message me here to continue the conversation.',
    'reopened.title': '🔄 Ticket #{id} reopened',
    'reopened.body': 'Your ticket has been reopened. You can keep replying here.',
    'blacklisted.dm': 'You have been blocked and can no longer open tickets.',
    'blacklisted.reason': 'Reason: {reason}',
    'invalidButton': 'Invalid or expired button.',
    'invalidInteraction': 'Invalid interaction.',
    'error': 'Something went wrong.',
    'unblacklisted': 'You were removed from the blacklist and can open tickets again.',
    'panel.subject': 'Ticket subject',
    'panel.subjectPlaceholder': 'A few words — used as the ticket title',
    'panel.form': '📋 **Form:**',
    'panel.created': '✅ Your ticket #{id} has been created. The conversation continues in a private message with the bot.',
    'panel.exists': 'ℹ️ You already have an open ticket (#{id}). Message the bot privately to follow it.',
    'panel.failed': '❌ The ticket could not be created. Try again in a moment.',
    'panel.blacklisted': '❌ You cannot open a ticket.',
    'panel.serverLimit': '❌ This server has reached its limit of open tickets. Try again later.',
    'panel.dailyLimit': '❌ You have already opened {max} ticket(s) today. Try again tomorrow.',
  },
};

function t(key, vars = {}) {
  const s = D[lang()][key] ?? D.fr[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

// ── Language resolution ──
const LOCALE_TTL_S = 90 * 24 * 3600;
const guildCache = new Map(); // guildId -> { at, setting, preferred }
const GUILD_TTL_MS = 60 * 1000;

async function rememberLocale(userId, locale) {
  if (!userId || !locale) return;
  await require('./redis').getRedis().set(`locale:${userId}`, String(locale).slice(0, 10), 'EX', LOCALE_TTL_S).catch(() => {});
}

async function guildLanguage(guildId) {
  const c = guildCache.get(guildId);
  if (c && Date.now() - c.at < GUILD_TTL_MS) return c.setting;
  let setting = 'fr';
  try {
    const [row] = await require('./tenantDb').getTenantDb(guildId)('SELECT bot_language FROM guild_config WHERE id = 1');
    if (['fr', 'en', 'auto'].includes(row?.bot_language)) setting = row.bot_language;
  } catch { /* guild not ready */ }
  guildCache.set(guildId, { at: Date.now(), setting });
  return setting;
}

// Language for a member, on a given guild when known.
async function memberLang(userId, guildId = null, client = null) {
  const setting = guildId ? await guildLanguage(guildId) : 'auto';
  if (setting !== 'auto') return setting;
  const remembered = userId ? await require('./redis').getRedis().get(`locale:${userId}`).catch(() => null) : null;
  if (remembered) return fromLocale(remembered);
  const preferred = guildId ? client?.guilds?.cache?.get(guildId)?.preferredLocale : null;
  return preferred ? fromLocale(preferred) : 'fr';
}

// Runs fn in the member's language.
async function inMemberLang(userId, guildId, client, fn) {
  return withLang(await memberLang(userId, guildId, client), fn);
}

// Sends a DM built in the member's language: build() runs inside that language.
async function sendToMember(client, userOrId, guildId, build) {
  const user = typeof userOrId === 'string' ? await client?.users.fetch(userOrId).catch(() => null) : userOrId;
  if (!user) return null;
  return inMemberLang(user.id, guildId, client, async () => user.send(await build(user)).catch(() => null));
}

const clearGuildLanguageCache = guildId => guildCache.delete(guildId);

module.exports = { t, lang, withLang, memberLang, inMemberLang, sendToMember, rememberLocale, fromLocale, clearGuildLanguageCache, LANGS };

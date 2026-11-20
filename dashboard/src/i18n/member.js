// Texts of the member space (/espace) in the six languages of the bot. The language is the one
// picked at the bottom of the page, else the browser's (English for any other language). It is
// sent to the API (X-Member-Lang) so that its error messages and the downloaded conversation
// follow it too.
const KEY = 'memberLang';
export const MEMBER_LANGS = [['fr', 'Français'], ['en', 'English'], ['es', 'Español'], ['de', 'Deutsch'], ['it', 'Italiano'], ['pt', 'Português']];
const CODES = MEMBER_LANGS.map(([c]) => c);
const LOCALES = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-BR' };

function detect() {
  try { const saved = localStorage.getItem(KEY); if (CODES.includes(saved)) return saved; } catch { /* storage unavailable */ }
  for (const l of navigator.languages || [navigator.language || '']) {
    const p = String(l).slice(0, 2).toLowerCase();
    if (CODES.includes(p)) return p;
  }
  return 'en';
}

export const MEMBER_LANG = detect();
export const memberLocale = LOCALES[MEMBER_LANG];
export function setMemberLang(next) {
  if (!CODES.includes(next)) return;
  try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
  window.location.reload();
}

const fr = {
  loginEmail: 'Recevoir un lien de connexion', emailLabel: 'Adresse e-mail', or: 'ou',
  linkSent: 'C\'est envoyé : ouvre le lien reçu par e-mail (valable 15 minutes). Pense à regarder dans les indésirables.',
  emailHint: 'Un lien à usage unique t\'est envoyé par e-mail, sans mot de passe.', noLogin: 'Aucun moyen de connexion n\'est encore configuré sur cette instance.',
  signingIn: 'Connexion en cours…', newLink: 'Demander un nouveau lien',
  noneHintWeb: 'Ouvre un ticket depuis l\'onglet « Ouvrir un ticket ».', replyWeb: 'Les réponses du support t\'arrivent aussi par e-mail, avec un lien vers cette page.',
  noGuildWeb: 'Aucun espace n\'accepte encore de demandes par e-mail sur cette instance.',
  title: 'Mes tickets', subtitle: 'Retrouve tes demandes au support, leur statut et vos échanges.',
  login: 'Se connecter avec Discord', loginHint: 'Seule ton identité Discord est demandée. Tu ne vois que tes propres tickets.',
  logout: 'Se déconnecter', none: 'Aucun ticket pour l\'instant.', noneHint: 'Pour ouvrir un ticket, envoie un message privé au bot sur Discord.',
  back: 'Mes tickets', transcript: 'Télécharger l\'échange', noMessages: 'Aucun message', you: 'Toi', member: 'Membre',
  tasks: 'Étapes', surveyTitle: 'Comment s\'est passé ton échange avec le support ?', surveyRating: 'Ta note', surveyComment: 'Un commentaire (facultatif)', surveyThanks: 'Merci, ta réponse est enregistrée !', kbHelpful: 'Cet article t\'a-t-il aidé ?', kbYes: 'Oui', kbNo: 'Non', kbWhatMissing: 'Qu\'est-ce qui manque ?', kbSend: 'Envoyer', kbThanks: 'Merci pour ton avis !', kbOtherLangs: 'Aussi en :', kbOriginal: 'Original', catalogTitle: 'Que veux-tu demander ?', otherRequest: 'Autre demande', changeService: 'changer', recorder: { screenshot: 'Capture d\'écran', video: 'Vidéo de l\'écran', voice: 'Message vocal', stop: 'Arrêter', recording: 'Enregistrement…', denied: 'Accès refusé par le navigateur', tooBig: 'Enregistrement trop lourd ({mb} Mo au plus)' }, npsLow: 'Pas du tout probable', npsHigh: 'Très probable', cesLow: 'Pas du tout d\'accord', cesHigh: 'Tout à fait d\'accord', assetLabel: 'Concerne', assetNone: 'Aucun de mes équipements', contractTitle: 'Contrat de mon organisation', contractHours: '{left} h restantes sur {total} h', contractTickets: '{left} ticket(s) restant(s) sur {total}', contractUnlimited: 'Support illimité', contractUntil: 'jusqu\'au {date}', orgTitle: 'Tickets de mon organisation', orgBy: 'de {name}', orgReadOnly: 'Un ticket de ton organisation : tu peux le suivre, seule la personne qui l\'a ouvert y répond.', participant: 'Participant', rating: 'Ta note', opened: 'Ouvert le', closed: 'Fermé le', notFound: 'Ticket introuvable.',
  error: { invalid_state: 'La connexion a expiré, réessaie.', oauth_failed: 'La connexion Discord a échoué, réessaie.', no_code: 'Connexion annulée.' },
  status: { closed: 'Fermé', merged: 'Regroupé avec un autre ticket', waiting: 'En attente de ta réponse', in_progress: 'En cours de traitement', assigned: 'Pris en charge', received: 'Reçu, en attente de prise en charge' },
  reply: 'Tu peux aussi répondre en message privé au bot sur Discord.',
  deleted: 'Message supprimé', edited: 'modifié',
  tabs: { tickets: 'Mes tickets', new: 'Ouvrir un ticket', help: 'Aide' },
  replyPh: 'Écris ta réponse…', send: 'Envoyer', sent: 'Message envoyé', closedTicket: 'Ce ticket est fermé.',
  server: 'Espace', subject: 'Sujet', subjectPh: 'Sujet de ta demande', message: 'Ta demande', messagePh: 'Explique ton problème le plus précisément possible.',
  confidential: 'Demande confidentielle : seuls les fondateurs de l\'espace pourront lire ce ticket (signalement, harcèlement…)', confidentialBadge: 'Confidentiel',
  optional: 'facultatif', form: 'Quelques questions', open: 'Ouvrir le ticket', noGuild: 'Aucun serveur disponible : tu dois être membre d\'un serveur qui utilise ce bot.',
  faqTitle: 'Questions fréquentes', faqSearch: 'Chercher dans l\'aide…', faqNone: 'Aucune réponse ne correspond.', faqEmpty: 'Cet espace n\'a pas encore de page d\'aide.',
  kbTitle: 'Base de connaissances', kbLink: 'Voir la base de connaissances publique', kbBack: 'Tous les articles', kbNotFound: 'Cette page d\'aide n\'existe pas ou n\'est pas publique.', kbArticleNotFound: 'Cet article n\'existe pas ou n\'est plus public.', kbContact: 'Ma question n\'y est pas : contacter le support', kbUpdated: 'Mis à jour le', kbGeneral: 'Général', kbCount: '{n} article(s)',
  solTitle: 'Solution proposée', solAccept: 'C\'est résolu', solThanks: 'Merci ! Le ticket est fermé.', solNotYet: 'Pas encore résolu ? Réponds simplement à l\'e-mail : le ticket reprend.', solGone: 'Ce lien a expiré ou a déjà servi.', resolvedHint: 'Si c\'est bon, confirme ; sinon dis ce qui ne va pas encore.', resolvedRefuse: 'Pas encore', resolvedRefusePh: 'Ce qui ne va pas encore…', resolvedSend: 'Envoyer', resolvedStatus: 'Résolu : en attente de ta confirmation',
  attach: 'Joindre des fichiers', files: 'Fichiers du ticket', fileHint: '{max} fichiers au plus, {mb} Mo chacun', filesSent: 'Fichiers envoyés',
  alreadyOpen: 'Tu as déjà un ticket ouvert à ce sujet :', alreadyOpenHint: 'Tu peux y répondre plutôt que d\'en ouvrir un nouveau.', stillStuck: 'Toujours bloqué ?', maybe: 'Ces réponses peuvent t\'aider :', error2: 'Erreur, réessaie.', privacy: 'Confidentialité', language: 'Langue',
};

const en = {
  loginEmail: 'Get a sign-in link', emailLabel: 'E-mail address', or: 'or',
  linkSent: 'Sent: open the link you received by e-mail (valid for 15 minutes). Check your spam folder too.',
  emailHint: 'A single-use link is sent to you by e-mail, no password needed.', noLogin: 'No sign-in method is set up on this instance yet.',
  signingIn: 'Signing in…', newLink: 'Ask for a new link',
  noneHintWeb: 'Open a ticket from the « Open a ticket » tab.', replyWeb: 'The support answers also reach you by e-mail, with a link to this page.',
  noGuildWeb: 'No space accepts requests by e-mail on this instance yet.',
  title: 'My tickets', subtitle: 'Find your support requests, their status and your conversations.',
  login: 'Sign in with Discord', loginHint: 'Only your Discord identity is requested. You only see your own tickets.',
  logout: 'Sign out', none: 'No tickets yet.', noneHint: 'To open a ticket, send a direct message to the bot on Discord.',
  back: 'My tickets', transcript: 'Download the conversation', noMessages: 'No messages', you: 'You', member: 'Member',
  tasks: 'Steps', surveyTitle: 'How was your exchange with support?', surveyRating: 'Your rating', surveyComment: 'A comment (optional)', surveyThanks: 'Thank you, your answer is saved!', kbHelpful: 'Did this article help you?', kbYes: 'Yes', kbNo: 'No', kbWhatMissing: 'What is missing?', kbSend: 'Send', kbThanks: 'Thanks for your feedback!', kbOtherLangs: 'Also in:', kbOriginal: 'Original', catalogTitle: 'What do you need?', otherRequest: 'Something else', changeService: 'change', recorder: { screenshot: 'Screenshot', video: 'Screen video', voice: 'Voice message', stop: 'Stop', recording: 'Recording…', denied: 'Access refused by the browser', tooBig: 'Recording too large ({mb} MB at most)' }, npsLow: 'Not at all likely', npsHigh: 'Very likely', cesLow: 'Strongly disagree', cesHigh: 'Strongly agree', assetLabel: 'About', assetNone: 'None of my devices', contractTitle: 'My organisation\'s contract', contractHours: '{left} h left of {total} h', contractTickets: '{left} ticket(s) left of {total}', contractUnlimited: 'Unlimited support', contractUntil: 'until {date}', orgTitle: 'My organisation\'s tickets', orgBy: 'by {name}', orgReadOnly: 'A ticket of your organisation: you can follow it, only the person who opened it replies.', participant: 'Participant', rating: 'Your rating', opened: 'Opened', closed: 'Closed', notFound: 'Ticket not found.',
  error: { invalid_state: 'The sign-in expired, please try again.', oauth_failed: 'Discord sign-in failed, please try again.', no_code: 'Sign-in cancelled.' },
  status: { closed: 'Closed', merged: 'Merged with another ticket', waiting: 'Waiting for your answer', in_progress: 'Being handled', assigned: 'Taken in charge', received: 'Received, waiting to be taken in charge' },
  reply: 'You can also answer by messaging the bot privately on Discord.',
  deleted: 'Message deleted', edited: 'edited',
  tabs: { tickets: 'My tickets', new: 'Open a ticket', help: 'Help' },
  replyPh: 'Write your answer…', send: 'Send', sent: 'Message sent', closedTicket: 'This ticket is closed.',
  server: 'Space', subject: 'Subject', subjectPh: 'Subject of your request', message: 'Your request', messagePh: 'Describe your problem as precisely as possible.',
  confidential: 'Confidential request: only the space founders will be able to read this ticket (report, harassment…)', confidentialBadge: 'Confidential',
  optional: 'optional', form: 'A few questions', open: 'Open the ticket', noGuild: 'No server available: you must be a member of a server that uses this bot.',
  faqTitle: 'Frequently asked questions', faqSearch: 'Search the help…', faqNone: 'No answer matches.', faqEmpty: 'This space has no help page yet.',
  kbTitle: 'Knowledge base', kbLink: 'See the public knowledge base', kbBack: 'All articles', kbNotFound: 'This help page does not exist or is not public.', kbArticleNotFound: 'This article does not exist or is no longer public.', kbContact: 'My question isn\'t here: contact support', kbUpdated: 'Updated on', kbGeneral: 'General', kbCount: '{n} article(s)',
  solTitle: 'Solution proposed', solAccept: 'It\'s solved', solThanks: 'Thanks! The ticket is closed.', solNotYet: 'Not solved yet? Just reply to the e-mail: the ticket goes on.', solGone: 'This link has expired or was already used.', resolvedHint: 'If it\'s fine, confirm; otherwise say what is still wrong.', resolvedRefuse: 'Not yet', resolvedRefusePh: 'What is still wrong…', resolvedSend: 'Send', resolvedStatus: 'Solved: waiting for your confirmation',
  attach: 'Attach files', files: 'Files of the ticket', fileHint: '{max} files at most, {mb} MB each', filesSent: 'Files sent',
  alreadyOpen: 'You already have an open ticket about this:', alreadyOpenHint: 'You can answer it instead of opening a new one.', stillStuck: 'Still stuck?', maybe: 'These answers may help:', error2: 'Error, please try again.', privacy: 'Privacy', language: 'Language',
};

const es = {
  loginEmail: 'Recibir un enlace de inicio de sesión', emailLabel: 'Dirección de correo', or: 'o',
  linkSent: 'Enviado: abre el enlace recibido por correo (válido 15 minutos). Revisa también la carpeta de spam.',
  emailHint: 'Te enviamos por correo un enlace de un solo uso, sin contraseña.', noLogin: 'Todavía no hay ningún método de inicio de sesión configurado en esta instancia.',
  signingIn: 'Iniciando sesión…', newLink: 'Pedir un nuevo enlace',
  noneHintWeb: 'Abre un ticket desde la pestaña « Abrir un ticket ».', replyWeb: 'Las respuestas del soporte también te llegan por correo, con un enlace a esta página.',
  noGuildWeb: 'Ningún espacio acepta todavía solicitudes por correo en esta instancia.',
  title: 'Mis tickets', subtitle: 'Encuentra tus solicitudes al soporte, su estado y vuestras conversaciones.',
  login: 'Iniciar sesión con Discord', loginHint: 'Solo se pide tu identidad de Discord. Solo ves tus propios tickets.',
  logout: 'Cerrar sesión', none: 'Todavía no hay tickets.', noneHint: 'Para abrir un ticket, envía un mensaje privado al bot en Discord.',
  back: 'Mis tickets', transcript: 'Descargar la conversación', noMessages: 'Sin mensajes', you: 'Tú', member: 'Miembro',
  tasks: 'Pasos', surveyTitle: '¿Qué tal fue tu intercambio con el soporte?', surveyRating: 'Tu valoración', surveyComment: 'Un comentario (opcional)', surveyThanks: '¡Gracias, tu respuesta está guardada!', kbHelpful: '¿Te ha ayudado este artículo?', kbYes: 'Sí', kbNo: 'No', kbWhatMissing: '¿Qué falta?', kbSend: 'Enviar', kbThanks: '¡Gracias por tu opinión!', kbOtherLangs: 'También en:', kbOriginal: 'Original', catalogTitle: '¿Qué necesitas?', otherRequest: 'Otra solicitud', changeService: 'cambiar', recorder: { screenshot: 'Captura de pantalla', video: 'Vídeo de la pantalla', voice: 'Mensaje de voz', stop: 'Detener', recording: 'Grabando…', denied: 'Acceso denegado por el navegador', tooBig: 'Grabación demasiado pesada ({mb} MB como máximo)' }, npsLow: 'Nada probable', npsHigh: 'Muy probable', cesLow: 'Totalmente en desacuerdo', cesHigh: 'Totalmente de acuerdo', assetLabel: 'Se refiere a', assetNone: 'Ninguno de mis equipos', contractTitle: 'Contrato de mi organización', contractHours: 'Quedan {left} h de {total} h', contractTickets: 'Quedan {left} ticket(s) de {total}', contractUnlimited: 'Soporte ilimitado', contractUntil: 'hasta el {date}', orgTitle: 'Tickets de mi organización', orgBy: 'de {name}', orgReadOnly: 'Un ticket de tu organización: puedes seguirlo, solo quien lo abrió responde.', participant: 'Participante', rating: 'Tu valoración', opened: 'Abierto el', closed: 'Cerrado el', notFound: 'Ticket no encontrado.',
  error: { invalid_state: 'La conexión ha caducado, inténtalo de nuevo.', oauth_failed: 'La conexión con Discord ha fallado, inténtalo de nuevo.', no_code: 'Conexión cancelada.' },
  status: { closed: 'Cerrado', merged: 'Fusionado con otro ticket', waiting: 'Esperando tu respuesta', in_progress: 'En curso', assigned: 'Atendido', received: 'Recibido, a la espera de ser atendido' },
  reply: 'También puedes responder por mensaje privado al bot en Discord.',
  deleted: 'Mensaje eliminado', edited: 'editado',
  tabs: { tickets: 'Mis tickets', new: 'Abrir un ticket', help: 'Ayuda' },
  replyPh: 'Escribe tu respuesta…', send: 'Enviar', sent: 'Mensaje enviado', closedTicket: 'Este ticket está cerrado.',
  server: 'Espacio', subject: 'Asunto', subjectPh: 'Asunto de tu solicitud', message: 'Tu solicitud', messagePh: 'Explica tu problema con la mayor precisión posible.',
  confidential: 'Solicitud confidencial: solo los fundadores del espacio podrán leer este ticket (denuncia, acoso…)', confidentialBadge: 'Confidencial',
  optional: 'opcional', form: 'Algunas preguntas', open: 'Abrir el ticket', noGuild: 'Ningún servidor disponible: debes ser miembro de un servidor que use este bot.',
  faqTitle: 'Preguntas frecuentes', faqSearch: 'Buscar en la ayuda…', faqNone: 'Ninguna respuesta coincide.', faqEmpty: 'Este espacio aún no tiene página de ayuda.',
  kbTitle: 'Base de conocimientos', kbLink: 'Ver la base de conocimientos pública', kbBack: 'Todos los artículos', kbNotFound: 'Esta página de ayuda no existe o no es pública.', kbArticleNotFound: 'Este artículo no existe o ya no es público.', kbContact: 'Mi pregunta no está: contactar con el soporte', kbUpdated: 'Actualizado el', kbGeneral: 'General', kbCount: '{n} artículo(s)',
  solTitle: 'Solución propuesta', solAccept: 'Está resuelto', solThanks: '¡Gracias! El ticket está cerrado.', solNotYet: '¿Aún no está resuelto? Responde al correo: el ticket continúa.', solGone: 'Este enlace ha caducado o ya se usó.', resolvedHint: 'Si está bien, confírmalo; si no, di lo que aún falla.', resolvedRefuse: 'Todavía no', resolvedRefusePh: 'Lo que aún falla…', resolvedSend: 'Enviar', resolvedStatus: 'Resuelto: esperando tu confirmación',
  attach: 'Adjuntar archivos', files: 'Archivos del ticket', fileHint: '{max} archivos como máximo, {mb} MB cada uno', filesSent: 'Archivos enviados',
  alreadyOpen: 'Ya tienes un ticket abierto sobre esto:', alreadyOpenHint: 'Puedes responder en él en lugar de abrir uno nuevo.', stillStuck: '¿Sigues bloqueado?', maybe: 'Estas respuestas pueden ayudarte:', error2: 'Error, inténtalo de nuevo.', privacy: 'Privacidad', language: 'Idioma',
};

const de = {
  loginEmail: 'Anmeldelink erhalten', emailLabel: 'E-Mail-Adresse', or: 'oder',
  linkSent: 'Gesendet: Öffne den Link aus der E-Mail (15 Minuten gültig). Sieh auch im Spam-Ordner nach.',
  emailHint: 'Du erhältst einen Einmal-Link per E-Mail, ganz ohne Passwort.', noLogin: 'Auf dieser Instanz ist noch keine Anmeldemethode eingerichtet.',
  signingIn: 'Anmeldung läuft…', newLink: 'Neuen Link anfordern',
  noneHintWeb: 'Öffne ein Ticket über den Reiter « Ticket öffnen ».', replyWeb: 'Antworten des Supports erhältst du auch per E-Mail, mit einem Link zu dieser Seite.',
  noGuildWeb: 'Auf dieser Instanz nimmt noch kein Bereich Anfragen per E-Mail an.',
  title: 'Meine Tickets', subtitle: 'Deine Support-Anfragen, ihr Status und eure Unterhaltungen.',
  login: 'Mit Discord anmelden', loginHint: 'Nur deine Discord-Identität wird abgefragt. Du siehst nur deine eigenen Tickets.',
  logout: 'Abmelden', none: 'Noch keine Tickets.', noneHint: 'Um ein Ticket zu öffnen, schreibe dem Bot auf Discord eine Direktnachricht.',
  back: 'Meine Tickets', transcript: 'Unterhaltung herunterladen', noMessages: 'Keine Nachrichten', you: 'Du', member: 'Mitglied',
  tasks: 'Schritte', surveyTitle: 'Wie war dein Austausch mit dem Support?', surveyRating: 'Deine Bewertung', surveyComment: 'Ein Kommentar (optional)', surveyThanks: 'Danke, deine Antwort ist gespeichert!', kbHelpful: 'Hat dir dieser Artikel geholfen?', kbYes: 'Ja', kbNo: 'Nein', kbWhatMissing: 'Was fehlt?', kbSend: 'Senden', kbThanks: 'Danke für deine Rückmeldung!', kbOtherLangs: 'Auch auf:', kbOriginal: 'Original', catalogTitle: 'Was brauchst du?', otherRequest: 'Etwas anderes', changeService: 'ändern', recorder: { screenshot: 'Bildschirmfoto', video: 'Bildschirmvideo', voice: 'Sprachnachricht', stop: 'Stoppen', recording: 'Aufnahme…', denied: 'Zugriff vom Browser verweigert', tooBig: 'Aufnahme zu groß (höchstens {mb} MB)' }, npsLow: 'Überhaupt nicht wahrscheinlich', npsHigh: 'Sehr wahrscheinlich', cesLow: 'Stimme überhaupt nicht zu', cesHigh: 'Stimme voll zu', assetLabel: 'Betrifft', assetNone: 'Keines meiner Geräte', contractTitle: 'Vertrag meiner Organisation', contractHours: 'Noch {left} h von {total} h', contractTickets: 'Noch {left} Ticket(s) von {total}', contractUnlimited: 'Unbegrenzter Support', contractUntil: 'bis {date}', orgTitle: 'Tickets meiner Organisation', orgBy: 'von {name}', orgReadOnly: 'Ein Ticket deiner Organisation: du kannst es verfolgen, nur die Person, die es geöffnet hat, antwortet.', participant: 'Teilnehmer', rating: 'Deine Bewertung', opened: 'Geöffnet am', closed: 'Geschlossen am', notFound: 'Ticket nicht gefunden.',
  error: { invalid_state: 'Die Anmeldung ist abgelaufen, versuche es erneut.', oauth_failed: 'Die Discord-Anmeldung ist fehlgeschlagen, versuche es erneut.', no_code: 'Anmeldung abgebrochen.' },
  status: { closed: 'Geschlossen', merged: 'Mit einem anderen Ticket zusammengeführt', waiting: 'Wartet auf deine Antwort', in_progress: 'In Bearbeitung', assigned: 'Übernommen', received: 'Erhalten, wartet auf Übernahme' },
  reply: 'Du kannst auch per Direktnachricht an den Bot auf Discord antworten.',
  deleted: 'Nachricht gelöscht', edited: 'bearbeitet',
  tabs: { tickets: 'Meine Tickets', new: 'Ticket öffnen', help: 'Hilfe' },
  replyPh: 'Schreibe deine Antwort…', send: 'Senden', sent: 'Nachricht gesendet', closedTicket: 'Dieses Ticket ist geschlossen.',
  server: 'Bereich', subject: 'Betreff', subjectPh: 'Betreff deines Anliegens', message: 'Dein Anliegen', messagePh: 'Beschreibe dein Problem so genau wie möglich.',
  confidential: 'Vertrauliche Anfrage: Nur die Gründer des Bereichs können dieses Ticket lesen (Meldung, Belästigung…)', confidentialBadge: 'Vertraulich',
  optional: 'optional', form: 'Ein paar Fragen', open: 'Ticket öffnen', noGuild: 'Kein Server verfügbar: Du musst Mitglied eines Servers sein, der diesen Bot nutzt.',
  faqTitle: 'Häufige Fragen', faqSearch: 'Hilfe durchsuchen…', faqNone: 'Keine Antwort passt.', faqEmpty: 'Dieser Bereich hat noch keine Hilfeseite.',
  kbTitle: 'Wissensdatenbank', kbLink: 'Öffentliche Wissensdatenbank ansehen', kbBack: 'Alle Artikel', kbNotFound: 'Diese Hilfeseite existiert nicht oder ist nicht öffentlich.', kbArticleNotFound: 'Dieser Artikel existiert nicht oder ist nicht mehr öffentlich.', kbContact: 'Meine Frage ist nicht dabei: Support kontaktieren', kbUpdated: 'Aktualisiert am', kbGeneral: 'Allgemein', kbCount: '{n} Artikel',
  solTitle: 'Lösung vorgeschlagen', solAccept: 'Es ist gelöst', solThanks: 'Danke! Das Ticket ist geschlossen.', solNotYet: 'Noch nicht gelöst? Antworte einfach auf die E-Mail: das Ticket geht weiter.', solGone: 'Dieser Link ist abgelaufen oder wurde schon benutzt.', resolvedHint: 'Wenn es passt, bestätige; sonst schreib, was noch nicht passt.', resolvedRefuse: 'Noch nicht', resolvedRefusePh: 'Was noch nicht passt…', resolvedSend: 'Senden', resolvedStatus: 'Gelöst: wartet auf deine Bestätigung',
  attach: 'Dateien anhängen', files: 'Dateien des Tickets', fileHint: 'Höchstens {max} Dateien, je {mb} MB', filesSent: 'Dateien gesendet',
  alreadyOpen: 'Du hast bereits ein offenes Ticket zu diesem Thema:', alreadyOpenHint: 'Du kannst dort antworten, statt ein neues zu eröffnen.', stillStuck: 'Immer noch nicht gelöst?', maybe: 'Diese Antworten könnten helfen:', error2: 'Fehler, versuche es erneut.', privacy: 'Datenschutz', language: 'Sprache',
};

const it = {
  loginEmail: 'Ricevi un link di accesso', emailLabel: 'Indirizzo e-mail', or: 'oppure',
  linkSent: 'Inviato: apri il link ricevuto via e-mail (valido 15 minuti). Controlla anche lo spam.',
  emailHint: 'Ricevi via e-mail un link monouso, senza bisogno di password.', noLogin: 'Nessun metodo di accesso è ancora configurato su questa istanza.',
  signingIn: 'Accesso in corso…', newLink: 'Richiedi un nuovo link',
  noneHintWeb: 'Apri un ticket dalla scheda « Apri un ticket ».', replyWeb: 'Le risposte del supporto ti arrivano anche via e-mail, con un link a questa pagina.',
  noGuildWeb: 'Nessuno spazio accetta ancora richieste via e-mail su questa istanza.',
  title: 'I miei ticket', subtitle: 'Ritrova le tue richieste al supporto, il loro stato e le vostre conversazioni.',
  login: 'Accedi con Discord', loginHint: 'Viene richiesta solo la tua identità Discord. Vedi solo i tuoi ticket.',
  logout: 'Esci', none: 'Ancora nessun ticket.', noneHint: 'Per aprire un ticket, invia un messaggio privato al bot su Discord.',
  back: 'I miei ticket', transcript: 'Scarica la conversazione', noMessages: 'Nessun messaggio', you: 'Tu', member: 'Membro',
  tasks: 'Passaggi', surveyTitle: 'Com\'è andato il tuo scambio con il supporto?', surveyRating: 'Il tuo voto', surveyComment: 'Un commento (facoltativo)', surveyThanks: 'Grazie, la tua risposta è salvata!', kbHelpful: 'Questo articolo ti è stato utile?', kbYes: 'Sì', kbNo: 'No', kbWhatMissing: 'Cosa manca?', kbSend: 'Invia', kbThanks: 'Grazie per il tuo parere!', kbOtherLangs: 'Anche in:', kbOriginal: 'Originale', catalogTitle: 'Di cosa hai bisogno?', otherRequest: 'Altra richiesta', changeService: 'cambia', recorder: { screenshot: 'Screenshot', video: 'Video dello schermo', voice: 'Messaggio vocale', stop: 'Ferma', recording: 'Registrazione…', denied: 'Accesso negato dal browser', tooBig: 'Registrazione troppo pesante (al massimo {mb} MB)' }, npsLow: 'Per niente probabile', npsHigh: 'Molto probabile', cesLow: 'Per niente d\'accordo', cesHigh: 'Completamente d\'accordo', assetLabel: 'Riguarda', assetNone: 'Nessuno dei miei dispositivi', contractTitle: 'Contratto della mia organizzazione', contractHours: 'Restano {left} h su {total} h', contractTickets: 'Restano {left} ticket su {total}', contractUnlimited: 'Supporto illimitato', contractUntil: 'fino al {date}', orgTitle: 'Ticket della mia organizzazione', orgBy: 'di {name}', orgReadOnly: 'Un ticket della tua organizzazione: puoi seguirlo, risponde solo chi l\'ha aperto.', participant: 'Partecipante', rating: 'Il tuo voto', opened: 'Aperto il', closed: 'Chiuso il', notFound: 'Ticket non trovato.',
  error: { invalid_state: 'L\'accesso è scaduto, riprova.', oauth_failed: 'L\'accesso con Discord non è riuscito, riprova.', no_code: 'Accesso annullato.' },
  status: { closed: 'Chiuso', merged: 'Unito a un altro ticket', waiting: 'In attesa della tua risposta', in_progress: 'In lavorazione', assigned: 'Preso in carico', received: 'Ricevuto, in attesa di presa in carico' },
  reply: 'Puoi anche rispondere con un messaggio privato al bot su Discord.',
  deleted: 'Messaggio eliminato', edited: 'modificato',
  tabs: { tickets: 'I miei ticket', new: 'Apri un ticket', help: 'Aiuto' },
  replyPh: 'Scrivi la tua risposta…', send: 'Invia', sent: 'Messaggio inviato', closedTicket: 'Questo ticket è chiuso.',
  server: 'Spazio', subject: 'Oggetto', subjectPh: 'Oggetto della tua richiesta', message: 'La tua richiesta', messagePh: 'Descrivi il problema nel modo più preciso possibile.',
  confidential: 'Richiesta riservata: solo i fondatori dello spazio potranno leggere questo ticket (segnalazione, molestie…)', confidentialBadge: 'Riservato',
  optional: 'facoltativo', form: 'Qualche domanda', open: 'Apri il ticket', noGuild: 'Nessun server disponibile: devi essere membro di un server che usa questo bot.',
  faqTitle: 'Domande frequenti', faqSearch: 'Cerca nell\'aiuto…', faqNone: 'Nessuna risposta corrisponde.', faqEmpty: 'Questo spazio non ha ancora una pagina di aiuto.',
  kbTitle: 'Base di conoscenza', kbLink: 'Vedi la base di conoscenza pubblica', kbBack: 'Tutti gli articoli', kbNotFound: 'Questa pagina di aiuto non esiste o non è pubblica.', kbArticleNotFound: 'Questo articolo non esiste o non è più pubblico.', kbContact: 'La mia domanda non c\'è: contatta il supporto', kbUpdated: 'Aggiornato il', kbGeneral: 'Generale', kbCount: '{n} articolo/i',
  solTitle: 'Soluzione proposta', solAccept: 'È risolto', solThanks: 'Grazie! Il ticket è chiuso.', solNotYet: 'Non ancora risolto? Rispondi all\'e-mail: il ticket continua.', solGone: 'Questo link è scaduto o è già stato usato.', resolvedHint: 'Se va bene, conferma; altrimenti di\' cosa non va ancora.', resolvedRefuse: 'Non ancora', resolvedRefusePh: 'Cosa non va ancora…', resolvedSend: 'Invia', resolvedStatus: 'Risolto: in attesa della tua conferma',
  attach: 'Allega file', files: 'File del ticket', fileHint: 'Al massimo {max} file, {mb} MB ciascuno', filesSent: 'File inviati',
  alreadyOpen: 'Hai già un ticket aperto su questo argomento:', alreadyOpenHint: 'Puoi rispondere lì invece di aprirne uno nuovo.', stillStuck: 'Ancora bloccato?', maybe: 'Queste risposte possono aiutarti:', error2: 'Errore, riprova.', privacy: 'Privacy', language: 'Lingua',
};

const pt = {
  loginEmail: 'Receber um link de login', emailLabel: 'Endereço de e-mail', or: 'ou',
  linkSent: 'Enviado: abra o link recebido por e-mail (válido por 15 minutos). Verifique também o spam.',
  emailHint: 'Um link de uso único é enviado para você por e-mail, sem precisar de senha.', noLogin: 'Nenhum método de login está configurado nesta instância ainda.',
  signingIn: 'Entrando…', newLink: 'Pedir um novo link',
  noneHintWeb: 'Abra um ticket pela aba « Abrir um ticket ».', replyWeb: 'As respostas do suporte também chegam por e-mail, com um link para esta página.',
  noGuildWeb: 'Nenhum espaço aceita pedidos por e-mail nesta instância ainda.',
  title: 'Meus tickets', subtitle: 'Encontre suas solicitações ao suporte, o status delas e suas conversas.',
  login: 'Entrar com o Discord', loginHint: 'Só sua identidade do Discord é solicitada. Você só vê seus próprios tickets.',
  logout: 'Sair', none: 'Nenhum ticket por enquanto.', noneHint: 'Para abrir um ticket, envie uma mensagem privada ao bot no Discord.',
  back: 'Meus tickets', transcript: 'Baixar a conversa', noMessages: 'Nenhuma mensagem', you: 'Você', member: 'Membro',
  tasks: 'Etapas', surveyTitle: 'Como foi sua conversa com o suporte?', surveyRating: 'Sua nota', surveyComment: 'Um comentário (opcional)', surveyThanks: 'Obrigado, sua resposta foi salva!', kbHelpful: 'Este artigo ajudou você?', kbYes: 'Sim', kbNo: 'Não', kbWhatMissing: 'O que está faltando?', kbSend: 'Enviar', kbThanks: 'Obrigado pela sua opinião!', kbOtherLangs: 'Também em:', kbOriginal: 'Original', catalogTitle: 'Do que você precisa?', otherRequest: 'Outra solicitação', changeService: 'mudar', recorder: { screenshot: 'Captura de ecrã', video: 'Vídeo do ecrã', voice: 'Mensagem de voz', stop: 'Parar', recording: 'A gravar…', denied: 'Acesso recusado pelo navegador', tooBig: 'Gravação demasiado pesada ({mb} MB no máximo)' }, npsLow: 'Nada provável', npsHigh: 'Muito provável', cesLow: 'Discordo totalmente', cesHigh: 'Concordo totalmente', assetLabel: 'Refere-se a', assetNone: 'Nenhum dos meus equipamentos', contractTitle: 'Contrato da minha organização', contractHours: 'Restam {left} h de {total} h', contractTickets: 'Restam {left} ticket(s) de {total}', contractUnlimited: 'Suporte ilimitado', contractUntil: 'até {date}', orgTitle: 'Tickets da minha organização', orgBy: 'de {name}', orgReadOnly: 'Um ticket da sua organização: você pode acompanhá-lo, só quem o abriu responde.', participant: 'Participante', rating: 'Sua nota', opened: 'Aberto em', closed: 'Fechado em', notFound: 'Ticket não encontrado.',
  error: { invalid_state: 'A conexão expirou, tente de novo.', oauth_failed: 'A conexão com o Discord falhou, tente de novo.', no_code: 'Conexão cancelada.' },
  status: { closed: 'Fechado', merged: 'Mesclado com outro ticket', waiting: 'Aguardando sua resposta', in_progress: 'Em andamento', assigned: 'Assumido', received: 'Recebido, aguardando atendimento' },
  reply: 'Você também pode responder por mensagem privada ao bot no Discord.',
  deleted: 'Mensagem excluída', edited: 'editada',
  tabs: { tickets: 'Meus tickets', new: 'Abrir um ticket', help: 'Ajuda' },
  replyPh: 'Escreva sua resposta…', send: 'Enviar', sent: 'Mensagem enviada', closedTicket: 'Este ticket está fechado.',
  server: 'Espaço', subject: 'Assunto', subjectPh: 'Assunto da sua solicitação', message: 'Sua solicitação', messagePh: 'Explique seu problema da forma mais precisa possível.',
  confidential: 'Solicitação confidencial: só os fundadores do espaço poderão ler este ticket (denúncia, assédio…)', confidentialBadge: 'Confidencial',
  optional: 'opcional', form: 'Algumas perguntas', open: 'Abrir o ticket', noGuild: 'Nenhum servidor disponível: você precisa ser membro de um servidor que usa este bot.',
  faqTitle: 'Perguntas frequentes', faqSearch: 'Pesquisar na ajuda…', faqNone: 'Nenhuma resposta corresponde.', faqEmpty: 'Este espaço ainda não tem página de ajuda.',
  kbTitle: 'Base de conhecimento', kbLink: 'Ver a base de conhecimento pública', kbBack: 'Todos os artigos', kbNotFound: 'Esta página de ajuda não existe ou não é pública.', kbArticleNotFound: 'Este artigo não existe ou não é mais público.', kbContact: 'Minha pergunta não está aqui: contatar o suporte', kbUpdated: 'Atualizado em', kbGeneral: 'Geral', kbCount: '{n} artigo(s)',
  solTitle: 'Solução proposta', solAccept: 'Está resolvido', solThanks: 'Obrigado! O ticket está fechado.', solNotYet: 'Ainda não resolvido? Responda ao e-mail: o ticket continua.', solGone: 'Este link expirou ou já foi usado.', resolvedHint: 'Se estiver tudo certo, confirme; senão diga o que ainda não está certo.', resolvedRefuse: 'Ainda não', resolvedRefusePh: 'O que ainda não está certo…', resolvedSend: 'Enviar', resolvedStatus: 'Resolvido: aguardando sua confirmação',
  attach: 'Anexar arquivos', files: 'Arquivos do ticket', fileHint: 'No máximo {max} arquivos, {mb} MB cada', filesSent: 'Arquivos enviados',
  alreadyOpen: 'Você já tem um ticket aberto sobre isso:', alreadyOpenHint: 'Você pode responder nele em vez de abrir um novo.', stillStuck: 'Ainda com dúvidas?', maybe: 'Estas respostas podem ajudar:', error2: 'Erro, tente de novo.', privacy: 'Privacidade', language: 'Idioma',
};

export const MEMBER_STRINGS = { fr, en, es, de, it, pt };
export const STR = MEMBER_STRINGS[MEMBER_LANG];

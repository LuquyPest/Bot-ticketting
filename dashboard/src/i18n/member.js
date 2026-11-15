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
  title: 'Mes tickets', subtitle: 'Retrouve tes demandes au support, leur statut et vos échanges.',
  login: 'Se connecter avec Discord', loginHint: 'Seule ton identité Discord est demandée. Tu ne vois que tes propres tickets.',
  logout: 'Se déconnecter', none: 'Aucun ticket pour l\'instant.', noneHint: 'Pour ouvrir un ticket, envoie un message privé au bot sur Discord.',
  back: 'Mes tickets', transcript: 'Télécharger l\'échange', noMessages: 'Aucun message', you: 'Toi', member: 'Membre',
  participant: 'Participant', rating: 'Ta note', opened: 'Ouvert le', closed: 'Fermé le', notFound: 'Ticket introuvable.',
  error: { invalid_state: 'La connexion a expiré, réessaie.', oauth_failed: 'La connexion Discord a échoué, réessaie.', no_code: 'Connexion annulée.' },
  status: { closed: 'Fermé', merged: 'Regroupé avec un autre ticket', waiting: 'En attente de ta réponse', in_progress: 'En cours de traitement', assigned: 'Pris en charge', received: 'Reçu, en attente de prise en charge' },
  reply: 'Tu peux aussi répondre en message privé au bot sur Discord.',
  deleted: 'Message supprimé', edited: 'modifié',
  tabs: { tickets: 'Mes tickets', new: 'Ouvrir un ticket', help: 'Aide' },
  replyPh: 'Écris ta réponse…', send: 'Envoyer', sent: 'Message envoyé', closedTicket: 'Ce ticket est fermé.',
  server: 'Serveur', subject: 'Sujet', subjectPh: 'Sujet de ta demande', message: 'Ta demande', messagePh: 'Explique ton problème le plus précisément possible.',
  confidential: 'Demande confidentielle : seuls les fondateurs du serveur pourront lire ce ticket (signalement, harcèlement…)', confidentialBadge: 'Confidentiel',
  optional: 'facultatif', form: 'Quelques questions', open: 'Ouvrir le ticket', noGuild: 'Aucun serveur disponible : tu dois être membre d\'un serveur qui utilise ce bot.',
  faqTitle: 'Questions fréquentes', faqSearch: 'Chercher dans l\'aide…', faqNone: 'Aucune réponse ne correspond.', faqEmpty: 'Ce serveur n\'a pas encore de page d\'aide.',
  stillStuck: 'Toujours bloqué ?', maybe: 'Ces réponses peuvent t\'aider :', error2: 'Erreur, réessaie.', privacy: 'Confidentialité', language: 'Langue',
};

const en = {
  title: 'My tickets', subtitle: 'Find your support requests, their status and your conversations.',
  login: 'Sign in with Discord', loginHint: 'Only your Discord identity is requested. You only see your own tickets.',
  logout: 'Sign out', none: 'No tickets yet.', noneHint: 'To open a ticket, send a direct message to the bot on Discord.',
  back: 'My tickets', transcript: 'Download the conversation', noMessages: 'No messages', you: 'You', member: 'Member',
  participant: 'Participant', rating: 'Your rating', opened: 'Opened', closed: 'Closed', notFound: 'Ticket not found.',
  error: { invalid_state: 'The sign-in expired, please try again.', oauth_failed: 'Discord sign-in failed, please try again.', no_code: 'Sign-in cancelled.' },
  status: { closed: 'Closed', merged: 'Merged with another ticket', waiting: 'Waiting for your answer', in_progress: 'Being handled', assigned: 'Taken in charge', received: 'Received, waiting to be taken in charge' },
  reply: 'You can also answer by messaging the bot privately on Discord.',
  deleted: 'Message deleted', edited: 'edited',
  tabs: { tickets: 'My tickets', new: 'Open a ticket', help: 'Help' },
  replyPh: 'Write your answer…', send: 'Send', sent: 'Message sent', closedTicket: 'This ticket is closed.',
  server: 'Server', subject: 'Subject', subjectPh: 'Subject of your request', message: 'Your request', messagePh: 'Describe your problem as precisely as possible.',
  confidential: 'Confidential request: only the server founders will be able to read this ticket (report, harassment…)', confidentialBadge: 'Confidential',
  optional: 'optional', form: 'A few questions', open: 'Open the ticket', noGuild: 'No server available: you must be a member of a server that uses this bot.',
  faqTitle: 'Frequently asked questions', faqSearch: 'Search the help…', faqNone: 'No answer matches.', faqEmpty: 'This server has no help page yet.',
  stillStuck: 'Still stuck?', maybe: 'These answers may help:', error2: 'Error, please try again.', privacy: 'Privacy', language: 'Language',
};

const es = {
  title: 'Mis tickets', subtitle: 'Encuentra tus solicitudes al soporte, su estado y vuestras conversaciones.',
  login: 'Iniciar sesión con Discord', loginHint: 'Solo se pide tu identidad de Discord. Solo ves tus propios tickets.',
  logout: 'Cerrar sesión', none: 'Todavía no hay tickets.', noneHint: 'Para abrir un ticket, envía un mensaje privado al bot en Discord.',
  back: 'Mis tickets', transcript: 'Descargar la conversación', noMessages: 'Sin mensajes', you: 'Tú', member: 'Miembro',
  participant: 'Participante', rating: 'Tu valoración', opened: 'Abierto el', closed: 'Cerrado el', notFound: 'Ticket no encontrado.',
  error: { invalid_state: 'La conexión ha caducado, inténtalo de nuevo.', oauth_failed: 'La conexión con Discord ha fallado, inténtalo de nuevo.', no_code: 'Conexión cancelada.' },
  status: { closed: 'Cerrado', merged: 'Fusionado con otro ticket', waiting: 'Esperando tu respuesta', in_progress: 'En curso', assigned: 'Atendido', received: 'Recibido, a la espera de ser atendido' },
  reply: 'También puedes responder por mensaje privado al bot en Discord.',
  deleted: 'Mensaje eliminado', edited: 'editado',
  tabs: { tickets: 'Mis tickets', new: 'Abrir un ticket', help: 'Ayuda' },
  replyPh: 'Escribe tu respuesta…', send: 'Enviar', sent: 'Mensaje enviado', closedTicket: 'Este ticket está cerrado.',
  server: 'Servidor', subject: 'Asunto', subjectPh: 'Asunto de tu solicitud', message: 'Tu solicitud', messagePh: 'Explica tu problema con la mayor precisión posible.',
  confidential: 'Solicitud confidencial: solo los fundadores del servidor podrán leer este ticket (denuncia, acoso…)', confidentialBadge: 'Confidencial',
  optional: 'opcional', form: 'Algunas preguntas', open: 'Abrir el ticket', noGuild: 'Ningún servidor disponible: debes ser miembro de un servidor que use este bot.',
  faqTitle: 'Preguntas frecuentes', faqSearch: 'Buscar en la ayuda…', faqNone: 'Ninguna respuesta coincide.', faqEmpty: 'Este servidor aún no tiene página de ayuda.',
  stillStuck: '¿Sigues bloqueado?', maybe: 'Estas respuestas pueden ayudarte:', error2: 'Error, inténtalo de nuevo.', privacy: 'Privacidad', language: 'Idioma',
};

const de = {
  title: 'Meine Tickets', subtitle: 'Deine Support-Anfragen, ihr Status und eure Unterhaltungen.',
  login: 'Mit Discord anmelden', loginHint: 'Nur deine Discord-Identität wird abgefragt. Du siehst nur deine eigenen Tickets.',
  logout: 'Abmelden', none: 'Noch keine Tickets.', noneHint: 'Um ein Ticket zu öffnen, schreibe dem Bot auf Discord eine Direktnachricht.',
  back: 'Meine Tickets', transcript: 'Unterhaltung herunterladen', noMessages: 'Keine Nachrichten', you: 'Du', member: 'Mitglied',
  participant: 'Teilnehmer', rating: 'Deine Bewertung', opened: 'Geöffnet am', closed: 'Geschlossen am', notFound: 'Ticket nicht gefunden.',
  error: { invalid_state: 'Die Anmeldung ist abgelaufen, versuche es erneut.', oauth_failed: 'Die Discord-Anmeldung ist fehlgeschlagen, versuche es erneut.', no_code: 'Anmeldung abgebrochen.' },
  status: { closed: 'Geschlossen', merged: 'Mit einem anderen Ticket zusammengeführt', waiting: 'Wartet auf deine Antwort', in_progress: 'In Bearbeitung', assigned: 'Übernommen', received: 'Erhalten, wartet auf Übernahme' },
  reply: 'Du kannst auch per Direktnachricht an den Bot auf Discord antworten.',
  deleted: 'Nachricht gelöscht', edited: 'bearbeitet',
  tabs: { tickets: 'Meine Tickets', new: 'Ticket öffnen', help: 'Hilfe' },
  replyPh: 'Schreibe deine Antwort…', send: 'Senden', sent: 'Nachricht gesendet', closedTicket: 'Dieses Ticket ist geschlossen.',
  server: 'Server', subject: 'Betreff', subjectPh: 'Betreff deines Anliegens', message: 'Dein Anliegen', messagePh: 'Beschreibe dein Problem so genau wie möglich.',
  confidential: 'Vertrauliche Anfrage: Nur die Gründer des Servers können dieses Ticket lesen (Meldung, Belästigung…)', confidentialBadge: 'Vertraulich',
  optional: 'optional', form: 'Ein paar Fragen', open: 'Ticket öffnen', noGuild: 'Kein Server verfügbar: Du musst Mitglied eines Servers sein, der diesen Bot nutzt.',
  faqTitle: 'Häufige Fragen', faqSearch: 'Hilfe durchsuchen…', faqNone: 'Keine Antwort passt.', faqEmpty: 'Dieser Server hat noch keine Hilfeseite.',
  stillStuck: 'Immer noch nicht gelöst?', maybe: 'Diese Antworten könnten helfen:', error2: 'Fehler, versuche es erneut.', privacy: 'Datenschutz', language: 'Sprache',
};

const it = {
  title: 'I miei ticket', subtitle: 'Ritrova le tue richieste al supporto, il loro stato e le vostre conversazioni.',
  login: 'Accedi con Discord', loginHint: 'Viene richiesta solo la tua identità Discord. Vedi solo i tuoi ticket.',
  logout: 'Esci', none: 'Ancora nessun ticket.', noneHint: 'Per aprire un ticket, invia un messaggio privato al bot su Discord.',
  back: 'I miei ticket', transcript: 'Scarica la conversazione', noMessages: 'Nessun messaggio', you: 'Tu', member: 'Membro',
  participant: 'Partecipante', rating: 'Il tuo voto', opened: 'Aperto il', closed: 'Chiuso il', notFound: 'Ticket non trovato.',
  error: { invalid_state: 'L\'accesso è scaduto, riprova.', oauth_failed: 'L\'accesso con Discord non è riuscito, riprova.', no_code: 'Accesso annullato.' },
  status: { closed: 'Chiuso', merged: 'Unito a un altro ticket', waiting: 'In attesa della tua risposta', in_progress: 'In lavorazione', assigned: 'Preso in carico', received: 'Ricevuto, in attesa di presa in carico' },
  reply: 'Puoi anche rispondere con un messaggio privato al bot su Discord.',
  deleted: 'Messaggio eliminato', edited: 'modificato',
  tabs: { tickets: 'I miei ticket', new: 'Apri un ticket', help: 'Aiuto' },
  replyPh: 'Scrivi la tua risposta…', send: 'Invia', sent: 'Messaggio inviato', closedTicket: 'Questo ticket è chiuso.',
  server: 'Server', subject: 'Oggetto', subjectPh: 'Oggetto della tua richiesta', message: 'La tua richiesta', messagePh: 'Descrivi il problema nel modo più preciso possibile.',
  confidential: 'Richiesta riservata: solo i fondatori del server potranno leggere questo ticket (segnalazione, molestie…)', confidentialBadge: 'Riservato',
  optional: 'facoltativo', form: 'Qualche domanda', open: 'Apri il ticket', noGuild: 'Nessun server disponibile: devi essere membro di un server che usa questo bot.',
  faqTitle: 'Domande frequenti', faqSearch: 'Cerca nell\'aiuto…', faqNone: 'Nessuna risposta corrisponde.', faqEmpty: 'Questo server non ha ancora una pagina di aiuto.',
  stillStuck: 'Ancora bloccato?', maybe: 'Queste risposte possono aiutarti:', error2: 'Errore, riprova.', privacy: 'Privacy', language: 'Lingua',
};

const pt = {
  title: 'Meus tickets', subtitle: 'Encontre suas solicitações ao suporte, o status delas e suas conversas.',
  login: 'Entrar com o Discord', loginHint: 'Só sua identidade do Discord é solicitada. Você só vê seus próprios tickets.',
  logout: 'Sair', none: 'Nenhum ticket por enquanto.', noneHint: 'Para abrir um ticket, envie uma mensagem privada ao bot no Discord.',
  back: 'Meus tickets', transcript: 'Baixar a conversa', noMessages: 'Nenhuma mensagem', you: 'Você', member: 'Membro',
  participant: 'Participante', rating: 'Sua nota', opened: 'Aberto em', closed: 'Fechado em', notFound: 'Ticket não encontrado.',
  error: { invalid_state: 'A conexão expirou, tente de novo.', oauth_failed: 'A conexão com o Discord falhou, tente de novo.', no_code: 'Conexão cancelada.' },
  status: { closed: 'Fechado', merged: 'Mesclado com outro ticket', waiting: 'Aguardando sua resposta', in_progress: 'Em andamento', assigned: 'Assumido', received: 'Recebido, aguardando atendimento' },
  reply: 'Você também pode responder por mensagem privada ao bot no Discord.',
  deleted: 'Mensagem excluída', edited: 'editada',
  tabs: { tickets: 'Meus tickets', new: 'Abrir um ticket', help: 'Ajuda' },
  replyPh: 'Escreva sua resposta…', send: 'Enviar', sent: 'Mensagem enviada', closedTicket: 'Este ticket está fechado.',
  server: 'Servidor', subject: 'Assunto', subjectPh: 'Assunto da sua solicitação', message: 'Sua solicitação', messagePh: 'Explique seu problema da forma mais precisa possível.',
  confidential: 'Solicitação confidencial: só os fundadores do servidor poderão ler este ticket (denúncia, assédio…)', confidentialBadge: 'Confidencial',
  optional: 'opcional', form: 'Algumas perguntas', open: 'Abrir o ticket', noGuild: 'Nenhum servidor disponível: você precisa ser membro de um servidor que usa este bot.',
  faqTitle: 'Perguntas frequentes', faqSearch: 'Pesquisar na ajuda…', faqNone: 'Nenhuma resposta corresponde.', faqEmpty: 'Este servidor ainda não tem página de ajuda.',
  stillStuck: 'Ainda com dúvidas?', maybe: 'Estas respostas podem ajudar:', error2: 'Erro, tente de novo.', privacy: 'Privacidade', language: 'Idioma',
};

export const MEMBER_STRINGS = { fr, en, es, de, it, pt };
export const STR = MEMBER_STRINGS[MEMBER_LANG];

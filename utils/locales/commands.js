// Translations of the slash commands shown by Discord (descriptions, option names, choices), in the
// language of each member's Discord client. The commands are written in French in commands/*.js;
// deploy-commands.js registers English as the default (any other Discord language) and French,
// Spanish, German, Italian and Portuguese as localizations. Command names never change: the
// documentation and the habits of the staff keep working.
// Key: command[.subcommand][.option] → description; '…#value' → choice; NAMES: option names.

const T = {
  'adduser': ['Adds a user as a DM participant linked to the ticket', 'Añade un usuario como participante por MD vinculado al ticket', 'Fügt einen Nutzer als per DM verknüpften Teilnehmer zum Ticket hinzu', 'Aggiunge un utente come partecipante in DM collegato al ticket', 'Adiciona um usuário como participante por DM vinculado ao ticket'],
  'adduser.utilisateur': ['User to add as a linked DM participant', 'Usuario que se añade por MD', 'Hinzuzufügender Nutzer (per DM)', 'Utente da aggiungere in DM', 'Usuário a adicionar por DM'],
  'areply': ['Anonymous reply', 'Respuesta anónima', 'Anonyme Antwort', 'Risposta anonima', 'Resposta anônima'],
  'areply.message': ['Message to send', 'Mensaje que se envía', 'Zu sendende Nachricht', 'Messaggio da inviare', 'Mensagem a enviar'],
  'areply.fichier': ['File to send', 'Archivo que se envía', 'Zu sendende Datei', 'File da inviare', 'Arquivo a enviar'],
  'blacklist': ['Manage the ticket blacklist', 'Gestionar la lista negra de tickets', 'Ticket-Sperrliste verwalten', 'Gestisci la blacklist dei ticket', 'Gerenciar a lista de bloqueio de tickets'],
  'blacklist.add': ['Block a user', 'Bloquear a un usuario', 'Einen Nutzer sperren', 'Blocca un utente', 'Bloquear um usuário'],
  'blacklist.add.utilisateur': ['User to block', 'Usuario que se bloquea', 'Zu sperrender Nutzer', 'Utente da bloccare', 'Usuário a bloquear'],
  'blacklist.add.raison': ['Reason', 'Motivo', 'Grund', 'Motivo', 'Motivo'],
  'blacklist.remove': ['Unblock a user', 'Desbloquear a un usuario', 'Einen Nutzer entsperren', 'Sblocca un utente', 'Desbloquear um usuário'],
  'blacklist.remove.utilisateur': ['User to unblock', 'Usuario que se desbloquea', 'Zu entsperrender Nutzer', 'Utente da sbloccare', 'Usuário a desbloquear'],
  'blacklist.list': ['Show the blocked users', 'Mostrar los usuarios bloqueados', 'Gesperrte Nutzer anzeigen', 'Mostra gli utenti bloccati', 'Mostrar os usuários bloqueados'],
  'claim': ['Adds yourself to the people assigned to the ticket', 'Te añade a las personas asignadas al ticket', 'Fügt dich den zugewiesenen Personen des Tickets hinzu', 'Ti aggiunge alle persone assegnate al ticket', 'Adiciona você às pessoas atribuídas ao ticket'],
  'contact': ['Opens a ticket to contact a member (sanction, follow-up, refund…)', 'Abre un ticket para contactar con un miembro (sanción, seguimiento, reembolso…)', 'Öffnet ein Ticket, um ein Mitglied zu kontaktieren (Sanktion, Nachverfolgung, Erstattung…)', 'Apre un ticket per contattare un membro (sanzione, follow-up, rimborso…)', 'Abre um ticket para contatar um membro (sanção, acompanhamento, reembolso…)'],
  'contact.membre': ['Member to contact', 'Miembro al que contactar', 'Zu kontaktierendes Mitglied', 'Membro da contattare', 'Membro a contatar'],
  'contact.message': ['First message sent to the member', 'Primer mensaje enviado al miembro', 'Erste Nachricht an das Mitglied', 'Primo messaggio inviato al membro', 'Primeira mensagem enviada ao membro'],
  'contact.sujet': ['Subject of the ticket', 'Asunto del ticket', 'Betreff des Tickets', 'Oggetto del ticket', 'Assunto do ticket'],
  'gettranscript': ['Fetches a transcript by its ID and creates a temporary link', 'Recupera una transcripción por su ID y genera un enlace temporal', 'Ruft ein Transkript über seine ID ab und erzeugt einen temporären Link', 'Recupera una trascrizione dal suo ID e genera un link temporaneo', 'Recupera uma transcrição pelo ID e gera um link temporário'],
  'gettranscript.transcriptid': ['Transcript ID', 'ID de la transcripción', 'ID des Transkripts', 'ID della trascrizione', 'ID da transcrição'],
  'merge': ['Merges this ticket into another open ticket of the same member', 'Fusiona este ticket con otro ticket abierto del mismo miembro', 'Führt dieses Ticket mit einem anderen offenen Ticket desselben Mitglieds zusammen', 'Unisce questo ticket a un altro ticket aperto dello stesso membro', 'Mescla este ticket em outro ticket aberto do mesmo membro'],
  'merge.ticket': ['Ticket that receives this conversation', 'Ticket que recibe esta conversación', 'Ticket, das dieses Gespräch erhält', 'Ticket che riceve questa conversazione', 'Ticket que recebe esta conversa'],
  'mestickets': ['See the status of my open tickets', 'Ver el estado de mis tickets abiertos', 'Status meiner offenen Tickets ansehen', 'Vedi lo stato dei miei ticket aperti', 'Ver o status dos meus tickets abertos'],
  'moveticket': ['Changes the stage of the ticket (moves the channel to the matching category)', 'Cambia la etapa del ticket (mueve el canal a la categoría asociada)', 'Ändert die Phase des Tickets (verschiebt den Kanal in die zugehörige Kategorie)', 'Cambia la fase del ticket (sposta il canale nella categoria associata)', 'Muda a etapa do ticket (move o canal para a categoria associada)'],
  'moveticket.etape': ['New stage', 'Nueva etapa', 'Neue Phase', 'Nuova fase', 'Nova etapa'],
  'moveticket.etape#open': ['Open', 'Abierto', 'Offen', 'Aperto', 'Aberto'],
  'moveticket.etape#waiting': ['Waiting', 'En espera', 'Wartend', 'In attesa', 'Em espera'],
  'moveticket.etape#in_progress': ['In progress', 'En curso', 'In Bearbeitung', 'In corso', 'Em andamento'],
  'note': ['Adds an internal note (not visible to the user, not in the transcript)', 'Añade una nota interna (no visible para el usuario, fuera de la transcripción)', 'Fügt eine interne Notiz hinzu (für den Nutzer unsichtbar, nicht im Transkript)', 'Aggiunge una nota interna (non visibile all\'utente, fuori dalla trascrizione)', 'Adiciona uma nota interna (invisível para o usuário, fora da transcrição)'],
  'note.message': ['Content of the note', 'Contenido de la nota', 'Inhalt der Notiz', 'Contenuto della nota', 'Conteúdo da nota'],
  'oldtickets': ['Shows the past tickets of a user', 'Muestra los tickets anteriores de un usuario', 'Zeigt die früheren Tickets eines Nutzers', 'Mostra i ticket precedenti di un utente', 'Mostra os tickets anteriores de um usuário'],
  'oldtickets.userid': ['Discord ID', 'ID de Discord', 'Discord-ID', 'ID Discord', 'ID do Discord'],
  'priority': ['Sets the priority of the ticket', 'Define la prioridad del ticket', 'Legt die Priorität des Tickets fest', 'Imposta la priorità del ticket', 'Define a prioridade do ticket'],
  'priority.niveau': ['Priority level', 'Nivel de prioridad', 'Prioritätsstufe', 'Livello di priorità', 'Nível de prioridade'],
  'priority.niveau#low': ['🟢 Low', '🟢 Baja', '🟢 Niedrig', '🟢 Bassa', '🟢 Baixa'],
  'priority.niveau#normal': ['🔵 Normal', '🔵 Normal', '🔵 Normal', '🔵 Normale', '🔵 Normal'],
  'priority.niveau#urgent': ['🔴 Urgent', '🔴 Urgente', '🔴 Dringend', '🔴 Urgente', '🔴 Urgente'],
  'removeuser': ['Removes a user from the DM participants linked to the ticket', 'Quita a un usuario de los participantes por MD del ticket', 'Entfernt einen Nutzer aus den per DM verknüpften Teilnehmern', 'Rimuove un utente dai partecipanti in DM del ticket', 'Remove um usuário dos participantes por DM do ticket'],
  'removeuser.utilisateur': ['User to remove', 'Usuario que se quita', 'Zu entfernender Nutzer', 'Utente da rimuovere', 'Usuário a remover'],
  'rename': ['Changes the title of the ticket (the channel is renamed too)', 'Cambia el título del ticket (el canal también se renombra)', 'Ändert den Titel des Tickets (der Kanal wird ebenfalls umbenannt)', 'Cambia il titolo del ticket (anche il canale viene rinominato)', 'Muda o título do ticket (o canal também é renomeado)'],
  'rename.name': ['New title', 'Nuevo título', 'Neuer Titel', 'Nuovo titolo', 'Novo título'],
  'reopen': ['Reopens the last closed ticket of a user', 'Reabre el último ticket cerrado de un usuario', 'Öffnet das zuletzt geschlossene Ticket eines Nutzers erneut', 'Riapre l\'ultimo ticket chiuso di un utente', 'Reabre o último ticket fechado de um usuário'],
  'reopen.userid': ['Discord ID of the user', 'ID de Discord del usuario', 'Discord-ID des Nutzers', 'ID Discord dell\'utente', 'ID do Discord do usuário'],
  'reply': ['Replies to the member', 'Responde al miembro', 'Antwortet dem Mitglied', 'Risponde al membro', 'Responde ao membro'],
  'reply.message': ['Message to send', 'Mensaje que se envía', 'Zu sendende Nachricht', 'Messaggio da inviare', 'Mensagem a enviar'],
  'reply.fichier': ['File to send', 'Archivo que se envía', 'Zu sendende Datei', 'File da inviare', 'Arquivo a enviar'],
  'setup': ['Setup wizard: staff roles, categories and panel (founders)', 'Asistente de configuración: roles del staff, categorías y panel (fundadores)', 'Einrichtungsassistent: Team-Rollen, Kategorien und Panel (Gründer)', 'Procedura guidata: ruoli dello staff, categorie e pannello (fondatori)', 'Assistente de configuração: cargos da equipe, categorias e painel (fundadores)'],
  'staffstats': ['Shows the ticket statistics of the staff', 'Muestra las estadísticas de tickets del staff', 'Zeigt die Ticket-Statistiken des Teams', 'Mostra le statistiche dei ticket dello staff', 'Mostra as estatísticas de tickets da equipe'],
  'template': ['Sends a reply template to the member (and applies its actions if it is a macro)', 'Envía una plantilla de respuesta al miembro (y aplica sus acciones si es una macro)', 'Sendet eine Antwortvorlage an das Mitglied (und führt ihre Aktionen aus, wenn es ein Makro ist)', 'Invia un modello di risposta al membro (e applica le sue azioni se è una macro)', 'Envia um modelo de resposta ao membro (e aplica suas ações se for uma macro)'],
  'template.modele': ['Template to send', 'Plantilla que se envía', 'Zu sendende Vorlage', 'Modello da inviare', 'Modelo a enviar'],
  'template.anonyme': ['Reply as « Support »', 'Responder como « Soporte »', 'Als „Support“ antworten', 'Rispondi come « Supporto »', 'Responder como « Suporte »'],
  'unclaim': ['Removes yourself from the people assigned to the ticket', 'Te quita de las personas asignadas al ticket', 'Entfernt dich aus den zugewiesenen Personen des Tickets', 'Ti rimuove dalle persone assegnate al ticket', 'Remove você das pessoas atribuídas ao ticket'],
  'vocal': ['Opens or closes the temporary voice channel of the ticket', 'Abre o cierra el canal de voz temporal del ticket', 'Öffnet oder schließt den temporären Sprachkanal des Tickets', 'Apre o chiude il canale vocale temporaneo del ticket', 'Abre ou fecha o canal de voz temporário do ticket'],
  'vocal.action': ['Open or close', 'Abrir o cerrar', 'Öffnen oder schließen', 'Apri o chiudi', 'Abrir ou fechar'],
  'vocal.action#open': ['Open', 'Abrir', 'Öffnen', 'Apri', 'Abrir'],
  'vocal.action#close': ['Close', 'Cerrar', 'Schließen', 'Chiudi', 'Fechar'],
};

// Option names (lowercase, no spaces: Discord rule); keyed by the French name
const NAMES = {
  utilisateur: ['user', 'usuario', 'nutzer', 'utente', 'usuário'],
  message: ['message', 'mensaje', 'nachricht', 'messaggio', 'mensagem'],
  fichier: ['file', 'archivo', 'datei', 'file', 'arquivo'],
  raison: ['reason', 'motivo', 'grund', 'motivo', 'motivo'],
  membre: ['member', 'miembro', 'mitglied', 'membro', 'membro'],
  sujet: ['subject', 'asunto', 'betreff', 'oggetto', 'assunto'],
  transcriptid: ['transcriptid', 'idtranscripcion', 'transkriptid', 'idtrascrizione', 'idtranscricao'],
  ticket: ['ticket', 'ticket', 'ticket', 'ticket', 'ticket'],
  etape: ['stage', 'etapa', 'phase', 'fase', 'etapa'],
  userid: ['userid', 'idusuario', 'nutzerid', 'idutente', 'idusuario'],
  niveau: ['level', 'nivel', 'stufe', 'livello', 'nivel'],
  name: ['title', 'titulo', 'titel', 'titolo', 'titulo'],
  modele: ['template', 'plantilla', 'vorlage', 'modello', 'modelo'],
  anonyme: ['anonymous', 'anonimo', 'anonym', 'anonimo', 'anonimo'],
  action: ['action', 'accion', 'aktion', 'azione', 'acao'],
};

// Discord locale codes for each translation column (en is also the default)
const LOCALES = [['en-US', 'en-GB'], ['es-ES', 'es-419'], ['de'], ['it'], ['pt-BR']];

const spread = values => {
  const out = {};
  values.forEach((v, i) => { if (v) for (const code of LOCALES[i]) out[code] = v; });
  return out;
};

// Applies the translations to a command JSON (toJSON() of a SlashCommandBuilder)
function localizeCommand(json) {
  const walk = (node, key) => {
    const tr = T[key];
    if (tr) {
      node.description_localizations = { fr: node.description, ...spread(tr) };
      node.description = tr[0];
    }
    for (const opt of node.options || []) {
      const optKey = `${key}.${opt.name}`;
      if (NAMES[opt.name]) {
        opt.name_localizations = { fr: opt.name, ...spread(NAMES[opt.name]) };
      }
      for (const ch of opt.choices || []) {
        const c = T[`${optKey}#${ch.value}`];
        if (c) { ch.name_localizations = { fr: ch.name, ...spread(c) }; ch.name = c[0]; }
      }
      walk(opt, optKey);
    }
    return node;
  };
  return walk(json, json.name);
}

module.exports = { localizeCommand, T, NAMES, LOCALES };

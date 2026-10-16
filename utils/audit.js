// Guild event journal (table audit_log): every action, from the dashboard, Discord, the API,
// the super-admin panel or the bot's own automations.

// action -> [label, category] — also served to the dashboard (GET /api/audit/meta)
const ACTIONS = {
  // Tickets
  ticket_open:              ['Ticket ouvert', 'tickets'],
  ticket_close:             ['Ticket fermé', 'tickets'],
  ticket_reopen:            ['Ticket réouvert', 'tickets'],
  ticket_reply:             ['Réponse envoyée', 'tickets'],
  ticket_note:              ['Note interne', 'tickets'],
  note_delete:              ['Note supprimée', 'tickets'],
  ticket_assign:            ['Attribution', 'tickets'],
  ticket_unassign:          ['Retrait d\'attribution', 'tickets'],
  ticket_stage:             ['Changement d\'étape', 'tickets'],
  ticket_priority:          ['Priorité modifiée', 'tickets'],
  ticket_rename:            ['Salon renommé', 'tickets'],
  ticket_subject:           ['Titre modifié', 'tickets'],
  ticket_visibility_change: ['Visibilité modifiée', 'tickets'],
  participant_add:          ['Participant ajouté', 'tickets'],
  participant_remove:       ['Participant retiré', 'tickets'],
  ticket_tag_add:           ['Tag ajouté', 'tickets'],
  ticket_tag_remove:        ['Tag retiré', 'tickets'],
  ticket_rating:            ['Note de satisfaction', 'tickets'],
  ticket_rating_comment:    ['Commentaire de satisfaction', 'tickets'],
  ticket_escalation:        ['Escalade', 'tickets'],
  scheduled_create:         ['Message programmé', 'tickets'],
  scheduled_delete:         ['Message programmé annulé', 'tickets'],
  scheduled_sent:           ['Message programmé envoyé', 'tickets'],
  // Modération
  blacklist_add:            ['Blacklist : ajout', 'moderation'],
  blacklist_remove:         ['Blacklist : retrait', 'moderation'],
  // Équipe
  dashboard_login:          ['Connexion au dashboard', 'equipe'],
  user_role_change:         ['Rôle modifié', 'equipe'],
  grade_assign:             ['Grade attribué', 'equipe'],
  grade_remove:             ['Grade retiré', 'equipe'],
  grade_create:             ['Grade créé', 'equipe'],
  grade_update:             ['Grade modifié', 'equipe'],
  grade_permissions_update: ['Permissions de grade modifiées', 'equipe'],
  grade_delete:             ['Grade supprimé', 'equipe'],
  founder_add:              ['Fondateur nommé', 'equipe'],
  founder_remove:           ['Fondateur retiré', 'equipe'],
  staff_access_granted:     ['Accès staff accordé (rôle Discord)', 'equipe'],
  staff_access_revoked:     ['Accès staff retiré (rôle Discord)', 'equipe'],
  agent_limit_reached:      ['Limite de staff atteinte', 'equipe'],
  // Configuration
  config_update:            ['Paramètres modifiés', 'config'],
  bot_identity_update:      ['Identité du bot modifiée', 'config'],
  panel_create:             ['Panel créé', 'config'],
  panel_update:             ['Panel modifié', 'config'],
  panel_delete:             ['Panel supprimé', 'config'],
  panel_publish:            ['Panel publié', 'config'],
  form_create:              ['Formulaire créé', 'config'],
  form_update:              ['Formulaire modifié', 'config'],
  form_delete:              ['Formulaire supprimé', 'config'],
  tag_create:               ['Tag créé', 'config'],
  tag_update:               ['Tag modifié', 'config'],
  tag_delete:               ['Tag supprimé', 'config'],
  template_create:          ['Modèle de réponse créé', 'config'],
  template_delete:          ['Modèle de réponse supprimé', 'config'],
  // Intégrations
  api_key_create:           ['Clé API créée', 'integrations'],
  api_key_revoke:           ['Clé API révoquée', 'integrations'],
  newsletter_send:          ['Newsletter envoyée', 'integrations'],
};

const CATEGORIES = {
  tickets: 'Tickets', moderation: 'Modération', equipe: 'Équipe', config: 'Configuration', integrations: 'Intégrations',
};
const SOURCES = { dashboard: 'Dashboard', discord: 'Discord', system: 'Automatique', api: 'API', sa: 'Super-admin' };

const SYSTEM = { id: 'system', tag: 'Système', source: 'system' };

// Where an action comes from, given the acting user object used across the code base.
function sourceOf(actor) {
  if (!actor) return 'system';
  if (actor.source) return actor.source;
  if (actor.api) return 'api';
  if (actor.id === 'system') return 'system';
  return 'discord'; // discord.js User objects (slash commands, buttons, DMs)
}

// Never throws: a failed journal entry must not break the action itself.
async function recordEvent(db, { actor, action, ticketId = null, targetType = null, targetId = null, details = null, source }) {
  const a = actor || SYSTEM;
  try {
    await db(
      `INSERT INTO audit_log (actor_id, actor_tag, action, source, ticket_id, target_type, target_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(a.id).slice(0, 32),
        String(a.tag || a.username || a.id).slice(0, 100),
        action,
        source || sourceOf(a),
        ticketId || null,
        targetType,
        targetId != null ? String(targetId).slice(0, 50) : null,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (e) {
    console.error('recordEvent error:', e.message);
  }
}

// Acting user of a dashboard request.
const dashboardActor = req => ({ id: req.session.user.id, tag: req.session.user.username, username: req.session.user.username, source: 'dashboard' });

module.exports = { ACTIONS, CATEGORIES, SOURCES, SYSTEM, recordEvent, dashboardActor, sourceOf };

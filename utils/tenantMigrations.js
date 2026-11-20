// Versioned migrations of the per-guild databases. Each database records the versions it has
// applied (schema_migrations); a migration runs once, in order, and an error stops the run
// instead of being silently ignored. To change the schema, append a new version at the end —
// never edit an applied one. GET_LOCK keeps two bot instances from migrating the same base.
const logger = require('./logger');

// v6 (migration 82): the inactivity and escalation settings become four rules « when time passes »
// with the same effect, in the staff's language; tickets already warned or alerted are not again
function timersAsRulesStatements() {
  const T = require('./locales/staff');
  const LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt'];
  const q = v => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  // The text in the staff language (auto and unknown: French), as an SQL expression
  const text = key => `CASE staff_language ${LANGS.map((l, i) => `WHEN '${l}' THEN ${q(T[key][i])}`).join(' ')} ELSE ${q(T[key][0])} END`;
  const timer = (basis, minutes) => `JSON_OBJECT('basis', '${basis}', 'minutes', ${minutes}, 'direction', 'after', 'businessHours', false)`;
  const rule = (origin, name, position, timerSql, conditions, actions) => `INSERT INTO ticket_rules (name, position, active, triggers, match_mode, conditions, actions, stop_after, origin, timer)
    SELECT ${q(name)}, ${position}, 1, '["time"]', 'all', ${conditions}, ${actions}, 0, '${origin}', ${timerSql}
    FROM guild_config WHERE id = 1 AND NOT EXISTS (SELECT 1 FROM ticket_rules WHERE origin = '${origin}')`;
  const notResolved = `JSON_OBJECT('field', 'resolved', 'not', false, 'values', JSON_ARRAY('no'))`;
  const urgentHandled = `JSON_ARRAY(JSON_OBJECT('field', 'priority', 'not', false, 'values', JSON_ARRAY('urgent')), JSON_OBJECT('field', 'assigned', 'not', false, 'values', JSON_ARRAY('yes')), ${notResolved})`;
  const fill = (sql, vars) => Object.entries(vars).reduce((acc, [k, v]) => `REPLACE(${acc}, '{${k}}', ${v})`, sql);
  return [
    'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS timers_in_rules TINYINT(1) NOT NULL DEFAULT 0',
    rule('inactivity_warn', 'Inactivité : avertissement', 1000, timer('last_message', 'inactive_warning_hours * 60'), `JSON_ARRAY(${notResolved})`,
      `JSON_ARRAY(JSON_OBJECT('type', 'reply', 'value', ${fill(text('inactive.warn'), { h: 'inactive_warning_hours', left: 'GREATEST(inactive_hours - inactive_warning_hours, 0)' })}))`),
    rule('inactivity_close', 'Inactivité : fermeture', 1001, timer('last_message', 'inactive_hours * 60'), `JSON_ARRAY(${notResolved})`, `JSON_ARRAY(JSON_OBJECT('type', 'close', 'value', true))`),
    rule('escalation_alert', 'Escalade : alerte', 1002, timer('last_activity', 'escalation_alert_hours * 60'), urgentHandled,
      `JSON_ARRAY(JSON_OBJECT('type', 'channelPost', 'value', JSON_OBJECT('channelId', NULL, 'text', ${fill(text('escalation.alert'), { h: 'escalation_alert_hours' })})))`),
    rule('escalation_close', 'Escalade : fermeture', 1003, timer('last_activity', 'escalation_close_hours * 60'), urgentHandled,
      `JSON_ARRAY(JSON_OBJECT('type', 'reply', 'value', ${text('escalation.closed')}), JSON_OBJECT('type', 'close', 'value', true))`),
    // Already done by the old checks: not again for the same moment
    `INSERT IGNORE INTO rule_timer_fired (ticket_id, rule_id, basis_at)
      SELECT t.id, r.id, t.last_message_at FROM tickets t JOIN ticket_rules r ON r.origin = 'inactivity_warn'
      WHERE t.status = 'open' AND t.warned_inactive = 1 AND t.last_message_at IS NOT NULL`,
    `INSERT IGNORE INTO rule_timer_fired (ticket_id, rule_id, basis_at)
      SELECT t.id, r.id, COALESCE(t.last_message_at, t.created_at) FROM tickets t JOIN ticket_rules r ON r.origin = 'escalation_alert'
      WHERE t.status = 'open' AND t.escalation_alerted = 1`,
    "UPDATE guild_config SET timers_in_rules = 1 WHERE id = 1 AND EXISTS (SELECT 1 FROM ticket_rules WHERE origin = 'inactivity_close')",
  ];
}

const MIGRATIONS = [
  {
    version: 1,
    name: 'Historique (modifications antérieures au versionnement)',
    // Written before versioning, idempotent (IF NOT EXISTS): errors on bases that already have
    // these changes are expected and ignored for this version only.
    tolerant: true,
    statements: [

      `ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS bio VARCHAR(160) DEFAULT NULL`,
      `ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS banner_color VARCHAR(7) NOT NULL DEFAULT '#6366f1'`,
      `ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS profile_picture_url VARCHAR(512) DEFAULT NULL`,
      // Phase 2 — new ticket tracking columns
      `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS staff_reminder_sent_at DATETIME DEFAULT NULL`,
      `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS user_warned_inactive TINYINT(1) NOT NULL DEFAULT 0`,
      // Phase 1 — feature flags in guild_config
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS faq_enabled TINYINT(1) NOT NULL DEFAULT 0`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS intake_form_enabled TINYINT(1) NOT NULL DEFAULT 0`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS staff_reminder_enabled TINYINT(1) NOT NULL DEFAULT 0`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS staff_reminder_hours INT NOT NULL DEFAULT 4`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS user_inactive_enabled TINYINT(1) NOT NULL DEFAULT 0`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS user_inactive_warn_hours INT NOT NULL DEFAULT 24`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS user_inactive_close_hours INT NOT NULL DEFAULT 72`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS internal_notes_enabled TINYINT(1) NOT NULL DEFAULT 1`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS monthly_goals_enabled TINYINT(1) NOT NULL DEFAULT 0`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS leaderboard_enabled TINYINT(1) NOT NULL DEFAULT 1`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS webhooks_enabled TINYINT(1) NOT NULL DEFAULT 0`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS webhook_events JSON NOT NULL DEFAULT ('["ticket_open","ticket_close","ticket_claim"]')`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS api_keys_enabled TINYINT(1) NOT NULL DEFAULT 0`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS webhook_secret VARCHAR(255) DEFAULT NULL`,
      // Phase 3 — per-subject welcome messages + ip allowlist
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS subject_welcome_messages JSON NOT NULL DEFAULT ('{}')`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS ip_allowlist JSON NOT NULL DEFAULT ('[]')`,
      // Phase 4 — intake form modal fields + panels
      `ALTER TABLE intake_form_fields ADD COLUMN IF NOT EXISTS placeholder VARCHAR(100) DEFAULT NULL`,
      `ALTER TABLE intake_form_fields ADD COLUMN IF NOT EXISTS style ENUM('short','paragraph') NOT NULL DEFAULT 'short'`,
      `ALTER TABLE intake_form_fields ADD COLUMN IF NOT EXISTS min_length INT DEFAULT NULL`,
      `ALTER TABLE intake_form_fields ADD COLUMN IF NOT EXISTS max_length INT DEFAULT NULL`,
      // Event journal: origin of each action + related ticket (utils/audit.js)
      `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'dashboard'`,
      `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ticket_id INT DEFAULT NULL`,
      `UPDATE audit_log SET source = 'sa' WHERE actor_id LIKE 'sa:%' AND source = 'dashboard'`,
      `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_ticket ON audit_log (ticket_id)`,
      // Ticket stages (Ouvert / En attente / En cours) mapped to Discord categories
      `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS stage ENUM('open','waiting','in_progress') NOT NULL DEFAULT 'open'`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS waiting_category_id VARCHAR(32) DEFAULT NULL`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS in_progress_category_id VARCHAR(32) DEFAULT NULL`,
      // Multiple assignees per ticket (claimed_by stays the primary one); backfill from claimed_by
      `CREATE TABLE IF NOT EXISTS ticket_assignees (
        ticket_id INT NOT NULL, user_id VARCHAR(32) NOT NULL, assigned_by_id VARCHAR(32) DEFAULT NULL,
        assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (ticket_id, user_id),
        INDEX idx_ta_user (user_id),
        CONSTRAINT fk_ta_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE)`,
      `INSERT IGNORE INTO ticket_assignees (ticket_id, user_id, assigned_by_id)
       SELECT id, claimed_by, claimed_by FROM tickets WHERE claimed_by IS NOT NULL`,
      // Saved ticket list views (per user)
      `CREATE TABLE IF NOT EXISTS ticket_views (
        id INT AUTO_INCREMENT PRIMARY KEY, user_id VARCHAR(32) NOT NULL, name VARCHAR(60) NOT NULL,
        filters JSON NOT NULL, is_default TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_tv_user (user_id))`,
      // Grades granted by the Discord support / chief support roles (utils/staffSync.js)
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS support_grade_id INT DEFAULT NULL`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS chief_grade_id INT DEFAULT NULL`,
      // Ratings: attributed to the claimer, else the closer; may be unattributed (auto/API close)
      `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_by_id VARCHAR(32) DEFAULT NULL`,
      `ALTER TABLE ticket_ratings MODIFY closed_by_id VARCHAR(32) DEFAULT NULL`,
      // Webhook secrets used to be written in clear into the audit log
      `UPDATE audit_log SET details = JSON_SET(details, '$.webhookSecret', '[modifié]')
       WHERE action = 'config_update' AND JSON_EXISTS(details, '$.webhookSecret')
         AND JSON_VALUE(details, '$.webhookSecret') IS NOT NULL
         AND JSON_VALUE(details, '$.webhookSecret') <> '[modifié]'`,
      // Free comment left with a satisfaction rating
      `ALTER TABLE ticket_ratings ADD COLUMN IF NOT EXISTS comment TEXT DEFAULT NULL`,
      // Reply templates: personal or shared (existing ones stay shared) + usage counter
      `ALTER TABLE reply_templates ADD COLUMN IF NOT EXISTS scope ENUM('personal','shared') NOT NULL DEFAULT 'shared'`,
      `ALTER TABLE reply_templates ADD COLUMN IF NOT EXISTS use_count INT NOT NULL DEFAULT 0`,
      // Macros: actions applied when the template is sent (stage, tag, priority, assign, close)
      `ALTER TABLE reply_templates ADD COLUMN IF NOT EXISTS actions JSON DEFAULT NULL`,
      // Discord DM when someone else assigns you a ticket (profile setting)
      `ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS notify_assign_dm TINYINT(1) NOT NULL DEFAULT 1`,
      `ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS notify_mention_dm TINYINT(1) NOT NULL DEFAULT 1`,
      // Per-stage SLA: time in the current stage counts from stage_changed_at (utils/sla.js)
      `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS stage_changed_at DATETIME DEFAULT NULL`,
      `UPDATE tickets SET stage_changed_at = created_at WHERE stage_changed_at IS NULL`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS sla_open_hours INT NOT NULL DEFAULT 0`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS sla_waiting_hours INT NOT NULL DEFAULT 0`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS sla_in_progress_hours INT NOT NULL DEFAULT 0`,
      // Ticket merged into another one (the source is closed)
      `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS merged_into INT DEFAULT NULL`,
      // Automatic events shown in the ticket history (merge, closed by the member…)
      `ALTER TABLE ticket_notes MODIFY source ENUM('web','discord','reply','user','scheduled','system') NOT NULL DEFAULT 'web'`,
      // Mandatory 2FA for the staff of this server (utils/twoFactorPolicy.js)
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS require_2fa ENUM('none','founders','staff') NOT NULL DEFAULT 'none'`,
      // Language of the messages sent to members (utils/i18n.js)
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS bot_language ENUM('fr','en','auto') NOT NULL DEFAULT 'fr'`,
      // Automatic FAQ shown in DM before a ticket is opened (utils/faq.js)
      `CREATE TABLE IF NOT EXISTS faq_entries (
        id INT AUTO_INCREMENT PRIMARY KEY, question VARCHAR(200) NOT NULL, answer TEXT NOT NULL,
        keywords VARCHAR(500) NOT NULL DEFAULT '', active TINYINT(1) NOT NULL DEFAULT 1,
        shown_count INT NOT NULL DEFAULT 0, solved_count INT NOT NULL DEFAULT 0,
        created_by_tag VARCHAR(100) DEFAULT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    ],
  },
  {
    version: 2,
    name: 'Suppression des tables et colonnes des fonctionnalités retirées (badges, rôles staff, ancienne FAQ)',
    statements: [
      'DROP TABLE IF EXISTS user_badges',
      'DROP TABLE IF EXISTS badge_definitions',
      'DROP TABLE IF EXISTS staff_roles',
      'DROP TABLE IF EXISTS faq_rules',
      'ALTER TABLE guild_config DROP COLUMN IF EXISTS badges_enabled',
    ],
  },
  {
    version: 3,
    name: 'Réouverture d\'un ticket par le membre (délai en jours, 0 = désactivée)',
    statements: ['ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS member_reopen_days INT NOT NULL DEFAULT 7'],
  },
  {
    version: 4,
    name: 'Notification du membre aux changements d\'étape (option)',
    statements: ['ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS notify_member_stage TINYINT(1) NOT NULL DEFAULT 0'],
  },
  {
    version: 5,
    name: 'Suivi des notes basses (seuil, date de recontact)',
    statements: [
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS low_rating_threshold TINYINT NOT NULL DEFAULT 2',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS followup_at DATETIME DEFAULT NULL',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS followup_by_tag VARCHAR(100) DEFAULT NULL',
    ],
  },
  {
    version: 6,
    name: 'Rappels personnels sur les tickets',
    statements: [`CREATE TABLE IF NOT EXISTS ticket_reminders (
      id INT AUTO_INCREMENT PRIMARY KEY, ticket_id INT NOT NULL, user_id VARCHAR(32) NOT NULL,
      remind_at DATETIME NOT NULL, note VARCHAR(200) DEFAULT NULL, sent_at DATETIME DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tr_due (sent_at, remind_at), INDEX idx_tr_user (user_id),
      CONSTRAINT fk_trm_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE)`],
  },
  {
    version: 7,
    name: 'Tickets liés (sans fusion)',
    statements: [`CREATE TABLE IF NOT EXISTS ticket_links (
      ticket_a INT NOT NULL, ticket_b INT NOT NULL, created_by_tag VARCHAR(100) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (ticket_a, ticket_b), INDEX idx_tl_b (ticket_b),
      CONSTRAINT fk_tl_a FOREIGN KEY (ticket_a) REFERENCES tickets(id) ON DELETE CASCADE,
      CONSTRAINT fk_tl_b FOREIGN KEY (ticket_b) REFERENCES tickets(id) ON DELETE CASCADE)`],
  },
  {
    version: 8,
    name: 'Statut de disponibilité du staff',
    statements: ["ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS availability ENUM('available','busy','away') NOT NULL DEFAULT 'available'"],
  },
  {
    version: 9,
    name: 'Champs personnalisés des tickets',
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_fields (
        id INT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(80) NOT NULL, type ENUM('text','number') NOT NULL DEFAULT 'text',
        required TINYINT(1) NOT NULL DEFAULT 0, subject VARCHAR(100) DEFAULT NULL, position INT NOT NULL DEFAULT 0,
        active TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS ticket_field_values (
        ticket_id INT NOT NULL, field_id INT NOT NULL, value VARCHAR(200) NOT NULL,
        PRIMARY KEY (ticket_id, field_id), INDEX idx_tfv_field (field_id, value),
        CONSTRAINT fk_tfv_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
        CONSTRAINT fk_tfv_field FOREIGN KEY (field_id) REFERENCES ticket_fields(id) ON DELETE CASCADE)`,
    ],
  },
  {
    version: 10,
    name: 'Règles automatiques par sujet',
    statements: [`CREATE TABLE IF NOT EXISTS subject_rules (
      id INT AUTO_INCREMENT PRIMARY KEY, subject VARCHAR(100) NOT NULL,
      tag_id INT DEFAULT NULL, priority ENUM('low','normal','urgent') DEFAULT NULL, visibility_grade_id INT DEFAULT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`],
  },
  {
    version: 11,
    name: 'Salon du rapport mensuel',
    statements: ['ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS monthly_report_channel_id VARCHAR(32) DEFAULT NULL'],
  },
  {
    version: 12,
    name: 'Recherche plein texte dans les messages',
    statements: ['ALTER TABLE ticket_notes ADD FULLTEXT INDEX IF NOT EXISTS ft_tn_content (content)'],
  },
  {
    version: 13,
    name: 'Historique de la configuration',
    statements: [`CREATE TABLE IF NOT EXISTS config_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      actor_id VARCHAR(40) NOT NULL, actor_tag VARCHAR(100) NOT NULL,
      source ENUM('settings','import','restore') NOT NULL DEFAULT 'settings',
      restored_from INT DEFAULT NULL,
      changes JSON NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ch_created (created_at))`],
  },
  {
    version: 14,
    name: 'Espace membre web',
    statements: ['ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS member_portal_enabled TINYINT(1) NOT NULL DEFAULT 1'],
  },
  {
    version: 15,
    name: 'Notes épinglées, messages modifiés ou supprimés par le membre',
    statements: [
      `ALTER TABLE ticket_notes
         ADD COLUMN IF NOT EXISTS pinned_at DATETIME DEFAULT NULL,
         ADD COLUMN IF NOT EXISTS pinned_by_tag VARCHAR(100) DEFAULT NULL,
         ADD COLUMN IF NOT EXISTS discord_message_id VARCHAR(32) DEFAULT NULL,
         ADD COLUMN IF NOT EXISTS edited_at DATETIME DEFAULT NULL,
         ADD COLUMN IF NOT EXISTS edit_history JSON DEFAULT NULL,
         ADD COLUMN IF NOT EXISTS deleted_at DATETIME DEFAULT NULL`,
      'ALTER TABLE ticket_notes ADD INDEX IF NOT EXISTS idx_tn_dmsg (discord_message_id)',
    ],
  },
  {
    version: 16,
    name: 'Annonces d\'incident',
    statements: [
      `CREATE TABLE IF NOT EXISTS incidents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(120) NOT NULL, message TEXT NOT NULL,
        subjects JSON DEFAULT NULL,
        notify_on_resolve TINYINT(1) NOT NULL DEFAULT 1, resolved_message TEXT DEFAULT NULL,
        created_by_id VARCHAR(32) NOT NULL, created_by_tag VARCHAR(100) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME DEFAULT NULL, resolved_by_tag VARCHAR(100) DEFAULT NULL)`,
      `CREATE TABLE IF NOT EXISTS incident_tickets (
        incident_id INT NOT NULL, ticket_id INT NOT NULL, owner_id VARCHAR(32) NOT NULL,
        notified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (incident_id, ticket_id), INDEX idx_it_owner (incident_id, owner_id),
        CONSTRAINT fk_it_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE)`,
    ],
  },
  {
    version: 17,
    name: 'Nettoyage : notes /note dans l\'historique, tables et réglages inutilisés',
    statements: [
      // /note used to write to staff_notes, which nothing displayed: those notes join the ticket history
      // (the table no longer exists on new servers: created empty so the copy below always runs)
      `CREATE TABLE IF NOT EXISTS staff_notes (id INT AUTO_INCREMENT PRIMARY KEY, ticket_id INT NOT NULL,
         author_id VARCHAR(32) NOT NULL, author_tag VARCHAR(100) NOT NULL, content TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source, created_at)
         SELECT ticket_id, author_id, author_tag, content, 'web', created_at FROM staff_notes`,
      'DROP TABLE IF EXISTS staff_notes',
      'DROP TABLE IF EXISTS monthly_goals', // never written: the monthly goal is a fixed 50 tickets
      // Settings that nothing read (fixed embed colour; the bot's name is its Discord nickname)
      'ALTER TABLE guild_config DROP COLUMN IF EXISTS embed_color, DROP COLUMN IF EXISTS bot_display_name',
    ],
  },
  {
    version: 18,
    name: 'Variables des champs personnalisés dans les modèles',
    statements: ['ALTER TABLE ticket_fields ADD COLUMN IF NOT EXISTS var_name VARCHAR(40) DEFAULT NULL'],
  },
  {
    version: 19,
    name: 'Règles par mots-clés du message',
    statements: [
      `ALTER TABLE subject_rules ADD COLUMN IF NOT EXISTS match_type ENUM('subject','keyword') NOT NULL DEFAULT 'subject',
         ADD COLUMN IF NOT EXISTS keywords VARCHAR(300) DEFAULT NULL, MODIFY subject VARCHAR(100) DEFAULT NULL`,
    ],
  },
  {
    version: 20,
    name: 'Espace membre aux couleurs du serveur',
    statements: [
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS portal_logo MEDIUMTEXT DEFAULT NULL,
         ADD COLUMN IF NOT EXISTS portal_color VARCHAR(7) DEFAULT NULL,
         ADD COLUMN IF NOT EXISTS portal_welcome VARCHAR(500) DEFAULT NULL`,
    ],
  },
  {
    version: 21,
    name: 'Procédures par sujet',
    statements: [
      `CREATE TABLE IF NOT EXISTS procedures (
        id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(100) NOT NULL, subject VARCHAR(100) DEFAULT NULL,
        steps JSON NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1, position INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS ticket_procedure_checks (
        ticket_id INT NOT NULL, procedure_id INT NOT NULL, step_id VARCHAR(12) NOT NULL,
        checked_by_id VARCHAR(32) NOT NULL, checked_by_tag VARCHAR(100) NOT NULL,
        checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (ticket_id, procedure_id, step_id),
        CONSTRAINT fk_tpc_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
        CONSTRAINT fk_tpc_proc FOREIGN KEY (procedure_id) REFERENCES procedures(id) ON DELETE CASCADE)`,
    ],
  },
  {
    version: 22,
    name: 'Temps passé sur les tickets',
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_time (
        id INT AUTO_INCREMENT PRIMARY KEY, ticket_id INT NOT NULL,
        user_id VARCHAR(32) NOT NULL, user_tag VARCHAR(100) NOT NULL,
        source ENUM('timer','manual') NOT NULL DEFAULT 'timer',
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ended_at DATETIME DEFAULT NULL,
        seconds INT DEFAULT NULL, note VARCHAR(200) DEFAULT NULL,
        INDEX idx_tt_user_running (user_id, ended_at), INDEX idx_tt_ticket (ticket_id),
        CONSTRAINT fk_tt_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE)`,
    ],
  },
  {
    version: 23,
    name: 'Profils des membres : discussion du staff et étiquettes',
    statements: [
      `CREATE TABLE IF NOT EXISTS member_notes (
        id INT AUTO_INCREMENT PRIMARY KEY, member_id VARCHAR(32) NOT NULL, parent_id INT DEFAULT NULL,
        author_id VARCHAR(32) NOT NULL, author_tag VARCHAR(100) NOT NULL, content TEXT NOT NULL,
        pinned TINYINT(1) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, edited_at DATETIME DEFAULT NULL,
        INDEX idx_mn_member (member_id, created_at),
        CONSTRAINT fk_mn_parent FOREIGN KEY (parent_id) REFERENCES member_notes(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS member_profiles (
        member_id VARCHAR(32) NOT NULL PRIMARY KEY, labels JSON DEFAULT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    ],
  },
  {
    version: 24,
    name: 'Accès invités temporaires',
    statements: [
      `CREATE TABLE IF NOT EXISTS guest_invites (
        id INT AUTO_INCREMENT PRIMARY KEY, token_hash CHAR(64) NOT NULL UNIQUE, label VARCHAR(100) NOT NULL,
        ticket_ids JSON NOT NULL, include_notes TINYINT(1) NOT NULL DEFAULT 0,
        expires_at DATETIME NOT NULL, revoked_at DATETIME DEFAULT NULL,
        created_by_id VARCHAR(32) NOT NULL, created_by_tag VARCHAR(100) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, last_used_at DATETIME DEFAULT NULL, uses INT NOT NULL DEFAULT 0)`,
    ],
  },
  {
    version: 25,
    name: 'Fils privés, catégories de débordement, vocal de ticket, réponses modifiables',
    statements: [
      `ALTER TABLE guild_config
         ADD COLUMN IF NOT EXISTS ticket_mode ENUM('channel','thread') NOT NULL DEFAULT 'channel',
         ADD COLUMN IF NOT EXISTS thread_parent_channel_id VARCHAR(32) DEFAULT NULL,
         ADD COLUMN IF NOT EXISTS health_alerts_enabled TINYINT(1) NOT NULL DEFAULT 1`,
      `ALTER TABLE tickets
         ADD COLUMN IF NOT EXISTS voice_channel_id VARCHAR(32) DEFAULT NULL,
         ADD COLUMN IF NOT EXISTS opened_by_id VARCHAR(32) DEFAULT NULL`,
      'ALTER TABLE ticket_notes ADD COLUMN IF NOT EXISTS reply_refs JSON DEFAULT NULL',
      // Extra categories created when a stage category reaches Discord's 50-channel limit
      `CREATE TABLE IF NOT EXISTS overflow_categories (
        category_id VARCHAR(32) NOT NULL PRIMARY KEY, base_category_id VARCHAR(32) NOT NULL, position INT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_oc_base (base_category_id))`,
    ],
  },
  {
    version: 26,
    name: 'Tickets suivis',
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_followers (
        ticket_id INT NOT NULL, user_id VARCHAR(32) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (ticket_id, user_id), INDEX idx_tf_user (user_id),
        CONSTRAINT fk_tf_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE)`,
    ],
  },
  {
    version: 27,
    name: 'Absences planifiées',
    statements: [
      `CREATE TABLE IF NOT EXISTS staff_absences (
        id INT AUTO_INCREMENT PRIMARY KEY, user_id VARCHAR(32) NOT NULL,
        starts_at DATETIME NOT NULL, ends_at DATETIME NOT NULL, reason VARCHAR(160) DEFAULT NULL,
        state ENUM('planned','active','done') NOT NULL DEFAULT 'planned', set_vacation TINYINT(1) NOT NULL DEFAULT 0,
        created_by_id VARCHAR(32) NOT NULL, created_by_tag VARCHAR(100) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sa_user (user_id, starts_at), INDEX idx_sa_state (state, starts_at))`,
    ],
  },
  {
    version: 28,
    name: 'Consultations des tickets confidentiels, déconnexion après inactivité',
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_access_log (
        id INT AUTO_INCREMENT PRIMARY KEY, ticket_id INT NOT NULL,
        user_id VARCHAR(64) NOT NULL, user_tag VARCHAR(100) NOT NULL,
        kind ENUM('view','notes','transcript','pdf','guest') NOT NULL DEFAULT 'view',
        ip VARCHAR(45) DEFAULT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tal_ticket (ticket_id, created_at), INDEX idx_tal_created (created_at))`,
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS idle_timeout_minutes INT NOT NULL DEFAULT 0',
    ],
  },
  {
    version: 29,
    name: 'Format des tickets en trois modes, permission « Ouvrir un ticket pour un membre »',
    statements: [
      // 'channel' meant "channels with overflow categories", now 'auto' (channels, then threads when full)
      "ALTER TABLE guild_config MODIFY ticket_mode ENUM('channel','auto','thread') NOT NULL DEFAULT 'auto'",
      "UPDATE guild_config SET ticket_mode = 'auto' WHERE ticket_mode = 'channel'",
      "INSERT IGNORE INTO grade_permissions (grade_id, permission) SELECT grade_id, 'create_ticket' FROM grade_permissions WHERE permission = 'reply_ticket'",
    ],
  },
  {
    version: 30,
    name: 'Rôles du staff rattachés à des tags',
    statements: [
      `CREATE TABLE IF NOT EXISTS access_roles (
        id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, color VARCHAR(7) NOT NULL DEFAULT '#6366f1',
        position INT NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS access_role_members (
        role_id INT NOT NULL, user_id VARCHAR(32) NOT NULL, PRIMARY KEY (role_id, user_id), INDEX idx_srm_user (user_id),
        CONSTRAINT fk_srm_role FOREIGN KEY (role_id) REFERENCES access_roles(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS access_role_tags (
        role_id INT NOT NULL, tag_id INT NOT NULL, PRIMARY KEY (role_id, tag_id), INDEX idx_srt_tag (tag_id),
        CONSTRAINT fk_srt_role FOREIGN KEY (role_id) REFERENCES access_roles(id) ON DELETE CASCADE,
        CONSTRAINT fk_srt_tag FOREIGN KEY (tag_id) REFERENCES ticket_tags(id) ON DELETE CASCADE)`,
    ],
  },
  {
    version: 31,
    name: 'Messages aux membres en espagnol, allemand, italien et portugais',
    statements: [
      `ALTER TABLE guild_config MODIFY COLUMN bot_language ENUM('fr','en','es','de','it','pt','auto') NOT NULL DEFAULT 'fr'`,
    ],
  },
  {
    version: 32,
    name: 'Statistiques publiques du support dans un salon',
    statements: [
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS public_stats_channel_id VARCHAR(32) DEFAULT NULL',
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS public_stats_message_id VARCHAR(32) DEFAULT NULL',
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS public_stats_target_hours INT NOT NULL DEFAULT 2',
    ],
  },
  {
    version: 33,
    name: 'Historique des réglages : changements faits par l\'assistant /setup',
    statements: [
      `ALTER TABLE config_history MODIFY COLUMN source ENUM('settings','import','restore','setup') NOT NULL DEFAULT 'settings'`,
    ],
  },
  {
    version: 34,
    name: 'Format de ticket « base de données » : aucun salon Discord',
    statements: [
      "ALTER TABLE guild_config MODIFY ticket_mode ENUM('channel','auto','thread','database') NOT NULL DEFAULT 'auto'",
    ],
  },
  {
    version: 35,
    name: 'Tickets par e-mail (boîte IMAP, envoi SMTP)',
    statements: [
      `CREATE TABLE IF NOT EXISTS email_settings (
        id            TINYINT PRIMARY KEY,
        enabled       TINYINT(1) NOT NULL DEFAULT 0,
        address       VARCHAR(254) DEFAULT NULL,
        display_name  VARCHAR(100) DEFAULT NULL,
        imap_host     VARCHAR(255) DEFAULT NULL,
        imap_port     INT NOT NULL DEFAULT 993,
        imap_user     VARCHAR(254) DEFAULT NULL,
        imap_password TEXT DEFAULT NULL,
        smtp_host     VARCHAR(255) DEFAULT NULL,
        smtp_port     INT NOT NULL DEFAULT 587,
        smtp_user     VARCHAR(254) DEFAULT NULL,
        smtp_password TEXT DEFAULT NULL,
        last_fetch_at DATETIME DEFAULT NULL,
        last_error    VARCHAR(300) DEFAULT NULL,
        updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS email_contacts (
        owner_id   VARCHAR(32) PRIMARY KEY,
        address    VARCHAR(254) NOT NULL,
        name       VARCHAR(100) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS email_threads (
        ticket_id       INT PRIMARY KEY,
        last_message_id VARCHAR(255) DEFAULT NULL,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
    ],
  },
  {
    version: 36,
    name: 'Pièces jointes des e-mails conservées',
    statements: [
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS attach_enabled TINYINT(1) NOT NULL DEFAULT 1',
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS attach_max_mb INT NOT NULL DEFAULT 10',
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS attach_quota_mb INT NOT NULL DEFAULT 500',
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS attach_retention_days INT NOT NULL DEFAULT 90',
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS attach_post_discord TINYINT(1) NOT NULL DEFAULT 1',
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS attach_blocked VARCHAR(600) DEFAULT NULL',
      `CREATE TABLE IF NOT EXISTS email_attachments (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id    INT NOT NULL,
        note_id      INT DEFAULT NULL,
        filename     VARCHAR(150) NOT NULL,
        content_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
        size         INT NOT NULL,
        sha256       CHAR(64) NOT NULL,
        stored_name  CHAR(32) NOT NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ea_ticket (ticket_id),
        CONSTRAINT fk_ea_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 37,
    name: 'Langue du bot pour le staff (réponses aux commandes, messages des salons)',
    statements: [
      "ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS staff_language ENUM('fr','en','es','de','it','pt','auto') NOT NULL DEFAULT 'fr'",
    ],
  },
  {
    version: 38,
    name: 'Invitations dans l\'équipe par e-mail (v4)',
    statements: [
      `CREATE TABLE IF NOT EXISTS team_invitations (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        email          VARCHAR(254) NOT NULL,
        role           ENUM('support','fondateur') NOT NULL DEFAULT 'support',
        grade_id       INT DEFAULT NULL,
        token_hash     CHAR(64) NOT NULL,
        invited_by_id  VARCHAR(32) NOT NULL,
        invited_by_tag VARCHAR(100) NOT NULL,
        created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at     DATETIME NOT NULL,
        accepted_at    DATETIME DEFAULT NULL,
        accepted_by    VARCHAR(32) DEFAULT NULL,
        revoked_at     DATETIME DEFAULT NULL,
        UNIQUE KEY uniq_ti_token (token_hash),
        INDEX idx_ti_email (email),
        CONSTRAINT fk_ti_grade FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE SET NULL
      )`,
    ],
  },
  {
    version: 39,
    name: 'Contacts : une fiche par personne, plusieurs identités (Discord, e-mail, web) (v4)',
    statements: [
      `CREATE TABLE IF NOT EXISTS contacts (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        display_name VARCHAR(100) NOT NULL,
        email        VARCHAR(254) DEFAULT NULL,
        notes        TEXT DEFAULT NULL,
        seed         VARCHAR(32) DEFAULT NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_contact_seed (seed),
        INDEX idx_contact_name (display_name)
      )`,
      `CREATE TABLE IF NOT EXISTS contact_identities (
        value      VARCHAR(32) PRIMARY KEY,
        contact_id INT NOT NULL,
        kind       ENUM('discord','email','web') NOT NULL,
        label      VARCHAR(254) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ci_contact (contact_id),
        CONSTRAINT fk_ci_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      )`,
      // The cards gather tickets by owner: profiles, directory and sync read tickets.owner_id
      'CREATE INDEX IF NOT EXISTS idx_tickets_owner ON tickets (owner_id)',
      ...require('./contactsSync').SYNC_STATEMENTS,
    ],
  },
  {
    version: 40,
    name: 'Portail : ouverture de tickets par connexion e-mail, sans Discord (v4)',
    // Off for the existing spaces (nothing changes); on for a space created without Discord
    statements: ['ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS portal_email_open TINYINT(1) NOT NULL DEFAULT 0'],
  },
  {
    version: 41,
    name: 'Widget web : formulaire de ticket à intégrer sur un site (v4.1)',
    // Off everywhere; the public token is created when a founder turns the widget on
    statements: [
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS widget_enabled TINYINT(1) NOT NULL DEFAULT 0',
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS widget_token VARCHAR(64) DEFAULT NULL',
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS widget_origins TEXT DEFAULT NULL',
    ],
  },
  {
    version: 42,
    name: 'E-mail : plusieurs adresses par espace, routées vers un sujet ou un tag (v4.1)',
    statements: [
      `CREATE TABLE IF NOT EXISTS email_addresses (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        address      VARCHAR(254) NOT NULL,
        display_name VARCHAR(100) DEFAULT NULL,
        subject      VARCHAR(100) DEFAULT NULL,
        tag_id       INT DEFAULT NULL,
        reply_from   TINYINT(1) NOT NULL DEFAULT 0,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_email_address (address)
      )`,
      // The address a ticket came in on (its replies can leave from it)
      'ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS via_address_id INT DEFAULT NULL',
    ],
  },
  {
    version: 43,
    name: 'Statuts personnalisés (v4.2)',
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_stages (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        label       VARCHAR(40) NOT NULL,
        color       VARCHAR(16) NOT NULL DEFAULT 'violet',
        kind        ENUM('open','waiting','in_progress') NOT NULL DEFAULT 'in_progress',
        category_id VARCHAR(32) DEFAULT NULL,
        sla_hours   INT NOT NULL DEFAULT 0,
        position    INT NOT NULL DEFAULT 0,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      // « s_<id> » for a custom status; the three built-in values are unchanged
      "ALTER TABLE tickets MODIFY stage VARCHAR(40) NOT NULL DEFAULT 'open'",
    ],
  },
  {
    version: 44,
    name: 'Équipes et files, attribution automatique (v4.2)',
    statements: [
      `CREATE TABLE IF NOT EXISTS teams (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        name         VARCHAR(60) NOT NULL,
        color        VARCHAR(16) NOT NULL DEFAULT 'violet',
        assign_mode  ENUM('none','round_robin','load') NOT NULL DEFAULT 'none',
        max_open     INT NOT NULL DEFAULT 0,
        subjects     TEXT DEFAULT NULL,
        tag_ids      TEXT DEFAULT NULL,
        last_user_id VARCHAR(32) DEFAULT NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS team_members (
        team_id  INT NOT NULL,
        user_id  VARCHAR(32) NOT NULL,
        added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (team_id, user_id),
        INDEX idx_tm_user (user_id),
        CONSTRAINT fk_tm_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
      )`,
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS team_id INT DEFAULT NULL',
      'CREATE INDEX IF NOT EXISTS idx_tickets_team ON tickets (team_id)',
    ],
  },
  {
    version: 45,
    name: 'Catégories en arbre : délai par catégorie (v4.2)',
    // The existing subjects are kept as they are: they become the categories
    statements: ['ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS subject_sla JSON DEFAULT NULL'],
  },
  {
    version: 46,
    name: 'Validations : accord d\'une personne avant d\'avancer (v4.2)',
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_approvals (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id        INT NOT NULL,
        approver_id      VARCHAR(32) DEFAULT NULL,
        approver_email   VARCHAR(254) DEFAULT NULL,
        approver_name    VARCHAR(100) NOT NULL,
        reason           TEXT NOT NULL,
        next_stage       VARCHAR(40) DEFAULT NULL,
        status           ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
        requested_by_id  VARCHAR(32) DEFAULT NULL,
        requested_by_tag VARCHAR(100) DEFAULT NULL,
        decision_comment VARCHAR(1000) DEFAULT NULL,
        decided_by_tag   VARCHAR(100) DEFAULT NULL,
        decided_at       DATETIME DEFAULT NULL,
        token_hash       CHAR(64) DEFAULT NULL,
        expires_at       DATETIME DEFAULT NULL,
        reminded_at      DATETIME DEFAULT NULL,
        remind_count     INT NOT NULL DEFAULT 0,
        created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ap_ticket (ticket_id),
        INDEX idx_ap_status (status),
        UNIQUE KEY uq_ap_token (token_hash),
        CONSTRAINT fk_ap_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 47,
    name: 'Base de connaissances : articles publics ou réservés aux membres, catégories (v4.2)',
    statements: [
      // The existing FAQ entries stay where they were (member space, DM suggestions): 'members'
      `ALTER TABLE faq_entries ADD COLUMN IF NOT EXISTS visibility ENUM('members','public') NOT NULL DEFAULT 'members'`,
      `ALTER TABLE faq_entries ADD COLUMN IF NOT EXISTS category VARCHAR(80) NOT NULL DEFAULT ''`,
      'ALTER TABLE faq_entries ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0',
      'ALTER TABLE faq_entries ADD COLUMN IF NOT EXISTS updated_at DATETIME DEFAULT NULL',
      // The public page (/aide/<space>) answers only once a founder turns it on
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS kb_public TINYINT(1) NOT NULL DEFAULT 0',
    ],
  },
  {
    version: 48,
    name: 'E-mail par OAuth2 : Gmail / Google Workspace et Microsoft 365 (v5.0)',
    statements: [
      // password = IMAP/SMTP account and password as before (the existing boxes keep it)
      `ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS auth_mode ENUM('password','google','microsoft') NOT NULL DEFAULT 'password'`,
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS oauth_account VARCHAR(254) DEFAULT NULL',
      // Tokens sealed by utils/secretBox.js (rewritten by scripts/rotate-encryption-key.js)
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS oauth_refresh TEXT DEFAULT NULL',
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS oauth_access TEXT DEFAULT NULL',
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS oauth_expires_at DATETIME DEFAULT NULL',
    ],
  },
  {
    version: 49,
    name: 'Réception des e-mails par webhook : Mailgun, Postmark, SendGrid, Amazon SES (v5.0)',
    statements: [
      `ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS inbound_mode ENUM('imap','webhook') NOT NULL DEFAULT 'imap'`,
      `ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS inbound_provider ENUM('mailgun','postmark','sendgrid','ses') DEFAULT NULL`,
      // Secret of the URL and Mailgun signing key: sealed (utils/secretBox.js)
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS inbound_token TEXT DEFAULT NULL',
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS inbound_secret TEXT DEFAULT NULL',
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS inbound_topic VARCHAR(300) DEFAULT NULL',
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS last_inbound_at DATETIME DEFAULT NULL',
    ],
  },
  {
    version: 50,
    name: 'Copies des tickets par e-mail : les CC restent en copie des réponses (v5.0)',
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_cc (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id  INT NOT NULL,
        address    VARCHAR(254) NOT NULL,
        name       VARCHAR(100) DEFAULT NULL,
        added_by   VARCHAR(100) NOT NULL DEFAULT 'email',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_cc (ticket_id, address),
        CONSTRAINT fk_cc_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 51,
    name: 'E-mails mis en forme : signatures par personne et par espace, modèle aux couleurs de l\'espace (v5.0)',
    statements: [
      'ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS email_signature TEXT DEFAULT NULL',
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS signature TEXT DEFAULT NULL',
      // The template with the space's name, logo and colour (1); a bare message (0), as before
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS branded TINYINT(1) NOT NULL DEFAULT 1',
    ],
  },
  {
    version: 52,
    name: 'Filtrage des e-mails reçus : règles d\'import, anti-spam, quarantaine (v5.0)',
    statements: [
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS filter_block TEXT DEFAULT NULL',
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS filter_allow TEXT DEFAULT NULL',
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS filter_max_mb INT NOT NULL DEFAULT 10',
      // Spam seen by the mail servers: kept aside to review (default), dropped, or let through as before
      `ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS spam_action ENUM('quarantine','drop','off') NOT NULL DEFAULT 'quarantine'`,
      'ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS spam_threshold DECIMAL(4,1) NOT NULL DEFAULT 5.0',
      `CREATE TABLE IF NOT EXISTS email_quarantine (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        from_address VARCHAR(254) NOT NULL,
        from_name    VARCHAR(100) DEFAULT NULL,
        subject      VARCHAR(200) NOT NULL DEFAULT '',
        excerpt      VARCHAR(300) NOT NULL DEFAULT '',
        reason       VARCHAR(200) NOT NULL,
        score        DECIMAL(6,2) DEFAULT NULL,
        raw_gz       MEDIUMBLOB DEFAULT NULL,
        fields       MEDIUMTEXT DEFAULT NULL,
        received_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_eq_received (received_at)
      )`,
    ],
  },
  {
    version: 53,
    name: 'Types de tickets : Incident ou Demande (v5.1)',
    statements: [
      // The existing tickets are requests
      `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_type ENUM('incident','request') NOT NULL DEFAULT 'request'`,
      'CREATE INDEX IF NOT EXISTS idx_tickets_type ON tickets (ticket_type)',
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS ticket_types_enabled TINYINT(1) NOT NULL DEFAULT 1',
      // An existing space keeps its screens as they were (turned on in Settings); a space created
      // after this version has its row inserted after the migrations, so it keeps the default (on)
      'UPDATE guild_config SET ticket_types_enabled = 0',
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS ticket_type_labels JSON DEFAULT NULL',
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS subject_types JSON DEFAULT NULL',
    ],
  },
  {
    version: 54,
    name: 'Résolution et clôture : solution, accord du demandeur, clôture automatique (v5.1)',
    statements: [
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at DATETIME DEFAULT NULL',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution TEXT DEFAULT NULL',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_by_tag VARCHAR(100) DEFAULT NULL',
      // SHA-256 of the link « C'est résolu » sent by e-mail (never the link itself)
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_token CHAR(64) DEFAULT NULL',
      'CREATE INDEX IF NOT EXISTS idx_tickets_resolved ON tickets (resolved_at)',
      'CREATE INDEX IF NOT EXISTS idx_tickets_restoken ON tickets (resolution_token)',
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS resolution_enabled TINYINT(1) NOT NULL DEFAULT 1',
      // Existing spaces close as before until turned on; a new space has it on (row inserted after the migrations)
      'UPDATE guild_config SET resolution_enabled = 0',
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS resolution_autoclose_days INT NOT NULL DEFAULT 7',
    ],
  },
  {
    version: 55,
    name: 'Matrice de priorité : urgence × impact, 6 niveaux (v5.1)',
    statements: [
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS urgency TINYINT DEFAULT NULL',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS impact TINYINT DEFAULT NULL',
      // 1 very low … 5 very high, 6 major; the 3 priorities of before stay, kept in step (utils/priorityMatrix.js)
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority_level TINYINT NOT NULL DEFAULT 3',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority_forced TINYINT(1) NOT NULL DEFAULT 0',
      "UPDATE tickets SET priority_level = CASE priority WHEN 'low' THEN 2 WHEN 'urgent' THEN 4 ELSE 3 END",
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS priority_matrix_enabled TINYINT(1) NOT NULL DEFAULT 1',
      // Existing spaces keep their 3 priorities on screen until turned on; a new space has the matrix
      'UPDATE guild_config SET priority_matrix_enabled = 0',
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS priority_matrix JSON DEFAULT NULL',
    ],
  },
  {
    version: 56,
    name: 'Calendriers : horaires d\'ouverture, fuseau, jours fériés, réponse hors horaires (v5.1)',
    statements: [
      `CREATE TABLE IF NOT EXISTS calendars (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        name          VARCHAR(60) NOT NULL,
        timezone      VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
        hours         JSON DEFAULT NULL,
        closed_days   JSON DEFAULT NULL,
        outside_reply TINYINT(1) NOT NULL DEFAULT 0,
        outside_text  VARCHAR(1000) DEFAULT NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      // No calendar = always open, as before
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS calendar_id INT DEFAULT NULL',
      'ALTER TABLE teams ADD COLUMN IF NOT EXISTS calendar_id INT DEFAULT NULL',
    ],
  },
  {
    version: 57,
    name: 'Objectifs SLA : prise en charge et résolution en heures ouvrées (v5.1)',
    statements: [
      `CREATE TABLE IF NOT EXISTS sla_policies (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        name           VARCHAR(60) NOT NULL,
        position       INT NOT NULL DEFAULT 0,
        conditions     JSON DEFAULT NULL,
        tto_minutes    INT DEFAULT NULL,
        ttr_minutes    INT DEFAULT NULL,
        business_hours TINYINT(1) NOT NULL DEFAULT 1,
        active         TINYINT(1) NOT NULL DEFAULT 1,
        created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      // No objective = no deadline beyond the stage ones (as before)
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_policy_id INT DEFAULT NULL',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tto_due_at DATETIME DEFAULT NULL',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ttr_due_at DATETIME DEFAULT NULL',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_paused_at DATETIME DEFAULT NULL',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_paused_minutes INT NOT NULL DEFAULT 0',
      'CREATE INDEX IF NOT EXISTS idx_tickets_ttr ON tickets (ttr_due_at)',
    ],
  },
  {
    version: 58,
    name: 'Escalade par niveaux et objectifs internes par équipe (OLA) (v5.1)',
    statements: [
      // A level belongs to an SLA objective (tto / ttr) or to a team (ola)
      `CREATE TABLE IF NOT EXISTS sla_escalations (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        policy_id  INT DEFAULT NULL,
        team_id    INT DEFAULT NULL,
        objective  VARCHAR(8) NOT NULL,
        percent    SMALLINT NOT NULL,
        actions    JSON DEFAULT NULL,
        INDEX idx_esc_policy (policy_id),
        INDEX idx_esc_team (team_id)
      )`,
      // Each level fires once per ticket
      `CREATE TABLE IF NOT EXISTS sla_escalation_fired (
        ticket_id     INT NOT NULL,
        escalation_id INT NOT NULL,
        fired_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (ticket_id, escalation_id)
      )`,
      'ALTER TABLE teams ADD COLUMN IF NOT EXISTS ola_minutes INT DEFAULT NULL',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS team_since DATETIME DEFAULT NULL',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ola_due_at DATETIME DEFAULT NULL',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ola_paused_minutes INT NOT NULL DEFAULT 0',
      'UPDATE tickets SET team_since = created_at WHERE team_id IS NOT NULL AND team_since IS NULL',
    ],
  },
  {
    version: 59,
    name: 'Moteur de règles : quand, si, alors ; reprise des règles par sujet et par mots-clés (v5.2)',
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_rules (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        name        VARCHAR(80) NOT NULL,
        position    INT NOT NULL DEFAULT 0,
        active      TINYINT(1) NOT NULL DEFAULT 1,
        triggers    JSON NOT NULL,
        match_mode  VARCHAR(3) NOT NULL DEFAULT 'all',
        conditions  JSON DEFAULT NULL,
        actions     JSON NOT NULL,
        stop_after  TINYINT(1) NOT NULL DEFAULT 0,
        origin      VARCHAR(16) DEFAULT NULL,
        legacy      JSON DEFAULT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      // Same effect: at the opening, the subject (one contained in the other, a category covers
      // its sub-categories) or the keywords of the first message; priority, tag, grade
      `INSERT INTO ticket_rules (name, position, active, triggers, match_mode, conditions, actions, origin, legacy)
       SELECT LEFT(IF(match_type = 'keyword', CONCAT('Mots-clés : ', keywords), CONCAT('Sujet : ', subject)), 80), id, active, '["created"]', 'all',
              IF(match_type = 'keyword', JSON_ARRAY(JSON_OBJECT('field', 'text', 'not', false, 'values', JSON_ARRAY(keywords))),
                                         JSON_ARRAY(JSON_OBJECT('field', 'subject', 'not', false, 'values', JSON_ARRAY(subject)))),
              CONCAT('[', CONCAT_WS(',',
                IF(priority IS NULL, NULL, JSON_OBJECT('type', 'priority', 'value', priority)),
                IF(tag_id IS NULL, NULL, JSON_OBJECT('type', 'tagAdd', 'value', tag_id)),
                IF(visibility_grade_id IS NULL, NULL, JSON_OBJECT('type', 'grade', 'value', visibility_grade_id))), ']'),
              'subject',
              JSON_OBJECT('match_type', COALESCE(match_type, 'subject'), 'subject', subject, 'keywords', keywords, 'tag_id', tag_id, 'priority', priority, 'visibility_grade_id', visibility_grade_id)
       FROM subject_rules WHERE priority IS NOT NULL OR tag_id IS NOT NULL OR visibility_grade_id IS NOT NULL ORDER BY id`,
      'DELETE FROM subject_rules',
    ],
  },
  {
    version: 60,
    name: 'Règles temporelles : « quand le temps passe » (v5.2)',
    statements: [
      'ALTER TABLE ticket_rules ADD COLUMN IF NOT EXISTS timer JSON DEFAULT NULL',
      // Once per rule, ticket and moment it counts from (a new reply or status starts it again)
      `CREATE TABLE IF NOT EXISTS rule_timer_fired (
        ticket_id INT NOT NULL,
        rule_id   INT NOT NULL,
        basis_at  DATETIME NOT NULL,
        fired_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (ticket_id, rule_id, basis_at)
      )`,
    ],
  },
  {
    version: 61,
    name: 'Notifications : événements × destinataires × canaux, préférences, textes du demandeur (v5.2)',
    statements: [
      `CREATE TABLE IF NOT EXISTS notification_rules (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        event      VARCHAR(24) NOT NULL,
        recipients JSON NOT NULL,
        channels   JSON NOT NULL,
        emails     JSON DEFAULT NULL,
        imposed    TINYINT(1) NOT NULL DEFAULT 0,
        active     TINYINT(1) NOT NULL DEFAULT 1
      )`,
      // What was sent before (utils/followers.js, utils/assignNotify.js)
      `INSERT INTO notification_rules (event, recipients, channels) SELECT * FROM (
        SELECT 'member_reply' AS e, '["followers"]' AS r, '["dashboard"]' AS c UNION ALL SELECT 'staff_reply', '["followers"]', '["dashboard"]'
        UNION ALL SELECT 'note', '["followers"]', '["dashboard"]' UNION ALL SELECT 'closed', '["followers"]', '["dashboard"]'
        UNION ALL SELECT 'assigned', '["assignee"]', '["dashboard","discord"]') d
       WHERE NOT EXISTS (SELECT 1 FROM notification_rules)`,
      `CREATE TABLE IF NOT EXISTS user_notification_prefs (
        user_id VARCHAR(32) NOT NULL,
        event   VARCHAR(24) NOT NULL,
        channel VARCHAR(12) NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (user_id, event, channel)
      )`,
      "INSERT IGNORE INTO user_notification_prefs (user_id, event, channel, enabled) SELECT user_id, 'assigned', 'discord', 0 FROM dashboard_users WHERE notify_assign_dm = 0",
      `CREATE TABLE IF NOT EXISTS notification_templates (
        tkey VARCHAR(40) NOT NULL,
        lang VARCHAR(2) NOT NULL,
        text TEXT NOT NULL,
        PRIMARY KEY (tkey, lang)
      )`,
    ],
  },
  {
    version: 62,
    name: 'Slack et Microsoft Teams : notifications d\'équipe et bouton « Prendre » (v5.2)',
    statements: [
      `CREATE TABLE IF NOT EXISTS chat_integrations (
        kind           VARCHAR(8) PRIMARY KEY,
        webhook_url    TEXT DEFAULT NULL,
        signing_secret TEXT DEFAULT NULL,
        active         TINYINT(1) NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS chat_user_links (
        provider    VARCHAR(8) NOT NULL,
        team_id     VARCHAR(32) NOT NULL,
        external_id VARCHAR(32) NOT NULL,
        user_id     VARCHAR(32) NOT NULL,
        linked_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider, team_id, external_id)
      )`,
    ],
  },
  {
    version: 63,
    name: 'Organisations : contacts regroupés par domaine ou à la main, SLA et horaires propres (v5.3)',
    statements: [
      `CREATE TABLE IF NOT EXISTS organizations (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        parent_id   INT DEFAULT NULL,
        team_id     INT DEFAULT NULL,
        manager_id  VARCHAR(32) DEFAULT NULL,
        calendar_id INT DEFAULT NULL,
        fields      JSON DEFAULT NULL,
        notes       TEXT DEFAULT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_org_name (name)
      )`,
      `CREATE TABLE IF NOT EXISTS organization_domains (
        domain          VARCHAR(253) PRIMARY KEY,
        organization_id INT NOT NULL,
        INDEX idx_od_org (organization_id)
      )`,
      'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS organization_id INT DEFAULT NULL',
      'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS org_manual TINYINT(1) NOT NULL DEFAULT 0',
      'CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts (organization_id)',
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS organization_id INT DEFAULT NULL',
      'CREATE INDEX IF NOT EXISTS idx_tickets_org ON tickets (organization_id)',
    ],
  },
  {
    version: 64,
    name: 'Portail d\'organisation : les tickets de son organisation dans l\'espace membre (v5.3)',
    statements: [
      // Nobody by default: nothing new is shown until a founder chooses it
      "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS portal_visibility VARCHAR(8) NOT NULL DEFAULT 'none'",
      'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS org_portal_manager TINYINT(1) NOT NULL DEFAULT 0',
    ],
  },
  {
    version: 65,
    name: 'Catalogue de services : services par catégorie, formulaires conditionnels, gabarits (v5.3)',
    statements: [
      `CREATE TABLE IF NOT EXISTS catalog_services (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        name        VARCHAR(80) NOT NULL,
        description VARCHAR(300) DEFAULT NULL,
        icon        VARCHAR(16) DEFAULT NULL,
        category    VARCHAR(60) DEFAULT NULL,
        position    INT NOT NULL DEFAULT 0,
        active      TINYINT(1) NOT NULL DEFAULT 1,
        fields      JSON DEFAULT NULL,
        subject     VARCHAR(100) DEFAULT NULL,
        ticket_type VARCHAR(10) DEFAULT NULL,
        team_id     INT DEFAULT NULL,
        priority    VARCHAR(10) DEFAULT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS catalog_service_id INT DEFAULT NULL',
      // The opening forms of before, copied as services (the forms themselves keep working in Discord)
      `INSERT INTO catalog_services (name, category, position, active, fields, subject)
       SELECT LEFT(f.name, 80), 'Demandes', f.id, f.active,
              COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('key', CONCAT('f', ff.id), 'label', LEFT(ff.label, 100),
                  'type', IF(ff.field_type = 'choice', 'select', ff.field_type), 'choices', JSON_EXTRACT(COALESCE(ff.choices, '[]'), '$'),
                  'required', ff.required = 1, 'default', '', 'showIf', NULL) ORDER BY ff.position, ff.id)
                FROM intake_form_fields ff WHERE ff.form_id = f.id), '[]'),
              f.subject
       FROM intake_forms f WHERE NOT EXISTS (SELECT 1 FROM catalog_services) ORDER BY f.id`,
    ],
  },
  {
    version: 66,
    name: 'Tickets récurrents : ouverts tout seuls selon une périodicité (v5.3)',
    statements: [
      `CREATE TABLE IF NOT EXISTS recurring_tickets (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        name           VARCHAR(80) NOT NULL,
        subject        VARCHAR(100) DEFAULT NULL,
        content        TEXT NOT NULL,
        frequency      VARCHAR(10) NOT NULL,
        run_time       VARCHAR(5) NOT NULL,
        weekday        TINYINT DEFAULT NULL,
        monthday       TINYINT DEFAULT NULL,
        timezone       VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
        service_id     INT DEFAULT NULL,
        ticket_type    VARCHAR(10) DEFAULT NULL,
        priority       VARCHAR(10) DEFAULT NULL,
        team_id        INT DEFAULT NULL,
        skip_if_open   TINYINT(1) NOT NULL DEFAULT 1,
        active         TINYINT(1) NOT NULL DEFAULT 1,
        next_run_at    DATETIME DEFAULT NULL,
        last_run_at    DATETIME DEFAULT NULL,
        last_ticket_id INT DEFAULT NULL,
        created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_rt_next (active, next_run_at)
      )`,
    ],
  },
  {
    version: 67,
    name: 'Tâches de ticket et modèles de tâches (v5.4)',
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_tasks (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id       INT NOT NULL,
        title           VARCHAR(200) NOT NULL,
        description     TEXT DEFAULT NULL,
        assignee_id     VARCHAR(32) DEFAULT NULL,
        team_id         INT DEFAULT NULL,
        planned_minutes INT DEFAULT NULL,
        due_at          DATETIME DEFAULT NULL,
        state           VARCHAR(4) NOT NULL DEFAULT 'todo',
        visible         TINYINT(1) NOT NULL DEFAULT 0,
        position        INT NOT NULL DEFAULT 0,
        created_by      VARCHAR(32) DEFAULT NULL,
        done_at         DATETIME DEFAULT NULL,
        done_by_tag     VARCHAR(100) DEFAULT NULL,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tk_ticket (ticket_id),
        INDEX idx_tk_assignee (assignee_id, state),
        INDEX idx_tk_due (due_at),
        CONSTRAINT fk_tk_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS task_templates (
        id    INT AUTO_INCREMENT PRIMARY KEY,
        name  VARCHAR(80) NOT NULL,
        tasks JSON NOT NULL
      )`,
      // The time spent goes to the ticket or to one of its tasks
      'ALTER TABLE ticket_time ADD COLUMN IF NOT EXISTS task_id INT DEFAULT NULL',
      'CREATE INDEX IF NOT EXISTS idx_tt_task ON ticket_time (task_id)',
    ],
  },
  {
    version: 68,
    name: 'Planning : flux iCal personnel (v5.4)',
    statements: [
      // The secret link of a staff member's iCal feed, stored hashed (none until they ask for one)
      'ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS ical_token_hash CHAR(64) DEFAULT NULL',
      'CREATE INDEX IF NOT EXISTS idx_du_ical ON dashboard_users (ical_token_hash)',
    ],
  },
  {
    version: 69,
    name: 'Interface du staff : colonnes de la liste, vues partagées par équipe (v5.4)',
    statements: [
      'ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS ui_prefs JSON DEFAULT NULL',
      // A saved view of the ticket list can be shared with a team: its members see it
      'ALTER TABLE ticket_views ADD COLUMN IF NOT EXISTS team_id INT DEFAULT NULL',
      'CREATE INDEX IF NOT EXISTS idx_tv_team ON ticket_views (team_id)',
    ],
  },
  {
    version: 70,
    name: 'Coûts : taux horaires, forfait par ticket, frais ajoutés (v5.4)',
    statements: [
      "ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS cost_currency VARCHAR(3) NOT NULL DEFAULT 'EUR'",
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS cost_default_rate_cents INT NOT NULL DEFAULT 0',
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS cost_fixed_cents INT NOT NULL DEFAULT 0',
      `CREATE TABLE IF NOT EXISTS cost_rates (
        scope        VARCHAR(4) NOT NULL,
        target_id    VARCHAR(32) NOT NULL,
        hourly_cents INT NOT NULL,
        PRIMARY KEY (scope, target_id)
      )`,
      `CREATE TABLE IF NOT EXISTS ticket_costs (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id      INT NOT NULL,
        label          VARCHAR(120) NOT NULL,
        amount_cents   INT NOT NULL,
        created_by_id  VARCHAR(32) DEFAULT NULL,
        created_by_tag VARCHAR(100) DEFAULT NULL,
        created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tc_ticket (ticket_id),
        INDEX idx_tc_date (created_at),
        CONSTRAINT fk_tc_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 71,
    name: 'Problèmes : la cause commune de plusieurs tickets (v5.5, désactivé par défaut)',
    statements: [
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS problems_enabled TINYINT(1) NOT NULL DEFAULT 0',
      `CREATE TABLE IF NOT EXISTS problems (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        title       VARCHAR(200) NOT NULL,
        description TEXT DEFAULT NULL,
        symptoms    TEXT DEFAULT NULL,
        cause       TEXT DEFAULT NULL,
        workaround  TEXT DEFAULT NULL,
        solution    TEXT DEFAULT NULL,
        status      VARCHAR(12) NOT NULL DEFAULT 'open',
        assignee_id VARCHAR(32) DEFAULT NULL,
        team_id     INT DEFAULT NULL,
        created_by  VARCHAR(32) DEFAULT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME DEFAULT NULL,
        INDEX idx_pb_status (status)
      )`,
      `CREATE TABLE IF NOT EXISTS problem_tickets (
        problem_id INT NOT NULL,
        ticket_id  INT NOT NULL,
        linked_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (problem_id, ticket_id),
        INDEX idx_pt_ticket (ticket_id),
        CONSTRAINT fk_pt_problem FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE,
        CONSTRAINT fk_pt_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS problem_tasks (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        problem_id INT NOT NULL,
        title      VARCHAR(200) NOT NULL,
        done       TINYINT(1) NOT NULL DEFAULT 0,
        CONSTRAINT fk_pk_problem FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 72,
    name: 'Changements : plans, risques, validations, créneau, tâches (v5.5, désactivé par défaut)',
    statements: [
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS changes_enabled TINYINT(1) NOT NULL DEFAULT 0',
      `CREATE TABLE IF NOT EXISTS changes (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        title         VARCHAR(200) NOT NULL,
        description   TEXT DEFAULT NULL,
        deploy_plan   TEXT DEFAULT NULL,
        rollback_plan TEXT DEFAULT NULL,
        risks         TEXT DEFAULT NULL,
        impact        TEXT DEFAULT NULL,
        risk_level    VARCHAR(6) NOT NULL DEFAULT 'low',
        status        VARCHAR(12) NOT NULL DEFAULT 'draft',
        assignee_id   VARCHAR(32) DEFAULT NULL,
        team_id       INT DEFAULT NULL,
        starts_at     DATETIME DEFAULT NULL,
        ends_at       DATETIME DEFAULT NULL,
        created_by    VARCHAR(32) DEFAULT NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ch_status (status),
        INDEX idx_ch_start (starts_at)
      )`,
      `CREATE TABLE IF NOT EXISTS change_approvals (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        change_id   INT NOT NULL,
        approver_id VARCHAR(32) NOT NULL,
        decision    VARCHAR(8) NOT NULL DEFAULT 'pending',
        comment     VARCHAR(1000) DEFAULT NULL,
        decided_at  DATETIME DEFAULT NULL,
        UNIQUE KEY uniq_ca (change_id, approver_id),
        CONSTRAINT fk_ca_change FOREIGN KEY (change_id) REFERENCES changes(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS change_links (
        change_id INT NOT NULL,
        kind      VARCHAR(8) NOT NULL,
        target_id INT NOT NULL,
        PRIMARY KEY (change_id, kind, target_id),
        INDEX idx_cl_target (kind, target_id),
        CONSTRAINT fk_cl_change FOREIGN KEY (change_id) REFERENCES changes(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS change_tasks (
        id        INT AUTO_INCREMENT PRIMARY KEY,
        change_id INT NOT NULL,
        title     VARCHAR(200) NOT NULL,
        done      TINYINT(1) NOT NULL DEFAULT 0,
        CONSTRAINT fk_ck_change FOREIGN KEY (change_id) REFERENCES changes(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 73,
    name: 'Base de connaissances gérée : brouillons, visibilités, révisions, traductions, retours (v5.6)',
    statements: [
      // Every existing article stays published, with the visibility it had
      "ALTER TABLE faq_entries MODIFY COLUMN visibility ENUM('members','public','staff','organization','team') NOT NULL DEFAULT 'members'",
      "ALTER TABLE faq_entries ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'published'",
      'ALTER TABLE faq_entries ADD COLUMN IF NOT EXISTS organization_id INT DEFAULT NULL',
      'ALTER TABLE faq_entries ADD COLUMN IF NOT EXISTS team_id INT DEFAULT NULL',
      'ALTER TABLE faq_entries ADD COLUMN IF NOT EXISTS review_at DATE DEFAULT NULL',
      'ALTER TABLE faq_entries ADD COLUMN IF NOT EXISTS expires_at DATE DEFAULT NULL',
      'ALTER TABLE faq_entries ADD COLUMN IF NOT EXISTS lang VARCHAR(2) DEFAULT NULL',
      'ALTER TABLE faq_entries ADD COLUMN IF NOT EXISTS translation_of INT DEFAULT NULL',
      'ALTER TABLE faq_entries ADD COLUMN IF NOT EXISTS helpful_yes INT NOT NULL DEFAULT 0',
      'ALTER TABLE faq_entries ADD COLUMN IF NOT EXISTS helpful_no INT NOT NULL DEFAULT 0',
      `CREATE TABLE IF NOT EXISTS faq_revisions (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        faq_id         INT NOT NULL,
        question       VARCHAR(200) NOT NULL,
        answer         TEXT NOT NULL,
        category       VARCHAR(80) NOT NULL DEFAULT '',
        edited_by_tag  VARCHAR(100) DEFAULT NULL,
        created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_fr_faq (faq_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS faq_feedback (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        faq_id     INT NOT NULL,
        helpful    TINYINT(1) NOT NULL,
        comment    VARCHAR(1000) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ff_faq (faq_id, created_at)
      )`,
      // What readers looked for and did not find
      `CREATE TABLE IF NOT EXISTS kb_searches (
        query   VARCHAR(100) PRIMARY KEY,
        misses  INT NOT NULL DEFAULT 0,
        last_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
  },
  {
    version: 74,
    name: 'Tableaux de bord : widgets, tableaux personnels et partagés (v5.6)',
    statements: [
      `CREATE TABLE IF NOT EXISTS dashboards (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        owner_id   VARCHAR(32) NOT NULL,
        name       VARCHAR(60) NOT NULL,
        widgets    JSON NOT NULL,
        sharing    VARCHAR(8) NOT NULL DEFAULT 'private',
        team_id    INT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_db_owner (owner_id),
        INDEX idx_db_sharing (sharing, team_id)
      )`,
    ],
  },
  {
    version: 75,
    name: 'Rapports programmés envoyés par e-mail (v5.6)',
    statements: [
      `CREATE TABLE IF NOT EXISTS scheduled_reports (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        owner_id     VARCHAR(32) NOT NULL,
        name         VARCHAR(80) NOT NULL,
        dimension    VARCHAR(16) NOT NULL,
        days         INT NOT NULL DEFAULT 30,
        format       VARCHAR(4) NOT NULL DEFAULT 'xlsx',
        frequency    VARCHAR(8) NOT NULL DEFAULT 'weekly',
        weekday      TINYINT DEFAULT 1,
        monthday     TINYINT DEFAULT 1,
        run_time     VARCHAR(5) NOT NULL DEFAULT '08:00',
        timezone     VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
        recipients   TEXT NOT NULL,
        active       TINYINT(1) NOT NULL DEFAULT 1,
        next_run_at  DATETIME DEFAULT NULL,
        last_sent_at DATETIME DEFAULT NULL,
        last_error   VARCHAR(300) DEFAULT NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sr_next (active, next_run_at)
      )`,
    ],
  },
  {
    version: 76,
    name: 'Enquête de satisfaction : délai, questions, lien externe, taux de réponse (v5.6)',
    statements: [
      // 0 minute, built-in: what was sent before (the rating at the closing)
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS survey_delay_minutes INT NOT NULL DEFAULT 0',
      "ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS survey_mode VARCHAR(8) NOT NULL DEFAULT 'builtin'",
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS survey_external_url VARCHAR(500) DEFAULT NULL',
      'ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS survey_questions JSON DEFAULT NULL',
      `CREATE TABLE IF NOT EXISTS survey_requests (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id     INT NOT NULL,
        owner_id      VARCHAR(32) NOT NULL,
        token_hash    CHAR(64) NOT NULL,
        pending_token VARCHAR(64) DEFAULT NULL,
        send_at       DATETIME NOT NULL,
        sent_at       DATETIME DEFAULT NULL,
        answered_at   DATETIME DEFAULT NULL,
        expires_at    DATETIME NOT NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sq_token (token_hash),
        INDEX idx_sq_due (sent_at, send_at),
        INDEX idx_sq_ticket (ticket_id)
      )`,
      `CREATE TABLE IF NOT EXISTS survey_responses (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT NOT NULL,
        ticket_id  INT NOT NULL,
        rating     TINYINT NOT NULL,
        comment    TEXT DEFAULT NULL,
        answers    JSON DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_srsp_date (created_at)
      )`,
    ],
  },
  {
    version: 77,
    name: 'Imports depuis d\'autres outils : ce qui a déjà été repris (v5.7)',
    statements: [
      `CREATE TABLE IF NOT EXISTS import_refs (
        source      VARCHAR(12) NOT NULL,
        kind        VARCHAR(16) NOT NULL,
        external_id VARCHAR(64) NOT NULL,
        local_id    INT NOT NULL,
        imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (source, kind, external_id)
      )`,
    ],
  },
  {
    version: 78,
    name: 'Rétention des tickets clos (anonymisation ou suppression) et archives (v5.7)',
    statements: [
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS ticket_retention_mode VARCHAR(10) NOT NULL DEFAULT 'off'`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS ticket_retention_months SMALLINT NOT NULL DEFAULT 36`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS ticket_archive_months SMALLINT NOT NULL DEFAULT 0`,
      `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS anonymized_at DATETIME DEFAULT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_tickets_closed_at ON tickets (status, closed_at)`,
    ],
  },
  {
    version: 79,
    name: 'Données rattachées à un ticket supprimées avec lui : enquêtes, fils e-mail, déclenchements (#76)',
    statements: [
      `DELETE FROM survey_requests WHERE ticket_id NOT IN (SELECT id FROM tickets)`,
      `ALTER TABLE survey_requests ADD CONSTRAINT fk_sq_ticket FOREIGN KEY IF NOT EXISTS (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE`,
      `DELETE FROM survey_responses WHERE ticket_id NOT IN (SELECT id FROM tickets)`,
      `ALTER TABLE survey_responses ADD CONSTRAINT fk_srsp_ticket FOREIGN KEY IF NOT EXISTS (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE`,
      `DELETE FROM email_threads WHERE ticket_id NOT IN (SELECT id FROM tickets)`,
      `ALTER TABLE email_threads ADD CONSTRAINT fk_et_ticket FOREIGN KEY IF NOT EXISTS (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE`,
      `DELETE FROM sla_escalation_fired WHERE ticket_id NOT IN (SELECT id FROM tickets)`,
      `ALTER TABLE sla_escalation_fired ADD CONSTRAINT fk_sef_ticket FOREIGN KEY IF NOT EXISTS (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE`,
      `DELETE FROM rule_timer_fired WHERE ticket_id NOT IN (SELECT id FROM tickets)`,
      `ALTER TABLE rule_timer_fired ADD CONSTRAINT fk_rtf_ticket FOREIGN KEY IF NOT EXISTS (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE`,
    ],
  },
  {
    version: 80,
    name: 'Images des articles de la base de connaissances (v6)',
    statements: [
      `CREATE TABLE IF NOT EXISTS faq_images (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        token        CHAR(32) NOT NULL,
        faq_id       INT NOT NULL,
        content_type VARCHAR(20) NOT NULL,
        size         INT NOT NULL,
        sha256       CHAR(64) NOT NULL,
        stored_name  CHAR(32) NOT NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_fi_token (token),
        INDEX idx_fi_faq (faq_id),
        CONSTRAINT fk_fi_faq FOREIGN KEY (faq_id) REFERENCES faq_entries(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 81,
    name: 'Objectif SLA choisi par une règle (v6)',
    statements: [
      `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_forced TINYINT(1) NOT NULL DEFAULT 0`,
    ],
  },
  {
    version: 82,
    name: 'Inactivité et escalade deviennent des règles temporelles, même effet (v6)',
    statements: timersAsRulesStatements(),
  },
  {
    version: 83,
    name: 'Types de liens entre tickets : doublon, bloque, parent / enfant (v7)',
    statements: [
      // kind: related | duplicate | blocks | parent ; from_id: the ticket the asymmetric kind reads
      // from (« from_id is a duplicate of / blocks / is the parent of » the other one)
      `ALTER TABLE ticket_links ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'related',
         ADD COLUMN IF NOT EXISTS from_id INT DEFAULT NULL`,
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS close_children_with_parent TINYINT(1) NOT NULL DEFAULT 0`,
    ],
  },
  {
    version: 84,
    name: 'Sous-tâches des tickets (v7)',
    statements: [
      `ALTER TABLE ticket_tasks ADD COLUMN IF NOT EXISTS parent_id INT DEFAULT NULL, ADD INDEX IF NOT EXISTS idx_tk_parent (parent_id)`,
      `ALTER TABLE ticket_tasks ADD CONSTRAINT fk_tk_parent FOREIGN KEY IF NOT EXISTS (parent_id) REFERENCES ticket_tasks(id) ON DELETE CASCADE`,
    ],
  },
  {
    version: 85,
    name: 'Doublons ouverts : « ce n\'est pas un doublon » (v7)',
    statements: [`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS duplicate_dismissed_at DATETIME DEFAULT NULL`],
  },
  {
    version: 86,
    name: 'Compétences et langues du staff pour l\'attribution (v7)',
    statements: [
      `CREATE TABLE IF NOT EXISTS skills (
        id   INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(40) NOT NULL,
        UNIQUE KEY uq_skill_name (name)
      )`,
      `CREATE TABLE IF NOT EXISTS staff_skills (
        user_id  VARCHAR(32) NOT NULL,
        skill_id INT NOT NULL,
        PRIMARY KEY (user_id, skill_id),
        CONSTRAINT fk_staffskill_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS subject_skills (
        subject  VARCHAR(100) NOT NULL,
        skill_id INT NOT NULL,
        PRIMARY KEY (subject, skill_id),
        CONSTRAINT fk_subjskill_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS ticket_skills (
        ticket_id INT NOT NULL,
        skill_id  INT NOT NULL,
        PRIMARY KEY (ticket_id, skill_id),
        CONSTRAINT fk_tskill_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
        CONSTRAINT fk_tskill_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
      )`,
      // Languages the person answers in (fr,en,…); empty: not said
      `ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS languages VARCHAR(40) DEFAULT NULL`,
    ],
  },
  {
    version: 87,
    name: 'Niveaux de support des équipes (v7)',
    statements: [`ALTER TABLE teams ADD COLUMN IF NOT EXISTS level TINYINT DEFAULT NULL`],
  },
  {
    version: 88,
    name: 'Contrats des organisations (v7)',
    statements: [
      `CREATE TABLE IF NOT EXISTS contracts (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        organization_id  INT NOT NULL,
        name             VARCHAR(100) NOT NULL,
        kind             VARCHAR(10) NOT NULL DEFAULT 'hours',
        quota            INT DEFAULT NULL,
        starts_on        DATE NOT NULL,
        ends_on          DATE DEFAULT NULL,
        sla_policy_id    INT DEFAULT NULL,
        alert_percent    TINYINT NOT NULL DEFAULT 80,
        alert_days       SMALLINT NOT NULL DEFAULT 30,
        auto_renew       TINYINT(1) NOT NULL DEFAULT 0,
        renewal_of       INT DEFAULT NULL,
        notes            TEXT DEFAULT NULL,
        quota_alerted_at DATETIME DEFAULT NULL,
        end_alerted_at   DATETIME DEFAULT NULL,
        created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_contract_org (organization_id, starts_on),
        CONSTRAINT fk_contract_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 89,
    name: 'CRM de l\'espace : HubSpot ou Salesforce (v7)',
    statements: [`ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS crm_provider VARCHAR(12) DEFAULT NULL, ADD COLUMN IF NOT EXISTS crm_config TEXT DEFAULT NULL`],
  },
  {
    version: 90,
    name: 'Parc : types, éléments, relations et historique (v7)',
    statements: [
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS assets_enabled TINYINT(1) NOT NULL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS asset_types (
        id       INT AUTO_INCREMENT PRIMARY KEY,
        name     VARCHAR(60) NOT NULL,
        icon     VARCHAR(16) DEFAULT NULL,
        fields   JSON DEFAULT NULL,
        position INT NOT NULL DEFAULT 0,
        UNIQUE KEY uq_asset_type_name (name)
      )`,
      `CREATE TABLE IF NOT EXISTS assets (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        type_id          INT NOT NULL,
        name             VARCHAR(150) NOT NULL,
        status           VARCHAR(12) NOT NULL DEFAULT 'in_use',
        serial           VARCHAR(100) DEFAULT NULL,
        location         VARCHAR(200) DEFAULT NULL,
        owner_contact_id INT DEFAULT NULL,
        owner_org_id     INT DEFAULT NULL,
        fields           JSON DEFAULT NULL,
        notes            TEXT DEFAULT NULL,
        created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_asset_type (type_id), INDEX idx_asset_org (owner_org_id), INDEX idx_asset_contact (owner_contact_id), INDEX idx_asset_name (name),
        CONSTRAINT fk_asset_type FOREIGN KEY (type_id) REFERENCES asset_types(id),
        CONSTRAINT fk_asset_contact FOREIGN KEY (owner_contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
        CONSTRAINT fk_asset_org FOREIGN KEY (owner_org_id) REFERENCES organizations(id) ON DELETE SET NULL
      )`,
      `CREATE TABLE IF NOT EXISTS asset_relations (
        from_id INT NOT NULL,
        to_id   INT NOT NULL,
        kind    VARCHAR(12) NOT NULL,
        PRIMARY KEY (from_id, to_id, kind),
        INDEX idx_asset_rel_to (to_id),
        CONSTRAINT fk_asset_rel_from FOREIGN KEY (from_id) REFERENCES assets(id) ON DELETE CASCADE,
        CONSTRAINT fk_asset_rel_to FOREIGN KEY (to_id) REFERENCES assets(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS asset_history (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        asset_id   INT NOT NULL,
        actor_tag  VARCHAR(100) NOT NULL,
        changes    JSON DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_asset_hist (asset_id),
        CONSTRAINT fk_asset_hist FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 91,
    name: 'Parc : éléments liés aux tickets, problèmes et changements (v7)',
    statements: [
      `CREATE TABLE IF NOT EXISTS asset_links (
        asset_id    INT NOT NULL,
        target_type VARCHAR(8) NOT NULL,
        target_id   INT NOT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (asset_id, target_type, target_id),
        INDEX idx_asset_link_target (target_type, target_id),
        CONSTRAINT fk_asset_link_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 92,
    name: 'Mises en production (v7)',
    statements: [
      `CREATE TABLE IF NOT EXISTS releases (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        title         VARCHAR(200) NOT NULL,
        description   TEXT DEFAULT NULL,
        status        VARCHAR(14) NOT NULL DEFAULT 'preparation',
        rollback_plan TEXT DEFAULT NULL,
        review        TEXT DEFAULT NULL,
        assignee_id   VARCHAR(32) DEFAULT NULL,
        starts_at     DATETIME DEFAULT NULL,
        ends_at       DATETIME DEFAULT NULL,
        created_by    VARCHAR(32) DEFAULT NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at   DATETIME DEFAULT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS release_changes (
        release_id INT NOT NULL,
        change_id  INT NOT NULL,
        PRIMARY KEY (release_id, change_id),
        INDEX idx_rc_change (change_id),
        CONSTRAINT fk_rc_release FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
        CONSTRAINT fk_rc_change FOREIGN KEY (change_id) REFERENCES changes(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS release_steps (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        release_id  INT NOT NULL,
        stage       VARCHAR(14) NOT NULL,
        title       VARCHAR(200) NOT NULL,
        done        TINYINT(1) NOT NULL DEFAULT 0,
        done_by_tag VARCHAR(100) DEFAULT NULL,
        done_at     DATETIME DEFAULT NULL,
        INDEX idx_rs_release (release_id),
        CONSTRAINT fk_rs_release FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 93,
    name: 'Comité des changements (v7)',
    statements: [
      `CREATE TABLE IF NOT EXISTS cab_members (user_id VARCHAR(32) PRIMARY KEY)`,
      `CREATE TABLE IF NOT EXISTS cab_meetings (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        title      VARCHAR(150) NOT NULL,
        starts_at  DATETIME NOT NULL,
        status     VARCHAR(10) NOT NULL DEFAULT 'planned',
        notes      TEXT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS cab_agenda (
        meeting_id     INT NOT NULL,
        change_id      INT NOT NULL,
        position       INT NOT NULL DEFAULT 0,
        decision       VARCHAR(10) DEFAULT NULL,
        decision_note  TEXT DEFAULT NULL,
        decided_at     DATETIME DEFAULT NULL,
        decided_by_tag VARCHAR(100) DEFAULT NULL,
        PRIMARY KEY (meeting_id, change_id),
        INDEX idx_cab_agenda_change (change_id),
        CONSTRAINT fk_cab_agenda_meeting FOREIGN KEY (meeting_id) REFERENCES cab_meetings(id) ON DELETE CASCADE,
        CONSTRAINT fk_cab_agenda_change FOREIGN KEY (change_id) REFERENCES changes(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS cab_votes (
        meeting_id INT NOT NULL,
        change_id  INT NOT NULL,
        user_id    VARCHAR(32) NOT NULL,
        vote       VARCHAR(8) NOT NULL,
        comment    TEXT DEFAULT NULL,
        voted_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (meeting_id, change_id, user_id),
        CONSTRAINT fk_cab_votes_item FOREIGN KEY (meeting_id, change_id) REFERENCES cab_agenda(meeting_id, change_id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 94,
    name: 'Page de statut publique (v7)',
    statements: [
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS status_page_enabled TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS status_page_title VARCHAR(120) DEFAULT NULL`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS public TINYINT(1) NOT NULL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS status_components (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        name        VARCHAR(80) NOT NULL,
        description VARCHAR(300) DEFAULT NULL,
        status      VARCHAR(16) NOT NULL DEFAULT 'operational',
        position    INT NOT NULL DEFAULT 0,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS status_component_events (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        component_id INT NOT NULL,
        status       VARCHAR(16) NOT NULL,
        at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_sce_comp (component_id, at),
        CONSTRAINT fk_sce_comp FOREIGN KEY (component_id) REFERENCES status_components(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS status_subscribers (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        email        VARCHAR(254) NOT NULL,
        token_hash   CHAR(64) NOT NULL,
        unsub_token  VARCHAR(48) NOT NULL,
        lang         VARCHAR(2) NOT NULL DEFAULT 'fr',
        confirmed_at DATETIME DEFAULT NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_status_sub (email), INDEX idx_status_sub_token (token_hash), INDEX idx_status_sub_unsub (unsub_token)
      )`,
    ],
  },
  {
    version: 95,
    name: 'Modèle des e-mails de l\'espace (v7)',
    statements: [`ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS email_template TEXT DEFAULT NULL`],
  },
  {
    version: 96,
    name: 'Chat en direct dans le widget (v7)',
    statements: [
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS widget_chat TINYINT(1) NOT NULL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS chat_sessions (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        token_hash   CHAR(64) NOT NULL,
        ticket_id    INT NOT NULL,
        owner_id     VARCHAR(32) NOT NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        ended_at     DATETIME DEFAULT NULL,
        UNIQUE KEY uq_chat_token (token_hash), INDEX idx_chat_ticket (ticket_id),
        CONSTRAINT fk_chat_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 97,
    name: 'Arbre de questions du widget (v7)',
    statements: [`ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS widget_bot TEXT DEFAULT NULL`],
  },
];

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// conn: mysql2 connection already switched to the guild database (USE)
async function runTenantMigrations(conn, guildId) {
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT PRIMARY KEY, name VARCHAR(255) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  const [[{ db }]] = await conn.query('SELECT DATABASE() AS db');
  const [[{ locked }]] = await conn.query('SELECT GET_LOCK(?, 60) AS locked', [`migrate:${db}`]);
  if (!locked) throw new Error(`Migration de ${db} déjà en cours ailleurs`);
  try {
    const [rows] = await conn.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map(r => r.version));
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      for (const sql of m.statements) {
        try {
          await conn.query(sql);
        } catch (err) {
          if (m.tolerant) continue;
          logger.error('Migration échouée', { guildId, version: m.version, err: err.message });
          throw new Error(`Migration ${m.version} échouée : ${err.message}`);
        }
      }
      await conn.query('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [m.version, m.name.slice(0, 255)]);
      logger.info('Migration appliquée', { guildId, version: m.version, name: m.name });
    }
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [`migrate:${db}`]);
  }
}

// Version of a guild database (query function from utils/tenantDb.js)
async function schemaVersion(db) {
  const [row] = await db('SELECT MAX(version) AS v FROM schema_migrations').catch(() => []);
  return row?.v ?? 0;
}

module.exports = { runTenantMigrations, schemaVersion, MIGRATIONS, LATEST_VERSION };

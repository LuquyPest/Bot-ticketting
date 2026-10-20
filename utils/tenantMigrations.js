// Versioned migrations of the per-guild databases. Each database records the versions it has
// applied (schema_migrations); a migration runs once, in order, and an error stops the run
// instead of being silently ignored. To change the schema, append a new version at the end —
// never edit an applied one. GET_LOCK keeps two bot instances from migrating the same base.
const logger = require('./logger');

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

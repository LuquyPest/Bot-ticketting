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

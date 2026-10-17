const mysql = require('mysql2/promise');
const { getDbName } = require('./tenantDb');
const logger = require('./logger');

const TENANT_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS tickets (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    channel_id          VARCHAR(32) NOT NULL UNIQUE,
    owner_id            VARCHAR(32) NOT NULL,
    owner_tag           VARCHAR(100) NOT NULL,
    claimed_by          VARCHAR(32) DEFAULT NULL,
    status              ENUM('open','closed') NOT NULL DEFAULT 'open',
    subject             VARCHAR(100) DEFAULT NULL,
    priority            ENUM('low','normal','urgent') NOT NULL DEFAULT 'normal',
    stage               ENUM('open','waiting','in_progress') NOT NULL DEFAULT 'open',
    last_message_at     DATETIME DEFAULT NULL,
    first_response_at   DATETIME DEFAULT NULL,
    warned_inactive          TINYINT(1) NOT NULL DEFAULT 0,
    user_warned_inactive     TINYINT(1) NOT NULL DEFAULT 0,
    escalation_alerted       TINYINT(1) NOT NULL DEFAULT 0,
    staff_reminder_sent_at   DATETIME DEFAULT NULL,
    visibility_grade_id INT DEFAULT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at           DATETIME DEFAULT NULL,
    closed_by_tag       VARCHAR(100) DEFAULT NULL,
    closed_by_id        VARCHAR(32) DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS ticket_assignees (
    ticket_id      INT NOT NULL,
    user_id        VARCHAR(32) NOT NULL,
    assigned_by_id VARCHAR(32) DEFAULT NULL,
    assigned_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ticket_id, user_id),
    INDEX idx_ta_user (user_id),
    CONSTRAINT fk_ta_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ticket_views (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    VARCHAR(32) NOT NULL,
    name       VARCHAR(60) NOT NULL,
    filters    JSON NOT NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tv_user (user_id)
  );

  CREATE TABLE IF NOT EXISTS ticket_participants (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    user_id   VARCHAR(32) NOT NULL,
    added_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_tp (ticket_id, user_id),
    CONSTRAINT fk_tp_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS transcript_snapshots (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id      INT NOT NULL,
    channel_id     VARCHAR(32) NOT NULL,
    created_by_id  VARCHAR(32) NOT NULL,
    created_by_tag VARCHAR(100) NOT NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    message_count  INT NOT NULL DEFAULT 0,
    html           LONGTEXT NOT NULL,
    txt            LONGTEXT NOT NULL,
    CONSTRAINT fk_ts_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admin_stats (
    admin_id               VARCHAR(32) PRIMARY KEY,
    admin_tag              VARCHAR(100) NOT NULL,
    tickets_claimed        INT NOT NULL DEFAULT 0,
    tickets_closed         INT NOT NULL DEFAULT 0,
    total_ratings          INT NOT NULL DEFAULT 0,
    total_rating_score     INT NOT NULL DEFAULT 0,
    total_response_count   INT NOT NULL DEFAULT 0,
    total_response_seconds BIGINT NOT NULL DEFAULT 0,
    updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS blacklist (
    user_id      VARCHAR(32) PRIMARY KEY,
    user_tag     VARCHAR(100) NOT NULL,
    reason       TEXT DEFAULT NULL,
    added_by_id  VARCHAR(32) NOT NULL,
    added_by_tag VARCHAR(100) NOT NULL,
    expires_at   DATETIME DEFAULT NULL,
    added_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ticket_ratings (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id    INT NOT NULL,
    owner_id     VARCHAR(32) NOT NULL,
    closed_by_id VARCHAR(32) DEFAULT NULL,
    rating       TINYINT NOT NULL,
    rated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_rating (ticket_id, owner_id),
    CONSTRAINT fk_tr_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS dashboard_users (
    user_id             VARCHAR(32) PRIMARY KEY,
    username            VARCHAR(100) NOT NULL,
    avatar              VARCHAR(64) DEFAULT NULL,
    role                ENUM('nouveau','support','fondateur') NOT NULL DEFAULT 'nouveau',
    discord_has_role    TINYINT(1) NOT NULL DEFAULT 0,
    staff_role_id       INT DEFAULT NULL,
    approved_by         VARCHAR(32) DEFAULT NULL,
    approved_at         DATETIME DEFAULT NULL,
    vacation_mode       TINYINT(1) NOT NULL DEFAULT 0,
    bio                 VARCHAR(160) DEFAULT NULL,
    banner_color        VARCHAR(7) NOT NULL DEFAULT '#6366f1',
    profile_picture_url VARCHAR(512) DEFAULT NULL,
    first_login         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ticket_notes (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id  INT NOT NULL,
    author_id  VARCHAR(32) NOT NULL,
    author_tag VARCHAR(100) NOT NULL,
    content    TEXT NOT NULL,
    source     ENUM('web','discord','reply','user','scheduled') NOT NULL DEFAULT 'web',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tn_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reply_templates (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    name           VARCHAR(100) NOT NULL,
    subject        VARCHAR(100) DEFAULT NULL,
    content        TEXT NOT NULL,
    created_by_id  VARCHAR(32) NOT NULL,
    created_by_tag VARCHAR(100) NOT NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS grades (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(80) NOT NULL,
    color      VARCHAR(7) NOT NULL DEFAULT '#6366f1',
    parent_id  INT DEFAULT NULL,
    position   INT NOT NULL DEFAULT 0,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_grade_parent FOREIGN KEY (parent_id) REFERENCES grades(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS grade_permissions (
    grade_id   INT NOT NULL,
    permission VARCHAR(50) NOT NULL,
    PRIMARY KEY (grade_id, permission),
    CONSTRAINT fk_gp_grade FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_grades (
    user_id        VARCHAR(32) NOT NULL,
    grade_id       INT NOT NULL,
    assigned_by_id  VARCHAR(32) NOT NULL,
    assigned_by_tag VARCHAR(100) NOT NULL,
    assigned_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, grade_id),
    CONSTRAINT fk_ug_grade FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    actor_id    VARCHAR(32) NOT NULL,
    actor_tag   VARCHAR(100) NOT NULL,
    action      VARCHAR(100) NOT NULL,
    source      VARCHAR(16) NOT NULL DEFAULT 'dashboard',
    ticket_id   INT DEFAULT NULL,
    target_type VARCHAR(50) DEFAULT NULL,
    target_id   VARCHAR(50) DEFAULT NULL,
    details     JSON DEFAULT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_created (created_at),
    INDEX idx_audit_action (action),
    INDEX idx_audit_ticket (ticket_id)
  );

  CREATE TABLE IF NOT EXISTS ticket_tags (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(50) NOT NULL UNIQUE,
    color      VARCHAR(7) NOT NULL DEFAULT '#6366f1',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ticket_tag_assignments (
    ticket_id INT NOT NULL,
    tag_id    INT NOT NULL,
    PRIMARY KEY (ticket_id, tag_id),
    CONSTRAINT fk_tta_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    CONSTRAINT fk_tta_tag   FOREIGN KEY (tag_id)    REFERENCES ticket_tags(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id  INT NOT NULL,
    sender_id  VARCHAR(32) NOT NULL,
    sender_tag VARCHAR(100) NOT NULL,
    content    TEXT NOT NULL,
    send_at    DATETIME NOT NULL,
    sent       TINYINT(1) NOT NULL DEFAULT 0,
    sent_at    DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sm_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS guild_config (
    id                    INT AUTO_INCREMENT PRIMARY KEY,
    ticket_category_id    VARCHAR(32) DEFAULT NULL,
    waiting_category_id   VARCHAR(32) DEFAULT NULL,
    in_progress_category_id VARCHAR(32) DEFAULT NULL,
    support_role_ids      JSON NOT NULL DEFAULT ('[]'),
    chief_role_ids        JSON NOT NULL DEFAULT ('[]'),
    support_grade_id      INT DEFAULT NULL,
    chief_grade_id        INT DEFAULT NULL,
    ticket_prefix         VARCHAR(50) NOT NULL DEFAULT 'ticket',
    welcome_message       TEXT DEFAULT NULL,
    close_message         TEXT DEFAULT NULL,
    close_log_channel_id  VARCHAR(32) DEFAULT NULL,
    claim_log_channel_id  VARCHAR(32) DEFAULT NULL,
    move_log_channel_id   VARCHAR(32) DEFAULT NULL,
    add_user_log_channel_id    VARCHAR(32) DEFAULT NULL,
    remove_user_log_channel_id VARCHAR(32) DEFAULT NULL,
    embed_color           VARCHAR(7) NOT NULL DEFAULT '#6366f1',
    bot_display_name      VARCHAR(100) NOT NULL DEFAULT 'Ticket Bot',
    max_tickets_per_day   INT NOT NULL DEFAULT 10,
    inactive_warning_hours INT NOT NULL DEFAULT 48,
    inactive_hours        INT NOT NULL DEFAULT 62,
    ticket_subjects       JSON NOT NULL DEFAULT ('[]'),
    webhook_url                VARCHAR(500) DEFAULT NULL,
    webhook_secret             VARCHAR(255) DEFAULT NULL,
    reply_rate_limit_seconds   INT NOT NULL DEFAULT 30,
    weekly_report_channel_id   VARCHAR(32) DEFAULT NULL,
    spam_alert_channel_id      VARCHAR(32) DEFAULT NULL,
    escalation_alert_channel_id VARCHAR(32) DEFAULT NULL,
    escalation_alert_hours     INT NOT NULL DEFAULT 24,
    escalation_close_hours     INT NOT NULL DEFAULT 72,
    faq_enabled               TINYINT(1) NOT NULL DEFAULT 0,
    intake_form_enabled       TINYINT(1) NOT NULL DEFAULT 0,
    staff_reminder_enabled    TINYINT(1) NOT NULL DEFAULT 0,
    staff_reminder_hours      INT NOT NULL DEFAULT 4,
    user_inactive_enabled     TINYINT(1) NOT NULL DEFAULT 0,
    user_inactive_warn_hours  INT NOT NULL DEFAULT 24,
    user_inactive_close_hours INT NOT NULL DEFAULT 72,
    internal_notes_enabled    TINYINT(1) NOT NULL DEFAULT 1,
    badges_enabled            TINYINT(1) NOT NULL DEFAULT 0,
    monthly_goals_enabled     TINYINT(1) NOT NULL DEFAULT 0,
    leaderboard_enabled       TINYINT(1) NOT NULL DEFAULT 1,
    webhooks_enabled          TINYINT(1) NOT NULL DEFAULT 0,
    webhook_events            JSON NOT NULL DEFAULT ('["ticket_open","ticket_close","ticket_claim"]'),
    api_keys_enabled          TINYINT(1) NOT NULL DEFAULT 0,
    updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS intake_forms (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    subject    VARCHAR(100) DEFAULT NULL,
    active     TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS intake_form_fields (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    form_id    INT NOT NULL,
    label      VARCHAR(100) NOT NULL,
    field_type ENUM('text','number','choice') NOT NULL DEFAULT 'text',
    choices    JSON DEFAULT NULL,
    required   TINYINT(1) NOT NULL DEFAULT 1,
    position   INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_iff_form FOREIGN KEY (form_id) REFERENCES intake_forms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS staff_notes (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id  INT NOT NULL,
    author_id  VARCHAR(32) NOT NULL,
    author_tag VARCHAR(100) NOT NULL,
    content    TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sn_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS monthly_goals (
    id      INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(32) NOT NULL,
    year    SMALLINT NOT NULL,
    month   TINYINT NOT NULL,
    target  INT NOT NULL DEFAULT 50,
    UNIQUE KEY uniq_goal (user_id, year, month)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    key_hash     VARCHAR(255) NOT NULL UNIQUE,
    key_prefix   VARCHAR(8) NOT NULL,
    permissions  JSON NOT NULL DEFAULT ('[]'),
    created_by   VARCHAR(32) NOT NULL,
    last_used_at DATETIME DEFAULT NULL,
    expires_at   DATETIME DEFAULT NULL,
    active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ticket_panels (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    channel_id   VARCHAR(20) DEFAULT NULL,
    message_id   VARCHAR(20) DEFAULT NULL,
    title        VARCHAR(256) NOT NULL DEFAULT 'Support',
    description  TEXT DEFAULT NULL,
    color        VARCHAR(7) NOT NULL DEFAULT '#6366f1',
    footer_text  VARCHAR(256) DEFAULT NULL,
    image_url    VARCHAR(512) DEFAULT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS panel_buttons (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    panel_id  INT NOT NULL,
    label     VARCHAR(80) NOT NULL,
    emoji     VARCHAR(50) DEFAULT NULL,
    style     ENUM('primary','secondary','success','danger') NOT NULL DEFAULT 'primary',
    subject   VARCHAR(100) DEFAULT NULL,
    form_id   INT DEFAULT NULL,
    position  INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_pb_panel FOREIGN KEY (panel_id) REFERENCES ticket_panels(id) ON DELETE CASCADE,
    CONSTRAINT fk_pb_form  FOREIGN KEY (form_id)  REFERENCES intake_forms(id)  ON DELETE SET NULL
  );
`;

async function ensureTenantSchema(guildId) {
  const cfg = require('./config').config.database;
  const dbName = getDbName(guildId);

  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    multipleStatements: true
  });

  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(`USE \`${dbName}\``);
    await conn.query(TENANT_TABLES_SQL);

    // Migrations for existing tenant DBs
    const migrations = [
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
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS badges_enabled TINYINT(1) NOT NULL DEFAULT 0`,
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
      // Discord DM when someone else assigns you a ticket (profile setting)
      `ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS notify_assign_dm TINYINT(1) NOT NULL DEFAULT 1`,
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
      // Language of the messages sent to members (utils/i18n.js)
      `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS bot_language ENUM('fr','en','auto') NOT NULL DEFAULT 'fr'`,
      // Automatic FAQ shown in DM before a ticket is opened (utils/faq.js)
      `CREATE TABLE IF NOT EXISTS faq_entries (
        id INT AUTO_INCREMENT PRIMARY KEY, question VARCHAR(200) NOT NULL, answer TEXT NOT NULL,
        keywords VARCHAR(500) NOT NULL DEFAULT '', active TINYINT(1) NOT NULL DEFAULT 1,
        shown_count INT NOT NULL DEFAULT 0, solved_count INT NOT NULL DEFAULT 0,
        created_by_tag VARCHAR(100) DEFAULT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    ];
    for (const m of migrations) await conn.query(m).catch(() => null);

    // Seed default guild_config row
    await conn.query(`
      INSERT IGNORE INTO guild_config (id) VALUES (1)
    `);

    logger.info('Tenant schema ready', { guildId, dbName });
  } finally {
    await conn.end();
  }
}

module.exports = { ensureTenantSchema };

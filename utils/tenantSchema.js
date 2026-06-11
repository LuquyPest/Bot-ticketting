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
    last_message_at     DATETIME DEFAULT NULL,
    first_response_at   DATETIME DEFAULT NULL,
    warned_inactive     TINYINT(1) NOT NULL DEFAULT 0,
    escalation_alerted  TINYINT(1) NOT NULL DEFAULT 0,
    visibility_grade_id INT DEFAULT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at           DATETIME DEFAULT NULL,
    closed_by_tag       VARCHAR(100) DEFAULT NULL
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
    closed_by_id VARCHAR(32) NOT NULL,
    rating       TINYINT NOT NULL,
    rated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_rating (ticket_id, owner_id),
    CONSTRAINT fk_tr_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS dashboard_users (
    user_id           VARCHAR(32) PRIMARY KEY,
    username          VARCHAR(100) NOT NULL,
    avatar            VARCHAR(64) DEFAULT NULL,
    role              ENUM('nouveau','support','fondateur') NOT NULL DEFAULT 'nouveau',
    discord_has_role  TINYINT(1) NOT NULL DEFAULT 0,
    staff_role_id     INT DEFAULT NULL,
    approved_by       VARCHAR(32) DEFAULT NULL,
    approved_at       DATETIME DEFAULT NULL,
    vacation_mode     TINYINT(1) NOT NULL DEFAULT 0,
    first_login       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
    target_type VARCHAR(50) DEFAULT NULL,
    target_id   VARCHAR(50) DEFAULT NULL,
    details     JSON DEFAULT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

  CREATE TABLE IF NOT EXISTS staff_roles (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    name             VARCHAR(80) NOT NULL,
    discord_role_ids JSON NOT NULL DEFAULT ('[]'),
    level            INT NOT NULL DEFAULT 1,
    permissions      JSON NOT NULL DEFAULT ('[]'),
    is_founder_role  TINYINT(1) NOT NULL DEFAULT 0,
    color            VARCHAR(7) NOT NULL DEFAULT '#6366f1',
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guild_config (
    id                    INT AUTO_INCREMENT PRIMARY KEY,
    ticket_category_id    VARCHAR(32) DEFAULT NULL,
    support_role_ids      JSON NOT NULL DEFAULT ('[]'),
    chief_role_ids        JSON NOT NULL DEFAULT ('[]'),
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
    reply_rate_limit_seconds   INT NOT NULL DEFAULT 30,
    weekly_report_channel_id   VARCHAR(32) DEFAULT NULL,
    spam_alert_channel_id      VARCHAR(32) DEFAULT NULL,
    escalation_alert_channel_id VARCHAR(32) DEFAULT NULL,
    escalation_alert_hours     INT NOT NULL DEFAULT 24,
    escalation_close_hours     INT NOT NULL DEFAULT 72,
    updated_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  );
`;

async function ensureTenantSchema(guildId) {
  const cfg = require('../config.json').database;
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

    // Seed default guild_config row
    await conn.query(`
      INSERT IGNORE INTO guild_config (id) VALUES (1)
    `);

    logger.info('Tenant schema ready', { guildId, dbName });
  } finally {
    await conn.end();
  }
}

module.exports = { ensureTenantSchema, TENANT_TABLES_SQL };

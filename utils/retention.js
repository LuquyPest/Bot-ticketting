// Data retention: purges old logs (global + per guild) and old transcripts. Runs daily
// (utils/jobQueue.js). Durations (days) come from config.json → "retention" or, for transcripts,
// TRANSCRIPT_RETENTION_DAYS; 0 disables a purge (transcripts are kept forever by default).
const { globalQuery } = require('./globalDb');
const { getTenantDb } = require('./tenantDb');
const logger = require('./logger');

const DEFAULTS = {
  loginLogsDays: 90,    // dashboard logins (contain IP addresses)
  errorLogsDays: 30,
  auditLogDays: 365,    // per-guild activity journal
  sessionsDays: 7,      // session tracking rows (sessions themselves expire after 24 h)
  instanceAuditDays: 730, // journal of the instance section
  transcriptDays: 0,    // closed tickets' transcripts
};

function retentionSettings() {
  const { config } = require('./config');
  return { ...DEFAULTS, ...(config.retention || {}) };
}

async function purge(query, table, column, days) {
  if (!days || days <= 0) return 0;
  const r = await query(`DELETE FROM ${table} WHERE ${column} < DATE_SUB(NOW(), INTERVAL ? DAY)`, [days]);
  return r.affectedRows || 0;
}

async function runRetentionPurge() {
  const s = retentionSettings();
  const report = {
    login_logs:   await purge(globalQuery, 'login_logs', 'created_at', s.loginLogsDays),
    error_logs:   await purge(globalQuery, 'error_logs', 'created_at', s.errorLogsDays),
    user_sessions: await purge(globalQuery, 'user_sessions', 'last_seen_at', s.sessionsDays),
    instance_audit_log: await purge(globalQuery, 'instance_audit_log', 'created_at', s.instanceAuditDays),
    audit_log: 0,
    transcripts: 0,
  };

  const guilds = await globalQuery('SELECT guild_id FROM guilds WHERE status IN ("active", "suspended")');
  for (const g of guilds) {
    try {
      const db = getTenantDb(g.guild_id);
      report.audit_log += await purge(db, 'audit_log', 'created_at', s.auditLogDays);
      report.transcripts += await purge(db, 'transcript_snapshots', 'created_at', s.transcriptDays);
    } catch (err) {
      logger.error('retention purge error', { guildId: g.guild_id, err: err.message });
    }
  }
  logger.info('Purge de rétention', report);
  return report;
}

module.exports = { runRetentionPurge, DEFAULTS };

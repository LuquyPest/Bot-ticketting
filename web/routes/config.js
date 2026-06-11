const express = require('express');
const router = express.Router();
const { logAudit } = require('../../utils/gradePermissions');

// Allowed fields and their DB column names (all stored in guild_config table)
const FIELD_MAP = {
  ticketPrefix:              'ticket_prefix',
  welcomeMessage:            'welcome_message',
  closeMessage:              'close_message',
  ticketSubjects:            'ticket_subjects',
  maxTicketsPerDay:          'max_tickets_per_day',
  inactiveWarningHours:      'inactive_warning_hours',
  inactiveHours:             'inactive_hours',
  replyRateLimitSeconds:     'reply_rate_limit_seconds',
  ticketCategoryId:          'ticket_category_id',
  supportRoleIds:            'support_role_ids',
  chiefRoleIds:              'chief_role_ids',
  closeLogChannelId:         'close_log_channel_id',
  claimLogChannelId:         'claim_log_channel_id',
  moveLogChannelId:          'move_log_channel_id',
  addUserLogChannelId:       'add_user_log_channel_id',
  removeUserLogChannelId:    'remove_user_log_channel_id',
  weeklyReportChannelId:     'weekly_report_channel_id',
  spamAlertChannelId:        'spam_alert_channel_id',
  escalationAlertChannelId:  'escalation_alert_channel_id',
  escalationAlertHours:      'escalation_alert_hours',
  escalationCloseHours:      'escalation_close_hours',
  embedColor:                'embed_color',
  botDisplayName:            'bot_display_name',
  webhookUrl:                'webhook_url',
  webhookSecret:             'webhook_secret',
  // Phase 1 — feature flags
  faqEnabled:               'faq_enabled',
  intakeFormEnabled:        'intake_form_enabled',
  staffReminderEnabled:     'staff_reminder_enabled',
  staffReminderHours:       'staff_reminder_hours',
  userInactiveEnabled:      'user_inactive_enabled',
  userInactiveWarnHours:    'user_inactive_warn_hours',
  userInactiveCloseHours:   'user_inactive_close_hours',
  internalNotesEnabled:     'internal_notes_enabled',
  badgesEnabled:            'badges_enabled',
  monthlyGoalsEnabled:      'monthly_goals_enabled',
  leaderboardEnabled:       'leaderboard_enabled',
  webhooksEnabled:          'webhooks_enabled',
  webhookEvents:            'webhook_events',
  apiKeysEnabled:           'api_keys_enabled',
};

const SNOWFLAKE = v => v === null || v === '' || (typeof v === 'string' && /^\d{17,20}$/.test(v));
const SNOWFLAKE_ARRAY = v => Array.isArray(v) && v.every(id => typeof id === 'string' && /^\d{17,20}$/.test(id));

const VALIDATORS = {
  ticketPrefix:             v => typeof v === 'string' && v.length >= 1 && v.length <= 50,
  welcomeMessage:           v => v === null || (typeof v === 'string' && v.length <= 2000),
  closeMessage:             v => v === null || (typeof v === 'string' && v.length <= 2000),
  ticketSubjects:           v => Array.isArray(v) && v.length <= 25 && v.every(s => typeof s === 'string' && s.length <= 100),
  maxTicketsPerDay:         v => Number.isInteger(v) && v >= 1 && v <= 100,
  inactiveWarningHours:     v => Number.isInteger(v) && v >= 1 && v <= 720,
  inactiveHours:            v => Number.isInteger(v) && v >= 1 && v <= 720,
  replyRateLimitSeconds:    v => Number.isInteger(v) && v >= 0 && v <= 300,
  ticketCategoryId:         SNOWFLAKE,
  supportRoleIds:           SNOWFLAKE_ARRAY,
  chiefRoleIds:             SNOWFLAKE_ARRAY,
  closeLogChannelId:        SNOWFLAKE,
  claimLogChannelId:        SNOWFLAKE,
  moveLogChannelId:         SNOWFLAKE,
  addUserLogChannelId:      SNOWFLAKE,
  removeUserLogChannelId:   SNOWFLAKE,
  weeklyReportChannelId:    SNOWFLAKE,
  spamAlertChannelId:       SNOWFLAKE,
  escalationAlertChannelId: SNOWFLAKE,
  escalationAlertHours:     v => Number.isInteger(v) && v >= 1 && v <= 48,
  escalationCloseHours:     v => Number.isInteger(v) && v >= 1 && v <= 168,
  embedColor:               v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v),
  botDisplayName:           v => typeof v === 'string' && v.length >= 1 && v.length <= 100,
  webhookUrl:               v => v === null || (typeof v === 'string' && v.length <= 500 && /^https:\/\/.{3,}/.test(v)),
  webhookSecret:            v => v === null || (typeof v === 'string' && v.length >= 16 && v.length <= 255),
  // Phase 1 — feature flags
  faqEnabled:               v => v === 0 || v === 1 || v === true || v === false,
  intakeFormEnabled:        v => v === 0 || v === 1 || v === true || v === false,
  staffReminderEnabled:     v => v === 0 || v === 1 || v === true || v === false,
  staffReminderHours:       v => Number.isInteger(v) && v >= 1 && v <= 168,
  userInactiveEnabled:      v => v === 0 || v === 1 || v === true || v === false,
  userInactiveWarnHours:    v => Number.isInteger(v) && v >= 1 && v <= 720,
  userInactiveCloseHours:   v => Number.isInteger(v) && v >= 1 && v <= 720,
  internalNotesEnabled:     v => v === 0 || v === 1 || v === true || v === false,
  badgesEnabled:            v => v === 0 || v === 1 || v === true || v === false,
  monthlyGoalsEnabled:      v => v === 0 || v === 1 || v === true || v === false,
  leaderboardEnabled:       v => v === 0 || v === 1 || v === true || v === false,
  webhooksEnabled:          v => v === 0 || v === 1 || v === true || v === false,
  webhookEvents:            v => Array.isArray(v) && v.every(e => typeof e === 'string' && e.length <= 50),
  apiKeysEnabled:           v => v === 0 || v === 1 || v === true || v === false,
};

// Fields stored as JSON in the DB
const JSON_FIELDS = new Set(['ticket_subjects', 'support_role_ids', 'chief_role_ids', 'webhook_events']);

function dbRow2Api(row) {
  const out = {};
  for (const [apiKey, dbCol] of Object.entries(FIELD_MAP)) {
    if (dbCol in row) {
      let val = row[dbCol];
      if (JSON_FIELDS.has(dbCol) && typeof val === 'string') {
        try { val = JSON.parse(val); } catch { val = []; }
      }
      out[apiKey] = val;
    }
  }
  return out;
}

router.get('/', async (req, res) => {
  try {
    const [cfg] = await req.guildDb('SELECT * FROM guild_config LIMIT 1');
    res.json(cfg ? dbRow2Api(cfg) : {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/', async (req, res) => {
  if (!req.userIsFondateur && !req.userPermissions?.has('manage_settings')) {
    return res.status(403).json({ error: 'Permission insuffisante' });
  }
  try {
    const updates = req.body;
    const setClauses = [];
    const params = [];

    for (const [apiKey, dbCol] of Object.entries(FIELD_MAP)) {
      if (!(apiKey in updates)) continue;
      const validator = VALIDATORS[apiKey];
      if (validator && !validator(updates[apiKey])) {
        return res.status(400).json({ error: `Valeur invalide pour le champ "${apiKey}"` });
      }
      const val = JSON_FIELDS.has(dbCol) ? JSON.stringify(updates[apiKey]) : (updates[apiKey] ?? null);
      setClauses.push(`${dbCol} = ?`);
      params.push(val);
    }

    if (!setClauses.length) return res.json({ ok: true });

    params.push(1); // WHERE id = 1
    await req.guildDb(`UPDATE guild_config SET ${setClauses.join(', ')} WHERE id = ?`, params);

    await logAudit(
      req.session.user.id, req.session.user.username,
      'config_update', 'guild_config', req.guildId,
      Object.fromEntries(Object.keys(updates).filter(k => k in FIELD_MAP).map(k => [k, updates[k]])),
      req.guildDb
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

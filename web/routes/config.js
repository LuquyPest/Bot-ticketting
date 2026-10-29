const express = require('express');
const router = express.Router();
const { parseJsonField } = require('../../utils/jsonField');
const { logAudit } = require('../../utils/gradePermissions');
const { foreignChannels, foreignRoles } = require('../../utils/discordGuard');
const { diffConfig, recordHistory, listHistory, restorePlan } = require('../../utils/configHistory');

const CHANNEL_FIELDS = ['ticketCategoryId', 'waitingCategoryId', 'inProgressCategoryId', 'threadParentChannelId', 'closeLogChannelId', 'claimLogChannelId', 'moveLogChannelId', 'addUserLogChannelId',
  'removeUserLogChannelId', 'weeklyReportChannelId', 'monthlyReportChannelId', 'spamAlertChannelId', 'escalationAlertChannelId'];
const ROLE_FIELDS = ['supportRoleIds', 'chiefRoleIds'];
// Never written to the audit log in clear
// Never written to the history in clear (the logo: too large to keep every version)
const SECRET_FIELDS = new Set(['webhookSecret', 'portalLogo']);

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
  waitingCategoryId:         'waiting_category_id',
  inProgressCategoryId:      'in_progress_category_id',
  ticketMode:                'ticket_mode',
  threadParentChannelId:     'thread_parent_channel_id',
  healthAlertsEnabled:       'health_alerts_enabled',
  slaOpenHours:              'sla_open_hours',
  slaWaitingHours:           'sla_waiting_hours',
  slaInProgressHours:        'sla_in_progress_hours',
  supportRoleIds:            'support_role_ids',
  chiefRoleIds:              'chief_role_ids',
  supportGradeId:            'support_grade_id',
  chiefGradeId:              'chief_grade_id',
  closeLogChannelId:         'close_log_channel_id',
  claimLogChannelId:         'claim_log_channel_id',
  moveLogChannelId:          'move_log_channel_id',
  addUserLogChannelId:       'add_user_log_channel_id',
  removeUserLogChannelId:    'remove_user_log_channel_id',
  weeklyReportChannelId:     'weekly_report_channel_id',
  monthlyReportChannelId:    'monthly_report_channel_id',
  spamAlertChannelId:        'spam_alert_channel_id',
  escalationAlertChannelId:  'escalation_alert_channel_id',
  escalationAlertHours:      'escalation_alert_hours',
  escalationCloseHours:      'escalation_close_hours',
  botLanguage:               'bot_language',
  require2fa:                'require_2fa',
  memberReopenDays:          'member_reopen_days',
  notifyMemberStage:         'notify_member_stage',
  lowRatingThreshold:        'low_rating_threshold',
  memberPortalEnabled:       'member_portal_enabled',
  portalLogo:                'portal_logo',
  portalColor:               'portal_color',
  portalWelcome:             'portal_welcome',
  webhookUrl:                'webhook_url',
  webhookSecret:             'webhook_secret',
  // Phase 1 — feature flags
  intakeFormEnabled:        'intake_form_enabled',
  staffReminderEnabled:     'staff_reminder_enabled',
  staffReminderHours:       'staff_reminder_hours',
  userInactiveEnabled:      'user_inactive_enabled',
  userInactiveWarnHours:    'user_inactive_warn_hours',
  userInactiveCloseHours:   'user_inactive_close_hours',
  internalNotesEnabled:     'internal_notes_enabled',
  monthlyGoalsEnabled:      'monthly_goals_enabled',
  leaderboardEnabled:       'leaderboard_enabled',
  webhooksEnabled:          'webhooks_enabled',
  webhookEvents:            'webhook_events',
  apiKeysEnabled:           'api_keys_enabled',
  // Phase 3
  subjectWelcomeMessages:   'subject_welcome_messages',
  ipAllowlist:              'ip_allowlist',
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
  waitingCategoryId:        SNOWFLAKE,
  inProgressCategoryId:     SNOWFLAKE,
  ticketMode:               v => ['channel', 'thread'].includes(v),
  threadParentChannelId:    SNOWFLAKE,
  healthAlertsEnabled:      v => v === 0 || v === 1 || v === true || v === false,
  slaOpenHours:             v => Number.isInteger(v) && v >= 0 && v <= 720,
  slaWaitingHours:          v => Number.isInteger(v) && v >= 0 && v <= 720,
  slaInProgressHours:       v => Number.isInteger(v) && v >= 0 && v <= 720,
  supportRoleIds:           SNOWFLAKE_ARRAY,
  chiefRoleIds:             SNOWFLAKE_ARRAY,
  supportGradeId:           v => v === null || (Number.isInteger(v) && v > 0),
  chiefGradeId:             v => v === null || (Number.isInteger(v) && v > 0),
  closeLogChannelId:        SNOWFLAKE,
  claimLogChannelId:        SNOWFLAKE,
  moveLogChannelId:         SNOWFLAKE,
  addUserLogChannelId:      SNOWFLAKE,
  removeUserLogChannelId:   SNOWFLAKE,
  weeklyReportChannelId:    SNOWFLAKE,
  monthlyReportChannelId:   SNOWFLAKE,
  spamAlertChannelId:       SNOWFLAKE,
  escalationAlertChannelId: SNOWFLAKE,
  escalationAlertHours:     v => Number.isInteger(v) && v >= 1 && v <= 48,
  escalationCloseHours:     v => Number.isInteger(v) && v >= 1 && v <= 168,
  botLanguage:              v => ['fr', 'en', 'auto'].includes(v),
  require2fa:               v => ['none', 'founders', 'staff'].includes(v),
  memberReopenDays:         v => Number.isInteger(v) && v >= 0 && v <= 90,
  notifyMemberStage:        v => v === 0 || v === 1 || v === true || v === false,
  lowRatingThreshold:       v => Number.isInteger(v) && v >= 0 && v <= 4,
  memberPortalEnabled:      v => v === 0 || v === 1 || v === true || v === false,
  // Member space branding: a small image embedded as a data URL (resized in the browser), so no
  // external host is needed and the CSP stays closed
  portalLogo:               v => v === null || (typeof v === 'string' && v.length <= 200_000 && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v)),
  portalColor:              v => v === null || (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)),
  portalWelcome:            v => v === null || (typeof v === 'string' && v.length <= 500),
  webhookUrl:               v => v === null || (typeof v === 'string' && v.length <= 500 && /^https:\/\/.{3,}/.test(v)),
  webhookSecret:            v => v === null || (typeof v === 'string' && v.length >= 16 && v.length <= 255),
  // Phase 1 — feature flags
  intakeFormEnabled:        v => v === 0 || v === 1 || v === true || v === false,
  staffReminderEnabled:     v => v === 0 || v === 1 || v === true || v === false,
  staffReminderHours:       v => Number.isInteger(v) && v >= 1 && v <= 168,
  userInactiveEnabled:      v => v === 0 || v === 1 || v === true || v === false,
  userInactiveWarnHours:    v => Number.isInteger(v) && v >= 1 && v <= 720,
  userInactiveCloseHours:   v => Number.isInteger(v) && v >= 1 && v <= 720,
  internalNotesEnabled:     v => v === 0 || v === 1 || v === true || v === false,
  monthlyGoalsEnabled:      v => v === 0 || v === 1 || v === true || v === false,
  leaderboardEnabled:       v => v === 0 || v === 1 || v === true || v === false,
  webhooksEnabled:          v => v === 0 || v === 1 || v === true || v === false,
  webhookEvents:            v => Array.isArray(v) && v.every(e => typeof e === 'string' && e.length <= 50),
  apiKeysEnabled:           v => v === 0 || v === 1 || v === true || v === false,
  // Phase 3
  subjectWelcomeMessages:   v => typeof v === 'object' && v !== null && !Array.isArray(v) &&
                                 Object.entries(v).every(([k, msg]) =>
                                   typeof k === 'string' && k.length <= 100 &&
                                   (msg === null || (typeof msg === 'string' && msg.length <= 2000))
                                 ),
  ipAllowlist:              v => Array.isArray(v) && v.length <= 50 && v.every(cidr =>
                                   typeof cidr === 'string' && cidr.length <= 50
                                 ),
};

// Fields stored as JSON in the DB
const JSON_FIELDS = new Set(['ticket_subjects', 'support_role_ids', 'chief_role_ids', 'webhook_events', 'subject_welcome_messages', 'ip_allowlist']);

function dbRow2Api(row) {
  const out = {};
  for (const [apiKey, dbCol] of Object.entries(FIELD_MAP)) {
    if (dbCol in row) {
      let val = row[dbCol];
      if (JSON_FIELDS.has(dbCol)) val = parseJsonField(val, dbCol === 'subject_welcome_messages' ? {} : []);
      out[apiKey] = val;
    }
  }
  return out;
}

// GET /api/config/export — the whole configuration as a JSON file (no secrets)
router.get('/export', async (req, res) => {
  try {
    const data = await require('../../utils/configTransfer').exportConfig(req.guildDb);
    data.guildName = req.guild?.guild_name || null;
    await logAudit(req.session.user.id, req.session.user.username, 'config_export', 'guild', req.guildId, null, req.guildDb);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="configuration-${req.guildId}.json"`);
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/config/import { data, includeDiscordIds } — merges by name, never deletes
router.post('/import', async (req, res) => {
  try {
    // Imported settings go through the same checks as the Settings page: valid values, channels
    // and roles of this server only (a file could otherwise point the bot at another server)
    const byColumn = Object.fromEntries(Object.entries(FIELD_MAP).map(([api, col]) => [col, api]));
    const applyConfig = async cols => {
      const updates = {};
      for (const [col, v] of Object.entries(cols)) if (byColumn[col] && byColumn[col] !== 'require2fa') updates[byColumn[col]] = v;
      if (!Object.keys(updates).length) return { ok: true, count: 0 };
      const r = await applyConfigUpdates(req, updates, { source: 'import' });
      return r.error ? r : { ok: true, count: Object.keys(updates).length };
    };
    const report = await require('../../utils/configTransfer').importConfig(req.guildDb, req.body?.data, {
      includeDiscordIds: !!req.body?.includeDiscordIds, actor: req.session.user, applyConfig,
    });
    require('../../utils/i18n').clearGuildLanguageCache(req.guildId);
    await logAudit(req.session.user.id, req.session.user.username, 'config_import', 'guild', req.guildId, { report, includeDiscordIds: !!req.body?.includeDiscordIds }, req.guildDb);
    res.json({ ok: true, report });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/', async (req, res) => {
  try {
    const [cfg] = await req.guildDb('SELECT * FROM guild_config LIMIT 1');
    res.json(cfg ? dbRow2Api(cfg) : {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

async function snapshot(db) {
  const [cfg] = await db('SELECT * FROM guild_config WHERE id = 1');
  return cfg ? dbRow2Api(cfg) : {};
}

// Validates and writes settings, then records the change in the history and the audit log.
// Returns { error, status } on refusal, { ok, historyId } otherwise.
async function applyConfigUpdates(req, updates, { source = 'settings', restoredFrom = null } = {}) {
  const setClauses = [];
  const params = [];

  // Requiring 2FA: the founder setting it must have it, or they would lock themselves out
  if (updates.require2fa && updates.require2fa !== 'none'
      && !(await require('../../utils/twoFactorPolicy').hasTotp(req.session.user.id))) {
    return { status: 400, error: 'Active d\'abord la double authentification sur ton compte (Profil)' };
  }

  for (const [apiKey, dbCol] of Object.entries(FIELD_MAP)) {
    if (!(apiKey in updates)) continue;
    const validator = VALIDATORS[apiKey];
    if (validator && !validator(updates[apiKey])) {
      return { status: 400, error: `Valeur invalide pour le champ "${apiKey}"` };
    }
    const val = JSON_FIELDS.has(dbCol) ? JSON.stringify(updates[apiKey]) : (updates[apiKey] ?? null);
    setClauses.push(`${dbCol} = ?`);
    params.push(val);
  }

  if (!setClauses.length) return { ok: true, historyId: null };

  for (const k of ['supportGradeId', 'chiefGradeId']) {
    if (updates[k] && !(await req.guildDb('SELECT 1 FROM grades WHERE id = ?', [updates[k]])).length) {
      return { status: 400, error: 'Grade introuvable' };
    }
  }

  // Channel/role IDs must belong to this guild (the bot would otherwise post in another server)
  const client = req.app.locals.client;
  if (client) {
    const channelIds = CHANNEL_FIELDS.filter(k => k in updates).map(k => updates[k]).filter(Boolean);
    if ((await foreignChannels(client, req.guildId, channelIds)).length) {
      return { status: 400, error: 'Un des salons choisis n\'appartient pas à ce serveur' };
    }
    const roleIds = ROLE_FIELDS.filter(k => k in updates).flatMap(k => updates[k]);
    if ((await foreignRoles(client, req.guildId, roleIds)).length) {
      return { status: 400, error: 'Un des rôles choisis n\'appartient pas à ce serveur' };
    }
  }

  // Thread mode: tickets are private threads of a text channel, which must then be chosen
  if ('ticketMode' in updates || 'threadParentChannelId' in updates) {
    const [cur] = await req.guildDb('SELECT ticket_mode, thread_parent_channel_id FROM guild_config WHERE id = 1');
    const mode = updates.ticketMode ?? cur?.ticket_mode;
    const parentId = 'threadParentChannelId' in updates ? updates.threadParentChannelId : cur?.thread_parent_channel_id;
    if (mode === 'thread') {
      if (!parentId) return { status: 400, error: 'Choisis le salon dans lequel les fils de tickets seront créés' };
      const parent = client ? await require('../../utils/discordGuard').fetchGuildChannel(client, req.guildId, parentId) : null;
      if (client && parent?.type !== require('discord.js').ChannelType.GuildText) return { status: 400, error: 'Le salon des fils doit être un salon textuel' };
    }
  }

  const before = await snapshot(req.guildDb);
  params.push(1); // WHERE id = 1
  await req.guildDb(`UPDATE guild_config SET ${setClauses.join(', ')} WHERE id = ?`, params);
  require('../../utils/i18n').clearGuildLanguageCache(req.guildId);
  const changes = diffConfig(before, await snapshot(req.guildDb), SECRET_FIELDS);
  const historyId = await recordHistory(req.guildDb, req.session.user, changes, { source, restoredFrom });

  await logAudit(
    req.session.user.id, req.session.user.username,
    source === 'restore' ? 'config_restore' : 'config_update', 'guild_config', req.guildId,
    Object.fromEntries(Object.keys(updates).filter(k => k in FIELD_MAP)
      .map(k => [k, SECRET_FIELDS.has(k) && updates[k] ? '[modifié]' : updates[k]])),
    req.guildDb
  );
  return { ok: true, historyId };
}

const canManage = req => req.userIsFondateur || req.userPermissions?.has('manage_settings');

router.patch('/', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const r = await applyConfigUpdates(req, req.body || {});
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/config/history?page= — who changed which setting, with before/after values
router.get('/history', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const page = Math.max(1, Math.min(100, parseInt(req.query.page) || 1));
    res.json(await listHistory(req.guildDb, { page }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/config/history/:id/restore — back to the state just before that change (undoes it
// and every later change); secret fields are left as they are
router.post('/history/:id/restore', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Permission insuffisante' });
  try {
    const id = parseInt(req.params.id);
    const plan = id > 0 && await restorePlan(req.guildDb, id);
    if (!plan) return res.status(404).json({ error: 'Version introuvable' });
    const current = await snapshot(req.guildDb);
    const updates = Object.fromEntries(Object.entries(plan.updates).filter(([k, v]) => k in FIELD_MAP && JSON.stringify(current[k] ?? null) !== JSON.stringify(v ?? null)));
    if (!Object.keys(updates).length) return res.json({ ok: true, restored: [], skipped: plan.skipped, message: 'Les paramètres sont déjà dans cet état' });
    const r = await applyConfigUpdates(req, updates, { source: 'restore', restoredFrom: id });
    if (r.error) return res.status(r.status).json({ error: `Restauration impossible : ${r.error}` });
    res.json({ ok: true, restored: Object.keys(updates), skipped: plan.skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/bot-identity', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  const client = req.app.get('botClient');
  if (!client?.isReady()) return res.status(503).json({ error: 'Bot non connecté' });
  try {
    const guild = await client.guilds.fetch(req.guildId).catch(() => null);
    if (!guild) return res.status(404).json({ error: 'Serveur Discord introuvable' });
    // Not cached yet right after startup: fetched
    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!me) return res.status(503).json({ error: 'Bot introuvable sur ce serveur' });
    res.json({
      username:    client.user.username,
      nickname:    me.nickname || null,
      displayName: me.displayName,
      avatarUrl:   me.displayAvatarURL({ size: 256, extension: 'png' }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/config/bot-identity — change le pseudo et/ou l'avatar per-guild (fondateur)
router.patch('/bot-identity', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  const client = req.app.get('botClient');
  if (!client?.isReady()) return res.status(503).json({ error: 'Bot non connecté' });

  const { nickname, avatarDataUrl } = req.body;
  if (nickname !== undefined && typeof nickname !== 'string' && nickname !== null)
    return res.status(400).json({ error: 'nickname doit être une chaîne ou null' });
  if (nickname !== undefined && nickname !== null && nickname.length > 32)
    return res.status(400).json({ error: 'nickname trop long (max 32 caractères)' });
  if (avatarDataUrl !== undefined && avatarDataUrl !== null) {
    if (typeof avatarDataUrl !== 'string' || !/^data:image\/(png|jpeg|gif|webp);base64,/.test(avatarDataUrl))
      return res.status(400).json({ error: 'avatarDataUrl invalide (data URI attendu)' });
    // Limite ~2 Mo base64
    if (avatarDataUrl.length > 2_800_000)
      return res.status(400).json({ error: 'Image trop lourde (max 2 Mo)' });
  }

  try {
    const guild = await client.guilds.fetch(req.guildId).catch(() => null);
    if (!guild) return res.status(404).json({ error: 'Serveur Discord introuvable' });

    const errors  = {};
    const results = {};

    if (nickname !== undefined) {
      try {
        await guild.members.me.setNickname(nickname || null, 'Changement via dashboard');
        results.nickname = nickname || null;
      } catch (err) {
        errors.nickname = err.message;
      }
    }

    if (avatarDataUrl !== undefined) {
      try {
        const { Routes } = require('discord.js');
        await client.rest.patch(Routes.guildMember(req.guildId, '@me'), {
          body: { avatar: avatarDataUrl || null },
        });
        results.avatarUpdated = true;
      } catch (err) {
        errors.avatar = err.message;
      }
    }

    if (Object.keys(errors).length) {
      return res.status(400).json({ errors, results });
    }

    await logAudit(
      req.session.user.id, req.session.user.username,
      'bot_identity_update', 'guild', req.guildId,
      { nickname: results.nickname, avatarUpdated: results.avatarUpdated },
      req.guildDb
    );

    res.json({ ok: true, ...results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

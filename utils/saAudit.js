// Journal of the super-admin panel (ticketbot_global.sa_audit_log): every successful change made
// by a super-admin or a manager, with the server concerned. Recorded by a middleware on the SA
// router (web/routes/superadmin.js), so a new route is journaled without extra code.
const { globalQuery } = require('./globalDb');

// "METHOD /route/pattern" -> action
const ACTIONS = {
  'POST /guilds/:guildId/approve': 'guild_approve',
  'PATCH /guilds/:guildId/suspend': 'guild_suspend',
  'PATCH /guilds/:guildId/reactivate': 'guild_reactivate',
  'DELETE /guilds/:guildId': 'guild_delete',
  'PATCH /guilds/:guildId/maintenance': 'guild_maintenance',
  'PATCH /guilds/:guildId/limits': 'guild_limits',
  'PUT /guilds/:guildId/plan': 'guild_plan',
  'POST /guilds/:guildId/founders': 'founder_add',
  'DELETE /guilds/:guildId/founders/:userId': 'founder_remove',
  'POST /blocked/accounts/:type/:id/unlock': 'account_unlock',
  'POST /blocked/ips/unblock': 'ip_unblock',
  'POST /managers': 'manager_create',
  'PATCH /managers/:id': 'manager_update',
  'POST /managers/:id/reset-totp': 'manager_reset_totp',
  'DELETE /managers/:id': 'manager_delete',
  'DELETE /error-logs/:id': 'error_delete',
  'DELETE /error-logs': 'errors_clear',
  'PUT /settings/error-alert': 'error_alert_update',
  'POST /settings/error-alert/test': 'error_alert_test',
  'POST /plans': 'plan_create',
  'PATCH /plans/:id': 'plan_update',
  'DELETE /plans/:id': 'plan_delete',
};

const SECRET_KEYS = /pass|secret|totp|code|token/i;

function cleanDetails(req) {
  const details = {};
  for (const [k, v] of Object.entries(req.params || {})) if (k !== 'guildId') details[k] = v;
  for (const [k, v] of Object.entries(req.body && typeof req.body === 'object' ? req.body : {})) {
    if (SECRET_KEYS.test(k)) { details[k] = '[masqué]'; continue; }
    // Webhook URLs carry their token in the path
    details[k] = typeof v === 'string' && /^https?:\/\//.test(v) ? `${new URL(v).origin}/…` : v;
  }
  if (req.query && Object.keys(req.query).length) details.filters = req.query;
  return Object.keys(details).length ? details : null;
}

function saAuditMiddleware(req, res, next) {
  if (req.method === 'GET' || req.path.startsWith('/auth/')) return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.saUser || !req.route) return;
    const action = ACTIONS[`${req.method} ${req.route.path}`] || `${req.method.toLowerCase()} ${req.route.path}`;
    let details = null;
    try { details = cleanDetails(req); } catch { /* malformed URL in body */ }
    globalQuery(
      'INSERT INTO sa_audit_log (actor_id, actor_name, actor_type, action, guild_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.saUser.id, req.saUser.username, req.saUser.type, action.slice(0, 64), req.params?.guildId || null,
        details ? JSON.stringify(details).slice(0, 4000) : null, (req.ip || '').slice(0, 64)]
    ).catch(() => null);
  });
  next();
}

module.exports = { saAuditMiddleware, ACTIONS };

// Journal of the instance section (ticketbot_global.instance_audit_log): every successful change
// made by the owner, with the server concerned. Recorded by a middleware on the instance router
// (web/routes/instance.js), so a new route is journaled without extra code.
const { globalQuery } = require('./globalDb');

// "METHOD /route/pattern" -> action
const ACTIONS = {
  'POST /guilds': 'space_create',
  'POST /guilds/:guildId/discord/link': 'space_discord_link',
  'POST /guilds/:guildId/discord/unlink': 'space_discord_unlink',
  'PATCH /guilds/:guildId/suspend': 'guild_suspend',
  'PATCH /guilds/:guildId/reactivate': 'guild_reactivate',
  'DELETE /guilds/:guildId': 'guild_delete',
  'PATCH /guilds/:guildId/maintenance': 'guild_maintenance',
  'POST /guilds/:guildId/founders': 'founder_add',
  'DELETE /guilds/:guildId/founders/:userId': 'founder_remove',
  'POST /blocked/ips/unblock': 'ip_unblock',
  'DELETE /error-logs/:id': 'error_delete',
  'DELETE /error-logs': 'errors_clear',
  'PUT /settings/error-alert': 'error_alert_update',
  'POST /settings/error-alert/test': 'error_alert_test',
  'PUT /demo': 'demo_toggle',
  'POST /demo/reset': 'demo_reset',
  'PUT /metrics': 'metrics_toggle',
  'PUT /email': 'instance_email_update',
  'PUT /login-providers': 'login_providers_update',
  'POST /email/test': 'instance_email_test',
  'POST /restore': 'guild_restore_request',
  'POST /restore/:guildId/rollback': 'guild_restore_rollback',
  'DELETE /restore/:guildId/previous': 'guild_restore_drop_prev',
};

const SECRET_KEYS = /pass|secret|totp|code|token/i;

// Secrets masked at any depth (Instance → Connexion sends { google: { clientSecret } })
function cleanValue(k, v, depth = 0) {
  if (SECRET_KEYS.test(k)) return '[masqué]';
  // Webhook URLs carry their token in the path
  if (typeof v === 'string' && /^https?:\/\//.test(v)) return `${new URL(v).origin}/…`;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (depth >= 3) return '[…]';
    return Object.fromEntries(Object.entries(v).map(([k2, v2]) => [k2, cleanValue(k2, v2, depth + 1)]));
  }
  return v;
}

function cleanDetails(req) {
  const details = {};
  for (const [k, v] of Object.entries(req.params || {})) if (k !== 'guildId') details[k] = v;
  for (const [k, v] of Object.entries(req.body && typeof req.body === 'object' ? req.body : {})) details[k] = cleanValue(k, v);
  if (req.query && Object.keys(req.query).length) details.filters = req.query;
  return Object.keys(details).length ? details : null;
}

function instanceAuditMiddleware(req, res, next) {
  if (req.method === 'GET') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.owner || !req.route) return;
    const action = ACTIONS[`${req.method} ${req.route.path}`] || `${req.method.toLowerCase()} ${req.route.path}`;
    let details = null;
    try { details = cleanDetails(req); } catch { /* malformed URL in body */ }
    globalQuery(
      'INSERT INTO instance_audit_log (actor_id, actor_name, action, guild_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [req.owner.id, req.owner.username, action.slice(0, 64), req.params?.guildId || null,
        details ? JSON.stringify(details).slice(0, 4000) : null, (req.ip || '').slice(0, 64)]
    ).catch(() => null);
  });
  next();
}

module.exports = { instanceAuditMiddleware, ACTIONS };

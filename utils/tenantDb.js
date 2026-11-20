const mysql = require('mysql2/promise');

const _pools = new Map();
// DB_TENANT_POOL_SIZE (v6): connections of each space; 10 by default (5 before v6)
const tenantLimit = () => require('./globalDb').poolSize(require('./config').config.database.tenantConnectionLimit, 10);
// All the spaces' pools together: how many, connections open, idle, waiting
function poolsStats() {
  const { statsOf } = require('./globalDb');
  const out = { pools: _pools.size, limit: tenantLimit(), open: 0, idle: 0, waiting: 0, busiest: null };
  for (const [guildId, pool] of _pools) {
    const s = statsOf(pool, out.limit);
    out.open += s.open; out.idle += s.idle; out.waiting += s.waiting;
    if (!out.busiest || s.open - s.idle > out.busiest.inUse) out.busiest = { guildId, inUse: s.open - s.idle, waiting: s.waiting };
  }
  return out;
}

function getDbName(guildId) {
  if (!/^\d{17,20}$/.test(String(guildId))) throw new Error(`guildId invalide: ${guildId}`);
  return `ticketbot_guild_${guildId}`;
}

function _getPool(guildId) {
  if (_pools.has(guildId)) return _pools.get(guildId);
  const cfg = require('./config').config.database;
  const pool = mysql.createPool({
    host:             cfg.host,
    port:             cfg.port,
    user:             cfg.user,
    password:         cfg.password,
    database:         getDbName(guildId),
    waitForConnections: true,
    // Per server: busy servers queue behind it (see the load test); total = servers × limit
    connectionLimit:  tenantLimit(),
    maxIdle:          2,      // idle connections closed beyond 2, after idleTimeout
    idleTimeout:      60000,
    queueLimit:       0,
    charset:          'utf8mb4',
    stringifyObjects: true // objects in params must never expand to `col` = val (SQLi gadget)
  });
  _pools.set(guildId, pool);
  return pool;
}

// An id parsed from bad input (parseInt('x') → NaN) would be written as NaN, a SQL error: it
// becomes NULL, which matches nothing, so the route answers « not found » instead of crashing
const cleanValue = v => (typeof v === 'number' && Number.isNaN(v) ? null : Array.isArray(v) ? v.map(cleanValue) : v);
const cleanParams = params => (Array.isArray(params) ? params.map(cleanValue) : params);

function getTenantDb(guildId) {
  const tenantQuery = async function tenantQuery(sql, params = []) {
    const [result] = await _getPool(guildId).query(sql, cleanParams(params));
    return result;
  };
  tenantQuery.guildId = String(guildId); // for hooks that only receive the query function (utils/audit.js)
  return tenantQuery;
}

async function closeAll() {
  for (const pool of _pools.values()) await pool.end().catch(() => {});
  _pools.clear();
}

// Drops the connections of one server (its tables were swapped by a restore)
async function closeTenant(guildId) {
  const pool = _pools.get(guildId);
  _pools.delete(guildId);
  if (pool) await pool.end().catch(() => {});
}

module.exports = { cleanParams, getTenantDb, getDbName, closeAll, closeTenant, poolsStats };

const mysql = require('mysql2/promise');

let _pool = null;
// A pool size from the configuration: 1 to 200, else the default
const poolSize = (v, def) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 200 ? Number(v) : def);

function getPool() {
  if (_pool) return _pool;
  const cfg = require('./config').config.database;
  _pool = mysql.createPool({
    host:             cfg.host,
    port:             cfg.port,
    user:             cfg.user,
    password:         cfg.password,
    database:         'ticketbot_global',
    waitForConnections: true,
    // DB_POOL_SIZE (v6): shared by every space for the instance tables (sessions, accounts, journal)
    connectionLimit:  poolSize(cfg.poolSize, 20),
    queueLimit:       0,
    charset:          'utf8mb4',
    stringifyObjects: true // objects in params must never expand to `col` = val (SQLi gadget)
  });
  return _pool;
}

async function globalQuery(sql, params = []) {
  const [result] = await getPool().query(sql, require('./tenantDb').cleanParams(params));
  return result;
}

// Connections of a mysql2 pool: open, idle, requests waiting (Instance → Santé, /metrics)
function statsOf(promisePool, limit) {
  const p = promisePool?.pool;
  if (!p) return { limit, open: 0, idle: 0, waiting: 0 };
  return { limit, open: p._allConnections?.length || 0, idle: p._freeConnections?.length || 0, waiting: p._connectionQueue?.length || 0 };
}
function poolStats() {
  const cfg = require('./config').config.database;
  const tenants = require('./tenantDb').poolsStats();
  return { global: statsOf(_pool, poolSize(cfg.poolSize, 20)), tenants };
}

module.exports = { getPool, globalQuery, poolStats, poolSize, statsOf };

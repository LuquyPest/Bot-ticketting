const mysql = require('mysql2/promise');

const _pools = new Map();

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
    connectionLimit:  Number(cfg.tenantConnectionLimit) > 0 ? Number(cfg.tenantConnectionLimit) : 5,
    maxIdle:          2,      // idle connections closed beyond 2, after idleTimeout
    idleTimeout:      60000,
    queueLimit:       0,
    charset:          'utf8mb4',
    stringifyObjects: true // objects in params must never expand to `col` = val (SQLi gadget)
  });
  _pools.set(guildId, pool);
  return pool;
}

function getTenantDb(guildId) {
  return async function tenantQuery(sql, params = []) {
    const [result] = await _getPool(guildId).query(sql, params);
    return result;
  };
}

async function closeAll() {
  for (const pool of _pools.values()) await pool.end().catch(() => {});
  _pools.clear();
}

module.exports = { getTenantDb, getDbName, closeAll };

const mysql = require('mysql2/promise');

const _pools = new Map();

function getDbName(guildId) {
  return `ticketbot_guild_${guildId}`;
}

function _getPool(guildId) {
  if (_pools.has(guildId)) return _pools.get(guildId);
  const cfg = require('../config.json').database;
  const pool = mysql.createPool({
    host:             cfg.host,
    port:             cfg.port,
    user:             cfg.user,
    password:         cfg.password,
    database:         getDbName(guildId),
    waitForConnections: true,
    connectionLimit:  5,
    queueLimit:       0,
    charset:          'utf8mb4'
  });
  _pools.set(guildId, pool);
  return pool;
}

// Returns an async query function bound to this guild's DB
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

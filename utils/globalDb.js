const mysql = require('mysql2/promise');

let _pool = null;

function getPool() {
  if (_pool) return _pool;
  const cfg = require('../config.json').database;
  _pool = mysql.createPool({
    host:             cfg.host,
    port:             cfg.port,
    user:             cfg.user,
    password:         cfg.password,
    database:         'ticketbot_global',
    waitForConnections: true,
    connectionLimit:  10,
    queueLimit:       0,
    charset:          'utf8mb4'
  });
  return _pool;
}

async function globalQuery(sql, params = []) {
  const [result] = await getPool().query(sql, params);
  return result;
}

module.exports = { getPool, globalQuery };

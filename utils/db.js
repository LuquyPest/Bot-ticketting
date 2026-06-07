const mysql = require('mysql2/promise');
const config = require('../config.json');

const pool = mysql.createPool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

async function query(sql, params = []) {
  const [result] = await pool.query(sql, params);
  return result;
}

module.exports = {
  pool,
  query
};

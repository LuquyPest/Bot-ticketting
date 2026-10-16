// Super-admin settings stored in ticketbot_global.sa_settings (one JSON value per key).
const { globalQuery } = require('./globalDb');
const { parseJsonField } = require('./jsonField');

async function getSetting(key, defaults = {}) {
  const [row] = await globalQuery('SELECT v FROM sa_settings WHERE k = ?', [key]).catch(() => []);
  return { ...defaults, ...(row ? parseJsonField(row.v, {}) : {}) };
}

async function setSetting(key, value) {
  await globalQuery(
    'INSERT INTO sa_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
    [key, JSON.stringify(value)]
  );
}

module.exports = { getSetting, setSetting };

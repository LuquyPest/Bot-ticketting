// Instance settings stored in ticketbot_global.instance_settings (one JSON value per key):
// error alert, demonstration server…
const { globalQuery } = require('./globalDb');
const { parseJsonField } = require('./jsonField');

async function getSetting(key, defaults = {}) {
  const [row] = await globalQuery('SELECT v FROM instance_settings WHERE k = ?', [key]).catch(() => []);
  return { ...defaults, ...(row ? parseJsonField(row.v, {}) : {}) };
}

async function setSetting(key, value) {
  await globalQuery(
    'INSERT INTO instance_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
    [key, JSON.stringify(value)]
  );
}

module.exports = { getSetting, setSetting };

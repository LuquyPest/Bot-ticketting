// Global DB pool — ticketbot_global
// Used for: session store, superadmins, managers, guilds registry.
// Per-guild data → use utils/tenantDb.js
const { getPool, globalQuery } = require('./globalDb');

module.exports = { pool: getPool(), query: globalQuery };

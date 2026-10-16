// Per-guild limits set by the super-admin (guilds.max_agents, 0 = unlimited).
const { globalQuery } = require('./globalDb');

// Staff accounts = dashboard users with role support or fondateur.
async function agentCount(db) {
  const [{ n }] = await db("SELECT COUNT(*) AS n FROM dashboard_users WHERE role IN ('support', 'fondateur')");
  return Number(n);
}

// { ok, max, count } — whether one more staff account fits under the guild's max_agents.
async function canAddAgent(db, guildId) {
  const [g] = await globalQuery('SELECT max_agents FROM guilds WHERE guild_id = ?', [guildId]);
  const max = Number(g?.max_agents || 0);
  if (!max) return { ok: true, max: 0, count: null };
  const count = await agentCount(db);
  return { ok: count < max, max, count };
}

const limitMessage = l => `Limite de ${l.max} membres du staff atteinte pour ce serveur (fixée par le super-admin)`;

module.exports = { canAddAgent, agentCount, limitMessage };

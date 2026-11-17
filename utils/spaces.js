// Spaces (v4 PR 7, conception/v4.md §3.1 and §3.2): what used to be « a Discord server » is now a
// space, with or without a Discord server. A space that came from Discord keeps the ID of its
// server; a space created from the dashboard gets an ID of the same shape — 19 digits starting
// with 9, which no Discord server will reach before the 2080s — so that the database name, the
// routes and every place that stores a server ID keep working unchanged.
// Nothing is ever asked to Discord about a space without a Discord server: GuildManager.fetch
// answers « unknown guild » for its ID right away, and its tickets have no channel (« database »).
const crypto = require('crypto');
const { GuildManager } = require('discord.js');
const { globalQuery } = require('./globalDb');

const SPACE_ID_RE = /^9\d{18}$/;
let discordless = new Set();
let loadedAt = 0;
const TTL_MS = 30 * 1000;

async function refresh() {
  const rows = await globalQuery('SELECT guild_id FROM guilds WHERE discord = 0').catch(() => null);
  if (rows) { discordless = new Set(rows.map(r => r.guild_id)); loadedAt = Date.now(); }
}
// Synchronous answer from the cache (refreshed in the background every 30 s and at each change)
function isDiscordless(id) {
  if (Date.now() - loadedAt > TTL_MS) refresh().catch(() => null);
  return discordless.has(String(id));
}
async function hasDiscord(id) {
  await refresh();
  return !discordless.has(String(id));
}

if (!GuildManager.prototype.fetch.__spaceAware) {
  const original = GuildManager.prototype.fetch;
  GuildManager.prototype.fetch = function fetch(options, ...rest) {
    const id = typeof options === 'string' ? options : options?.guild || options?.id;
    if (id && (isDiscordless(id) || SPACE_ID_RE.test(String(id)))) return Promise.reject(Object.assign(new Error('Unknown Guild'), { code: 10004, status: 404 }));
    return original.call(this, options, ...rest);
  };
  GuildManager.prototype.fetch.__spaceAware = true;
}

async function newSpaceId() {
  for (;;) {
    const id = `9${[...crypto.randomBytes(18)].map(b => b % 10).join('')}`;
    const [row] = await globalQuery('SELECT 1 FROM guilds WHERE guild_id = ?', [id]);
    if (!row) return id;
  }
}

// Creates a space without Discord. by: { id, username } of the account that creates it (founder).
async function createSpace({ name, by }) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!clean) return { error: 'Nom de l\'espace requis' };
  const id = await newSpaceId();
  const { getDbName } = require('./tenantDb');
  await globalQuery(
    `INSERT INTO guilds (guild_id, guild_name, owner_discord_id, owner_discord_tag, status, db_name, created_by, discord, discord_guild_id)
     VALUES (?, ?, ?, ?, 'active', ?, ?, 0, NULL)`,
    [id, clean, String(by.id), String(by.username || by.id).slice(0, 100), getDbName(id), String(by.id)]
  );
  await require('./tenantSchema').ensureTenantSchema(id);
  const db = require('./tenantDb').getTenantDb(id);
  // No Discord server: tickets live in the database only
  await db("UPDATE guild_config SET ticket_mode = 'database' WHERE id = 1");
  await db("INSERT INTO dashboard_users (user_id, username, role) VALUES (?, ?, 'fondateur') ON DUPLICATE KEY UPDATE role = 'fondateur'",
    [String(by.id), String(by.username || by.id).slice(0, 100)]);
  await refresh();
  return { space: { id, name: clean } };
}

// Active spaces without Discord where the account is in the team (or every one for the owner)
async function discordlessSpacesFor(userId, { owner = false } = {}) {
  const rows = await globalQuery("SELECT guild_id, guild_name FROM guilds WHERE status = 'active' AND discord = 0");
  const out = [];
  for (const g of rows) {
    let member = owner;
    if (!member) {
      const [row] = await require('./tenantDb').getTenantDb(g.guild_id)("SELECT 1 FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [String(userId)]).catch(() => []);
      member = !!row;
    }
    if (member) out.push({ id: g.guild_id, name: g.guild_name, icon: null, iconUrl: null, status: 'active', discord: false });
  }
  return out;
}

module.exports = { createSpace, isDiscordless, hasDiscord, discordlessSpacesFor, refresh, SPACE_ID_RE };

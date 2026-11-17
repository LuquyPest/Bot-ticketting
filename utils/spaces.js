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

// ── Linking and unlinking a Discord server (v4 PR 7b) ──
// Linking: the owner picks a Discord server, the bot is invited there; when it arrives
// (registerGuild), the tables of the space move into the database named after that server — the
// same atomic RENAME as a restore — and the space takes the server's ID. A space linked to Discord
// thus always has the ID of its server, like every server before v4.
// Unlinking: the space keeps its ID and its data, the bot leaves the server, open tickets lose
// their channel (they continue in the dashboard and by DM / e-mail), tickets have no channel.
const SNOWFLAKE = /^\d{17,20}$/;
const LINK_TTL_S = 3600;
const DEMO_ID = '999999999999999999';
const quoteId = s => `\`${String(s).replace(/`/g, '')}\``;
const fail = (status, error) => Object.assign(new Error(error), { status });

function inviteUrl(discordGuildId) {
  const { config } = require('./config');
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('scope', 'bot applications.commands');
  url.searchParams.set('permissions', '268684432');
  url.searchParams.set('guild_id', discordGuildId);
  url.searchParams.set('disable_guild_select', 'true');
  return url.toString();
}

// Step 1: remembers which space the server will join (1 hour), returns the invite link
async function requestLink(spaceId, discordGuildId) {
  const { config } = require('./config');
  if (!config.token || !config.clientId) throw fail(409, 'Le bot Discord n\'est pas configuré sur cette instance (DISCORD_TOKEN)');
  if (!SNOWFLAKE.test(String(discordGuildId || '')) || SPACE_ID_RE.test(String(discordGuildId))) throw fail(400, 'Identifiant de serveur Discord invalide');
  const [space] = await globalQuery('SELECT guild_id, discord FROM guilds WHERE guild_id = ?', [String(spaceId)]);
  if (!space) throw fail(404, 'Espace introuvable');
  if (Number(space.discord) === 1) throw fail(409, 'Cet espace est déjà relié à un serveur Discord');
  const [taken] = await globalQuery('SELECT guild_id FROM guilds WHERE guild_id = ? OR discord_guild_id = ?', [String(discordGuildId), String(discordGuildId)]);
  if (taken) throw fail(409, 'Ce serveur Discord a déjà son espace');
  await require('./redis').getRedis().set(`spacelink:${discordGuildId}`, String(spaceId), 'EX', LINK_TTL_S);
  return { url: inviteUrl(discordGuildId) };
}

// Called when the bot arrives on a server: the space waiting for it, if any (consumed)
async function takePendingLink(discordGuildId) {
  return require('./redis').getRedis().getdel(`spacelink:${discordGuildId}`).catch(() => null);
}

async function tablesOf(db) {
  return (await globalQuery('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [db])).map(r => r.t || r.TABLE_NAME);
}

// Step 2: the space S becomes the space of the Discord server X (its tables, its row, its traces)
async function rekeySpace(spaceId, guild) {
  const S = String(spaceId), X = String(guild.id);
  const { getDbName, closeTenant } = require('./tenantDb');
  const from = getDbName(S), to = getDbName(X);
  const tables = await tablesOf(from);
  await globalQuery(`CREATE DATABASE IF NOT EXISTS ${quoteId(to)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  if (tables.length) await globalQuery(`RENAME TABLE ${tables.map(t => `${quoteId(from)}.${quoteId(t)} TO ${quoteId(to)}.${quoteId(t)}`).join(', ')}`);
  await globalQuery(`DROP DATABASE IF EXISTS ${quoteId(from)}`);
  await globalQuery(
    'UPDATE guilds SET guild_id = ?, db_name = ?, discord = 1, discord_guild_id = ?, guild_icon = ?, member_count = ? WHERE guild_id = ?',
    [X, to, X, guild.iconURL?.() || null, guild.memberCount ?? null, S]
  );
  // Traces of the space in the instance tables follow it
  for (const table of ['login_logs', 'error_logs', 'push_subscriptions', 'instance_audit_log']) {
    await globalQuery(`UPDATE ${table} SET guild_id = ? WHERE guild_id = ?`, [X, S]).catch(() => null);
  }
  await closeTenant(S);
  await refresh();
  require('./i18n').clearGuildLanguageCache(S);
  require('./staffI18n').clearStaffLangCache(S);
  require('./logger').info('Espace relié à un serveur Discord', { from: S, to: X, tables: tables.length });
  return { from: S, to: X };
}

// Unlinks the Discord server of a space; the bot leaves it
async function unlinkDiscord(client, spaceId) {
  const id = String(spaceId);
  if (id === DEMO_ID) throw fail(400, 'La démonstration n\'a pas de serveur Discord');
  const [space] = await globalQuery('SELECT guild_id, discord FROM guilds WHERE guild_id = ?', [id]);
  if (!space) throw fail(404, 'Espace introuvable');
  if (Number(space.discord) === 0) throw fail(409, 'Cet espace n\'est relié à aucun serveur Discord');
  // Marked first: the guildDelete that follows the departure must not suspend the space
  await globalQuery('UPDATE guilds SET discord = 0, discord_guild_id = NULL WHERE guild_id = ?', [id]);
  const db = require('./tenantDb').getTenantDb(id);
  // Open tickets lose their channel: they go on in the dashboard (virtual channel, utils/virtualChannel.js)
  const moved = await db("UPDATE tickets SET channel_id = CONCAT('db-u', id) WHERE status = 'open' AND channel_id NOT LIKE 'db-%'");
  await db("UPDATE guild_config SET ticket_mode = 'database' WHERE id = 1");
  const guild = client?.guilds?.cache?.get(id);
  await refresh();
  let left = false;
  if (guild) left = await guild.leave().then(() => true).catch(() => false);
  return { ok: true, openTickets: Number(moved.affectedRows || 0), leftDiscord: left };
}

module.exports = {
  createSpace, isDiscordless, hasDiscord, discordlessSpacesFor, refresh, SPACE_ID_RE,
  requestLink, takePendingLink, rekeySpace, unlinkDiscord, inviteUrl,
};

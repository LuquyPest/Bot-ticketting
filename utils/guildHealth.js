// Health of a server's bot setup: permissions the bot needs, configured channels, categories and
// roles that still exist and are usable, room left in the ticket categories. Shown to founders
// (page « Santé du serveur ») and checked every 15 min (job 'guild-health') and right after a
// Discord change that may break it (events/botHealth.js): a problem that was not there before
// is sent once by DM to the founders.
const { PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const { parseJsonField } = require('./jsonField');
const { CATEGORY_LIMIT, pruneEmptyOverflow } = require('./categoryOverflow');
const logger = require('./logger');

const F = PermissionsBitField.Flags;

// [flag, label, why it is needed]
const BASE_PERMS = [
  ['ViewChannel', 'Voir les salons', 'Lire les salons de tickets et de logs'],
  ['SendMessages', 'Envoyer des messages', 'Écrire dans les tickets et les logs'],
  ['EmbedLinks', 'Intégrer des liens', 'Afficher les messages du bot (embeds)'],
  ['AttachFiles', 'Joindre des fichiers', 'Transmettre les fichiers des membres et du staff'],
  ['ReadMessageHistory', 'Voir les anciens messages', 'Construire les transcripts'],
  ['ManageChannels', 'Gérer les salons', 'Créer, déplacer, renommer et supprimer les salons de tickets'],
  ['ManageRoles', 'Gérer les rôles', 'Restreindre un ticket à certains grades ou le rendre confidentiel'],
];
const THREAD_PERMS = [
  ['CreatePrivateThreads', 'Créer des fils privés', 'Ouvrir les tickets en fils privés'],
  ['SendMessagesInThreads', 'Envoyer des messages dans les fils', 'Écrire dans les tickets en fils'],
  ['ManageThreads', 'Gérer les fils', 'Ajouter le staff aux fils et les supprimer à la fermeture'],
];

const CHANNELS = {
  ticket_category_id: { label: 'Catégorie « Ouvert »', category: true },
  waiting_category_id: { label: 'Catégorie « En attente »', category: true },
  in_progress_category_id: { label: 'Catégorie « En cours »', category: true },
  thread_parent_channel_id: { label: 'Salon des fils de tickets', threads: true },
  close_log_channel_id: { label: 'Logs de fermeture' },
  claim_log_channel_id: { label: 'Logs de prise en charge' },
  move_log_channel_id: { label: 'Logs de déplacement' },
  add_user_log_channel_id: { label: 'Logs d\'ajout de membre' },
  remove_user_log_channel_id: { label: 'Logs de retrait de membre' },
  weekly_report_channel_id: { label: 'Rapport hebdomadaire' },
  monthly_report_channel_id: { label: 'Rapport mensuel' },
  spam_alert_channel_id: { label: 'Alertes de spam' },
  escalation_alert_channel_id: { label: 'Alertes d\'escalade' },
};
const ROLES = { support_role_ids: 'Rôle support', chief_role_ids: 'Rôle chef support' };

const missingIn = (perms, list) => list.filter(([flag]) => !perms?.has(F[flag])).map(([, label]) => label);

// Full report. guild: discord.js Guild (null = the bot is no longer on the server).
async function checkGuildHealth(db, client, guildId) {
  const [cfg = {}] = await db('SELECT * FROM guild_config LIMIT 1');
  const threads = cfg.ticket_mode === 'thread';
  const guild = await client?.guilds.fetch(guildId).catch(() => null);
  const report = { checkedAt: new Date().toISOString(), mode: threads ? 'thread' : 'channel', botInGuild: !!guild, permissions: [], channels: [], roles: [], categories: [], problems: [] };
  if (!guild) {
    report.problems.push({ id: 'bot_absent', text: 'Le bot n\'est plus sur le serveur' });
    return report;
  }
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const guildPerms = me?.permissions;
  for (const [flag, label, why] of [...BASE_PERMS, ...(threads ? THREAD_PERMS : [])]) {
    const ok = !!guildPerms?.has(F[flag]);
    report.permissions.push({ key: flag, label, why, ok });
    if (!ok) report.problems.push({ id: `perm:${flag}`, text: `Permission manquante : ${label}` });
  }

  for (const [col, def] of Object.entries(CHANNELS)) {
    const id = cfg[col];
    if (!id) continue;
    const ch = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
    const entry = { field: col, label: def.label, id, name: ch?.name || null, ok: true, problem: null };
    if (!ch) entry.problem = 'Supprimé ou introuvable';
    else if (def.category && ch.type !== ChannelType.GuildCategory) entry.problem = 'N\'est plus une catégorie';
    else if (!def.category && !ch.isTextBased?.()) entry.problem = 'N\'est pas un salon textuel';
    else {
      const perms = me ? ch.permissionsFor?.(me) : null;
      const needed = def.category ? BASE_PERMS.filter(([f]) => ['ViewChannel', 'ManageChannels', 'ManageRoles'].includes(f))
        : def.threads ? [...BASE_PERMS.slice(0, 2), ...THREAD_PERMS] : BASE_PERMS.slice(0, 3);
      const missing = missingIn(perms, needed);
      if (missing.length) entry.problem = `Permissions manquantes ici : ${missing.join(', ')}`;
    }
    entry.ok = !entry.problem;
    report.channels.push(entry);
    if (!entry.ok) report.problems.push({ id: `chan:${col}:${entry.problem}`, text: `${def.label} : ${entry.problem.toLowerCase()}` });

    if (def.category && ch?.type === ChannelType.GuildCategory) {
      const count = guild.channels.cache.filter(c => c.parentId === ch.id).size;
      const overflow = (await db('SELECT category_id FROM overflow_categories WHERE base_category_id = ?', [ch.id]).catch(() => []))
        .map(r => guild.channels.cache.get(r.category_id)).filter(Boolean)
        .map(c => ({ id: c.id, name: c.name, count: guild.channels.cache.filter(x => x.parentId === c.id).size }));
      report.categories.push({ field: col, label: def.label, id: ch.id, name: ch.name, count, limit: CATEGORY_LIMIT, overflow });
    }
  }
  if (threads && !cfg.thread_parent_channel_id) {
    report.problems.push({ id: 'thread_parent_missing', text: 'Mode fils privés activé sans salon parent' });
  }

  const roles = await guild.roles.fetch().catch(() => null);
  for (const [col, label] of Object.entries(ROLES)) {
    for (const id of parseJsonField(cfg[col])) {
      const role = roles?.get(id);
      const entry = { field: col, label, id, name: role?.name || null, ok: !!role, problem: role ? null : 'Supprimé ou introuvable' };
      report.roles.push(entry);
      if (!entry.ok) report.problems.push({ id: `role:${id}`, text: `${label} supprimé (${id})` });
    }
  }
  const total = guild.channels.cache.size;
  report.channelCount = { used: total, limit: 500 };
  if (!threads && total >= 480) report.problems.push({ id: 'guild_channels', text: `Le serveur approche de la limite de 500 salons (${total})` });
  return report;
}

// DM to founders about problems that were not in the previous check. Stored set: Redis.
async function alertNewProblems(db, client, guildId, guildName, report) {
  const { getRedis } = require('./redis');
  const key = `health:problems:${guildId}`;
  const previous = new Set(JSON.parse(await getRedis().get(key).catch(() => null) || '[]'));
  const current = report.problems.map(p => p.id);
  await getRedis().set(key, JSON.stringify(current), 'EX', 30 * 86400).catch(() => null);
  const fresh = report.problems.filter(p => !previous.has(p.id));
  if (!fresh.length) return [];
  const { config } = require('./config');
  const base = config.webServerBaseUrl?.replace(/\/$/, '');
  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setAuthor({ name: (guildName || 'Ton serveur').slice(0, 256) })
    .setTitle('⚠️ Problème de configuration du bot')
    .setDescription(`${fresh.slice(0, 15).map(p => `• ${p.text}`).join('\n')}\n\nTant que ce n'est pas corrigé, certaines actions sur les tickets peuvent échouer.`)
    .setFooter({ text: 'Désactivable dans Paramètres → Santé du serveur' })
    .setTimestamp();
  if (base) embed.setURL(`${base}/sante`);
  const founders = await db("SELECT user_id FROM dashboard_users WHERE role = 'fondateur'");
  for (const f of founders) {
    const user = await client.users.fetch(f.user_id).catch(() => null);
    if (user) await user.send({ embeds: [embed] }).catch(() => null);
  }
  await require('./audit').recordEvent(db, { actor: require('./audit').SYSTEM, action: 'health_alert', details: { problems: fresh.map(p => p.text) } }).catch(() => null);
  return fresh;
}

async function runGuildHealthCheck(client, onlyGuildId = null) {
  if (!client?.isReady?.()) return [];
  const { globalQuery } = require('./globalDb');
  const { getTenantDb } = require('./tenantDb');
  const guilds = await globalQuery("SELECT guild_id, guild_name FROM guilds WHERE status = 'active'" + (onlyGuildId ? ' AND guild_id = ?' : ''), onlyGuildId ? [onlyGuildId] : []);
  const sent = [];
  for (const g of guilds) {
    try {
      const db = getTenantDb(g.guild_id);
      const discordGuild = client.guilds.cache.get(g.guild_id);
      if (discordGuild) await pruneEmptyOverflow(db, discordGuild).catch(() => null);
      // Voice channels of tickets closed by a path that did not delete them (bulk close…)
      const stale = await db("SELECT id FROM tickets WHERE status = 'closed' AND voice_channel_id IS NOT NULL").catch(() => []);
      if (stale.length) {
        const tm = require('./ticketManager').createManager(db, client, g.guild_id);
        for (const { id } of stale) await tm.closeVoiceChannel(id).catch(() => null);
      }
      const [cfg] = await db('SELECT health_alerts_enabled FROM guild_config LIMIT 1');
      if (cfg && !Number(cfg.health_alerts_enabled)) continue;
      const report = await checkGuildHealth(db, client, g.guild_id);
      const fresh = await alertNewProblems(db, client, g.guild_id, g.guild_name, report);
      if (fresh.length) sent.push({ guildId: g.guild_id, problems: fresh.length });
    } catch (err) {
      logger.error('Santé du serveur', { guildId: g.guild_id, err: err.message });
    }
  }
  return sent;
}

// Discord change on a server (bot roles, channel deleted…): check it again shortly after,
// once for a burst of events.
const pending = new Map();
function scheduleHealthCheck(client, guildId, delayMs = 20000) {
  if (!guildId || pending.has(guildId)) return;
  pending.set(guildId, setTimeout(() => {
    pending.delete(guildId);
    runGuildHealthCheck(client, guildId).catch(() => null);
  }, delayMs).unref?.());
}

module.exports = { checkGuildHealth, runGuildHealthCheck, scheduleHealthCheck, alertNewProblems };

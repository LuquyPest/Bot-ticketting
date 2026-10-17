// Warns a server's founders when it gets close to a limit set by the super-admin (open tickets,
// staff accounts): at 80 % and when the limit is reached, at most once a day per limit.
// Runs hourly (BullMQ job 'quota-check').
const { EmbedBuilder } = require('discord.js');
const { globalQuery } = require('./globalDb');
const { getTenantDb } = require('./tenantDb');
const { getRedis } = require('./redis');
const { agentCount } = require('./limits');
const { recordEvent, SYSTEM } = require('./audit');
const logger = require('./logger');

const WARN_RATIO = 0.8;
const COOLDOWN_S = 24 * 3600;

const METRICS = {
  tickets: { column: 'max_tickets', label: 'tickets ouverts simultanés', usage: async db => Number((await db("SELECT COUNT(*) AS n FROM tickets WHERE status = 'open'"))[0].n) },
  agents:  { column: 'max_agents',  label: 'membres du staff',           usage: db => agentCount(db) },
};

async function runQuotaCheck(client) {
  const guilds = await globalQuery("SELECT guild_id, guild_name, max_tickets, max_agents FROM guilds WHERE status = 'active' AND (max_tickets > 0 OR max_agents > 0)");
  const sent = [];
  for (const g of guilds) {
    try {
      const db = getTenantDb(g.guild_id);
      for (const [key, m] of Object.entries(METRICS)) {
        const max = Number(g[m.column]) || 0;
        if (!max) continue;
        const used = await m.usage(db);
        if (used < max * WARN_RATIO) continue;
        const level = used >= max ? 'reached' : 'near';
        if (!(await getRedis().set(`alert:quota:${g.guild_id}:${key}:${level}`, '1', 'EX', COOLDOWN_S, 'NX'))) continue;

        await recordEvent(db, { actor: SYSTEM, action: 'quota_warning', details: { limit: key, used, max, level } });
        const founders = await db("SELECT user_id FROM dashboard_users WHERE role = 'fondateur'");
        const embed = new EmbedBuilder()
          .setColor(level === 'reached' ? 0xed4245 : 0xf59e0b)
          .setAuthor({ name: g.guild_name || 'Ton serveur' })
          .setTitle(level === 'reached' ? '🚫 Limite atteinte' : '⚠️ Limite bientôt atteinte')
          .setDescription(`**${used} / ${max}** ${m.label}.${level === 'reached'
            ? (key === 'tickets' ? '\nLes membres ne peuvent plus ouvrir de ticket tant que des tickets ne sont pas fermés.' : '\nAucun nouveau membre du staff ne peut être ajouté.')
            : ''}\nPour augmenter cette limite, contacte l'administrateur du bot.`)
          .setTimestamp();
        for (const f of founders) {
          const user = await client?.users.fetch(f.user_id).catch(() => null);
          if (user) await user.send({ embeds: [embed] }).catch(() => null);
        }
        sent.push({ guildId: g.guild_id, limit: key, used, max, level });
      }
    } catch (err) {
      logger.error('Alerte de limite', { guildId: g.guild_id, err: err.message });
    }
  }
  return sent;
}

module.exports = { runQuotaCheck };

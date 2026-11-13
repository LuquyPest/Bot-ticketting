const { Events } = require('discord.js');
const { globalQuery } = require('../utils/globalDb');
const { registerGuild } = require('../utils/guildActivation');
const logger = require('../utils/logger');

// Servers that got the bot while it was offline are activated now, without a DM
async function syncGuild(client, guild) {
  try {
    const result = await registerGuild(client, guild, { notify: false });
    if (result !== 'updated') logger.info('Serveur synchronisé au démarrage', { guildId: guild.id, guildName: guild.name, result });
  } catch (err) {
    logger.error('Erreur sync guild au démarrage', { guildId: guild.id, err: err.message });
  }
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`Connecté en tant que ${client.user.tag}`);

    const guilds = client.guilds.cache;
    logger.info('Synchronisation des serveurs existants', { count: guilds.size });
    await Promise.all(guilds.map(g => syncGuild(client, g)));
    logger.info('Synchronisation terminée');

    // A public bot can be invited by anyone, and every server is active on arrival
    const app = await client.application?.fetch().catch(() => null);
    const { allowedGuilds } = require('../utils/config').config;
    if (app?.botPublic && !allowedGuilds?.length) {
      logger.warn('Bot public sans ALLOWED_GUILDS : n\'importe qui peut l\'ajouter à son serveur, qui sera activé. Décoche « Public Bot » dans le portail Discord ou renseigne ALLOWED_GUILDS.');
    }

    // Tenant migrations are idempotent: apply them to every active guild, not only when a server arrives.
    // The scheduled jobs wait for them ('tenantsMigrated', index.js): a job would otherwise query
    // a table a new version has not created yet.
    try {
      const { ensureTenantSchema } = require('../utils/tenantSchema');
      const active = await globalQuery('SELECT guild_id FROM guilds WHERE status = "active"').catch(() => []);
      for (const { guild_id } of active) {
        await ensureTenantSchema(guild_id).catch(err => logger.error('Migration tenant échouée', { guildId: guild_id, err: err.message }));
      }
    } finally {
      client.emit('tenantsMigrated');
    }
  }
};

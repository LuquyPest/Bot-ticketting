const express = require('express');
const router = express.Router();
const { ChannelType } = require('discord.js');

// A space without a Discord server (or the demo) has no channels, categories nor roles: an empty
// list, not an error (Settings asks for them on every space — each visit logged 3 false errors)
router.use(async (req, res, next) => {
  if (req.method !== 'GET') return next();
  const discordless = !(await require('../../utils/spaces').hasDiscord(req.guildId).catch(() => true)) || req.guildId === require('../../utils/demo').DEMO_GUILD_ID;
  return discordless ? res.json([]) : next();
});

router.get('/categories', async (req, res) => {
  try {
    const client = req.app.locals.client;
    if (!client) return res.status(503).json({ error: 'Bot Discord non disponible' });

    const guild = await client.guilds.fetch(req.guildId).catch(() => null);
    if (!guild) return res.status(503).json({ error: 'Serveur Discord introuvable' });

    const channels = await guild.channels.fetch();
    const categories = channels
      .filter(c => c && c.type === ChannelType.GuildCategory)
      .map(c => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(categories);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/channels', async (req, res) => {
  try {
    const client = req.app.locals.client;
    if (!client) return res.status(503).json({ error: 'Bot Discord non disponible' });

    const guild = await client.guilds.fetch(req.guildId).catch(() => null);
    if (!guild) return res.status(503).json({ error: 'Serveur Discord introuvable' });

    const channels = await guild.channels.fetch();
    const textChannels = channels
      .filter(c => c && c.type === ChannelType.GuildText)
      .map(c => ({ id: c.id, name: c.name, parent_id: c.parentId || null }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(textChannels);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/roles', async (req, res) => {
  try {
    const client = req.app.locals.client;
    if (!client) return res.status(503).json({ error: 'Bot Discord non disponible' });

    const guild = await client.guilds.fetch(req.guildId).catch(() => null);
    if (!guild) return res.status(503).json({ error: 'Serveur Discord introuvable' });

    const roles = await guild.roles.fetch();
    const list = roles
      .filter(r => !r.managed && r.id !== guild.id)
      .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

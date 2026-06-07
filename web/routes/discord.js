const express = require('express');
const router = express.Router();
const { ChannelType } = require('discord.js');
const config = require('../../config.json');

router.get('/categories', async (req, res) => {
  try {
    const client = req.app.locals.client;
    if (!client) return res.status(503).json({ error: 'Bot Discord non disponible' });

    const guild = await client.guilds.fetch(config.guildId).catch(() => null);
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

module.exports = router;

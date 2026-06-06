const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../config.json');

const SAFE_FIELDS = [
  'ticketPrefix', 'welcomeMessage', 'ticketSubjects',
  'maxTicketsPerDay', 'inactiveWarningHours', 'inactiveHours',
  'replyRateLimitSeconds', 'closeLogChannelId', 'claimLogChannelId',
  'moveLogChannelId', 'addUserLogChannelId', 'removeUserLogChannelId'
];
const SAFE_DASH_FIELDS = ['port', 'authMethods', 'allowedRoleId'];

router.get('/', (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    // Mask secrets
    if (cfg.token) cfg.token = '***';
    if (cfg.database?.password) cfg.database.password = '***';
    if (cfg.dashboard) {
      if (cfg.dashboard.discordClientSecret) cfg.dashboard.discordClientSecret = '***';
      if (cfg.dashboard.sessionSecret) cfg.dashboard.sessionSecret = '***';
      if (cfg.dashboard.password) cfg.dashboard.password = '***';
    }
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: 'Impossible de lire config.json' });
  }
});

router.patch('/', (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const updates = req.body;

    for (const field of SAFE_FIELDS) {
      if (field in updates) cfg[field] = updates[field];
    }

    if (updates.dashboard && typeof updates.dashboard === 'object') {
      cfg.dashboard = cfg.dashboard || {};
      for (const field of SAFE_DASH_FIELDS) {
        if (field in updates.dashboard) cfg.dashboard[field] = updates.dashboard[field];
      }
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Impossible de sauvegarder config.json' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../config.json');

const SAFE_FIELDS = [
  'ticketPrefix', 'welcomeMessage', 'ticketSubjects',
  'maxTicketsPerDay', 'inactiveWarningHours', 'inactiveHours',
  'replyRateLimitSeconds', 'closeLogChannelId', 'claimLogChannelId',
  'moveLogChannelId', 'addUserLogChannelId', 'removeUserLogChannelId',
  'webEnabled', 'webServerPort', 'webServerBaseUrl'
];

const VALIDATORS = {
  ticketPrefix:           v => typeof v === 'string' && v.length >= 1 && v.length <= 20,
  welcomeMessage:         v => typeof v === 'string' && v.length <= 2000,
  ticketSubjects:         v => Array.isArray(v) && v.length <= 25 && v.every(s => typeof s === 'string' && s.length <= 100),
  maxTicketsPerDay:       v => Number.isInteger(v) && v >= 1 && v <= 100,
  inactiveWarningHours:   v => Number.isInteger(v) && v >= 1 && v <= 720,
  inactiveHours:          v => Number.isInteger(v) && v >= 1 && v <= 720,
  replyRateLimitSeconds:  v => Number.isInteger(v) && v >= 0 && v <= 300,
  closeLogChannelId:      v => v === null || (typeof v === 'string' && /^\d{17,20}$/.test(v)),
  claimLogChannelId:      v => v === null || (typeof v === 'string' && /^\d{17,20}$/.test(v)),
  moveLogChannelId:       v => v === null || (typeof v === 'string' && /^\d{17,20}$/.test(v)),
  addUserLogChannelId:    v => v === null || (typeof v === 'string' && /^\d{17,20}$/.test(v)),
  removeUserLogChannelId: v => v === null || (typeof v === 'string' && /^\d{17,20}$/.test(v)),
  webEnabled:             v => typeof v === 'boolean',
  webServerPort:          v => Number.isInteger(v) && v >= 1 && v <= 65535,
  webServerBaseUrl:       v => typeof v === 'string' && v.length <= 200,
};

router.get('/', (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const safe = {};
    for (const field of SAFE_FIELDS) {
      if (field in cfg) safe[field] = cfg[field];
    }
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Impossible de lire config.json' });
  }
});

router.patch('/', (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const updates = req.body;

    for (const field of SAFE_FIELDS) {
      if (!(field in updates)) continue;
      const validator = VALIDATORS[field];
      if (validator && !validator(updates[field])) {
        return res.status(400).json({ error: `Valeur invalide pour le champ "${field}"` });
      }
      cfg[field] = updates[field];
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Impossible de sauvegarder config.json' });
  }
});

module.exports = router;

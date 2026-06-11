const express    = require('express');
const router     = express.Router();
const webpush    = require('web-push');
const { globalQuery } = require('../../utils/globalDb');
const guildMiddleware = require('../middleware/guild');

let vapidReady = false;

function initVapid() {
  if (vapidReady) return;
  const config = require('../../config.json');
  if (!config.vapid?.publicKey || !config.vapid?.privateKey) return;
  webpush.setVapidDetails(
    `mailto:${config.vapid.contact || 'admin@localhost'}`,
    config.vapid.publicKey,
    config.vapid.privateKey
  );
  vapidReady = true;
}

// GET /api/push/vapid-public-key — return VAPID public key for the client
router.get('/vapid-public-key', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const config = require('../../config.json');
    if (!config.vapid?.publicKey) return res.status(501).json({ error: 'Push notifications non configurées' });
    res.json({ publicKey: config.vapid.publicKey });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/push/subscribe — save a push subscription for the current user+guild
router.post('/subscribe', guildMiddleware, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Subscription invalide' });
  }
  try {
    await globalQuery(
      `INSERT INTO push_subscriptions (user_id, guild_id, endpoint, p256dh, auth_key)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth_key = VALUES(auth_key)`,
      [req.session.user.id, req.guildId, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('push subscribe error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/push/unsubscribe — remove subscription
router.post('/unsubscribe', guildMiddleware, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint requis' });
  try {
    await globalQuery(
      'DELETE FROM push_subscriptions WHERE user_id = ? AND guild_id = ? AND endpoint = ?',
      [req.session.user.id, req.guildId, endpoint]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Utility — send a push notification to all subscribers of a guild
async function sendPushToGuild(guildId, payload) {
  initVapid();
  if (!vapidReady) return;
  const subs = await globalQuery(
    'SELECT endpoint, p256dh, auth_key FROM push_subscriptions WHERE guild_id = ?',
    [guildId]
  ).catch(() => []);
  for (const sub of subs) {
    const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } };
    webpush.sendNotification(subscription, JSON.stringify(payload)).catch(async err => {
      // Remove expired/invalid subscriptions (410 Gone)
      if (err.statusCode === 410 || err.statusCode === 404) {
        await globalQuery('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]).catch(() => null);
      }
    });
  }
}

module.exports = router;
module.exports.sendPushToGuild = sendPushToGuild;

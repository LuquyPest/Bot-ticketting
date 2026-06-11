const https = require('https');
const http = require('http');

async function emitWebhook(webhookUrl, event, payload) {
  if (!webhookUrl) return;
  const body = JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload });
  const url = new URL(webhookUrl);
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'TicketBot/1.0',
      'X-TicketBot-Event': event,
    },
    timeout: 5000,
  };

  return new Promise(resolve => {
    const req = (url.protocol === 'https:' ? https : http).request(options, res => {
      res.resume();
      resolve({ status: res.statusCode });
    });
    req.on('error', () => resolve({ error: true }));
    req.on('timeout', () => { req.destroy(); resolve({ timeout: true }); });
    req.write(body);
    req.end();
  });
}

// Fire webhook if enabled for this guild
async function fireTicketWebhook(db, event, payload) {
  try {
    const [cfg] = await db('SELECT webhooks_enabled, webhook_url, webhook_events FROM guild_config LIMIT 1');
    if (!cfg?.webhooks_enabled || !cfg.webhook_url) return;

    let events = [];
    try { events = Array.isArray(cfg.webhook_events) ? cfg.webhook_events : JSON.parse(cfg.webhook_events || '[]'); } catch {}
    if (events.length && !events.includes(event)) return;

    await emitWebhook(cfg.webhook_url, event, payload);
  } catch {}
}

module.exports = { emitWebhook, fireTicketWebhook };

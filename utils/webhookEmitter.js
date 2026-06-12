const https  = require('https');
const dns    = require('dns').promises;
const net    = require('net');
const crypto = require('crypto');

// RFC1918 + loopback + link-local + CGNAT + reserved ranges (SSRF blocklist)
const BLOCKED_CIDRS = [
  [0x7f000000, 0xff000000],   // 127.0.0.0/8  loopback
  [0x0a000000, 0xff000000],   // 10.0.0.0/8
  [0xac100000, 0xfff00000],   // 172.16.0.0/12
  [0xc0a80000, 0xffff0000],   // 192.168.0.0/16
  [0xa9fe0000, 0xffff0000],   // 169.254.0.0/16  link-local / AWS metadata
  [0x64400000, 0xffc00000],   // 100.64.0.0/10   CGNAT
  [0xc0000000, 0xffffff00],   // 192.0.0.0/24    IETF Protocol Assignments
  [0x00000000, 0xff000000],   // 0.0.0.0/8
  [0xe0000000, 0xf0000000],   // 224.0.0.0/4     multicast
  [0xf0000000, 0xf0000000],   // 240.0.0.0/4     reserved
];

function ipToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) return true; // block all IPv6 including ::1, fc00::/7
  if (!net.isIPv4(ip)) return true;
  const n = ipToInt(ip);
  return BLOCKED_CIDRS.some(([base, mask]) => (n & mask) === base);
}

// Resolves the hostname once, verifies all returned IPs, and returns the first
// safe IP to use as a pinned address — prevents DNS rebinding attacks where a
// second resolution at request time could return a private IP.
async function resolveAndPin(hostname) {
  if (net.isIP(hostname)) {
    return isPrivateIp(hostname) ? null : hostname;
  }
  try {
    const results = await dns.lookup(hostname, { all: true });
    if (!results.length) return null;
    if (results.some(r => isPrivateIp(r.address))) return null;
    return results[0].address;
  } catch { return null; }
}

async function emitWebhook(webhookUrl, event, payload, secret) {
  if (!webhookUrl) return;

  let url;
  try { url = new URL(webhookUrl); } catch { return { blocked: true }; }
  if (url.protocol !== 'https:') return { blocked: true };
  if (!url.hostname || url.hostname.length > 253) return { blocked: true };

  // Resolve DNS once and pin the IP — https.request uses the pinned IP,
  // avoiding a second OS-level resolution that a DNS rebinding attack could hijack.
  const resolvedIp = await resolveAndPin(url.hostname);
  if (!resolvedIp) return { blocked: true };

  const body = JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload });

  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'User-Agent': 'TicketBot/1.0',
    'X-TicketBot-Event': event,
    'Host': url.hostname,
  };
  if (secret) {
    headers['X-TicketBot-Signature-256'] = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  const options = {
    hostname: resolvedIp,        // pinned — no second DNS resolution at connection time
    port: parseInt(url.port) || 443,
    path: url.pathname + url.search,
    method: 'POST',
    headers,
    servername: url.hostname,    // TLS SNI uses the original hostname
    timeout: 5000,
  };

  return new Promise(resolve => {
    const req = https.request(options, res => {
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
    const [cfg] = await db('SELECT webhooks_enabled, webhook_url, webhook_secret, webhook_events FROM guild_config LIMIT 1');
    if (!cfg?.webhooks_enabled || !cfg.webhook_url) return;

    let events = [];
    try { events = Array.isArray(cfg.webhook_events) ? cfg.webhook_events : JSON.parse(cfg.webhook_events || '[]'); } catch {}
    if (events.length && !events.includes(event)) return;

    await emitWebhook(cfg.webhook_url, event, payload, cfg.webhook_secret || null);
  } catch {}
}

module.exports = { emitWebhook, fireTicketWebhook };

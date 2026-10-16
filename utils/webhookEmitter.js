const https  = require('https');
const dns    = require('dns').promises;
const net    = require('net');
const crypto = require('crypto');

// SSRF blocklist: loopback, RFC1918 (incl. Docker networks), link-local / cloud metadata, CGNAT,
// documentation/benchmark ranges, multicast and reserved. net.BlockList does the matching —
// hand-rolled bit masks broke on ranges >= 128.0.0.0 (JS `&` yields signed ints).
const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOCKED.addSubnet(addr, prefix, 'ipv4');

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) return true; // block all IPv6 including ::1, fc00::/7 and IPv4-mapped
  if (!net.isIPv4(ip)) return true;
  return BLOCKED.check(ip, 'ipv4');
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
  const body = JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload });
  const headers = { 'X-TicketBot-Event': event };
  if (secret) {
    headers['X-TicketBot-Signature-256'] = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  }
  return safePostJson(webhookUrl, body, headers);
}

// POST a JSON body to an external HTTPS URL with the SSRF protections (public IP only, DNS pinned).
async function safePostJson(webhookUrl, body, extraHeaders = {}) {
  let url;
  try { url = new URL(webhookUrl); } catch { return { blocked: true }; }
  if (url.protocol !== 'https:') return { blocked: true };
  if (!url.hostname || url.hostname.length > 253) return { blocked: true };

  // Resolve DNS once and pin the IP — https.request uses the pinned IP,
  // avoiding a second OS-level resolution that a DNS rebinding attack could hijack.
  const resolvedIp = await resolveAndPin(url.hostname);
  if (!resolvedIp) return { blocked: true };

  if (typeof body !== 'string') body = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'User-Agent': 'TicketBot/1.0',
    'Host': url.hostname,
    ...extraHeaders,
  };

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

module.exports = { fireTicketWebhook, safePostJson };

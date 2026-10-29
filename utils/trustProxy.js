// Express « trust proxy » function: X-Forwarded-For is believed only for `hops` proxies, and the
// closest one must be the proxy itself (`host`, resolved every minute) — another container of a
// shared Docker network could otherwise send its own header and pass for any address. Until
// `host` resolves (local runs, tests), the plain hop count applies.
const dns = require('dns');

const plainIp = a => (String(a).startsWith('::ffff:') ? String(a).slice(7) : String(a));

function createProxyTrust({ hops = 1, host = 'traefik', lookup = dns.promises.lookup, refreshMs = 60 * 1000 } = {}) {
  let proxyIps = null;
  async function refresh() {
    if (!host) return;
    const found = await lookup(host, { all: true }).catch(() => null);
    if (found?.length) proxyIps = new Set(found.map(f => plainIp(f.address)));
  }
  const ready = refresh();
  if (host && refreshMs) setInterval(refresh, refreshMs).unref();
  const trust = (addr, i) => {
    if (i >= hops) return false;
    if (i === 0 && proxyIps) return proxyIps.has(plainIp(addr));
    return true;
  };
  trust.ready = ready;
  return trust;
}

module.exports = { createProxyTrust };

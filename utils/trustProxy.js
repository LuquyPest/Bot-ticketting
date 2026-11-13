// Express « trust proxy » function: X-Forwarded-For is believed only for `hops` proxies, and the
// closest one must be the proxy itself (`host`, resolved every minute) — another container of a
// shared Docker network could otherwise send its own header and pass for any address. Until
// `host` resolves — or without any proxy name (own proxy, local runs, tests) — the closest hop is
// believed only when it is a loopback or private address: a client reaching the port directly
// from the Internet can never pass for another address.
const dns = require('dns');
const net = require('net');

const LOCAL = new net.BlockList();
for (const [a, bits] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10]]) LOCAL.addSubnet(a, bits, 'ipv4');
for (const [a, bits] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]]) LOCAL.addSubnet(a, bits, 'ipv6');
const isLocal = addr => (net.isIPv4(addr) ? LOCAL.check(addr, 'ipv4') : net.isIPv6(addr) && LOCAL.check(addr, 'ipv6'));

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
    if (i === 0) return proxyIps ? proxyIps.has(plainIp(addr)) : isLocal(plainIp(addr));
    return true;
  };
  trust.ready = ready;
  return trust;
}

module.exports = { createProxyTrust };

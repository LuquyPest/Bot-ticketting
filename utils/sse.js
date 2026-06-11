// SSE client registry — guild-aware.
// Each client is registered with a guildId so broadcasts are isolated.
const clients = new Map(); // guildId -> Set<{res, userId}>

function addClient(res, userId, guildId) {
  const key = guildId || '_global';
  if (!clients.has(key)) clients.set(key, new Set());
  const entry = { res, userId };
  clients.get(key).add(entry);
  return () => {
    const set = clients.get(key);
    if (set) { set.delete(entry); if (set.size === 0) clients.delete(key); }
  };
}

function broadcast(event, data, guildId) {
  const key = guildId || '_global';
  const set = clients.get(key);
  if (!set) return;
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const { res } of [...set]) {
    try { res.write(line); } catch { set.delete({ res }); }
  }
}

module.exports = { addClient, broadcast };

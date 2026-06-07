const clients = new Set();

function addClient(res, userId) {
  const entry = { res, userId };
  clients.add(entry);
  return () => clients.delete(entry);
}

function broadcast(event, data) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const { res } of [...clients]) {
    try { res.write(line); } catch { clients.delete({ res }); }
  }
}

module.exports = { addClient, broadcast };

const express = require('express');
const router = express.Router();
const { addClient } = require('../../utils/sse');

router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const remove = addClient(res, req.session?.user?.id, req.guildId);
  res.write('event: connected\ndata: {}\n\n');

  const keepAlive = setInterval(() => {
    try { res.write(':ping\n\n'); } catch { clearInterval(keepAlive); }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    remove();
  });
});

module.exports = router;

function log(level, message, ctx = {}) {
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...ctx
  }) + '\n');
}

module.exports = {
  info:  (msg, ctx) => log('info',  msg, ctx),
  warn:  (msg, ctx) => log('warn',  msg, ctx),
  error: (msg, ctx) => log('error', msg, ctx),
};

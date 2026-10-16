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
  error: (msg, ctx = {}) => {
    log('error', msg, ctx);
    // Also kept in the error journal (super-admin "Erreurs" page)
    const { guildId, err, ...rest } = ctx;
    const text = err ? String(err) : msg;
    require('./errorLog').logError(guildId, msg, { message: text.split('\n')[0], stack: err ? text : '' }, Object.keys(rest).length ? rest : null);
  },
};

// Every recurring automation runs as a BullMQ job scheduler: the schedule lives in Redis, so each
// run happens once even with several bot instances, and survives restarts.
const { Queue, Worker } = require('bullmq');
const logger = require('./logger');

const QUEUE = 'bot-jobs';
const TZ = 'Europe/Paris';

// name → schedule (every: ms, or pattern: cron) + runner
const JOBS = {
  'pending-expiry':      { every: 15 * 1000,      run: client => require('../events/messageCreate').runPendingExpiry(client) },
  'ticket-reminders':    { every: 60 * 1000,      run: client => require('./ticketReminders').sendDueReminders(client) },
  'scheduled-messages':  { every: 60 * 1000,      run: client => require('./scheduledMessages').processPending(client) },
  'escalation-check':    { every: 30 * 60 * 1000, run: client => require('./escalationChecker').runEscalationCheck(client) },
  'inactive-check':      { every: 60 * 60 * 1000, run: client => require('./inactiveTicketChecker').runInactiveCheck(client) },
  'user-inactive-check': { every: 60 * 60 * 1000, run: client => require('./userInactiveChecker').runUserInactiveCheck(client) },
  'staff-reminder':      { every: 60 * 60 * 1000, run: client => require('./staffReminderChecker').runStaffReminderCheck(client) },
  'monthly-report':      { pattern: '0 9 1 * *',  run: client => require('./monthlyReport').sendMonthlyReports(client) },
  'weekly-report':       { pattern: '0 9 * * 1',  run: client => require('./weeklyReport').sendWeeklyReport(client) },
  'error-alert':         { every: 5 * 60 * 1000,  run: client => require('./errorAlert').runErrorAlertCheck(client) },
  'discord-watch':       { every: 60 * 1000,      run: client => require('./discordWatch').runDiscordWatch(client) },
  'quota-check':         { every: 60 * 60 * 1000, run: client => require('./quotaAlert').runQuotaCheck(client) },
  'retention-purge':     { pattern: '30 4 * * *', run: () => require('./retention').runRetentionPurge() },
  'demo-reset':          { pattern: '15 4 * * *', run: async () => { const { enabled } = await require('./saSettings').getSetting('demo', { enabled: true }); if (enabled) await require('./demo').seedDemo(); } },
};

// Last run of each job (Redis hash jobs:last), shown on the super-admin « Santé » page
const LAST_RUNS = 'jobs:last';
async function recordRun(name, started, ok, error = null) {
  await require('./redis').getRedis().hset(LAST_RUNS, name, JSON.stringify({ at: Date.now(), durationMs: Date.now() - started, ok, error })).catch(() => {});
}
async function jobsStatus() {
  const q = getQueue();
  const [schedulers, counts, lastRaw] = await Promise.all([
    q.getJobSchedulers(), q.getJobCounts('waiting', 'active', 'delayed', 'failed'), require('./redis').getRedis().hgetall(LAST_RUNS),
  ]);
  const byName = new Map(schedulers.map(s => [s.key || s.id || s.name, s]));
  return {
    counts,
    jobs: Object.entries(JOBS).map(([name, def]) => {
      const s = byName.get(name);
      const last = lastRaw?.[name] ? JSON.parse(lastRaw[name]) : null;
      return { name, schedule: def.every ? `toutes les ${Math.round(def.every / 1000)} s` : def.pattern, next: s?.next || null, last };
    }),
  };
}

// BullMQ gets its own connections: closing it must not cut the shared client (sessions, pending states)
let queue = null;
const connection = () => ({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});
// A closed queue (shutdown, tests) is recreated on the next use
const getQueue = () => { if (queue?.closing) queue = null; return (queue ||= new Queue(QUEUE, { connection: connection() })); };

async function startWorkers(client) {
  const q = getQueue();
  // Upsert the schedules and drop the ones that no longer exist (renamed/removed jobs)
  for (const [name, job] of Object.entries(JOBS)) {
    const repeat = job.every ? { every: job.every } : { pattern: job.pattern, tz: TZ };
    await q.upsertJobScheduler(name, repeat, { name, opts: { removeOnComplete: 50, removeOnFail: 100 } });
  }
  for (const s of await q.getJobSchedulers()) {
    if (!JOBS[s.key] && !JOBS[s.id] && !JOBS[s.name]) await q.removeJobScheduler(s.key || s.id).catch(() => null);
  }

  const worker = new Worker(QUEUE, async job => {
    const def = JOBS[job.name];
    if (!def) return;
    const started = Date.now();
    try {
      await def.run(client);
      await recordRun(job.name, started, true);
    } catch (err) {
      await recordRun(job.name, started, false, err.message);
      throw err;
    }
  }, { connection: connection(), concurrency: 3 });

  // Without an 'error' listener, a Redis disconnect would crash the whole process
  worker.on('error', err => logger.error('job worker error', { err: err.message }));
  q.on('error', err => logger.error('job queue error', { err: err.message }));

  worker.on('failed', (job, err) => {
    logger.error('job failed', { job: job?.name, err: err.message });
    try { require('./errorLog').logError(null, `job:${job?.name}`, err); } catch {}
  });
  logger.info('Automatismes planifiés (BullMQ)', { jobs: Object.keys(JOBS) });
  return worker;
}

module.exports = { startWorkers, JOBS, getQueue, jobsStatus };

const { Queue, Worker } = require('bullmq');
const { getRedis } = require('./redis');

const connection = { connection: getRedis() };

const jobQueue = new Queue('bot-jobs', connection);

function startWorkers(client) {
  const worker = new Worker('bot-jobs', async job => {
    switch (job.name) {
      case 'weekly-report': {
        const { sendWeeklyReportForGuild } = require('./weeklyReport');
        await sendWeeklyReportForGuild(client, job.data.guildId);
        break;
      }
      case 'inactive-check': {
        const { startInactiveChecker }     = require('./inactiveTicketChecker');
        const { startUserInactiveChecker } = require('./userInactiveChecker');
        const { startStaffReminderChecker }= require('./staffReminderChecker');
        const { startEscalationChecker }   = require('./escalationChecker');
        const { startScheduledMessages }   = require('./scheduledMessages');
        // These internal functions are not exported, so we fall through to the global runner
        // In a future refactor, expose per-guild functions from each module
        break;
      }
    }
  }, { ...connection, concurrency: 3 });

  worker.on('failed', (job, err) => {
    console.error(`[queue] job ${job?.name} [${job?.data?.guildId}] failed:`, err.message);
    try { require('../web/server').logError(job?.data?.guildId || null, `queue:${job?.name}`, err); } catch {}
  });

  return worker;
}

async function enqueue(name, data = {}, opts = {}) {
  try {
    await jobQueue.add(name, data, {
      removeOnComplete: 200,
      removeOnFail: 100,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      ...opts,
    });
  } catch (err) {
    console.error(`[queue] enqueue ${name} failed (Redis down?):`, err.message);
  }
}

module.exports = { jobQueue, startWorkers, enqueue };

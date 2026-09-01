/**
 * Worker BullMQ — consume jobs Redis y delega a jobTasks (misma lógica que cola inline).
 * PM2: pm2 start src/worker-bullmq.js --name fibranexus-worker
 * Env: PROCESS_ROLE=worker, DATABASE_URL, REDIS_URL o REDIS_HOST, USE_JOB_QUEUE=true
 */
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.PROCESS_ROLE || process.env.PROCESS_ROLE === 'all') {
  process.env.PROCESS_ROLE = 'worker';
}

import { Worker } from 'bullmq';
import { runMigrations } from './db/migrate.js';
import { runTask } from './lib/jobs/tasks.js';
import { getRedisConnection } from './lib/jobs/redisConnection.js';
import { config, runsWorker } from './lib/config.js';

const QUEUE_NAME = '*';

async function main() {
  if (config.databaseUrl) {
    try {
      await runMigrations(config.databaseUrl);
      console.log('[Worker] Migrations completed');
    } catch (err) {
      console.error('[Worker] Migration error:', err.message);
    }
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`[Worker] ${job.name}#${job.id} processing`);
      const result = await runTask(job.name, job.data);
      console.log(`[Worker] ${job.name}#${job.id} done`);
      return result;
    },
    {
      connection: getRedisConnection(),
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[Worker] ${job?.name}#${job?.id} FAILED: ${err.message}`);
  });

  console.log('[Worker] BullMQ worker started, listening for jobs...');

  if (runsWorker()) {
    const { startScheduler } = await import('./lib/scheduler.js');
    startScheduler();
    console.log('[scheduler:init] Scheduler initialized in worker');
  }
}

main().catch((err) => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});

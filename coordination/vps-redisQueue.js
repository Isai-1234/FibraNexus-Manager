/**
 * Cola Redis BullMQ — enqueue hacia worker-bullmq.js (queue "*")
 */
import { Queue } from 'bullmq';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

let queue;
function getQueue() {
  if (!queue) queue = new Queue('*', { connection });
  return queue;
}

export async function enqueueRedis(jobName, payload = {}) {
  const q = getQueue();
  const job = await q.add(jobName, payload, {
    removeOnComplete: 100,
    removeOnFail: 50,
  });
  console.log(`[queue] enqueued ${jobName}#${job.id}`);
  return { queued: true, jobId: job.id };
}

export function shouldUseJobQueue() {
  if (!config.useJobQueue) return false;
  if (config.redisUrl) return true;
  return Boolean(process.env.REDIS_HOST);
}

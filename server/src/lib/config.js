/**
 * Config centralizada — cambiar proveedor = cambiar env, no código.
 */
export const config = {
  port: parseInt(process.env.PORT || '10000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  dbPoolMax: parseInt(process.env.DB_POOL_MAX || '10', 10),
  jwtSecret: process.env.JWT_SECRET,
  frontendUrl: process.env.FRONTEND_URL || '*',
  publicUrl: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || process.env.FRONTEND_URL,
  processRole: (process.env.PROCESS_ROLE || 'all').toLowerCase(),
  redisUrl: process.env.REDIS_URL || null,
  useJobQueue: process.env.USE_JOB_QUEUE === 'true',
  commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || 'local',
};

export function runsApi() {
  return config.processRole === 'all' || config.processRole === 'api';
}

export function runsWorker() {
  return config.processRole === 'all' || config.processRole === 'worker';
}

export function shouldUseJobQueue() {
  return config.useJobQueue && Boolean(config.redisUrl);
}

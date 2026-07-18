import '../loadEnv.js';

/**
 * Config centralizada — cambiar proveedor = cambiar env, no código.
 * Getters: leen process.env en el momento del uso (no al importar el módulo).
 */
function cleanDatabaseUrl(raw) {
  let v = String(raw || '').trim();
  // Errores comunes al pegar desde .env en Render Value:
  // DATABASE_URL="postgresql://..."  o  DATABASE_URL=postgresql://...
  if (/^DATABASE_URL\s*=/i.test(v)) {
    v = v.replace(/^DATABASE_URL\s*=\s*/i, '').trim();
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

export const config = {
  get port() {
    return parseInt(process.env.PORT || '10000', 10);
  },
  get databaseUrl() {
    return cleanDatabaseUrl(process.env.DATABASE_URL);
  },
  get dbPoolMax() {
    return parseInt(process.env.DB_POOL_MAX || '10', 10);
  },
  get jwtSecret() {
    return process.env.JWT_SECRET;
  },
  get frontendUrl() {
    return process.env.FRONTEND_URL || '*';
  },
  get publicUrl() {
    return process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || process.env.FRONTEND_URL;
  },
  get processRole() {
    return (process.env.PROCESS_ROLE || 'all').toLowerCase();
  },
  get redisUrl() {
    return process.env.REDIS_URL || null;
  },
  get useJobQueue() {
    return process.env.USE_JOB_QUEUE === 'true';
  },
  get commit() {
    return process.env.RENDER_GIT_COMMIT?.slice(0, 7) || 'local';
  },
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

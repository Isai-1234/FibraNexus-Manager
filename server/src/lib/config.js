import '../loadEnv.js';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Config centralizada — cambiar proveedor = cambiar env, no código.
 * Getters: leen process.env en el momento del uso (no al importar el módulo).
 */

/**
 * Limpia valores mal pegados desde el modal Connect de Supabase / .env:
 * comentarios, KEY=, comillas, saltos de línea.
 */
export function cleanDatabaseUrl(raw) {
  let v = String(raw || '').trim();
  if (!v) return '';

  // Si pegaron varias líneas (comentario + DATABASE_URL=...), quedarnos con la URI
  const uriMatch = v.match(/postgres(?:ql)?:\/\/[^\s"'`]+/i);
  if (uriMatch) {
    v = uriMatch[0];
  } else {
    v = v
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .join('')
      .trim();
    if (/^DATABASE_URL\s*=/i.test(v)) {
      v = v.replace(/^DATABASE_URL\s*=\s*/i, '').trim();
    }
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).trim();
    }
  }

  // Quitar comillas residuales al final
  v = v.replace(/^["']|["']$/g, '');
  return v.trim();
}

function resolveGitCommit() {
  const fromEnv = (
    process.env.RENDER_GIT_COMMIT
    || process.env.GIT_COMMIT
    || process.env.COMMIT_SHA
    || process.env.SOURCE_VERSION
    || ''
  ).trim();
  if (fromEnv) return fromEnv.slice(0, 7);

  try {
    const sha = execSync('git rev-parse --short HEAD', {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    }).trim();
    if (sha) return sha.slice(0, 7);
  } catch { /* sin git en PATH */ }

  try {
    const gitHead = join(process.cwd(), '.git', 'HEAD');
    if (!existsSync(gitHead)) return 'local';
    const head = readFileSync(gitHead, 'utf8').trim();
    if (head.startsWith('ref:')) {
      const ref = head.slice(4).trim();
      const refPath = join(process.cwd(), '.git', ref);
      if (existsSync(refPath)) {
        return readFileSync(refPath, 'utf8').trim().slice(0, 7);
      }
    }
    return head.slice(0, 7);
  } catch {
    return 'local';
  }
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
    return resolveGitCommit();
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

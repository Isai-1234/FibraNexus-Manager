/**
 * Proceso worker — Render servicio #2 cuando escales.
 * Env: PROCESS_ROLE=worker (+ DATABASE_URL, REDIS_URL opcional)
 */
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.PROCESS_ROLE || process.env.PROCESS_ROLE === 'all') {
  process.env.PROCESS_ROLE = 'worker';
}

import { runMigrations } from './db/migrate.js';
import { startScheduler } from './lib/scheduler.js';
import { config } from './lib/config.js';

async function main() {
  if (config.databaseUrl) {
    try {
      await runMigrations(config.databaseUrl);
    } catch (err) {
      console.error('Migration error:', err);
    }
  }
  startScheduler();
  console.log('FibraNexus worker running (role=worker, queue=%s)', config.useJobQueue ? 'redis' : 'inline');
}

main();

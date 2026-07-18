#!/usr/bin/env node
/**
 * Ejecuta migraciones SQL versionadas en server/migrations/*.sql
 * (ignora *.down.sql). Separado del arranque de la API.
 *
 *   node scripts/run-migrations.mjs
 */
import 'dotenv/config';
import { runVersionedMigrations } from '../server/src/db/runVersionedMigrations.js';
import { cleanDatabaseUrl } from '../server/src/lib/config.js';

async function main() {
  const url = cleanDatabaseUrl(process.env.DATABASE_URL);
  if (!url) {
    console.error('DATABASE_URL requerida');
    process.exit(1);
  }
  await runVersionedMigrations(url);
  console.log('Migraciones OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

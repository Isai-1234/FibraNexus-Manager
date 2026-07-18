#!/usr/bin/env node
/**
 * Ejecuta migraciones SQL versionadas en server/migrations/*.sql
 * (ignora *.down.sql). Separado del arranque de la API.
 *
 *   node scripts/run-migrations.mjs
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '../server/migrations');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL requerida');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.sql') && !f.includes('.down.'))
      .sort();

    for (const file of files) {
      const id = file.replace(/\.sql$/, '');
      const [{ exists }] = await sql`
        SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE id = ${id}) AS exists
      `;
      if (exists) {
        console.log('skip', id);
        continue;
      }
      const body = fs.readFileSync(path.join(dir, file), 'utf8');
      console.log('apply', id);
      await sql.unsafe(body);
      await sql`INSERT INTO schema_migrations (id) VALUES (${id}) ON CONFLICT DO NOTHING`;
    }
    console.log('Migraciones OK');
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

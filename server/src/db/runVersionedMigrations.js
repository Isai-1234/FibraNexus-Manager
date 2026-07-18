/**
 * Migraciones versionadas (server/migrations/*.sql).
 * Idempotentes vía schema_migrations.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '../../migrations');

export async function runVersionedMigrations(connectionString) {
  if (!connectionString) {
    throw new Error('DATABASE_URL requerida para migraciones versionadas');
  }
  const sql = postgres(connectionString, {
    max: 1,
    ssl: connectionString.includes('supabase') ? 'require' : undefined,
  });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql') && !f.includes('.down.'))
      .sort();

    for (const file of files) {
      const id = file.replace(/\.sql$/, '');
      const [{ exists }] = await sql`
        SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE id = ${id}) AS exists
      `;
      if (exists) {
        console.log('[migrate]', 'skip', id);
        continue;
      }
      const body = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log('[migrate]', 'apply', id);
      await sql.unsafe(body);
      await sql`INSERT INTO schema_migrations (id) VALUES (${id}) ON CONFLICT DO NOTHING`;
    }
    console.log('[migrate] versioned OK');
  } finally {
    await sql.end();
  }
}

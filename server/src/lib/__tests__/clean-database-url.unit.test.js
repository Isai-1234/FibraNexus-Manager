/**
 * Limpieza de DATABASE_URL mal pegada desde Supabase Connect / .env
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDatabaseUrl } from '../config.js';

describe('cleanDatabaseUrl', () => {
  it('extracts URI from multiline Connect paste', () => {
    const raw = `# Connect to Postgres via the shared transaction-mode pooler (IPv4-only)
DATABASE_URL="postgresql://postgres.abc:Secret.123@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true"`;
    assert.equal(
      cleanDatabaseUrl(raw),
      'postgresql://postgres.abc:Secret.123@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
    );
  });

  it('accepts plain URI', () => {
    const u = 'postgresql://postgres:pass@db.xxx.supabase.co:5432/postgres';
    assert.equal(cleanDatabaseUrl(u), u);
  });

  it('strips KEY= and quotes', () => {
    assert.equal(
      cleanDatabaseUrl('DATABASE_URL="postgresql://u:p@h:5432/db"'),
      'postgresql://u:p@h:5432/db',
    );
  });
});

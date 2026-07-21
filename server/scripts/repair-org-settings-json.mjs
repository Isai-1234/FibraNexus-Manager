#!/usr/bin/env node
/**
 * Repara organizations.settings guardados como JSON string dentro de jsonb.
 *
 *   cd server && node --env-file=.env scripts/repair-org-settings-json.mjs
 *
 * Idempotente vía schema_patches.repair_org_settings_json_v1
 */
import postgres from 'postgres';
import { normalizeOrgSettingsRaw } from '../src/lib/orgSettings.js';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }
  const sql = postgres(databaseUrl, { max: 1 });
  const force = process.env.FORCE_ORG_SETTINGS_REPAIR === '1';

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_patches (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        details JSONB
      )
    `;

    const [already] = await sql`
      SELECT id FROM schema_patches WHERE id = 'repair_org_settings_json_v1' LIMIT 1
    `;
    if (already && !force) {
      console.log('Patch repair_org_settings_json_v1 already applied — skip');
      return;
    }

    const rows = await sql`SELECT id, slug, settings, jsonb_typeof(settings) AS jtype FROM organizations`;
    let fixed = 0;
    for (const row of rows) {
      const needsUnwrap = row.jtype === 'string'
        || (typeof row.settings === 'string');
      if (!needsUnwrap) {
        console.log(`org#${row.id} ${row.slug}: ok (jsonb ${row.jtype})`);
        continue;
      }
      const obj = normalizeOrgSettingsRaw(row.settings);
      await sql`
        UPDATE organizations
        SET settings = ${sql.json(obj)}, updated_at = NOW()
        WHERE id = ${row.id}
      `;
      fixed += 1;
      console.log(`org#${row.id} ${row.slug}: unwrapped string → object (keys=${Object.keys(obj).length})`);
    }

    await sql`
      INSERT INTO schema_patches (id, details)
      VALUES ('repair_org_settings_json_v1', ${sql.json({ fixed })})
      ON CONFLICT (id) DO UPDATE SET applied_at = NOW(), details = EXCLUDED.details
    `;
    console.log('Done.', { fixed, total: rows.length });
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

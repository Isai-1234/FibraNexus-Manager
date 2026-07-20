#!/usr/bin/env node
/**
 * Reparación one-shot de texto doble-codificado (UTF-8 leído como Latin-1).
 *
 * Uso (desde /root/app o server/):
 *   node --env-file=server/.env server/scripts/repair-utf8-mojibake.mjs
 *   # o con cwd en server/:
 *   node --env-file=.env scripts/repair-utf8-mojibake.mjs
 *
 * Idempotente: solo reescribe filas donde looksLikeUtf8Mojibake(campo).
 * Idempotencia de patch: tabla schema_patches key = repair_utf8_mojibake_v1
 * (se puede forzar con FORCE_UTF8_REPAIR=1).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { looksLikeUtf8Mojibake, repairUtf8Mojibake } from '../src/lib/utf8Text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const force = process.env.FORCE_UTF8_REPAIR === '1';

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_patches (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        details JSONB
      )
    `;

    const [already] = await sql`
      SELECT id FROM schema_patches WHERE id = 'repair_utf8_mojibake_v1' LIMIT 1
    `;
    if (already && !force) {
      console.log('Patch repair_utf8_mojibake_v1 already applied — skip (FORCE_UTF8_REPAIR=1 to re-run)');
      return;
    }

    const stats = {
      usersFullName: 0,
      clientsAddress: 0,
      clientsCity: 0,
      clientsRegion: 0,
      clientsNotes: 0,
      clientsPlanNombre: 0,
      plansName: 0,
      plansDescription: 0,
    };

    const userRows = await sql`SELECT id, full_name FROM users WHERE full_name IS NOT NULL`;
    for (const row of userRows) {
      if (!looksLikeUtf8Mojibake(row.full_name)) continue;
      const fixed = repairUtf8Mojibake(row.full_name);
      if (fixed === row.full_name) continue;
      await sql`UPDATE users SET full_name = ${fixed}, updated_at = NOW() WHERE id = ${row.id}`;
      stats.usersFullName += 1;
      console.log(`users#${row.id}: ${JSON.stringify(row.full_name)} → ${JSON.stringify(fixed)}`);
    }

    const clientRows = await sql`
      SELECT id, address, city, region, notes, plan_nombre
      FROM clients
      WHERE address IS NOT NULL OR city IS NOT NULL OR region IS NOT NULL
         OR notes IS NOT NULL OR plan_nombre IS NOT NULL
    `;
    for (const row of clientRows) {
      if (looksLikeUtf8Mojibake(row.address)) {
        const fixed = repairUtf8Mojibake(row.address);
        if (fixed !== row.address) {
          await sql`UPDATE clients SET address = ${fixed}, updated_at = NOW() WHERE id = ${row.id}`;
          stats.clientsAddress += 1;
          console.log(`clients#${row.id} address repaired`);
        }
      }
      if (looksLikeUtf8Mojibake(row.city)) {
        const fixed = repairUtf8Mojibake(row.city);
        if (fixed !== row.city) {
          await sql`UPDATE clients SET city = ${fixed}, updated_at = NOW() WHERE id = ${row.id}`;
          stats.clientsCity += 1;
          console.log(`clients#${row.id} city repaired`);
        }
      }
      if (looksLikeUtf8Mojibake(row.region)) {
        const fixed = repairUtf8Mojibake(row.region);
        if (fixed !== row.region) {
          await sql`UPDATE clients SET region = ${fixed}, updated_at = NOW() WHERE id = ${row.id}`;
          stats.clientsRegion += 1;
          console.log(`clients#${row.id} region repaired`);
        }
      }
      if (looksLikeUtf8Mojibake(row.notes)) {
        const fixed = repairUtf8Mojibake(row.notes);
        if (fixed !== row.notes) {
          await sql`UPDATE clients SET notes = ${fixed}, updated_at = NOW() WHERE id = ${row.id}`;
          stats.clientsNotes += 1;
          console.log(`clients#${row.id} notes repaired`);
        }
      }
      if (looksLikeUtf8Mojibake(row.plan_nombre)) {
        const fixed = repairUtf8Mojibake(row.plan_nombre);
        if (fixed !== row.plan_nombre) {
          await sql`UPDATE clients SET plan_nombre = ${fixed}, updated_at = NOW() WHERE id = ${row.id}`;
          stats.clientsPlanNombre += 1;
          console.log(`clients#${row.id} plan_nombre repaired`);
        }
      }
    }

    const planRows = await sql`SELECT id, name, description FROM plans`;
    for (const row of planRows) {
      if (looksLikeUtf8Mojibake(row.name)) {
        const fixed = repairUtf8Mojibake(row.name);
        if (fixed !== row.name) {
          await sql`UPDATE plans SET name = ${fixed}, updated_at = NOW() WHERE id = ${row.id}`;
          stats.plansName += 1;
          console.log(`plans#${row.id} name: ${JSON.stringify(row.name)} → ${JSON.stringify(fixed)}`);
        }
      }
      if (looksLikeUtf8Mojibake(row.description)) {
        const fixed = repairUtf8Mojibake(row.description);
        if (fixed !== row.description) {
          await sql`UPDATE plans SET description = ${fixed}, updated_at = NOW() WHERE id = ${row.id}`;
          stats.plansDescription += 1;
        }
      }
    }

    await sql`
      INSERT INTO schema_patches (id, details)
      VALUES ('repair_utf8_mojibake_v1', ${sql.json(stats)})
      ON CONFLICT (id) DO UPDATE SET applied_at = NOW(), details = EXCLUDED.details
    `;

    console.log('Done.', stats);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Migración de cifrado de secretos existentes (idempotente).
 *
 *   CREDENTIALS_ENCRYPTION_KEY=... node scripts/migrate-encrypt-secrets.mjs
 *
 * Plan de respaldo: pg_dump antes de ejecutar en producción.
 */
import 'dotenv/config';
import { db } from '../server/src/db/index.js';
import { equipment } from '../server/src/db/schema.js';
import { eq } from 'drizzle-orm';
import {
  encryptSecret,
  encryptCredentialsObject,
  isEncryptedValue,
  getEncryptionKey,
} from '../server/src/lib/secrets.js';

async function main() {
  if (!getEncryptionKey()) {
    console.error('CREDENTIALS_ENCRYPTION_KEY requerida');
    process.exit(1);
  }

  const rows = await db.select({
    id: equipment.id,
    credentials: equipment.credentials,
    snmpCommunity: equipment.snmpCommunity,
  }).from(equipment);

  let updated = 0;
  for (const row of rows) {
    let changed = false;
    let creds = row.credentials;
    if (creds && typeof creds === 'object') {
      const next = encryptCredentialsObject(creds);
      if (JSON.stringify(next) !== JSON.stringify(creds)) {
        creds = next;
        changed = true;
      }
    }
    let snmp = row.snmpCommunity;
    if (snmp && !isEncryptedValue(snmp)) {
      snmp = encryptSecret(snmp);
      changed = true;
    }
    if (changed) {
      await db.update(equipment)
        .set({
          credentials: creds,
          snmpCommunity: snmp,
          updatedAt: new Date(),
        })
        .where(eq(equipment.id, row.id));
      updated += 1;
    }
  }

  console.log(`Migración cifrado OK. Equipos actualizados: ${updated}/${rows.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

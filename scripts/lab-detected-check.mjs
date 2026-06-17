/**
 * Diagnóstico lab Internetsur — equipos CPE vs detected_devices.
 * Uso: pegar DATABASE_URL en server/.env, luego:
 *   cd server && node ../scripts/lab-detected-check.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, '../server/package.json'));
require('dotenv').config({ path: join(__dirname, '../server/.env') });

const LAB_MACS = ['28:70:4e:bc:79:69', 'e4:b9:7a:09:2f:99'];

function normalizeMac(mac) {
  if (!mac) return null;
  const clean = String(mac).toLowerCase().replace(/[^0-9a-f]/g, '');
  if (clean.length !== 12) return null;
  return clean.replace(/(.{2})(?=.)/g, '$1:');
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error('\n❌ DATABASE_URL vacío en server/.env');
    console.error('   Render → fibranexus-api → Environment → copia DATABASE_URL (Supabase)\n');
    process.exit(1);
  }

  const { db } = await import('../server/src/db/index.js');
  const { equipment, detectedDevices, clients, users, clientServices, organizations } = await import('../server/src/db/schema.js');
  const { eq, and, inArray, desc } = await import('drizzle-orm');
  const { syncDetectedDeviceStates, enrichDetectedRowsWithLiveClient } = await import('../server/src/lib/detectedDeviceSync.js');

  const [org] = await db.select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.slug, 'internetsur'))
    .limit(1);
  const orgRow = org || (await db.select({ id: organizations.id, name: organizations.name }).from(organizations).limit(1))[0];
  if (!orgRow) {
    console.error('No hay organizaciones en la base.');
    process.exit(1);
  }
  const orgId = orgRow.id;
  console.log(`\n📡 Org: ${orgRow.name} (id=${orgId})\n`);

  const normMacs = LAB_MACS.map(normalizeMac).filter(Boolean);

  const cpeRows = await db.select({
    id: equipment.id,
    name: equipment.name,
    macAddress: equipment.macAddress,
    ipAddress: equipment.ipAddress,
    clientId: equipment.clientId,
    clientName: users.fullName,
    detectedDeviceId: equipment.detectedDeviceId,
  })
    .from(equipment)
    .leftJoin(clients, eq(equipment.clientId, clients.id))
    .leftJoin(users, eq(clients.userId, users.id))
    .where(and(eq(equipment.organizationId, orgId), eq(equipment.type, 'cpe')));

  const ddRows = await db.select({
    id: detectedDevices.id,
    macAddress: detectedDevices.macAddress,
    ipAddress: detectedDevices.ipAddress,
    status: detectedDevices.status,
    adoptedAsClientServiceId: detectedDevices.adoptedAsClientServiceId,
    serviceClientId: clientServices.clientId,
    serviceClientName: users.fullName,
  })
    .from(detectedDevices)
    .leftJoin(clientServices, eq(detectedDevices.adoptedAsClientServiceId, clientServices.id))
    .leftJoin(clients, eq(clientServices.clientId, clients.id))
    .leftJoin(users, eq(clients.userId, users.id))
    .where(eq(detectedDevices.organizationId, orgId));

  function printBlock(title, rows, filterMacs) {
    console.log(`── ${title} ──`);
    for (const mac of filterMacs) {
      const cpe = cpeRows.find((r) => normalizeMac(r.macAddress) === mac);
      const dd = ddRows.find((r) => normalizeMac(r.macAddress) === mac);
      console.log(`  MAC ${mac}`);
      console.log(`    CPE equipment.clientId → ${cpe?.clientName || '(sin vincular)'}  ip=${cpe?.ipAddress || '—'}`);
      console.log(`    detected_devices       → status=${dd?.status || '—'}  join=${dd?.serviceClientName || '—'}`);
      if (cpe?.clientName && dd?.serviceClientName && cpe.clientName !== dd.serviceClientName) {
        console.log(`    ⚠️  DESINCRONIZADO: equipo dice "${cpe.clientName}", detected join dice "${dd.serviceClientName}"`);
      }
    }
    console.log('');
  }

  printBlock('ANTES del sync', normMacs, normMacs);

  const healed = await syncDetectedDeviceStates(orgId);
  console.log(`🔧 syncDetectedDeviceStates → healed=${healed}\n`);

  const rawAfter = await db.select({
    id: detectedDevices.id,
    macAddress: detectedDevices.macAddress,
    ipAddress: detectedDevices.ipAddress,
    status: detectedDevices.status,
    adoptedAsClientServiceId: detectedDevices.adoptedAsClientServiceId,
    adoptedClientId: clients.id,
    adoptedClientName: users.fullName,
  })
    .from(detectedDevices)
    .leftJoin(clientServices, eq(detectedDevices.adoptedAsClientServiceId, clientServices.id))
    .leftJoin(clients, eq(clientServices.clientId, clients.id))
    .leftJoin(users, eq(clients.userId, users.id))
    .where(and(eq(detectedDevices.organizationId, orgId), inArray(detectedDevices.macAddress, normMacs)));

  const enriched = await enrichDetectedRowsWithLiveClient(rawAfter, orgId);

  console.log('── DESPUÉS (lo que vería la UI con fixes locales) ──');
  for (const row of enriched) {
    const mac = normalizeMac(row.macAddress);
    console.log(`  ${row.ipAddress || '—'}  ${mac}`);
    console.log(`    effectiveStatus=${row.effectiveStatus}  abonado=${row.adoptedClientName || '(ninguno)'}`);
  }
  console.log('\n✅ Listo. Si abonado sigue mal, corrige en Carlos/Liliana → Equipos (vincular/desvincular).\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

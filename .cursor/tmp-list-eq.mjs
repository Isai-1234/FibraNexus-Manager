import { db } from '/root/app/server/src/db/index.js';
import { equipment, clients } from '/root/app/server/src/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { attachSnmpDisplay } from '/root/app/server/src/lib/equipmentStatus.js';

const rows = await db.select().from(equipment).where(eq(equipment.organizationId, 3));
for (const row of rows) {
  const d = attachSnmpDisplay(row);
  console.log(JSON.stringify({
    id: row.id,
    name: row.name,
    ip: row.ipAddress,
    clientId: row.clientId,
    mac: row.macAddress,
    status: d.status,
    wirelessSignal: d.wirelessSignal,
    apStationSignal: d.apStationSignal,
    pollMethod: d.snmpPollMethod,
    linkDown: d.linkDown,
  }));
}

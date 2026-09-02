import { snmpWalkViaRouter } from '/root/app/server/src/lib/mikrotikNetwork.js';
import { parseUbntStationTable } from '/root/app/server/src/lib/snmpPoller.js';
import { db } from '/root/app/server/src/db/index.js';
import { equipment } from '/root/app/server/src/db/schema.js';
import { eq } from 'drizzle-orm';

const [router] = await db.select().from(equipment).where(eq(equipment.id, 1));
const [ap] = await db.select().from(equipment).where(eq(equipment.id, 2));
const host = ap.ipAddress.split('/')[0];
const community = 'public';
const walk = await snmpWalkViaRouter(router, host, community, '1.3.6.1.4.1.41112.1.4.7.1');
const map = parseUbntStationTable(walk);
for (const [mac, row] of map) {
  console.log(mac, JSON.stringify(row));
}

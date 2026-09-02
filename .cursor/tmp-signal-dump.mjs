import { pollEquipmentList } from '/root/app/server/src/lib/snmpPoller.js';
import { db } from '/root/app/server/src/db/index.js';
import { equipment } from '/root/app/server/src/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { orgFilter } from '/root/app/server/src/lib/tenant.js';

const orgId = 3;
const items = await db.select().from(equipment).where(orgFilter(equipment, orgId));
const router = items.find((e) => e.id === 1);
const routerBySite = new Map([[items.find((e) => e.siteId)?.siteId, router]].filter(([k]) => k));

const targets = items.filter((e) => [19, 2].includes(e.id));
const results = await pollEquipmentList(targets, routerBySite, { siteDevices: items });

for (const r of results) {
  console.log('\n===', r.name || r.id);
  console.log(JSON.stringify({
    wireless: r.wireless,
    apStationWireless: r.apStationWireless,
    raw: r.wirelessDebug?.raw,
    apRaw: r.apStationWirelessDebug?.raw,
    pollMethod: r.pollMethod,
  }, null, 2));
}

import { pollAllSnmpForOrg, attachSnmpDisplay } from '/root/app/server/src/lib/equipmentStatus.js';
import { db } from '/root/app/server/src/db/index.js';
import { equipment } from '/root/app/server/src/db/schema.js';
import { eq } from 'drizzle-orm';

const poll = await pollAllSnmpForOrg(3);
console.log('poll summary', poll);

const rows = await db.select().from(equipment).where(eq(equipment.id, 19));
const display = attachSnmpDisplay(rows[0]);
console.log(JSON.stringify({
  name: display.name,
  wirelessSignal: display.wirelessSignal,
  apStationSignal: display.apStationSignal,
  wirelessCcq: display.wirelessCcq,
  apStationCcq: display.apStationCcq,
  snmpPollMethod: display.snmpPollMethod,
  lastSnmp: rows[0].credentials?.lastSnmp,
}, null, 2));

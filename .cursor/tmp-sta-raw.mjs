import { snmpWalkViaRouter } from '/root/app/server/src/lib/mikrotikNetwork.js';
import { db } from '/root/app/server/src/db/index.js';
import { equipment } from '/root/app/server/src/db/schema.js';
import { eq } from 'drizzle-orm';

const [router] = await db.select().from(equipment).where(eq(equipment.id, 1));
const [ap] = await db.select().from(equipment).where(eq(equipment.id, 2));
const host = ap.ipAddress.split('/')[0];
const walk = await snmpWalkViaRouter(router, host, 'public', '1.3.6.1.4.1.41112.1.4.7.1');
console.log('oids', Object.keys(walk).length);
console.log(Object.entries(walk).slice(0, 15).map(([k,v]) => `${k} = ${v}`).join('\n'));

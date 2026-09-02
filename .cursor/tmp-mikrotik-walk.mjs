import { mikrotikSnmpWalk } from '/root/app/server/src/lib/mikrotikNetwork.js';
import { db } from '/root/app/server/src/db/index.js';
import { equipment } from '/root/app/server/src/db/schema.js';
import { eq } from 'drizzle-orm';

const [router] = await db.select().from(equipment).where(eq(equipment.id, 1));
const host = '172.16.11.253';
try {
  const rows = await mikrotikSnmpWalk(router, { address: host, community: 'public', oid: '1.3.6.1.4.1.41112.1.4.7.1' });
  console.log('rows', rows.length);
  console.log(rows.slice(0, 20));
} catch (e) {
  console.error('walk error', e.message);
}

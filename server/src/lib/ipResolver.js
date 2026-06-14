import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { and, eq, ne } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import { listDhcpLeases } from './mikrotikNetwork.js';
import { listPppoeActive } from './mikrotikClient.js';

const STALE_MS = 5 * 60 * 1000;

function normalizeMAC(mac) {
  return (mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');
}

export function isResolvedIpFresh(credentials) {
  if (!credentials?.resolvedIp || !credentials?.resolvedAt) return false;
  return Date.now() - new Date(credentials.resolvedAt).getTime() < STALE_MS;
}

/** Devuelve el host efectivo para SNMP: IP dinámica resuelta (si fresca) o ipAddress estático. */
export function getEffectiveHost(eq) {
  const creds = eq.credentials || {};
  const mode = creds.connectionMode || 'static';
  if (mode !== 'static' && isResolvedIpFresh(creds)) {
    return creds.resolvedIp;
  }
  return eq.ipAddress?.trim().split('/')[0] || null;
}

export async function syncSiteLeases(siteId, orgId) {
  const [router] = await db.select().from(equipment)
    .where(and(eq(equipment.siteId, siteId), eq(equipment.type, 'router'), orgFilter(equipment, orgId)))
    .limit(1);
  if (!router) return 0;

  const devices = await db.select().from(equipment)
    .where(and(eq(equipment.siteId, siteId), ne(equipment.type, 'router'), orgFilter(equipment, orgId)));

  const dynamic = devices.filter((d) => (d.credentials?.connectionMode || 'static') !== 'static');
  if (!dynamic.length) return 0;

  const [leases, sessions] = await Promise.all([
    listDhcpLeases(router).catch(() => []),
    listPppoeActive(router).catch(() => []),
  ]);

  let resolved = 0;
  for (const device of dynamic) {
    const creds = device.credentials || {};
    const mode = creds.connectionMode;
    let newIp = null;

    if (mode === 'dhcp' && device.macAddress) {
      const norm = normalizeMAC(device.macAddress);
      const lease = leases.find((l) =>
        normalizeMAC(l['mac-address']) === norm &&
        (l.status === 'bound' || l['active-address']),
      );
      newIp = lease?.['active-address'] || lease?.address || null;
    } else if (mode === 'pppoe' && creds.pppoeUsername) {
      const sess = sessions.find((s) => s.name === creds.pppoeUsername);
      newIp = sess?.address || null;
    }

    if (newIp && newIp !== creds.resolvedIp) {
      await db.update(equipment)
        .set({ credentials: { ...creds, resolvedIp: newIp, resolvedAt: new Date().toISOString() } })
        .where(eq(equipment.id, device.id));
      resolved++;
      console.log('[ipResolver] %s (id=%d) %s → %s', device.name, device.id, mode, newIp);
    }
  }
  return resolved;
}

export async function syncOrgLeases(orgId) {
  const allEquip = await db.select({ siteId: equipment.siteId })
    .from(equipment)
    .where(and(orgFilter(equipment, orgId), ne(equipment.type, 'router')));

  const siteIds = [...new Set(allEquip.map((e) => e.siteId).filter(Boolean))];

  let total = 0;
  for (const siteId of siteIds) {
    total += await syncSiteLeases(siteId, orgId).catch((err) => {
      console.error('[ipResolver] site=%d error: %s', siteId, err.message);
      return 0;
    });
  }
  if (total) console.log('[ipResolver] org=%d resolved %d IP(s)', orgId, total);
  return total;
}

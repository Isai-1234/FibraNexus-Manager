import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import { pollEquipmentList } from './snmpPoller.js';

const STALE_MS = 2 * 60 * 1000;

export function isPollStale(lastSeen, staleMs = STALE_MS) {
  if (!lastSeen) return true;
  return Date.now() - new Date(lastSeen).getTime() > staleMs;
}

export function isPollable(item) {
  return item.type !== 'router'
    && Boolean(item.ipAddress?.trim())
    && Boolean(item.snmpCommunity?.trim());
}

async function buildRouterBySiteMap(items, orgId) {
  const siteIds = [...new Set(items.map((e) => e.siteId).filter(Boolean))];
  if (!siteIds.length) return new Map();
  // P1: 1 query con inArray en lugar de N queries seriales
  const routers = await db.select().from(equipment)
    .where(and(
      inArray(equipment.siteId, siteIds),
      eq(equipment.type, 'router'),
      orgFilter(equipment, orgId),
    ));
  // Un router por site: si hay varios, toma el primero encontrado
  const map = new Map();
  for (const router of routers) {
    if (router.siteId && !map.has(router.siteId)) map.set(router.siteId, router);
  }
  return map;
}

export async function persistPollResult(row, result) {
  const status = result.online ? 'online' : 'offline';
  const [updated] = await db.update(equipment).set({
    status,
    lastSeen: new Date(),
    credentials: { ...(row.credentials || {}), lastSnmp: result },
    updatedAt: new Date(),
  }).where(eq(equipment.id, row.id)).returning();
  return updated;
}

export function attachSnmpDisplay(item) {
  const lastSnmp = item.credentials?.lastSnmp;
  const wireless = lastSnmp?.wireless;
  // Fallback: métricas enviadas por heartbeat EdgeRouter vía SNMP
  const lm = item.credentials?.lastMetrics;
  return {
    ...item,
    snmpOnline: item.status === 'online',
    snmpUptime: lastSnmp?.uptime || null,
    snmpPolledAt: lastSnmp?.polledAt || lm?.ts || item.lastSeen || null,
    snmpError: lastSnmp?.error || null,
    snmpPollMethod: lastSnmp?.pollMethod || null,
    snmpSysDescr: lastSnmp?.sysDescr || null,
    wirelessSignal: wireless?.signalDbm ?? lm?.signal ?? null,
    wirelessRssi: wireless?.rssiDbm ?? null,
    wirelessCcq: wireless?.ccqPercent ?? lm?.txCcq ?? null,
    wirelessSnr: wireless?.snrDb ?? lm?.cinr ?? null,
    wirelessTxRate: wireless?.txRateMbps ?? (lm?.txRate ? lm.txRate / 1_000_000 : null) ?? null,
    wirelessRxRate: wireless?.rxRateMbps ?? (lm?.rxRate ? lm.rxRate / 1_000_000 : null) ?? null,
    wirelessWarnings: wireless?.warnings || [],
    wirelessDebugHint: lastSnmp?.wirelessDebug?.hint || null,
    linkQuality: wireless?.linkQuality ?? null,
  };
}

/** Poll stale CPE/AP devices and update DB (max N per request to avoid timeouts). */
export async function refreshStaleEquipmentStatus(items, orgId, { maxPoll = 15 } = {}) {
  const stale = items.filter((e) => isPollable(e) && isPollStale(e.lastSeen));
  if (!stale.length) return items.map(attachSnmpDisplay);

  const toPoll = stale.slice(0, maxPoll);
  const routerBySite = await buildRouterBySiteMap(toPoll, orgId);
  const results = await pollEquipmentList(toPoll, routerBySite);
  const byId = new Map(items.map((e) => [e.id, { ...e }]));

  for (const r of results) {
    if (r.skipped) continue;
    const row = items.find((e) => e.id === r.id);
    if (!row) continue;

    const patch = {
      status: r.online ? 'online' : 'offline',
      lastSeen: new Date(),
      credentials: { ...(row.credentials || {}), lastSnmp: r },
    };

    // Siempre escribir — un error de SNMP es offline confirmado
    await db.update(equipment).set({ ...patch, updatedAt: new Date() })
      .where(eq(equipment.id, row.id));

    byId.set(row.id, attachSnmpDisplay({ ...row, ...patch }));
  }

  return items.map((e) => byId.get(e.id) || attachSnmpDisplay(e));
}

export async function pollAllSnmpForOrg(orgId) {
  const items = await db.select().from(equipment)
    .where(and(orgFilter(equipment, orgId), ne(equipment.type, 'router')));
  const pollable = items.filter(isPollable);
  if (!pollable.length) return { polled: 0, online: 0, offline: 0 };

  const routerBySite = await buildRouterBySiteMap(pollable, orgId);
  const results = await pollEquipmentList(pollable, routerBySite);
  let online = 0;
  let offline = 0;

  for (const r of results) {
    if (r.skipped) continue;
    const row = items.find((e) => e.id === r.id);
    if (!row) continue;
    if (r.online) online++;
    else offline++;
    // Siempre persistir — error = offline confirmado; sin esto el status queda 'online' en BD
    await persistPollResult(row, r);
  }

  return { polled: pollable.length, online, offline };
}

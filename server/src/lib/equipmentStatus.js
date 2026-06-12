import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { and, eq, ne } from 'drizzle-orm';
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
  const map = new Map();
  for (const siteId of siteIds) {
    const [router] = await db.select().from(equipment)
      .where(and(
        eq(equipment.siteId, siteId),
        eq(equipment.type, 'router'),
        orgFilter(equipment, orgId),
      ))
      .limit(1);
    if (router) map.set(siteId, router);
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
  return {
    ...item,
    snmpOnline: item.status === 'online',
    snmpUptime: lastSnmp?.uptime || null,
    snmpPolledAt: lastSnmp?.polledAt || item.lastSeen || null,
    snmpError: lastSnmp?.error || null,
    wirelessSignal: wireless?.signalDbm ?? null,
    wirelessRssi: wireless?.rssiDbm ?? null,
    wirelessCcq: wireless?.ccqPercent ?? null,
    wirelessSnr: wireless?.snrDb ?? null,
    wirelessTxRate: wireless?.txRateMbps ?? null,
    wirelessRxRate: wireless?.rxRateMbps ?? null,
    wirelessWarnings: wireless?.warnings || [],
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

    if (!r.error) {
      await db.update(equipment).set({ ...patch, updatedAt: new Date() })
        .where(eq(equipment.id, row.id));
    }

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
    if (r.error) offline++;
    else if (r.online) online++;
    else offline++;
    if (!r.error) await persistPollResult(row, r);
  }

  return { polled: pollable.length, online, offline };
}

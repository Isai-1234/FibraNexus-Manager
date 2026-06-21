import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { and, eq, ne } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import { pollEquipmentList } from './snmpPoller.js';

const STALE_MS = 2 * 60 * 1000;
/** Heartbeat ~30s; métricas del agente válidas un poco más que un ciclo. */
const METRICS_FRESH_MS = 90 * 1000;
const OFFLINE_AFTER_FAILURES = 3;

function isMetricsFresh(lastMetrics) {
  if (!lastMetrics?.ts) return false;
  return Date.now() - new Date(lastMetrics.ts).getTime() < METRICS_FRESH_MS;
}

/** Combina lastSnmp.wireless con lastMetrics del heartbeat cuando SNMP no trae wireless. */
function mergeWirelessDisplay(lastSnmpWireless, lastMetrics) {
  const w = lastSnmpWireless ? { ...lastSnmpWireless } : null;
  if (!isMetricsFresh(lastMetrics) || !lastMetrics?.signal || lastMetrics.signal === 0) {
    return w;
  }
  const signal = w?.signalDbm ?? lastMetrics.signal;
  const noise = w?.noiseFloorDbm ?? (lastMetrics.noise || null);
  const ccqFromSnmp = w?.ccqPercent;
  const ccq = (ccqFromSnmp != null && ccqFromSnmp > 0)
    ? ccqFromSnmp
    : (lastMetrics.txCcq > 0 ? lastMetrics.txCcq : ccqFromSnmp ?? null);
  let snr = w?.snrDb ?? null;
  if (snr == null && lastMetrics.cinr != null && lastMetrics.cinr !== 0) {
    snr = lastMetrics.cinr;
  } else if (snr == null && signal != null && noise != null) {
    snr = Math.round(signal - noise);
  }
  return {
    signalDbm: signal,
    rssiDbm: w?.rssiDbm ?? lastMetrics.signal,
    ccqPercent: ccq,
    noiseFloorDbm: noise,
    snrDb: snr,
    txRateMbps: w?.txRateMbps ?? lastMetrics.txRate ?? null,
    rxRateMbps: w?.rxRateMbps ?? lastMetrics.rxRate ?? null,
    warnings: w?.warnings || [],
    linkQuality: ccq ?? w?.linkQuality ?? (signal != null ? Math.min(100, Math.max(0, 100 + signal)) : null),
  };
}

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
  const prevFailures = row.credentials?.consecutiveFailures || 0;
  const failed = !result.online || Boolean(result.error);
  const consecutiveFailures = failed ? prevFailures + 1 : 0;
  const status = failed
    ? (consecutiveFailures >= OFFLINE_AFTER_FAILURES ? 'offline' : row.status)
    : 'online';

  const [updated] = await db.update(equipment).set({
    status,
    lastSeen: new Date(),
    credentials: { ...(row.credentials || {}), lastSnmp: result, consecutiveFailures },
    updatedAt: new Date(),
  }).where(eq(equipment.id, row.id)).returning();
  return updated;
}

export function attachSnmpDisplay(item) {
  const lastSnmp = item.credentials?.lastSnmp;
  const lastMetrics = item.credentials?.lastMetrics;
  const wireless = mergeWirelessDisplay(lastSnmp?.wireless, lastMetrics);
  const metricsFromHeartbeat = isMetricsFresh(lastMetrics)
    && Boolean(lastMetrics?.signal)
    && (!lastSnmp?.wireless?.signalDbm || (lastSnmp?.pollMethod === 'edgerouter-arp'));
  return {
    ...item,
    snmpOnline: item.status === 'online',
    snmpUptime: lastSnmp?.uptime || null,
    snmpPolledAt: lastSnmp?.polledAt || lastMetrics?.ts || item.lastSeen || null,
    snmpError: lastSnmp?.error || null,
    snmpPollMethod: metricsFromHeartbeat ? 'heartbeat' : (lastSnmp?.pollMethod || null),
    snmpSysDescr: lastSnmp?.sysDescr || null,
    wirelessSignal: wireless?.signalDbm ?? null,
    wirelessRssi: wireless?.rssiDbm ?? null,
    wirelessCcq: wireless?.ccqPercent ?? null,
    wirelessSnr: wireless?.snrDb ?? null,
    wirelessTxRate: wireless?.txRateMbps ?? null,
    wirelessRxRate: wireless?.rxRateMbps ?? null,
    wirelessWarnings: wireless?.warnings || [],
    wirelessDebugHint: lastSnmp?.wirelessDebug?.hint || null,
    linkQuality: wireless?.linkQuality ?? null,
  };
}

export function attachEquipmentDisplay(item) {
  return {
    ...attachSnmpDisplay(item),
    isStale: isPollable(item) && isPollStale(item.lastSeen),
  };
}

async function applyPollResults(items, results) {
  const byId = new Map(items.map((e) => [e.id, { ...e }]));

  for (const r of results) {
    if (r.skipped) continue;
    const row = items.find((e) => e.id === r.id);
    if (!row) continue;

    const prevFailures = row.credentials?.consecutiveFailures || 0;
    const failed = !r.online || Boolean(r.error);
    const consecutiveFailures = failed ? prevFailures + 1 : 0;
    const status = failed
      ? (consecutiveFailures >= OFFLINE_AFTER_FAILURES ? 'offline' : row.status)
      : 'online';

    const patch = {
      status,
      lastSeen: new Date(),
      credentials: { ...(row.credentials || {}), lastSnmp: r, consecutiveFailures },
    };

    if (!r.error || consecutiveFailures >= OFFLINE_AFTER_FAILURES) {
      await db.update(equipment).set({ ...patch, updatedAt: new Date() })
        .where(eq(equipment.id, row.id));
    }

    byId.set(row.id, { ...row, ...patch });
  }

  return items.map((e) => attachEquipmentDisplay(byId.get(e.id) || e));
}

/** Poll stale CPE/AP devices and update DB (max N per request to avoid timeouts). */
export async function refreshStaleEquipmentStatus(items, orgId, { maxPoll = 15 } = {}) {
  const stale = items.filter((e) => isPollable(e) && isPollStale(e.lastSeen));
  if (!stale.length) return items.map(attachEquipmentDisplay);

  const toPoll = stale.slice(0, maxPoll);
  const routerBySite = await buildRouterBySiteMap(toPoll, orgId);
  const results = await pollEquipmentList(toPoll, routerBySite);
  return applyPollResults(items, results);
}

/** Fuerza poll SNMP de todos los equipos pollables (background refresh). */
export async function forceRefreshEquipmentStatus(items, orgId, { maxPoll = 15 } = {}) {
  const pollable = items.filter(isPollable);
  if (!pollable.length) return items.map(attachEquipmentDisplay);

  const toPoll = pollable.slice(0, maxPoll);
  const routerBySite = await buildRouterBySiteMap(toPoll, orgId);
  const results = await pollEquipmentList(toPoll, routerBySite);
  return applyPollResults(items, results);
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
    await persistPollResult(row, r);
  }

  return { polled: pollable.length, online, offline };
}

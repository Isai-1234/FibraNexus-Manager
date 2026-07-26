import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { and, eq, ne } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import { pollEquipmentList } from './snmpPoller.js';

const STALE_MS = 2 * 60 * 1000;
/** Heartbeat ~30s; métricas del agente válidas un poco más que un ciclo. */
const METRICS_FRESH_MS = 90 * 1000;
const OFFLINE_AFTER_FAILURES = 3;
/** Un equipo que no responde retiene el puente SNMP del router: se reintenta espaciado. */
const FAILED_RETRY_MS = 10 * 60 * 1000;

function isInFailureBackoff(item) {
  const creds = item.credentials || {};
  if ((creds.consecutiveFailures || 0) < OFFLINE_AFTER_FAILURES) return false;
  const lastAttempt = creds.lastSnmp?.polledAt;
  if (!lastAttempt) return false;
  return Date.now() - new Date(lastAttempt).getTime() < FAILED_RETRY_MS;
}

function isMetricsFresh(lastMetrics) {
  if (!lastMetrics?.ts) return false;
  return Date.now() - new Date(lastMetrics.ts).getTime() < METRICS_FRESH_MS;
}

function isEdgeRouterAgent(router) {
  return Boolean(router?.credentials?.agentToken);
}

/** Presencia reciente vía agente EdgeRouter (ARP o cpeMetrics) — no degradar por SNMP fallido desde Render. */
export function hasRecentHeartbeatPresence(row) {
  const creds = row.credentials || {};
  const lastSeenMs = row.lastSeen ? Date.now() - new Date(row.lastSeen).getTime() : Infinity;
  const seenRecently = lastSeenMs < METRICS_FRESH_MS;
  const viaArp = creds.lastSnmp?.pollMethod === 'edgerouter-arp';
  const viaHbSnmp = creds.lastSnmp?.pollMethod === 'edgerouter-heartbeat';
  return seenRecently && (viaArp || viaHbSnmp || isMetricsFresh(creds.lastMetrics));
}

function pickBestSignal(snmpSignal, heartbeatSignal, pollMethod) {
  if (heartbeatSignal == null || heartbeatSignal === 0) return snmpSignal ?? null;
  if (snmpSignal == null) return heartbeatSignal;
  if (pollMethod === 'edgerouter-arp' || pollMethod === 'heartbeat' || pollMethod === 'edgerouter-heartbeat') {
    return heartbeatSignal;
  }
  // SNMP remoto erróneo (-96) vs heartbeat coherente (-62)
  if (snmpSignal <= -90 && heartbeatSignal > -80) return heartbeatSignal;
  return snmpSignal;
}

/** Combina lastSnmp.wireless con lastMetrics del heartbeat cuando SNMP no trae wireless. */
function mergeWirelessDisplay(lastSnmpWireless, lastMetrics, pollMethod) {
  const w = lastSnmpWireless ? { ...lastSnmpWireless } : null;
  const hbSignal = isMetricsFresh(lastMetrics) && lastMetrics?.signal ? lastMetrics.signal : null;
  if (!w && !hbSignal) return null;

  const signal = pickBestSignal(w?.signalDbm ?? null, hbSignal, pollMethod);
  const noise = w?.noiseFloorDbm ?? (lastMetrics?.noise || null);
  const ccqFromSnmp = w?.ccqPercent;
  const ccqFromHb = lastMetrics?.txCcq > 0 ? lastMetrics.txCcq : null;
  const ccq = (ccqFromSnmp != null && ccqFromSnmp > 0) ? ccqFromSnmp : ccqFromHb;
  let snr = w?.snrDb ?? null;
  if (snr == null && lastMetrics?.cinr != null && lastMetrics.cinr !== 0) {
    snr = lastMetrics.cinr;
  } else if (snr == null && signal != null && noise != null) {
    snr = Math.round(signal - noise);
  }
  return {
    signalDbm: signal,
    rssiDbm: w?.rssiDbm ?? hbSignal,
    ccqPercent: ccq ?? null,
    noiseFloorDbm: noise,
    snrDb: snr,
    txRateMbps: w?.txRateMbps ?? lastMetrics?.txRate ?? null,
    rxRateMbps: w?.rxRateMbps ?? lastMetrics?.rxRate ?? null,
    warnings: w?.warnings || [],
    linkQuality: ccq ?? w?.linkQuality ?? (signal != null ? Math.min(100, Math.max(0, 100 + signal)) : null),
  };
}

function mergeFailedPollSnmp(row, result, consecutiveFailures) {
  const prevSnmp = row.credentials?.lastSnmp || {};
  return {
    ...prevSnmp,
    polledAt: new Date().toISOString(),
    pollAttemptFailed: true,
    pollError: result.error || (result.online === false ? 'offline' : null),
    consecutivePollFailures: consecutiveFailures,
  };
}

/** Un timeout de la MIB wireless no debe borrar la última señal conocida del equipo. */
function carryOverWireless(row, result) {
  if (!result.online || result.wireless) return result;
  const budgetExceeded = result.wirelessDebug?.attempts?.includes('wireless-budget-exceeded');
  const prevWireless = row.credentials?.lastSnmp?.wireless;
  if (!budgetExceeded || !prevWireless) return result;
  return { ...result, wireless: prevWireless, wirelessStale: true };
}

function resolveStatusAfterPoll(row, failed, consecutiveFailures) {
  if (!failed) return 'online';
  if (hasRecentHeartbeatPresence(row)) return row.status === 'online' ? 'online' : row.status;
  if (consecutiveFailures >= OFFLINE_AFTER_FAILURES) return 'offline';
  return row.status;
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
  const status = resolveStatusAfterPoll(row, failed, consecutiveFailures);
  const lastSnmp = failed
    ? mergeFailedPollSnmp(row, result, consecutiveFailures)
    : carryOverWireless(row, result);

  const nextCreds = {
    ...(row.credentials || {}),
    lastSnmp,
    consecutiveFailures: failed ? consecutiveFailures : 0,
  };
  // IP remota reportada por el AP airMAX (gestión del CPE puede diferir de la inventariada).
  if (result.stationRemoteIp) {
    nextCreds.resolvedIp = result.stationRemoteIp;
    nextCreds.resolvedAt = new Date().toISOString();
    nextCreds.connectionMode = nextCreds.connectionMode || 'static';
  }

  const [updated] = await db.update(equipment).set({
    status,
    lastSeen: failed && hasRecentHeartbeatPresence(row) ? row.lastSeen : new Date(),
    credentials: nextCreds,
    updatedAt: new Date(),
  }).where(eq(equipment.id, row.id)).returning();
  return updated;
}

export function attachSnmpDisplay(item) {
  const lastSnmp = item.credentials?.lastSnmp;
  const lastMetrics = item.credentials?.lastMetrics;
  const pollMethod = lastSnmp?.pollMethod;
  const wireless = mergeWirelessDisplay(lastSnmp?.wireless, lastMetrics, pollMethod);
  const metricsFromHeartbeat = isMetricsFresh(lastMetrics)
    && Boolean(lastMetrics?.signal)
    && (!lastSnmp?.wireless?.signalDbm || (lastSnmp?.pollMethod === 'edgerouter-arp'));
  const display = {
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
  // Sanitizar secretos al final (mantiene flags hasSnmpCommunity / hasRouterPass)
  return sanitizeDisplay(display);
}

function sanitizeDisplay(display) {
  const { snmpCommunity, credentials, ...rest } = display;
  const creds = credentials && typeof credentials === 'object' ? credentials : {};
  const {
    routerPass: _rp,
    agentToken: _at,
    tunnelToken: _tt,
    snmpCommunity: _sc,
    pendingCmds,
    cmdHistory,
    heartbeatArp,
    heartbeatDhcp,
    ...safeCreds
  } = creds;
  return {
    ...rest,
    hasSnmpCommunity: !!(snmpCommunity && String(snmpCommunity).length > 0),
    snmpCommunitySet: !!(snmpCommunity && String(snmpCommunity).length > 0),
    credentials: {
      ...safeCreds,
      hasRouterPass: !!(creds.routerUser && creds.routerPass),
      hasAgentToken: !!creds.agentToken,
      hasTunnelToken: !!creds.tunnelToken,
      agentTokenRotatedAt: creds.agentTokenRotatedAt || null,
      pendingCmdCount: Array.isArray(pendingCmds) ? pendingCmds.length : 0,
    },
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
    const status = resolveStatusAfterPoll(row, failed, consecutiveFailures);
    const lastSnmp = failed
      ? mergeFailedPollSnmp(row, r, consecutiveFailures)
      : carryOverWireless(row, r);
    const keepHeartbeatSeen = failed && hasRecentHeartbeatPresence(row);

    const patch = {
      status,
      lastSeen: keepHeartbeatSeen ? row.lastSeen : new Date(),
      credentials: {
        ...(row.credentials || {}),
        lastSnmp,
        consecutiveFailures: failed ? consecutiveFailures : 0,
        ...(r.stationRemoteIp
          ? {
            resolvedIp: r.stationRemoteIp,
            resolvedAt: new Date().toISOString(),
            connectionMode: row.credentials?.connectionMode || 'static',
          }
          : {}),
      },
    };

    const shouldPersist = !failed
      || consecutiveFailures >= OFFLINE_AFTER_FAILURES
      || !keepHeartbeatSeen;

    if (shouldPersist) {
      await db.update(equipment).set({ ...patch, updatedAt: new Date() })
        .where(eq(equipment.id, row.id));
    }

    byId.set(row.id, { ...row, ...patch });
  }

  return items.map((e) => attachEquipmentDisplay(byId.get(e.id) || e));
}

function filterPollableFromRender(items, routerBySite) {
  return items.filter((eq) => {
    if (!isPollable(eq)) return false;
    const router = eq.siteId ? routerBySite.get(eq.siteId) : null;
    // Sitio con agente EdgeRouter: SNMP lo hace el heartbeat local, Render no alcanza la LAN
    if (router && isEdgeRouterAgent(router)) return false;
    return true;
  });
}

/** Poll stale CPE/AP devices and update DB (max N per request to avoid timeouts). */
export async function refreshStaleEquipmentStatus(items, orgId, { maxPoll = 15 } = {}) {
  const routerBySite = await buildRouterBySiteMap(items, orgId);
  const stale = filterPollableFromRender(items, routerBySite)
    .filter((e) => isPollStale(e.lastSeen) && !isInFailureBackoff(e));
  if (!stale.length) return items.map(attachEquipmentDisplay);

  const toPoll = stale.slice(0, maxPoll);
  // Va en la ruta de la petición: presupuesto corto, el resto sigue con su último estado.
  const results = await pollEquipmentList(toPoll, routerBySite, {
    routerBudgetMs: 6000,
    siteDevices: items,
  });
  return applyPollResults(items, results);
}

/** Fuerza poll SNMP de equipos alcanzables desde Render (no sitios EdgeRouter-agent). */
export async function forceRefreshEquipmentStatus(items, orgId, { maxPoll = 15 } = {}) {
  const routerBySite = await buildRouterBySiteMap(items, orgId);
  const pollable = filterPollableFromRender(items, routerBySite);
  if (!pollable.length) return items.map(attachEquipmentDisplay);

  const toPoll = pollable.slice(0, maxPoll);
  const results = await pollEquipmentList(toPoll, routerBySite, {
    routerBudgetMs: 20000,
    siteDevices: items,
  });
  return applyPollResults(items, results);
}

export async function pollAllSnmpForOrg(orgId) {
  const items = await db.select().from(equipment)
    .where(and(orgFilter(equipment, orgId), ne(equipment.type, 'router')));
  const pollable = items.filter((e) => isPollable(e) && !isInFailureBackoff(e));
  if (!pollable.length) return { polled: 0, online: 0, offline: 0 };

  const routerBySite = await buildRouterBySiteMap(pollable, orgId);
  const results = await pollEquipmentList(pollable, routerBySite, {
    routerBudgetMs: 20000,
    siteDevices: items,
  });
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

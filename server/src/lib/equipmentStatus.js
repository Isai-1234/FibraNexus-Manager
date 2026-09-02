import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { and, eq, ne } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import { pollEquipmentList } from './snmpPoller.js';
import { formatMacFromCompact, deviceMgmtIp } from './equipmentIdentity.js';
import { listDhcpLeases, listIpArp } from './mikrotikNetwork.js';

const STALE_MS = 45 * 1000;
/** Heartbeat ~30s; métricas del agente válidas un poco más que un ciclo. */
const METRICS_FRESH_MS = 90 * 1000;
const OFFLINE_AFTER_FAILURES = 3;
/**
 * Un equipo que no responde retiene el puente SNMP del router: se reintenta espaciado.
 * 90s: un intento fallido cuesta poco y con 10 min un equipo que vuelve tardaba
 * demasiado en re-evaluarse (recuperación debía ser manual).
 */
const FAILED_RETRY_MS = 90 * 1000;

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
function isIdleWireless(w) {
  if (!w) return true;
  const signal = w.signalDbm ?? w.rssiDbm;
  const noise = w.noiseFloorDbm;
  const ccq = w.ccqPercent;
  const tx = w.txRateMbps;
  const rx = w.rxRateMbps;
  return (signal == null || signal === 0 || signal <= -90)
    && (noise == null || noise <= -90)
    && (ccq == null || ccq === 0)
    && (!tx || tx === 0)
    && (!rx || rx === 0);
}

function mergeWirelessDisplay(lastSnmpWireless, lastMetrics, pollMethod) {
  if (isIdleWireless(lastSnmpWireless) && !isMetricsFresh(lastMetrics)) return null;
  const w = lastSnmpWireless && !isIdleWireless(lastSnmpWireless) ? { ...lastSnmpWireless } : null;
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
  const merged = {
    ...prevSnmp,
    polledAt: new Date().toISOString(),
    pollAttemptFailed: true,
    pollError: result.error || (result.online === false ? 'offline' : null),
    consecutivePollFailures: consecutiveFailures,
  };
  // Caída confirmada por el AP: no mostrar la última señal como si fuera actual.
  if (result.apConfirmedDown) {
    merged.wireless = null;
    merged.apStationWireless = null;
    merged.linkDown = true;
    merged.hint = 'El AP ya no reporta esta estación: enlace caído o CPE apagado.';
  }
  return merged;
}

/** Un timeout de la MIB wireless no debe borrar la última señal conocida del equipo. */
function carryOverWireless(row, result) {
  let out = result;
  if (result.online && !result.wireless) {
    const budgetExceeded = result.wirelessDebug?.attempts?.includes('wireless-budget-exceeded');
    const prevWireless = row.credentials?.lastSnmp?.wireless;
    if (budgetExceeded && prevWireless) {
      out = { ...result, wireless: prevWireless, wirelessStale: true };
    }
  }
  if (result.online && !result.apStationWireless) {
    const prevAp = row.credentials?.lastSnmp?.apStationWireless;
    if (prevAp) out = { ...out, apStationWireless: prevAp };
  }
  return snmpResultToLastSnmp(out);
}

/** Normaliza el objeto poll → lastSnmp persistido en credentials. */
function snmpResultToLastSnmp(result) {
  if (!result || typeof result !== 'object') return result;
  const {
    online, error, apConfirmedDown, pollMethod, polledAt, host, sysName, sysDescr, uptime,
    wireless, wirelessDebug, wirelessStale,
    apStationWireless, apStationWirelessDebug,
    stationRemoteIp, hint, linkDown, community, stationMac,
  } = result;
  return {
    polledAt: polledAt || new Date().toISOString(),
    pollMethod: pollMethod || null,
    online: online !== false,
    host: host || null,
    sysName: sysName || null,
    sysDescr: sysDescr || null,
    uptime: uptime || null,
    wireless: wireless || null,
    wirelessDebug: wirelessDebug || null,
    wirelessStale: wirelessStale || false,
    apStationWireless: apStationWireless || null,
    apStationWirelessDebug: apStationWirelessDebug || null,
    stationRemoteIp: stationRemoteIp || null,
    stationMac: stationMac || null,
    hint: hint || null,
    linkDown: linkDown || false,
    error: error || null,
    apConfirmedDown: apConfirmedDown || false,
    community: community || undefined,
  };
}

function resolveStatusAfterPoll(row, failed, consecutiveFailures, result) {
  if (!failed) return 'online';
  // El AP respondió y ya no lista la estación: evidencia directa de enlace caído, sin esperar 3 fallos.
  if (result?.apConfirmedDown) return 'offline';
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
  // Caída confirmada por AP: fijar en el umbral offline (no inflar cada 45s).
  const consecutiveFailures = failed
    ? (result.apConfirmedDown
      ? OFFLINE_AFTER_FAILURES
      : prevFailures + 1)
    : 0;
  const status = resolveStatusAfterPoll(row, failed, consecutiveFailures, result);
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

  const patch = {
    status,
    lastSeen: failed && hasRecentHeartbeatPresence(row) ? row.lastSeen : new Date(),
    credentials: nextCreds,
    updatedAt: new Date(),
  };
  // Corregir IP inventariada cuando el AP reporta otra (ej. .253 → .251).
  if (result.stationRemoteIp && result.stationRemoteIp !== row.ipAddress) {
    patch.ipAddress = result.stationRemoteIp;
    // Notas / “gestión .xxx” deben seguir la misma IP en todos lados.
    const syncedNotes = rewriteIpMentions(row.notes, row.ipAddress, result.stationRemoteIp);
    if (syncedNotes !== row.notes) patch.notes = syncedNotes;
  }

  // MAC desde tabla de estaciones del AP (identidad estable aunque cambie la IP DHCP).
  if (result.stationMac && !row.macAddress) {
    const mac = formatMacFromCompact(result.stationMac);
    if (mac) patch.macAddress = mac;
  }

  // Poll SNMP directo: actualizar IP de gestión si la MAC ya es conocida.
  if (result.online && result.host && result.pollMethod && result.pollMethod !== 'ap-station') {
    const polledIp = deviceMgmtIp({ host: result.host });
    if (polledIp && row.macAddress && polledIp !== row.ipAddress) {
      if (!patch.ipAddress) {
        patch.ipAddress = polledIp;
        const syncedNotes = rewriteIpMentions(row.notes, row.ipAddress, polledIp);
        if (syncedNotes !== row.notes && patch.notes === undefined) patch.notes = syncedNotes;
      }
    }
  }

  const [updated] = await db.update(equipment).set(patch).where(eq(equipment.id, row.id)).returning();
  return updated;
}

export function attachSnmpDisplay(item) {
  const lastSnmp = item.credentials?.lastSnmp;
  const lastMetrics = item.credentials?.lastMetrics;
  const pollMethod = lastSnmp?.pollMethod;
  const linkDown = Boolean(lastSnmp?.linkDown);
  const legacyStationOnly = pollMethod === 'ap-station' && !lastSnmp?.apStationWireless;
  const apStationSource = lastSnmp?.apStationWireless
    || (legacyStationOnly ? lastSnmp?.wireless : null);
  const cpeSource = legacyStationOnly ? null : lastSnmp?.wireless;
  // Offline / caída confirmada: no mostrar la última señal como si fuera actual.
  const wireless = (linkDown || item.status === 'offline')
    ? null
    : mergeWirelessDisplay(cpeSource, lastMetrics, pollMethod);
  const apStationWireless = (linkDown || item.status === 'offline')
    ? null
    : mergeWirelessDisplay(apStationSource, null, 'ap-station');
  const metricsFromHeartbeat = !linkDown
    && isMetricsFresh(lastMetrics)
    && Boolean(lastMetrics?.signal)
    && (!lastSnmp?.wireless?.signalDbm || (lastSnmp?.pollMethod === 'edgerouter-arp'));
  const resolvedIp = item.credentials?.resolvedIp || null;
  const displayIp = resolvedIp
    || (pollMethod === 'ap-station' && lastSnmp?.host)
    || item.ipAddress
    || null;
  const hasSnmp = Boolean(item.snmpCommunity?.trim());
  const unmonitored = !hasSnmp || pollMethod === 'unmonitored';
  const display = {
    ...item,
    displayIp,
    snmpOnline: item.status === 'online',
    snmpUptime: lastSnmp?.uptime || null,
    snmpPolledAt: lastSnmp?.polledAt || lastMetrics?.ts || item.lastSeen || null,
    snmpError: lastSnmp?.error || lastSnmp?.hint || null,
    snmpPollMethod: metricsFromHeartbeat ? 'heartbeat' : (lastSnmp?.pollMethod || null),
    snmpSysDescr: lastSnmp?.sysDescr || null,
    wirelessSignal: wireless?.signalDbm ?? null,
    wirelessRssi: wireless?.rssiDbm ?? null,
    wirelessCcq: wireless?.ccqPercent ?? null,
    wirelessNoise: wireless?.noiseFloorDbm ?? null,
    wirelessSnr: wireless?.snrDb ?? null,
    wirelessTxRate: wireless?.txRateMbps ?? null,
    wirelessRxRate: wireless?.rxRateMbps ?? null,
    wirelessWarnings: wireless?.warnings || [],
    apStationSignal: apStationWireless?.signalDbm ?? null,
    apStationCcq: apStationWireless?.ccqPercent ?? null,
    apStationNoise: apStationWireless?.noiseFloorDbm ?? null,
    apStationSnr: apStationWireless?.snrDb ?? null,
    apStationTxRate: apStationWireless?.txRateMbps ?? null,
    apStationRxRate: apStationWireless?.rxRateMbps ?? null,
    apStationWarnings: apStationWireless?.warnings || [],
    wirelessDebugHint: lastSnmp?.wirelessDebug?.hint || lastSnmp?.hint || null,
    linkQuality: wireless?.linkQuality ?? null,
    linkDown,
    // Sin SNMP no es “apagado”: es equipo de cliente sin monitoreo de gestión.
    statusLabel: item.status === 'online'
      ? 'Online'
      : (unmonitored ? 'Sin monitoreo' : 'Offline'),
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
    webPass: _wp,
    wifiPass: _wfp,
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
      hasWebPass: !!creds.webPass,
      hasWifiPass: !!creds.wifiPass,
      webUser: creds.webUser || null,
      wifiSsid: creds.wifiSsid || null,
      agentTokenRotatedAt: creds.agentTokenRotatedAt || null,
      pendingCmdCount: Array.isArray(pendingCmds) ? pendingCmds.length : 0,
    },
  };
}

export function attachEquipmentDisplay(item) {
  const display = {
    ...attachSnmpDisplay(item),
    isStale: isPollable(item) && isPollStale(item.lastSeen),
  };
  if (item.linkPeer) {
    display.linkPeer = attachSnmpDisplay(item.linkPeer);
  }
  return display;
}

async function applyPollResults(items, results) {
  const byId = new Map(items.map((e) => [e.id, { ...e }]));

  for (const r of results) {
    if (r.skipped) continue;
    const row = items.find((e) => e.id === r.id);
    if (!row) continue;

    const prevFailures = row.credentials?.consecutiveFailures || 0;
    const failed = !r.online || Boolean(r.error);
    const consecutiveFailures = failed
      ? (r.apConfirmedDown
        ? OFFLINE_AFTER_FAILURES
        : prevFailures + 1)
      : 0;
    const status = resolveStatusAfterPoll(row, failed, consecutiveFailures, r);
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
      ...(r.stationRemoteIp && r.stationRemoteIp !== row.ipAddress
        ? {
          ipAddress: r.stationRemoteIp,
          ...(rewriteIpMentions(row.notes, row.ipAddress, r.stationRemoteIp) !== row.notes
            ? { notes: rewriteIpMentions(row.notes, row.ipAddress, r.stationRemoteIp) }
            : {}),
        }
        : {}),
    };

    const shouldPersist = !failed
      || r.apConfirmedDown
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

function normalizeMac(mac) {
  return String(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');
}

/** Reescribe menciones de una IP vieja en notas/textos libres (p.ej. "gestión .253"). */
export function rewriteIpMentions(text, oldIp, newIp) {
  if (!text || !oldIp || !newIp || oldIp === newIp) return text || null;
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lastOctet = String(oldIp).split('.').pop();
  let out = String(text);
  out = out.replace(new RegExp(esc(oldIp), 'g'), newIp);
  if (lastOctet) {
    out = out.replace(new RegExp(`(gesti[oó]n\\s*\\.?\\s*)${esc(lastOctet)}\\b`, 'gi'), `$1${String(newIp).split('.').pop()}`);
    out = out.replace(new RegExp(`(\\.)${esc(lastOctet)}\\b`, 'g'), `.${String(newIp).split('.').pop()}`);
  }
  return out;
}

/**
 * Equipos sin SNMP (router WiFi del cliente, etc.): presencia por ARP/DHCP del MikroTik.
 * Si no aparecen, quedan en "Sin monitoreo" — no significa que estén apagados
 * (suelen vivir detrás del CPE / NAT del abonado).
 */
export async function refreshLanPresence(items, orgId) {
  const nonSnmp = items.filter((e) => e.type !== 'router' && e.ipAddress && !e.snmpCommunity?.trim());
  if (!nonSnmp.length) return items;

  const routerBySite = await buildRouterBySiteMap(nonSnmp, orgId);
  const byId = new Map(items.map((e) => [e.id, e]));
  const cache = new Map(); // siteId → { arp, leases }

  for (const device of nonSnmp) {
    const router = device.siteId ? routerBySite.get(device.siteId) : null;
    if (!router || isEdgeRouterAgent(router)) continue;

    if (!cache.has(device.siteId)) {
      const [arp, leases] = await Promise.all([
        listIpArp(router).catch(() => []),
        listDhcpLeases(router).catch(() => []),
      ]);
      cache.set(device.siteId, { arp, leases });
    }
    const { arp, leases } = cache.get(device.siteId);
    const mac = normalizeMac(device.macAddress);
    const ip = device.ipAddress?.trim().split('/')[0];

    const arpHit = arp.find((a) => {
      const aIp = String(a.address || '').split('/')[0];
      const aMac = normalizeMac(a['mac-address']);
      return (mac && aMac === mac) || (ip && aIp === ip);
    });
    const leaseHit = leases.find((l) => {
      const lIp = String(l['active-address'] || l.address || '').split('/')[0];
      const lMac = normalizeMac(l['mac-address'] || l['active-mac-address']);
      const bound = l.status === 'bound' || l['active-address'];
      return bound && ((mac && lMac === mac) || (ip && lIp === ip));
    });

    const seen = Boolean(arpHit || leaseHit);
    const seenIp = leaseHit?.['active-address'] || leaseHit?.address || arpHit?.address || ip;
    const prev = byId.get(device.id) || device;
    const nextStatus = seen ? 'online' : (prev.status === 'online' ? 'offline' : (prev.status || 'unknown'));
    const lastSnmp = {
      ...(prev.credentials?.lastSnmp || {}),
      polledAt: new Date().toISOString(),
      pollMethod: seen ? 'mikrotik-arp' : 'unmonitored',
      online: seen,
      host: seenIp,
      hint: seen
        ? 'Visible en ARP/DHCP del router del nodo.'
        : 'Sin SNMP y no aparece en ARP/DHCP del nodo. Normal si el WiFi del cliente está detrás del CPE (NAT). Internet del abonado no depende de este estado.',
    };

    const patch = {
      status: nextStatus,
      lastSeen: seen ? new Date() : prev.lastSeen,
      credentials: {
        ...(prev.credentials || {}),
        lastSnmp,
        consecutiveFailures: seen ? 0 : (prev.credentials?.consecutiveFailures || 0),
      },
      updatedAt: new Date(),
    };
    await db.update(equipment).set(patch).where(eq(equipment.id, device.id));
    byId.set(device.id, { ...prev, ...patch });
  }

  return items.map((e) => attachEquipmentDisplay(byId.get(e.id) || e));
}

/** Poll stale CPE/AP devices and update DB (max N per request to avoid timeouts). */
export async function refreshStaleEquipmentStatus(items, orgId, { maxPoll = 15 } = {}) {
  const routerBySite = await buildRouterBySiteMap(items, orgId);
  const stale = filterPollableFromRender(items, routerBySite)
    .filter((e) => isPollStale(e.lastSeen) && !isInFailureBackoff(e));

  let next = items;
  if (stale.length) {
    const toPoll = stale.slice(0, maxPoll);
    const results = await pollEquipmentList(toPoll, routerBySite, {
      routerBudgetMs: 6000,
      siteDevices: items,
    });
    next = await applyPollResults(items, results);
  }

  return refreshLanPresence(next, orgId);
}

/** Fuerza poll SNMP de equipos alcanzables desde Render (no sitios EdgeRouter-agent). */
export async function forceRefreshEquipmentStatus(items, orgId, { maxPoll = 15 } = {}) {
  const routerBySite = await buildRouterBySiteMap(items, orgId);
  const pollable = filterPollableFromRender(items, routerBySite);
  let next = items;
  if (pollable.length) {
    const toPoll = pollable.slice(0, maxPoll);
    const results = await pollEquipmentList(toPoll, routerBySite, {
      routerBudgetMs: 20000,
      siteDevices: items,
    });
    next = await applyPollResults(items, results);
  }
  return refreshLanPresence(next, orgId);
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

/**
 * Sync ligero estilo UISP: solo lee la tabla de estaciones de cada AP del sitio
 * y marca CPEs cliente online/offline por MAC. Mucho más barato que un poll SNMP completo.
 */
export async function syncApStationPresenceForOrg(orgId) {
  const items = await db.select().from(equipment)
    .where(and(orgFilter(equipment, orgId), ne(equipment.type, 'router')));
  if (!items.length) return { sites: 0, updated: 0, online: 0, offline: 0 };

  const routerBySite = await buildRouterBySiteMap(items, orgId);
  const bySite = new Map();
  for (const item of items) {
    if (!item.siteId) continue;
    if (!bySite.has(item.siteId)) bySite.set(item.siteId, []);
    bySite.get(item.siteId).push(item);
  }

  const { enrichFromApStations } = await import('./snmpPoller.js');
  let updated = 0;
  let online = 0;
  let offline = 0;
  let sites = 0;

  for (const [siteId, siteItems] of bySite) {
    const router = routerBySite.get(siteId);
    if (!router || isEdgeRouterAgent(router)) continue;

    const clientCpes = siteItems.filter((d) => d.clientId);
    if (!clientCpes.length) continue;
    sites++;

    const seed = clientCpes.map((d) => ({
      id: d.id,
      name: d.name,
      online: false,
      error: 'station-sync',
      polledAt: new Date().toISOString(),
    }));

    const enriched = await enrichFromApStations(seed, siteItems, router);
    for (const r of enriched) {
      const row = clientCpes.find((d) => d.id === r.id);
      if (!row) continue;
      // Solo persistir si hay evidencia clara (estación vista o AP confirmó caída).
      if (!r.online && !r.apConfirmedDown) continue;
      await persistPollResult(row, r);
      updated++;
      if (r.online) online++;
      else offline++;
    }
  }

  return { sites, updated, online, offline };
}

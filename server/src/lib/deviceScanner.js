import { db } from '../db/index.js';
import { equipment, detectedDevices } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { orgFilter } from './tenant.js';
import { isEdgeRouterType, edgeosLogin, edgeosDataGet, resolveHost, resolvePort, getRouterCredentials } from './edgeosClient.js';
import { mikrotikRequest } from './mikrotikClient.js';
import { listDhcpLeases } from './mikrotikNetwork.js';
import { syncDetectedDeviceStates } from './detectedDeviceSync.js';

// ─── Helpers ─────────────────────────────────────────────────

function normalizeMac(mac) {
  if (!mac) return null;
  const clean = String(mac).toLowerCase().replace(/[^0-9a-f]/g, '');
  if (clean.length !== 12) return null;
  return clean.replace(/(.{2})(?=.)/g, '$1:');
}

function isInfrastructureDevice(device, router, allRouters = []) {
  const ip = String(device.ipAddress || '').split('/')[0];
  if (!ip) return false;

  // Red del container cloudflared en MikroTik
  if (ip.startsWith('172.30.')) return true;

  const hostname = String(device.hostname || '').toLowerCase();
  if (/edgerouter|mikrotik|router|cloudflared|fibranexus/i.test(hostname)) return true;

  for (const r of [router, ...allRouters]) {
    if (!r) continue;
    const creds = r.credentials || {};
    const candidates = [
      creds.routerLocalIp,
      r.ipAddress,
    ].filter(Boolean).map((h) => String(h).split('/')[0].replace(/^https?:\/\//, '').split(':')[0]);

    if (candidates.includes(ip)) return true;
  }

  // Gateway típico del propio router en LAN (.1)
  if (/\.(1|254)$/.test(ip) && device.source === 'arp') {
    const onContainers = String(device.interfaceName || '').toLowerCase().includes('container');
    if (onContainers) return true;
  }

  return false;
}

// ─── MikroTik ────────────────────────────────────────────────

async function getDevicesFromMikrotik(router) {
  const devicesMap = new Map();

  const leases = await listDhcpLeases(router).catch(() => []);
  for (const lease of leases) {
    const mac = normalizeMac(lease['mac-address']);
    if (!mac) continue;
    devicesMap.set(mac, {
      macAddress: mac,
      ipAddress: String(lease['active-address'] || lease.address || '').split('/')[0] || null,
      hostname: lease['host-name'] || lease.comment || null,
      interfaceName: lease.server || null,
      source: 'dhcp',
    });
  }

  const arpEntries = await mikrotikRequest(router, 'GET', '/ip/arp').catch(() => []);
  for (const entry of (Array.isArray(arpEntries) ? arpEntries : [])) {
    if (entry.invalid === 'true' || entry.dynamic === 'false') continue;
    const mac = normalizeMac(entry['mac-address']);
    if (!mac) continue;
    if (!devicesMap.has(mac)) {
      devicesMap.set(mac, {
        macAddress: mac,
        ipAddress: String(entry.address || '').split('/')[0] || null,
        hostname: entry.comment || null,
        interfaceName: entry.interface || null,
        source: 'arp',
      });
    } else if (!devicesMap.get(mac).interfaceName && entry.interface) {
      devicesMap.get(mac).interfaceName = entry.interface;
    }
  }

  return Array.from(devicesMap.values());
}

// ─── EdgeRouter — heartbeat (agent mode) ─────────────────────

function getDevicesFromHeartbeat(router) {
  const creds = router.credentials || {};
  const devicesMap = new Map();

  for (const entry of (creds.heartbeatDhcp || [])) {
    const mac = normalizeMac(entry.mac);
    if (!mac) continue;
    devicesMap.set(mac, {
      macAddress: mac,
      ipAddress: entry.ip || null,
      hostname: null,
      interfaceName: null,
      source: 'dhcp',
    });
  }

  for (const entry of (creds.heartbeatArp || [])) {
    const mac = normalizeMac(entry.mac);
    if (!mac) continue;
    if (!devicesMap.has(mac)) {
      devicesMap.set(mac, {
        macAddress: mac,
        ipAddress: entry.ip || null,
        hostname: null,
        interfaceName: null,
        source: 'arp',
      });
    }
  }

  return Array.from(devicesMap.values());
}

// ─── EdgeRouter — API mode (direct/tunnel) ───────────────────

function extractEdgeosDhcpLeases(data) {
  const results = [];
  if (!data || typeof data !== 'object') return results;
  const leaseRoot = data?.data?.leases ?? data?.data ?? data;

  // Formato A: { 'dhcp-leases': { poolName: [{ 'ip-addr', 'mac-addr', 'client-hostname' }] } }
  const poolsA = leaseRoot?.['dhcp-leases'] ?? {};
  for (const [, poolLeases] of Object.entries(poolsA)) {
    for (const lease of (Array.isArray(poolLeases) ? poolLeases : [])) {
      const mac = normalizeMac(lease['mac-addr'] ?? lease['mac-address'] ?? lease.mac);
      const ip = String(lease['ip-addr'] ?? lease['ip-address'] ?? lease.ip ?? '').split('/')[0];
      if (mac && ip) results.push({ mac, ip, hostname: lease['client-hostname'] || null, interfaceName: null });
    }
  }
  if (results.length) return results;

  // Formato B: { 'dhcp-lease': { poolName: { lease: [...] } } }
  const poolsB = leaseRoot?.['dhcp-lease'] ?? {};
  for (const [, poolData] of Object.entries(poolsB)) {
    const arr = Array.isArray(poolData?.lease ?? poolData?.leases ?? poolData)
      ? (poolData?.lease ?? poolData?.leases ?? poolData)
      : [poolData?.lease ?? poolData?.leases ?? poolData].filter(Boolean);
    for (const lease of arr) {
      const mac = normalizeMac(lease?.mac ?? lease?.['mac-addr'] ?? lease?.['mac-address']);
      const ip = String(lease?.ip ?? lease?.['ip-addr'] ?? '').split('/')[0];
      if (mac && ip) results.push({ mac, ip, hostname: lease?.hostname || null, interfaceName: null });
    }
  }
  if (results.length) return results;

  // Formato C: objeto plano { "192.168.x.x": { mac, hostname } }
  for (const [key, val] of Object.entries(leaseRoot || {})) {
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(key) && val && typeof val === 'object') {
      const mac = normalizeMac(val.mac ?? val['mac-address'] ?? val['mac-addr'] ?? val['hardware-address']);
      if (mac) results.push({ mac, ip: key, hostname: val['client-hostname'] || val.hostname || null, interfaceName: null });
    }
  }
  return results;
}

function extractEdgeosArpEntries(data) {
  const results = [];
  if (!data || typeof data !== 'object') return results;
  const arpRoot = data?.data?.arp_table ?? data?.data?.neighbors ?? data?.data?.arp ?? data?.data ?? data;

  // Formato array: { entry: [...] } o directamente array
  const entries = arpRoot?.entry ?? (Array.isArray(arpRoot) ? arpRoot : []);
  for (const e of (Array.isArray(entries) ? entries : [entries]).filter(Boolean)) {
    const mac = normalizeMac(e.mac ?? e['mac-address'] ?? e['mac-addr'] ?? e['lladdr']);
    const ip = String(e.ip ?? e['ip-address'] ?? e['ip-addr'] ?? '').split('/')[0];
    if (mac && ip) results.push({ mac, ip, interfaceName: e.interface ?? e.dev ?? null });
  }
  if (results.length) return results;

  // Formato plano: { "ip": { mac, state } }
  if (!Array.isArray(arpRoot)) {
    for (const [key, val] of Object.entries(arpRoot || {})) {
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(key) && val && typeof val === 'object') {
        const mac = normalizeMac(val.mac ?? val['mac-address'] ?? val['lladdr']);
        if (mac) results.push({ mac, ip: key, interfaceName: val.interface ?? val.dev ?? null });
      }
    }
  }
  return results;
}

async function getDevicesFromEdgeOSApi(router) {
  const host = resolveHost(router);
  const port = resolvePort(router);
  if (!host) return [];

  const { user, pass } = getRouterCredentials(router);
  let cookie, csrfToken;
  try {
    ({ cookie, csrfToken } = await edgeosLogin({ host, port, user, pass, timeout: 8000 }));
  } catch (err) {
    console.warn('[deviceScanner] EdgeOS login %s: %s', router.name, err.message);
    return [];
  }

  const devicesMap = new Map();

  // DHCP leases
  try {
    const data = await edgeosDataGet({ host, port, cookie, csrfToken, dataPath: 'dhcp_leases', timeout: 7000 });
    for (const e of extractEdgeosDhcpLeases(data)) {
      devicesMap.set(e.mac, { macAddress: e.mac, ipAddress: e.ip, hostname: e.hostname, interfaceName: e.interfaceName, source: 'dhcp' });
    }
  } catch (err) {
    console.warn('[deviceScanner] EdgeOS dhcp_leases %s: %s', router.name, err.message);
  }

  // ARP table (intenta ambas rutas)
  for (const dataPath of ['arp_table', 'arp']) {
    try {
      const data = await edgeosDataGet({ host, port, cookie, csrfToken, dataPath, timeout: 6000 });
      const entries = extractEdgeosArpEntries(data);
      if (!entries.length) continue;
      for (const e of entries) {
        if (!devicesMap.has(e.mac)) {
          devicesMap.set(e.mac, { macAddress: e.mac, ipAddress: e.ip, hostname: null, interfaceName: e.interfaceName, source: 'arp' });
        }
      }
      break;
    } catch { /* silencioso */ }
  }

  return Array.from(devicesMap.values());
}

// ─── Dispatcher de adaptadores ───────────────────────────────

async function getDevicesForRouter(router) {
  const creds = router.credentials || {};
  const routerType = String(creds.routerType || '').toLowerCase();
  const isEdge = isEdgeRouterType(routerType) || String(router.brand || '').toLowerCase().includes('ubiquiti');
  const isMikrotik = routerType.startsWith('mikrotik') || String(router.brand || '').toLowerCase().includes('mikrotik');

  if (isEdge) {
    // Heartbeat (agente en modo push) tiene prioridad — no requiere conexión entrante
    const fromHeartbeat = getDevicesFromHeartbeat(router);
    if (fromHeartbeat.length > 0) return fromHeartbeat;

    // Fallback: API directa si tiene credenciales y es accesible
    if (creds.routerUser && creds.routerPass) {
      return getDevicesFromEdgeOSApi(router).catch((err) => {
        console.warn('[deviceScanner] EdgeOS API fallback %s: %s', router.name, err.message);
        return [];
      });
    }
    return [];
  }

  if (isMikrotik && creds.routerUser && creds.routerPass) {
    return getDevicesFromMikrotik(router).catch((err) => {
      console.warn('[deviceScanner] MikroTik %s: %s', router.name, err.message);
      return [];
    });
  }

  return [];
}

// ─── UPSERT en BD ────────────────────────────────────────────

async function upsertDetectedDevices(router, devices, orgId, allRouters = []) {
  let upserted = 0;
  const now = new Date();

  for (const device of devices) {
    if (!device.macAddress) continue;
    if (isInfrastructureDevice(device, router, allRouters)) continue;
    try {
      await db.insert(detectedDevices).values({
        organizationId: orgId,
        equipmentId: router.id,
        macAddress: device.macAddress,
        ipAddress: device.ipAddress || null,
        hostname: device.hostname || null,
        interfaceName: device.interfaceName || null,
        source: device.source || 'dhcp',
        firstSeen: now,
        lastSeen: now,
        status: 'detected',
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [detectedDevices.equipmentId, detectedDevices.macAddress],
        set: {
          ipAddress: device.ipAddress || null,
          hostname: device.hostname || null,
          interfaceName: device.interfaceName || null,
          lastSeen: now,
          updatedAt: now,
        },
      });
      upserted++;
    } catch (err) {
      console.warn('[deviceScanner] upsert mac=%s router=%d: %s', device.macAddress, router.id, err.message);
    }
  }
  return upserted;
}

// ─── Scanner principal ────────────────────────────────────────

export async function scanDevicesForOrg(orgId) {
  const routers = await db.select().from(equipment)
    .where(and(eq(equipment.type, 'router'), orgFilter(equipment, orgId)));

  let totalUpserted = 0;
  let scannedRouters = 0;

  for (const router of routers) {
    try {
      const devices = await getDevicesForRouter(router);
      const filtered = devices.filter((d) => !isInfrastructureDevice(d, router, routers));
      if (!filtered.length) continue;
      const count = await upsertDetectedDevices(router, filtered, orgId, routers);
      totalUpserted += count;
      scannedRouters++;
      console.log('[deviceScanner] router=%s (%s) found=%d upserted=%d', router.name, router.id, devices.length, count);
    } catch (err) {
      console.error('[deviceScanner] router=%s error: %s', router.name, err.message);
    }
  }

  await syncDetectedDeviceStates(orgId).catch((err) => {
    console.warn('[deviceScanner] sync detected states org=%d: %s', orgId, err.message);
  });

  return { scannedRouters, totalUpserted };
}

export async function scanDevicesForAllOrgs() {
  const { organizations } = await import('../db/schema.js');
  const { eq: eqFn } = await import('drizzle-orm');
  const orgs = await db.select({ id: organizations.id })
    .from(organizations)
    .where(eqFn(organizations.isActive, true));

  let total = 0;
  for (const org of orgs) {
    const result = await scanDevicesForOrg(org.id).catch((err) => {
      console.error('[deviceScanner] org=%d error: %s', org.id, err.message);
      return { scannedRouters: 0, totalUpserted: 0 };
    });
    total += result.totalUpserted;
  }
  return { totalUpserted: total };
}
